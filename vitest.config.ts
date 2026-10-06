import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { defineConfig } from 'vitest/config';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwtPrivate = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const jwtPublic = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const testEnv: Record<string, string> = {
  APP_ENV: 'test',
  PORT: '4000',
  LOG_LEVEL: 'silent',
  PUBLIC_WEB_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://civiclink_app:app@localhost:5432/civiclink_test',
  MIGRATION_DATABASE_URL: 'postgresql://civiclink_owner:owner@localhost:5432/civiclink_test',
  DB_POOL_MAX: '2',
  JWT_PRIVATE_KEY: jwtPrivate,
  JWT_PUBLIC_KEY: jwtPublic,
  JWT_KEY_ID: 'test-1',
  COOKIE_ENC_KEY: randomBytes(32).toString('base64'),
  LINK_SIGNING_SECRET: randomBytes(48).toString('base64url'),
  IP_HASH_SECRET: randomBytes(48).toString('base64url'),
  GOOGLE_CLIENT_ID: 'test-google-client',
  GOOGLE_CLIENT_SECRET: 'test-google-secret',
  APPLE_CLIENT_ID: 'test.apple.client',
  APPLE_TEAM_ID: 'TEAMID1234',
  APPLE_KEY_ID: 'KEYID12345',
  APPLE_PRIVATE_KEY: jwtPrivate,
  ADMIN_GOOGLE_CLIENT_ID: 'test-admin-google-client',
  ADMIN_GOOGLE_CLIENT_SECRET: 'test-admin-google-secret',
  ADMIN_GOOGLE_HD: 'qubalink.com',
  BOOTSTRAP_SUPER_ADMIN_EMAIL: 'bootstrap@qubalink.com',
  GOOGLE_MAPS_API_KEY: 'test-maps-key',
  STRIPE_SECRET_KEY: 'sk_test_placeholder',
  STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
  EMAIL_PROVIDER: 'console',
  EMAIL_FROM: 'CivicLink <no-reply@civiclink.local>',
  CONTACT_INBOX: 'hello@qubalink.com',
  PUSH_PROVIDER: 'console',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  POSTHOG_HOST: 'https://us.i.posthog.com',
  AWS_REGION: 'us-east-1',
  S3_BUCKET_EXPORTS: 'civiclink-test-exports',
  S3_BUCKET_SNAPSHOTS: 'civiclink-test-snapshots',
  LIMIT_DEFAULT_MAX_SAVED_LOCATIONS: '5',
  LIMIT_DEFAULT_MAX_FOLLOWS: '50',
  ACCOUNT_PURGE_DAYS: '30',
  ANON_LOOKUP_TTL_DAYS: '30',
  FRESHNESS_DEFAULT_DAYS: '90',
  GRAPHQL_INTROSPECTION: 'true',
};

export default defineConfig({
  test: {
    env: testEnv,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', 'test/setup/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'int',
          environment: 'node',
          include: ['src/**/*.int.test.ts', 'test/**/*.int.test.ts'],
          globalSetup: ['test/setup/global.ts'],
          fileParallelism: false,
          maxWorkers: 1,
          pool: 'forks',
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
