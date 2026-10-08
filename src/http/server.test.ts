import { getIntrospectionQuery } from 'graphql';
import { describe, expect, it } from 'vitest';
import type { AppServices } from '../app/services.js';
import { MemoryRateGate } from '../lib/rate-limit.js';
import { buildServer } from './server.js';

function services(): AppServices {
  const method = () => Promise.resolve(undefined);
  const service = new Proxy({}, { get: () => method });
  return new Proxy({} as AppServices, { get: () => service });
}

async function app(options?: { shuttingDown?: boolean; db?: boolean }) {
  return buildServer({
    services: services(),
    rateGate: new MemoryRateGate(),
    readiness: {
      isShuttingDown: () => options?.shuttingDown ?? false,
      pingDb: async () => options?.db ?? true,
    },
  });
}

describe('http server', () => {
  it('serves health and security headers', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(String(response.headers['content-security-policy'])).toContain("default-src 'none'");
    expect(String(response.headers['strict-transport-security'])).toContain('max-age=63072000');
    await server.close();
  });

  it('rejects an unknown browser origin on unsafe methods', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: { query: '{ health }' },
    });
    expect(response.statusCode).toBe(403);
    await server.close();
  });

  it('returns 413 for an oversized body', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-civiclink-csrf': '1',
      },
      payload: { query: '{ health }', pad: 'x'.repeat(120_000) },
    });
    expect(response.statusCode).toBe(413);
    await server.close();
  });

  it('returns 503 from readyz while shutting down or the database is down', async () => {
    const down = await app({ shuttingDown: true });
    const shutting = await down.inject({ method: 'GET', url: '/readyz' });
    expect(shutting.statusCode).toBe(503);
    await down.close();
    const db = await app({ db: false });
    const unavailable = await db.inject({ method: 'GET', url: '/readyz' });
    expect(unavailable.statusCode).toBe(503);
    await db.close();
  });

  it('returns JSON 404 with a request id', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'GET',
      url: '/missing',
      headers: { 'x-request-id': 'req-abc12345' },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string; requestId: string } }>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe('req-abc12345');
    await server.close();
  });

  it('requires the CSRF header for a normal query and still serves it when the header is present', async () => {
    const server = await app();
    const missing = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      payload: { query: '{ health }' },
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
    const mixed = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      payload: { query: '{ __schema { queryType { name } } health }' },
    });
    expect(mixed.statusCode).toBe(403);
    const ok = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-civiclink-csrf': '1',
      },
      payload: { query: '{ health }' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ data: { health: string } }>().data.health).toBe('ok');
    await server.close();
  });

  it('allows GraphQL introspection without the CSRF header outside production', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      payload: { query: getIntrospectionQuery(), operationName: 'IntrospectionQuery' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ data?: { __schema?: { queryType?: { name?: string } } }; errors?: unknown[] }>();
    expect(body.errors).toBeUndefined();
    expect(body.data?.__schema?.queryType?.name).toBe('Query');
    await server.close();
  });

  it('still rejects a protected field when the caller is anonymous', async () => {
    const server = await app();
    const missing = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      payload: { query: '{ me { id } }' },
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
    expect(missing.body).not.toContain('"id"');
    const anonymous = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-civiclink-csrf': '1',
      },
      payload: { query: '{ me { id } }' },
    });
    const body = anonymous.json<{
      data?: { me?: { id?: string } | null };
      errors?: { extensions?: { code?: string } }[];
    }>();
    expect(body.data?.me ?? null).toBeNull();
    const code = body.errors?.[0]?.extensions?.code;
    expect(code === 'UNAUTHENTICATED' || code === 'INTERNAL').toBe(true);
    await server.close();
  });
});
