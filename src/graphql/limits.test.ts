import { Lexer, Source, TokenKind, buildSchema, getIntrospectionQuery, parse, validate } from 'graphql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AppServices } from '../app/services.js';
import { MemoryRateGate } from '../lib/rate-limit.js';
import { buildServer } from '../http/server.js';
import { aliasLimitRule, costLimitRule, depthLimitRule, directiveLimitRule } from './limits.js';

function services(): AppServices {
  const method = () => Promise.resolve(undefined);
  const service = new Proxy({}, { get: () => method });
  return new Proxy({} as AppServices, { get: () => service });
}

function tokenCount(source: string): number {
  const lexer = new Lexer(new Source(source));
  let count = 0;
  let token = lexer.advance();
  while (token.kind !== TokenKind.EOF) {
    count += 1;
    token = lexer.advance();
  }
  return count;
}

function tokenDocuments(): { under: string; over: string } {
  const document = (count: number) =>
    Array.from({ length: count }, (_, index) => `query Q${String(index)} { health }`).join('\n');
  let count = 1;
  while (tokenCount(document(count)) < 2000) count += 1;
  const boundary = tokenCount(document(count));
  return {
    under: document(count - 1),
    over: boundary > 2000 ? document(count) : document(count + 1),
  };
}

function nestedProbe(depth: number): string {
  let inner = 'value';
  for (let level = 0; level < depth - 2; level += 1) inner = `next { ${inner} }`;
  return `{ probe { ${inner} } }`;
}

function aliases(count: number): string {
  return `{ ${Array.from({ length: count }, (_, index) => `a${String(index)}: health`).join(' ')} }`;
}

function directives(count: number): string {
  const fields = ['health @skip(if: false) @include(if: true)'];
  let remaining = count - 2;
  let index = 0;
  while (remaining > 0) {
    const marks = remaining === 1 ? '@skip(if: false)' : '@skip(if: false) @include(if: true)';
    fields.push(`a${String(index)}: health ${marks}`);
    remaining -= remaining === 1 ? 1 : 2;
    index += 1;
  }
  return `{ ${fields.join(' ')} }`;
}

function expensiveServices(): string {
  const edges = Array.from(
    { length: 10 },
    (_, index) => `a${String(index)}: edges { cursor node { title category { name } } }`,
  ).join(' ');
  return `{ services(first: 100) { ${edges} } }`;
}

interface GraphQLBody {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: { code?: string; stack?: unknown } }[];
}

describe('graphql limits', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer({
      services: services(),
      rateGate: new MemoryRateGate(),
      readiness: { isShuttingDown: () => false, pingDb: () => Promise.resolve(true) },
    });
  });

  afterAll(async () => {
    await server.close();
  });

  async function execute(query: string, operationName?: string): Promise<{ status: number; body: GraphQLBody }> {
    const response = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-civiclink-csrf': '1',
      },
      payload: operationName ? { query, operationName } : { query },
    });
    return { status: response.statusCode, body: response.json<GraphQLBody>() };
  }

  function expectAllowed(result: { status: number; body: GraphQLBody }): void {
    expect(result.status).toBe(200);
    expect(result.body.errors).toBeUndefined();
    expect(result.body.data).toBeTruthy();
  }

  function expectRejected(result: { body: GraphQLBody }): void {
    const error = result.body.errors?.[0];
    expect(error?.extensions?.code).toBe('BAD_REQUEST');
    expect(error?.extensions?.stack).toBeUndefined();
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain('Did you mean');
    expect(serialized).not.toContain('\\n    at ');
    expect(serialized).not.toContain('GraphQLError');
  }

  it('allows depth 8 and rejects depth 9', async () => {
    const ok = await execute(nestedProbe(8));
    expectAllowed(ok);
    expectRejected(await execute(nestedProbe(9)));
  });

  it('allows 10 aliases and rejects 11', async () => {
    expectAllowed(await execute(aliases(10)));
    expectRejected(await execute(aliases(11)));
  });

  it('allows 20 directives and rejects 21', async () => {
    expectAllowed(await execute(directives(20)));
    expectRejected(await execute(directives(21)));
  });

  it('allows a document under 2000 tokens and rejects one over 2000', async () => {
    const { under, over } = tokenDocuments();
    expect(tokenCount(under)).toBeLessThan(2000);
    expect(tokenCount(over)).toBeGreaterThan(2000);
    expectAllowed(await execute(under, 'Q0'));
    expectRejected(await execute(over, 'Q0'));
  });

  it('allows a cheap query and rejects a nested list over the cost limit', async () => {
    expectAllowed(await execute('{ health }'));
    expectRejected(await execute(expensiveServices()));
  });

  it('still allows introspection without the CSRF header outside production', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      payload: { query: getIntrospectionQuery(), operationName: 'IntrospectionQuery' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<GraphQLBody & { data?: { __schema?: { queryType?: { name?: string } } } }>();
    expect(body.errors).toBeUndefined();
    expect(body.data?.__schema?.queryType?.name).toBe('Query');
  });
});

const ruleSchema = buildSchema(`
  type Query {
    health: String
    services(first: Int): ServiceConnection
  }
  type ServiceConnection { edges: [ServiceEdge] }
  type ServiceEdge { node: Service }
  type Service { title: String }
`);

describe('limit rules follow fragments once', () => {
  const rules = [depthLimitRule(), aliasLimitRule(), directiveLimitRule(), costLimitRule()];

  it('stops on a fragment cycle', () => {
    const document = parse('query { ...A } fragment A on Query { ...B } fragment B on Query { ...A health }');
    expect(validate(ruleSchema, document, rules)).toEqual([]);
  });

  it('counts aliases and directives inside an inline fragment', () => {
    const allowed = parse('{ ... on Query { a0: health @skip(if: false) a1: health } }');
    expect(validate(ruleSchema, allowed, rules)).toEqual([]);
    const fields = Array.from({ length: 11 }, (_, index) => `a${String(index)}: health`).join(' ');
    const tooMany = parse(`{ ... on Query { ${fields} } }`);
    expect(validate(ruleSchema, tooMany, [aliasLimitRule()]).length).toBeGreaterThan(0);
  });
});
