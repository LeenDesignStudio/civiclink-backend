import { describe, expect, it } from 'vitest';
import { Argon2Hasher, FakePasswordHasher, passwordRejection } from './passwords.js';

describe('password rules', () => {
  it('rejects short, huge, email, and common passwords', () => {
    expect(passwordRejection('short-pass', 'ada@qubalink.com')).toBe('Use at least 12 characters.');
    expect(passwordRejection('x'.repeat(201), 'ada@qubalink.com')).toBe('Use at most 200 characters.');
    expect(passwordRejection('Ada@QubaLink.com', 'ada@qubalink.com')).toBe("Don't use your email address.");
    expect(passwordRejection('password1234', 'ada@qubalink.com')).toBe('Choose a password that is not commonly used.');
    expect(passwordRejection('correct-horse-battery', 'ada@qubalink.com')).toBeNull();
  });

  it('verifies an argon2id hash and a fake hash', async () => {
    const fake = new FakePasswordHasher();
    const fakeHash = await fake.hash('correct-horse-battery');
    expect(await fake.verify(fakeHash, 'correct-horse-battery')).toBe(true);
    expect(await fake.verify(fakeHash, 'other-password')).toBe(false);
    await fake.dummyVerify('anything');

    const argon = new Argon2Hasher();
    const hashed = await argon.hash('correct-horse-battery');
    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(await argon.verify(hashed, 'correct-horse-battery')).toBe(true);
    expect(await argon.verify(hashed, 'other-password')).toBe(false);
    expect(await argon.verify('not-a-hash', 'correct-horse-battery')).toBe(false);
    await argon.dummyVerify('other-password');
  });
});
