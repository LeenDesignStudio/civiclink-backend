import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeClock } from './clock.js';
import { decryptJson, encryptJson, hashIp, sha256Hex, signLink, verifyLink } from './crypto.js';

describe('crypto', () => {
  const key = randomBytes(32);
  const clock = new FakeClock(new Date('2026-01-01T00:00:00Z'));

  it('round-trips JSON and rejects tamper and expiry', () => {
    const token = encryptJson(key, { hello: 'world' }, new Date('2026-01-01T00:10:00Z'));
    expect(decryptJson(key, token, clock.now())).toEqual({ hello: 'world' });
    const raw = Buffer.from(token, 'base64url');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 0xff;
    expect(() => decryptJson(key, raw.toString('base64url'), clock.now())).toThrow();
    clock.advance(11 * 60 * 1000);
    expect(() => decryptJson(key, token, clock.now())).toThrow(/expired/);
  });

  it('signs links and rejects tamper and expiry', () => {
    const clock2 = new FakeClock(new Date('2026-01-01T00:00:00Z'));
    const token = signLink('s'.repeat(32), { user: 'u1', category: 'ALERTS' }, new Date('2026-01-02T00:00:00Z'));
    expect(verifyLink('s'.repeat(32), token, clock2.now())?.user).toBe('u1');
    expect(verifyLink('s'.repeat(32), `${token}x`, clock2.now())).toBeUndefined();
    clock2.advance(3 * 24 * 60 * 60 * 1000);
    expect(verifyLink('s'.repeat(32), token, clock2.now())).toBeUndefined();
  });

  it('hashes ip and sha256 stably', () => {
    expect(hashIp('127.0.0.1', 'secret-secret-secret-secret-secret')).toHaveLength(64);
    expect(sha256Hex('abc')).toHaveLength(64);
  });
});
