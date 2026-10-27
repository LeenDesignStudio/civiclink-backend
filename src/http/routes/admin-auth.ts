import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import { z } from 'zod';
import type { AdminPasswordMail } from '../../auth/admin-auth.js';
import { AdminAuthService } from '../../auth/admin-auth.js';
import { setAdminCookie } from '../../auth/cookies.js';
import { sendAuthError } from '../../auth/http-error.js';
import { hashIp } from '../../lib/crypto.js';
import { fromZod, isAppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

const loginBody = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(1).max(10_000),
  })
  .strict();

const forgotBody = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
  })
  .strict();

const resetBody = z
  .object({
    token: z.string().min(20).max(200),
    password: z.string().min(1).max(10_000),
  })
  .strict();

export interface AdminAuthRouteDeps {
  adminAuth: AdminAuthService;
  enqueuePasswordMail: (job: AdminPasswordMail) => Promise<void>;
}

function requireCsrf(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.headers['x-civiclink-csrf'] === '1') return true;
  void reply.status(403).send({
    error: { code: 'FORBIDDEN', message: 'Missing CSRF header.', requestId: request.id },
  });
  return false;
}

export function registerAdminAuthRoutes(app: FastifyInstance, deps: AdminAuthRouteDeps): void {
  app.post('/admin-auth/login', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!requireCsrf(request, reply)) return;
    try {
      const parsed = loginBody.safeParse(request.body ?? {});
      if (!parsed.success) throw fromZod(parsed.error);
      const ua = request.headers['user-agent'];
      const session = await deps.adminAuth.login(parsed.data, {
        requestId: request.id,
        ipHash: hashIp(request.ip || 'unknown'),
        ...(typeof ua === 'string' ? { userAgent: ua.slice(0, 400) } : {}),
      });
      setAdminCookie(reply, session.token);
      return await reply.send({ ok: true });
    } catch (err) {
      return sendAuthError(reply, err, request.id);
    }
  });

  app.post('/admin-auth/forgot-password', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!requireCsrf(request, reply)) return;
    try {
      const parsed = forgotBody.safeParse(request.body ?? {});
      if (!parsed.success) throw fromZod(parsed.error);
      const mail = await deps.adminAuth.requestPasswordReset(parsed.data.email);
      if (mail) {
        try {
          await deps.enqueuePasswordMail(mail);
        } catch (err) {
          logger.error(
            { requestId: request.id, principalId: mail.adminUserId, err: isAppError(err) ? err.code : 'queue' },
            'admin password email was not queued',
          );
        }
      }
      return await reply.status(202).send({ ok: true });
    } catch (err) {
      return sendAuthError(reply, err, request.id);
    }
  });

  app.post('/admin-auth/reset-password', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!requireCsrf(request, reply)) return;
    try {
      const parsed = resetBody.safeParse(request.body ?? {});
      if (!parsed.success) throw fromZod(parsed.error);
      await deps.adminAuth.resetPassword(parsed.data.token, parsed.data.password);
      return await reply.send({ ok: true });
    } catch (err) {
      return sendAuthError(reply, err, request.id);
    }
  });
}
