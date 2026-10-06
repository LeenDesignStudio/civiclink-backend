import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { SessionExpiredError } from '../lib/errors.js';
import { signAccessToken, verifyAccessToken } from './tokens.js';

const claims = { sub: 'user-1', typ: 'resident' as const, sid: 'session-1', ver: 1 };

describe('access tokens', () => {
  it('round-trips an ES256 resident token', async () => {
    const now = new Date('2026-04-01T12:00:00.000Z');
    const token = await signAccessToken(claims, { now });
    await expect(verifyAccessToken(token, { now })).resolves.toEqual(claims);
  });

  it('rejects an expired token using jose currentDate', async () => {
    const now = new Date('2026-04-01T12:00:00.000Z');
    const token = await signAccessToken(claims, { now });
    const later = new Date(now.getTime() + 16 * 60 * 1000);
    await expect(verifyAccessToken(token, { now: later })).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('accepts a token signed by the previous public key', async () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const previousPublicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const now = new Date('2026-04-01T12:00:00.000Z');
    const token = await signAccessToken(claims, {
      now,
      keys: { privateKeyPem, publicKeyPem: previousPublicKeyPem, keyId: 'old' },
    });
    await expect(
      verifyAccessToken(token, {
        now,
        keys: {
          privateKeyPem: env.JWT_PRIVATE_KEY,
          publicKeyPem: env.JWT_PUBLIC_KEY,
          keyId: env.JWT_KEY_ID,
          previousPublicKeyPem,
        },
      }),
    ).resolves.toEqual(claims);
  });
});
