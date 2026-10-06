import type { FastifyReply } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  COOKIE_ACCESS,
  COOKIE_ADMIN,
  COOKIE_OAUTH,
  COOKIE_REFRESH,
  readOAuthCookie,
  setAccessCookie,
  setAdminCookie,
  setOAuthCookie,
  setRefreshCookie,
  type OAuthCookiePayload,
} from './cookies.js';

function replyCapture() {
  const set: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const reply = {
    setCookie(name: string, value: string, options: Record<string, unknown>) {
      set.push({ name, value, options });
      return reply;
    },
    clearCookie() {
      return reply;
    },
  };
  return { set, reply: reply as unknown as FastifyReply };
}

const payload: OAuthCookiePayload = {
  provider: 'google',
  state: 'state-value-1',
  nonce: 'nonce-value-1',
  codeVerifier: 'verifier-value-1',
  intent: 'SIGN_IN',
  returnTo: '/me',
};

describe('auth cookies', () => {
  it('round-trips the oauth cookie and sets host-only attributes', () => {
    const now = new Date('2026-04-01T12:00:00.000Z');
    const google = replyCapture();
    setOAuthCookie(google.reply, payload, now);
    const saved = google.set[0];
    expect(saved?.name).toBe(COOKIE_OAUTH);
    expect(saved?.options).toMatchObject({ path: '/', httpOnly: true, secure: true, sameSite: 'lax' });
    expect(saved?.options).not.toHaveProperty('domain');
    expect(readOAuthCookie(saved?.value, now)).toEqual(payload);

    const apple = replyCapture();
    setOAuthCookie(apple.reply, { ...payload, provider: 'apple' }, now);
    expect(apple.set[0]?.options.sameSite).toBe('none');

    const access = replyCapture();
    setAccessCookie(access.reply, 'jwt');
    expect(access.set[0]).toMatchObject({ name: COOKIE_ACCESS, options: { sameSite: 'lax', secure: true, httpOnly: true, path: '/' } });

    const refresh = replyCapture();
    setRefreshCookie(refresh.reply, 'refresh');
    expect(refresh.set[0]?.name).toBe(COOKIE_REFRESH);
    expect(refresh.set[0]?.options.sameSite).toBe('strict');

    const admin = replyCapture();
    setAdminCookie(admin.reply, 'admin');
    expect(admin.set[0]?.name).toBe(COOKIE_ADMIN);
    expect(admin.set[0]?.options.sameSite).toBe('strict');
  });
});
