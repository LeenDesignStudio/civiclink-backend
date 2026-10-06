import type { FastifyInstance } from 'fastify';

export interface Readiness {
  isShuttingDown(): boolean;
  pingDb(): Promise<boolean>;
}

export async function registerHealthRoutes(app: FastifyInstance, readiness: Readiness): Promise<void> {
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_request, reply) => {
    if (readiness.isShuttingDown()) {
      return reply.code(503).send({ ok: false });
    }
    let ready = false;
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
