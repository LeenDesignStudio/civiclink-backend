import { hash, verify } from '@node-rs/argon2';
import { COMMON_PASSWORDS } from './common-passwords.js';

/** OWASP argon2id baseline. The library default algorithm is argon2id. 19 MiB, 2 iterations, 1 lane. */
const ARGON_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const DUMMY_PASSWORD = 'civiclink-admin-dummy-verify';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
  /** Spends a verify so an unknown email takes about as long as a wrong password. */
  dummyVerify(password: string): Promise<void>;
}

export function passwordRejection(password: string, email: string): string | null {
  if (password.length < 12) return 'Use at least 12 characters.';
  if (password.length > 200) return 'Use at most 200 characters.';
  if (password.toLowerCase() === email.trim().toLowerCase()) return "Don't use your email address.";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'Choose a password that is not commonly used.';
  return null;
}

export class Argon2Hasher implements PasswordHasher {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, ARGON_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  async dummyVerify(password: string): Promise<void> {
    this.dummyHash ??= this.hash(DUMMY_PASSWORD);
    await this.verify(await this.dummyHash, password);
  }
}

/** Test double. Hashes are `fake:` plus the password. */
export class FakePasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return Promise.resolve(`fake:${password}`);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return Promise.resolve(passwordHash === `fake:${password}`);
  }

  async dummyVerify(password: string): Promise<void> {
    await this.verify('fake:dummy-password-value', password);
  }
}
