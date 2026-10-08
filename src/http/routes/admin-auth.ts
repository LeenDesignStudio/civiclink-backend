import type { FastifyInstance } from 'fastify';
import '@fastify/cookie';
import { z } from 'zod';
import { AdminAuthService } from '../../auth/admin-auth.js';
import {
  COOKIE_OAUTH,
  clearAdminCookie,
  clearOAuthCookie,
  readOAuthCookie,
  setAdminCookie,
  setOAuthCookie,
} from '../../auth/cookies.js';
import { authFailureCode, redirectAuthError, sendAuthError } from '../../auth/http-error.js';
import type { GoogleOAuth } from '../../auth/oauth/google.js';
import { hashIp } from '../../lib/crypto.js';
import { isAppError, OauthFailedError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { Clock } from '../../lib/clock.js';
import { systemClock } from '../../lib/clock.js';

const callbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(200).optional(),
  error: z.string().max(100).optional(),
});

export interface AdminAuthRouteDeps {
  google: GoogleOAuth;
  adminAuth: AdminAuthService;
  webUrl: string;
  clock?: Clock;
}

export function registerAdminAuthRoutes(app: FastifyInstance, deps: AdminAuthRouteDeps): void {
  const clock = deps.clock ?? systemClock;

  app.get('/admin-auth/google/start', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      const redirectUri = new URL('/admin-auth/google/callback', deps.webUrl).toString();
      const start = await deps.google.begin(redirectUri);
      setOAuthCookie(
        reply,
        {
          provider: 'admin-google',
          state: start.state,
          nonce: start.nonce,
          codeVerifier: start.codeVerifier,
          intent: 'SIGN_IN',
          returnTo: '/admin',
        },
        clock.now(),
      );
      return await reply.redirect(start.url.toString(), 302);
    } catch (err) {
      return sendAuthError(reply, err, request.id);
    }
  });

  app.get('/admin-auth/google/callback', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      const query = callbackQuery.parse(request.query);
      if (query.error || !query.code || !query.state) {
        throw new OauthFailedError({ details: { reason: 'callback' } });
      }
      const payload = readOAuthCookie(request.cookies[COOKIE_OAUTH], clock.now());
      if (!payload || payload.provider !== 'admin-google' || payload.state !== query.state) {
        throw new OauthFailedError({ details: { reason: 'state' } });
      }
      const redirectUri = new URL('/admin-auth/google/callback', deps.webUrl).toString();
      const identity = await deps.google.complete({
        code: query.code,
        redirectUri,
        codeVerifier: payload.codeVerifier,
        expectedState: payload.state,
        expectedNonce: payload.nonce,
        currentUrl: new URL(request.url, deps.webUrl),
        method: 'GET',
        queryState: query.state,
      });
      const ua = request.headers['user-agent'];
      const session = await deps.adminAuth.completeLogin(
        {
          email: identity.email,
          emailVerified: identity.emailVerified,
          subject: identity.subject,
          ...(identity.hd ? { hd: identity.hd } : {}),
        },
        {
          requestId: request.id,
          ipHash: hashIp(request.ip || 'unknown'),
          ...(typeof ua === 'string' ? { userAgent: ua.slice(0, 400) } : {}),
        },
      );
      clearOAuthCookie(reply, 'lax');
      setAdminCookie(reply, session.token);
      return await reply.redirect(new URL('/admin', deps.webUrl).toString(), 302);
    } catch (err) {
      clearOAuthCookie(reply, 'lax');
      clearAdminCookie(reply);
      const code = authFailureCode(err);
      const reason =
        isAppError(err) && typeof err.details?.reason === 'string' ? err.details.reason : undefined;
      logger.warn({ requestId: request.id, code, ...(reason ? { reason } : {}) }, 'admin sign-in failed');
      const redirectCode =
        code === 'ADMIN_LOCKED' || code === 'ADMIN_NOT_ALLOWED' || code === 'OAUTH_FAILED'
          ? code
          : 'ADMIN_NOT_ALLOWED';
      return redirectAuthError(reply, deps.webUrl, '/admin/login', redirectCode);
    }
  });
}
