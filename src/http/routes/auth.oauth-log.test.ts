import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppleOAuth } from '../../auth/oauth/apple.js';
import type { GoogleOAuth } from '../../auth/oauth/google.js';
import { idTokenFailure, tokenExchangeFailure } from '../../auth/oauth/sign-in-failure.js';
import { COOKIE_OAUTH, readOAuthCookie, setOAuthCookie, type OAuthCookiePayload } from '../../auth/cookies.js';
import type { SessionService } from '../../auth/sessions.js';
import type { Clock } from '../../lib/clock.js';
import { logger } from '../../lib/logger.js';
import type { ResidentsService } from '../../modules/residents/residents.service.js';
import type { ResidentRecord } from '../../modules/residents/residents.dto.js';
import { registerAuthRoutes } from './auth.js';

const SECRET = 'super-secret-auth-code';
const now = new Date('2026-04-01T12:00:00.000Z');
const clock: Clock = { now: () => now };
const webUrl = 'http://localhost:3000';
const redirectUri = `${webUrl}/auth/google/callback`;

const cookiePayload: OAuthCookiePayload = {
  provider: 'google',
  state: 'state-value-1',
  nonce: 'nonce-value-1',
  codeVerifier: 'verifier-value-1',
  intent: 'SIGN_IN',
  returnTo: '/me',
};

const identity = {
  provider: 'GOOGLE' as const,
  subject: 'subject-1',
  email: 'ada@example.com',
  emailVerified: true as const,
};

const user: ResidentRecord = {
  id: 'user-1',
  email: 'ada@example.com',
  displayName: 'Ada',
  status: 'ACTIVE',
  termsVersion: null,
  privacyVersion: null,
  acceptedAt: null,
  marketingOptIn: false,
  provider: 'GOOGLE',
  lastLoginAt: null,
  createdAt: now,
};

function oauthCookie(overrides?: Partial<OAuthCookiePayload>): string {
  const set: { value: string }[] = [];
  const reply = {
    setCookie(_name: string, value: string) {
      set.push({ value });
      return reply;
    },
  };
  setOAuthCookie(reply as never, { ...cookiePayload, ...overrides }, now);
  const value = set[0]?.value;
  if (!value) throw new Error('cookie was not set');
  return value;
}

function providerError(name: string, error: string, description: string): Error {
  const cause = new Error(`${error} code=${SECRET}`);
  cause.name = name;
  return Object.assign(cause, { error, error_description: description });
}

