import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv, parseEnv, type EnvSource } from './env.js';

function pemPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function validSource(overrides: EnvSource = {}): EnvSource {
  const keys = pemPair();
  return {
    APP_ENV: 'test',
    PORT: '4000',
    LOG_LEVEL: 'info',
    PUBLIC_WEB_URL: 'http://localhost:3000',
    CORS_ORIGINS: 'http://localhost:3000, http://localhost:3001',
    DATABASE_URL: 'postgresql://civiclink_app:pw@localhost:5432/civiclink_test',
    MIGRATION_DATABASE_URL: 'postgresql://civiclink_owner:pw@localhost:5432/civiclink_test',
    DB_POOL_MAX: '4',
    JWT_PRIVATE_KEY: keys.privateKey,
    JWT_PUBLIC_KEY: keys.publicKey,
    JWT_KEY_ID: 'test',
    COOKIE_ENC_KEY: randomBytes(32).toString('base64'),
    LINK_SIGNING_SECRET: 'x'.repeat(32),
    IP_HASH_SECRET: 'y'.repeat(32),
    GOOGLE_CLIENT_ID: 'g',
    GOOGLE_CLIENT_SECRET: 'gs',
    APPLE_CLIENT_ID: 'a',
    APPLE_TEAM_ID: 't',
    APPLE_KEY_ID: 'k',
    APPLE_PRIVATE_KEY: keys.privateKey,
    ADMIN_GOOGLE_CLIENT_ID: 'ag',
    ADMIN_GOOGLE_CLIENT_SECRET: 'ags',
    ADMIN_GOOGLE_HD: 'qubalink.com',
    BOOTSTRAP_SUPER_ADMIN_EMAIL: 'root@qubalink.com',
    GOOGLE_MAPS_API_KEY: 'maps',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    EMAIL_PROVIDER: 'console',
    EMAIL_FROM: 'CivicLink <no-reply@civiclink.local>',
    CONTACT_INBOX: 'hello@qubalink.com',
    PUSH_PROVIDER: 'console',
    TURNSTILE_SECRET_KEY: 'turnstile',
    AWS_REGION: 'us-east-1',
    S3_BUCKET_EXPORTS: 'exports',
    S3_BUCKET_SNAPSHOTS: 'snapshots',
    GRAPHQL_INTROSPECTION: 'true',
    ...overrides,
  };
}

describe('parseEnv', () => {
  it('parses a valid test environment', () => {
    const parsed = parseEnv(validSource());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
    expect(parsed.env.cookieEncKey).toHaveLength(32);
    expect(parsed.env.GRAPHQL_INTROSPECTION).toBe(true);
  });

  it('lists invalid keys and never echoes values', () => {
    const parsed = parseEnv(validSource({ STRIPE_SECRET_KEY: 'not-a-key', PORT: 'nope' }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.keys).toEqual(['PORT', 'STRIPE_SECRET_KEY']);
    expect(parsed.keys.join(' ')).not.toContain('not-a-key');
  });

  it('reports a missing secret by key name', () => {
    const source = validSource();
    delete source.IP_HASH_SECRET;
    const lines: string[] = [];
    expect(() =>
      loadEnv(source, {
        write: (chunk) => lines.push(chunk),
        exit: (code) => {
          throw new Error(`exit ${code}`);
        },
      }),
    ).toThrow('exit 1');
    expect(lines.join('')).toContain('IP_HASH_SECRET');
    expect(lines.join('')).not.toContain('sk_test');
  });

  it('requires the shadow database in development', () => {
    const parsed = parseEnv(validSource({ APP_ENV: 'development' }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.keys).toContain('SHADOW_DATABASE_URL');
  });

  it('forces introspection off in production and rejects console providers', () => {
    const parsed = parseEnv(
      validSource({
        APP_ENV: 'production',
        GRAPHQL_INTROSPECTION: 'true',
        DATABASE_URL: 'postgresql://civiclink_app:pw@db/civiclink?sslmode=verify-full',
        EMAIL_PROVIDER: 'ses',
        PUSH_PROVIDER: 'fcm',
        FCM_SERVICE_ACCOUNT_JSON: 'e30=',
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.env.GRAPHQL_INTROSPECTION).toBe(false);
  });

  it('rejects production database URLs without verify-full', () => {
    const parsed = parseEnv(
      validSource({
        APP_ENV: 'production',
        EMAIL_PROVIDER: 'ses',
        PUSH_PROVIDER: 'fcm',
        FCM_SERVICE_ACCOUNT_JSON: 'e30=',
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.keys).toContain('DATABASE_URL');
  });
});
