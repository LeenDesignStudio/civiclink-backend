import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import { z } from 'zod';
import { hashIp } from '../../lib/crypto.js';
import { isAppError, SessionExpiredError, ValidationError } from '../../lib/errors.js';
import type { Clock } from '../../lib/clock.js';
import { systemClock } from '../../lib/clock.js';
import type { AppleOAuth } from '../../auth/oauth/apple.js';
import type { GoogleOAuth } from '../../auth/oauth/google.js';
import type { OAuthCompleteInput } from '../../auth/oauth/flow.js';
import {
  COOKIE_OAUTH,
  COOKIE_REFRESH,
  clearOAuthCookie,
  clearResidentAuthCookies,
  readOAuthCookie,
  setAccessCookie,
  setOAuthCookie,
  setRefreshCookie,
} from '../../auth/cookies.js';
import { authFailureCode, redirectAuthError, sendAuthError } from '../../auth/http-error.js';
import {
  callbackFailure,
  logResidentSignInFailure,
  requestHost,
  residentOauthFailure,
} from '../../auth/oauth/sign-in-failure.js';
import { assertReturnTo, parseIntent, residentReturnUrl } from '../../auth/return-to.js';
import type { SessionService } from '../../auth/sessions.js';
import { ACCESS_TOKEN_VERSION, signAccessToken } from '../../auth/tokens.js';
import type { ResidentsService } from '../../modules/residents/residents.service.js';

const callbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(200).optional(),
  error: z.string().max(100).optional(),
  error_description: z.string().max(300).optional(),
});

const appleBody = callbackQuery.extend({
  user: z.string().max(4000).optional(),
});

export interface AuthRouteDeps {
  google: GoogleOAuth;
  apple: AppleOAuth;
  residents: ResidentsService;
  sessions: SessionService;
  webUrl: string;
  clock?: Clock;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const clock = deps.clock ?? systemClock;

  app.get<{ Params: { provider: string }; Querystring: { intent?: string; returnTo?: string } }>(
    '/auth/:provider/start',
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      try {
        const provider = request.params.provider;
        if (provider !== 'google' && provider !== 'apple') {
          return await sendAuthError(reply, new ValidationError('Unknown provider.'), request.id);
        }
        const intent = parseIntent(request.query.intent);
        const returnTo = assertReturnTo(request.query.returnTo);
        const oauth = provider === 'google' ? deps.google : deps.apple;
        const redirectUri = new URL(`/auth/${provider}/callback`, deps.webUrl).toString();
        const start = await oauth.begin(redirectUri);
        setOAuthCookie(
          reply,
          {
            provider,
            state: start.state,
            nonce: start.nonce,
            codeVerifier: start.codeVerifier,
            intent,
            returnTo,
          },
          clock.now(),
        );
        return await reply.redirect(start.url.toString(), 302);
      } catch (err) {
        return sendAuthError(reply, err, request.id);
      }
    },
  );

  app.get('/auth/google/callback', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      const query = callbackQuery.parse(request.query);
      await finishResident(deps, clock, 'google', query, undefined, request, reply);
    } catch (err) {
      clearOAuthCookie(reply, 'lax');
      clearOAuthCookie(reply, 'none');
      logResidentCallback(deps.webUrl, 'google', request, err);
      return redirectAuthError(reply, deps.webUrl, '/signin', authFailureCode(err));
    }
  });

  app.post('/auth/apple/callback', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      const body = appleBody.parse(request.body ?? {});
      await finishResident(deps, clock, 'apple', body, body.user, request, reply);
    } catch (err) {
      clearOAuthCookie(reply, 'lax');
      clearOAuthCookie(reply, 'none');
      logResidentCallback(deps.webUrl, 'apple', request, err);
      return redirectAuthError(reply, deps.webUrl, '/signin', authFailureCode(err));
    }
  });

  app.post('/auth/refresh', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const csrf = request.headers['x-civiclink-csrf'];
    if (typeof csrf !== 'string' || csrf.length === 0) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Missing CSRF header.', requestId: request.id },
      });
    }
    try {
      const refreshToken = request.cookies[COOKIE_REFRESH];
      if (!refreshToken) {
        clearResidentAuthCookies(reply);
        return await sendAuthError(reply, new SessionExpiredError(), request.id);
      }
      const next = await deps.sessions.rotate(refreshToken);
      const access = await signAccessToken({
        sub: next.userId,
        typ: 'resident',
        sid: next.sessionId,
        ver: ACCESS_TOKEN_VERSION,
      });
      setAccessCookie(reply, access);
      setRefreshCookie(reply, next.refreshToken);
      return await reply.status(204).send();
    } catch (err) {
      clearResidentAuthCookies(reply);
      return sendAuthError(reply, err, request.id);
    }
  });
}

