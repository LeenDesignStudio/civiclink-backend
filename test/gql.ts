import type { AppServices } from '../src/app/services.js';
import type { Principal } from '../src/authz/authz.js';
import { MemoryRateGate } from '../src/lib/rate-limit.js';
import { buildServer } from '../src/http/server.js';

export interface GraphQLResult {
  status: number;
  body: {
    data?: Record<string, unknown> | null;
    errors?: { message: string; extensions?: { code?: string; requestId?: string } }[];
  };
}

export function gql(principal: Principal, services: AppServices) {
  return {
    async execute(query: string, variables?: Record<string, unknown>): Promise<GraphQLResult> {
      const app = await buildServer({
        services,
        rateGate: new MemoryRateGate(),
        readiness: { isShuttingDown: () => false, pingDb: async () => true },
        resolvePrincipal: () => Promise.resolve(principal),
      });
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/graphql',
          headers: {
            origin: 'http://localhost:3000',
            'content-type': 'application/json',
            'x-civiclink-csrf': '1',
          },
          payload: variables ? { query, variables } : { query },
        });
        return { status: response.statusCode, body: response.json<GraphQLResult['body']>() };
      } finally {
        await app.close();
      }
    },
  };
}

export function expectCode(result: GraphQLResult, code: string): void {
  const actual = result.body.errors?.[0]?.extensions?.code;
  if (actual !== code) {
    throw new Error(`expected ${code}, received ${actual ?? 'no error'}`);
  }
}
