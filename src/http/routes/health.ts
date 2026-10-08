import type { FastifyInstance } from 'fastify';

export interface Readiness {
  isShuttingDown(): boolean;
  pingDb(): Promise<boolean>;
}

export function registerHealthRoutes(app: FastifyInstance, readiness: Readiness): void {
  app.get('/healthz', () => ({ ok: true }));
  app.get('/readyz', async (_request, reply) => {
    if (readiness.isShuttingDown()) {
      return reply.code(503).send({ ok: false });
    }
    let ready: boolean;
    try {
      ready = await Promise.race([
        readiness.pingDb(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000)),
      ]);
    } catch {
      ready = false;
    }
    if (!ready) return reply.code(503).send({ ok: false });
    return { ok: true };
  });
}