async function finishResident(
  deps: AuthRouteDeps,
  clock: Clock,
  provider: 'google' | 'apple',
  query: {
    code?: string | undefined;
    state?: string | undefined;
    error?: string | undefined;
    error_description?: string | undefined;
  },
  appleUser: string | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const rawCookie = request.cookies[COOKIE_OAUTH];
  if (query.error || !query.code || !query.state) {
    throw callbackFailure({
      providerError: query.error,
      providerErrorDescription: query.error_description,
      hasCookie: Boolean(rawCookie),
      hasState: Boolean(query.state),
    });
  }
  const payload = readOAuthCookie(rawCookie, clock.now());
  if (!payload) throw residentOauthFailure('state_cookie_missing');
  if (payload.provider !== provider || payload.state !== query.state) {
    throw residentOauthFailure('state_mismatch');
  }
  if (payload.codeVerifier.length < 8) throw residentOauthFailure('pkce_missing');
  const redirectUri = new URL(`/auth/${provider}/callback`, deps.webUrl).toString();
  const currentUrl = new URL(request.url, deps.webUrl);
  const complete: OAuthCompleteInput = {
    code: query.code,
    redirectUri,
    codeVerifier: payload.codeVerifier,
    expectedState: payload.state,
    expectedNonce: payload.nonce,
    currentUrl,
    method: provider === 'apple' ? 'POST' : 'GET',
    queryState: query.state,
    ...(appleUser ? { appleUser } : {}),
  };
  const oauth = provider === 'google' ? deps.google : deps.apple;
  const identity = await oauth.complete(complete);
  let user;
  try {
    user = await deps.residents.upsertFromProvider({
      provider: identity.provider,
      providerSubject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      ...(identity.name ? { displayName: identity.name } : {}),
    });
  } catch (err) {
    if (isAppError(err) && (err.code === 'ACCOUNT_DELETED' || err.code === 'ACCOUNT_PENDING_DELETION')) throw err;
    throw residentOauthFailure('user_upsert', { cause: err });
  }
  const ua = request.headers['user-agent'];
  let session;
  try {
    session = await deps.sessions.create({
      userId: user.id,
      userStatus: user.status,
      ...(typeof ua === 'string' ? { userAgent: ua.slice(0, 400) } : {}),
      ipHash: hashIp(request.ip || 'unknown'),
    });
  } catch (err) {
    throw residentOauthFailure('session_create', { cause: err });
  }
  let access;
  try {
    access = await signAccessToken(
      { sub: user.id, typ: 'resident', sid: session.sessionId, ver: ACCESS_TOKEN_VERSION },
      { now: clock.now() },
    );
  } catch (err) {
    throw residentOauthFailure('session_create', { cause: err });
  }
  clearOAuthCookie(reply, 'lax');
  clearOAuthCookie(reply, 'none');
  setAccessCookie(reply, access);
  setRefreshCookie(reply, session.refreshToken);
  const termsAccepted = await deps.residents.termsAreCurrent(user);
  const destination = residentReturnUrl(
    deps.webUrl,
    payload.returnTo,
    termsAccepted ? undefined : { intent: payload.intent },
  );
  reply.redirect(destination, 302);
}

function logResidentCallback(
  webUrl: string,
  provider: 'google' | 'apple',
  request: FastifyRequest,
  err: unknown,
): void {
  logResidentSignInFailure({
    requestId: request.id,
    err,
    redirectUri: new URL(`/auth/${provider}/callback`, webUrl).toString(),
    host: requestHost(request.host),
  });
}
