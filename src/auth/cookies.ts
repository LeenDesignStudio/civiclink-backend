import type { FastifyReply } from 'fastify';
import '@fastify/cookie';
import { z } from 'zod';
import { env } from '../config/env.js';
import { decryptJson, encryptJson } from '../lib/crypto.js';
import { AUTH_INTENTS, type AuthIntent } from './return-to.js';

export const COOKIE_OAUTH = '__Host-cl_oauth';
export const COOKIE_ACCESS = '__Host-cl_at';
export const COOKIE_REFRESH = '__Host-cl_rt';
export const COOKIE_ADMIN = '__Host-cl_admin';

const OAUTH_MAX_AGE_SEC = 10 * 60;
const ACCESS_MAX_AGE_SEC = 15 * 60;
const REFRESH_MAX_AGE_SEC = 30 * 24 * 60 * 60;
const ADMIN_MAX_AGE_SEC = 12 * 60 * 60;

export interface OAuthCookiePayload {
  provider: 'google' | 'apple' | 'admin-google';
  state: string;
  nonce: string;
  codeVerifier: string;
  intent: AuthIntent;
  returnTo: string;
}

const oauthSchema = z
  .object({
    provider: z.enum(['google', 'apple', 'admin-google']),
    state: z.string().min(8).max(200),
    nonce: z.string().min(8).max(200),
    codeVerifier: z.string().min(8).max(200),
    intent: z.enum(AUTH_INTENTS),
    returnTo: z.string().min(1).max(2048),
  })
  .strict();

type SameSite = 'lax' | 'strict' | 'none';

function cookieOptions(sameSite: SameSite, maxAge?: number) {
  return {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite,
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

function encKey(key?: Buffer): Buffer {
  return key ?? env.cookieEncKey;
}

export function setOAuthCookie(
  reply: FastifyReply,
  payload: OAuthCookiePayload,
  now: Date,
  key?: Buffer,
): void {
  const sameSite: SameSite = payload.provider === 'apple' ? 'none' : 'lax';
  const expiresAt = new Date(now.getTime() + OAUTH_MAX_AGE_SEC * 1000);
  const value = encryptJson(encKey(key), payload, expiresAt);
  reply.setCookie(COOKIE_OAUTH, value, cookieOptions(sameSite, OAUTH_MAX_AGE_SEC));
}

export function readOAuthCookie(
  raw: string | undefined,
  now: Date,
  key?: Buffer,
): OAuthCookiePayload | undefined {
  if (!raw) return undefined;
  try {
    const parsed = oauthSchema.safeParse(decryptJson(encKey(key), raw, now));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function clearOAuthCookie(reply: FastifyReply, sameSite: SameSite = 'lax'): void {
  reply.clearCookie(COOKIE_OAUTH, cookieOptions(sameSite));
}

export function setAccessCookie(reply: FastifyReply, jwt: string): void {
  reply.setCookie(COOKIE_ACCESS, jwt, cookieOptions('lax', ACCESS_MAX_AGE_SEC));
}

export function clearAccessCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_ACCESS, cookieOptions('lax'));
}

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE_REFRESH, token, cookieOptions('strict', REFRESH_MAX_AGE_SEC));
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_REFRESH, cookieOptions('strict'));
}

export function setAdminCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE_ADMIN, token, cookieOptions('strict', ADMIN_MAX_AGE_SEC));
}

export function clearAdminCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_ADMIN, cookieOptions('strict'));
}

export function clearResidentAuthCookies(reply: FastifyReply): void {
  clearOAuthCookie(reply, 'lax');
  clearOAuthCookie(reply, 'none');
  clearAccessCookie(reply);
  clearRefreshCookie(reply);
}