interface WarnLog {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

describe('resident oauth callback failure log', () => {
  const complete = vi.fn();
  const upsert = vi.fn();
  const create = vi.fn();
  const warnings: { fields: Record<string, unknown>; message: string }[] = [];
  let app: FastifyInstance;
  let restoreWarn: (() => void) | undefined;

  beforeEach(async () => {
    complete.mockReset();
    upsert.mockReset();
    create.mockReset();
    warnings.length = 0;
    const warn = vi.spyOn(logger as unknown as WarnLog, 'warn').mockImplementation((fields, message) => {
      warnings.push({ fields, message });
    });
    restoreWarn = () => warn.mockRestore();
    app = Fastify();
    await app.register(cookie);
    registerAuthRoutes(app, {
      google: { begin: vi.fn(), complete } as unknown as GoogleOAuth,
      apple: { begin: vi.fn(), complete: vi.fn() } as unknown as AppleOAuth,
      residents: { upsertFromProvider: upsert, termsAreCurrent: vi.fn() } as unknown as ResidentsService,
      sessions: { create, rotate: vi.fn() } as unknown as SessionService,
      webUrl,
      clock,
    });
  });

  afterEach(async () => {
    restoreWarn?.();
    await app.close();
  });

  it('logs state_cookie_missing and redirects to OAUTH_FAILED', async () => {
    const response = await callback();
    expectFailure(response, { reason: 'state_cookie_missing', errorName: 'OauthFailedError' });
  });

  it('logs state_mismatch and redirects to OAUTH_FAILED', async () => {
    const response = await callback({ cookie: oauthCookie(), state: 'other-state-1' });
    expectFailure(response, { reason: 'state_mismatch', errorName: 'OauthFailedError' });
  });

  it('logs pkce_missing with the provider error and redirects to OAUTH_FAILED', async () => {
    complete.mockRejectedValue(
      tokenExchangeFailure(providerError('ResponseBodyError', 'invalid_grant', 'code_verifier mismatch')),
    );
    const response = await callback({ cookie: oauthCookie() });
    expectFailure(response, {
      reason: 'pkce_missing',
      errorName: 'ResponseBodyError',
      providerError: 'invalid_grant',
      providerErrorDescription: 'code_verifier mismatch',
    });
  });

  it('logs token_exchange with the provider error and redirects to OAUTH_FAILED', async () => {
    complete.mockRejectedValue(
      tokenExchangeFailure(
        providerError('ResponseBodyError', 'invalid_client', 'The OAuth client was not found.'),
      ),
    );
    const response = await callback({ cookie: oauthCookie() });
    expectFailure(response, {
      reason: 'token_exchange',
      errorName: 'ResponseBodyError',
      providerError: 'invalid_client',
      providerErrorDescription: 'The OAuth client was not found.',
    });
  });

  it('logs id_token_verify with the claim mismatch and redirects to OAUTH_FAILED', async () => {
    complete.mockRejectedValue(idTokenFailure('nonce'));
    const response = await callback({ cookie: oauthCookie() });
    expectFailure(response, {
      reason: 'id_token_verify',
      errorName: 'OauthFailedError',
      providerErrorDescription: 'nonce mismatch',
    });
  });

  it('logs user_upsert and redirects to OAUTH_FAILED', async () => {
    complete.mockResolvedValue(identity);
    const cause = new Error(`insert failed code=${SECRET}`);
    cause.name = 'DatabaseError';
    upsert.mockRejectedValue(cause);
    const response = await callback({ cookie: oauthCookie() });
    expectFailure(response, {
      reason: 'user_upsert',
      errorName: 'DatabaseError',
      errorMessage: 'insert failed code=[redacted]',
    });
  });

  it('logs session_create and redirects to OAUTH_FAILED', async () => {
    complete.mockResolvedValue(identity);
    upsert.mockResolvedValue(user);
    const cause = new Error('session insert failed');
    cause.name = 'DatabaseError';
    create.mockRejectedValue(cause);
    const response = await callback({ cookie: oauthCookie() });
    expectFailure(response, {
      reason: 'session_create',
      errorName: 'DatabaseError',
      errorMessage: 'session insert failed',
    });
  });

  it('logs unknown and redirects to OAUTH_FAILED', async () => {
    complete.mockRejectedValue(new Error('socket hang up'));
    const response = await callback({ cookie: oauthCookie() });
    expectFailure(response, {
      reason: 'unknown',
      errorName: 'Error',
      errorMessage: 'socket hang up',
    });
  });

  async function callback(input?: { cookie?: string; state?: string }) {
    const state = input?.state ?? cookiePayload.state;
    return app.inject({
      method: 'GET',
      url: `/auth/google/callback?code=${SECRET}&state=${state}`,
      headers: {
        host: 'civic.example',
        ...(input?.cookie ? { cookie: `${COOKIE_OAUTH}=${input.cookie}` } : {}),
      },
    });
  }

  function expectFailure(
    response: { statusCode: number; headers: { location?: string | string[] | undefined } },
    expected: {
      reason: string;
      errorName: string;
      errorMessage?: string;
      providerError?: string;
      providerErrorDescription?: string;
    },
  ) {
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${webUrl}/signin?error=OAUTH_FAILED`);
    const call = warnings.find((item) => item.message === 'resident sign-in failed');
    expect(call?.message).toBe('resident sign-in failed');
    const payload = call?.fields ?? {};
    expect(payload).toMatchObject({
      reason: expected.reason,
      redirectUri,
      host: 'civic.example',
      errorName: expected.errorName,
      ...(expected.errorMessage ? { errorMessage: expected.errorMessage } : {}),
      ...(expected.providerError ? { providerError: expected.providerError } : {}),
      ...(expected.providerErrorDescription
        ? { providerErrorDescription: expected.providerErrorDescription }
        : {}),
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('verifier-value-1');
    expect(serialized).not.toContain(COOKIE_OAUTH);
  }
});

describe('localhost sign-in against the public site', () => {
  const publicWeb = 'https://civic.example';
  const begin = vi.fn();
  let app: FastifyInstance;

  beforeEach(async () => {
    begin.mockReset();
    begin.mockImplementation((redirectUri: string) =>
      Promise.resolve({
        url: new URL('https://accounts.google.com/o/oauth2/v2/auth'),
        state: 'state-value-1',
        nonce: 'nonce-value-1',
        codeVerifier: 'verifier-value-1',
        redirectUri,
      }),
    );
    app = Fastify();
    await app.register(cookie);
    registerAuthRoutes(app, {
      google: { begin, complete: vi.fn() } as unknown as GoogleOAuth,
      apple: { begin: vi.fn(), complete: vi.fn() } as unknown as AppleOAuth,
      residents: { upsertFromProvider: vi.fn(), termsAreCurrent: vi.fn() } as unknown as ResidentsService,
      sessions: { create: vi.fn(), rotate: vi.fn() } as unknown as SessionService,
      webUrl: publicWeb,
      clock,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('sends a localhost browser back to localhost', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/google/start?intent=SIGN_IN&returnTo=%2Fme',
      headers: { 'x-civiclink-web-origin': 'http://localhost:3000' },
    });
    expect(response.statusCode).toBe(302);
    expect(begin).toHaveBeenCalledWith('http://localhost:3000/auth/google/callback');
    const saved = readOAuthCookie(cookieValue(response.headers['set-cookie']), now);
    expect(saved?.webOrigin).toBe('http://localhost:3000');
  });

  it('keeps the public site when the origin is not loopback', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/google/start?intent=SIGN_IN&returnTo=%2Fme',
      headers: { origin: 'https://evil.example', 'x-civiclink-web-origin': 'https://evil.example' },
    });
    expect(response.statusCode).toBe(302);
    expect(begin).toHaveBeenCalledWith(`${publicWeb}/auth/google/callback`);
    const saved = readOAuthCookie(cookieValue(response.headers['set-cookie']), now);
    expect(saved?.webOrigin).toBeUndefined();
  });

  it('returns a failed localhost callback to the localhost sign-in page', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/auth/google/callback?code=${SECRET}&state=state-value-1`,
      headers: {
        host: 'localhost:3000',
        cookie: `${COOKIE_OAUTH}=${oauthCookie({ webOrigin: 'http://localhost:3000' })}`,
        'x-civiclink-web-origin': 'http://localhost:3000',
      },
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('http://localhost:3000/signin?error=OAUTH_FAILED');
  });
});

function cookieValue(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header.find((item) => item.startsWith(`${COOKIE_OAUTH}=`)) : header;
  if (!raw) return undefined;
  const pair = raw.split(';')[0] ?? '';
  return pair.slice(COOKIE_OAUTH.length + 1);
}
