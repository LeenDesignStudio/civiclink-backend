import { OauthFailedError } from '../../lib/errors.js';
import type { IdClaims, VerifiedIdentity } from './types.js';

const SKEW_SEC = 60;
const MAX_IAT_AGE_SEC = 10 * 60;

function fail(reason: string, cause?: unknown): never {
  throw new OauthFailedError({
    ...(cause !== undefined ? { cause } : {}),
    details: { reason },
  });
}

export function emailVerified(value: unknown): boolean {
  return value === true || value === 'true';
}

export function assertIdClaims(
  claims: IdClaims,
  expected: { issuer: string; audience: string; nonce: string; now: Date },
): void {
  if (claims.iss !== expected.issuer) fail('iss');
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(expected.audience) : aud === expected.audience;
  if (!audOk) fail('aud');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= expected.now.getTime()) fail('exp');
  if (typeof claims.iat !== 'number') fail('iat');
  const nowSec = Math.floor(expected.now.getTime() / 1000);
  if (claims.iat > nowSec + SKEW_SEC) fail('iat');
  if (claims.iat < nowSec - MAX_IAT_AGE_SEC) fail('iat');
  if (!claims.nonce || claims.nonce !== expected.nonce) fail('nonce');
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) fail('sub');
  if (typeof claims.email !== 'string' || claims.email.length === 0) fail('email');
  if (!emailVerified(claims.email_verified)) fail('email_verified');
}

export function toVerifiedIdentity(
  provider: 'GOOGLE' | 'APPLE',
  claims: IdClaims,
  name?: string,
): VerifiedIdentity {
  if (typeof claims.email !== 'string') fail('email');
  const email = claims.email.trim().toLowerCase();
  if (email.length === 0) fail('email');
  const identity: VerifiedIdentity = {
    provider,
    subject: claims.sub,
    email,
    emailVerified: true,
  };
  if (typeof claims.hd === 'string' && claims.hd.length > 0) identity.hd = claims.hd;
  const resolved = name?.trim() || (typeof claims.name === 'string' ? claims.name.trim() : '');
  if (resolved.length > 0) identity.name = resolved.slice(0, 60);
  return identity;
}
