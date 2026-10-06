import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const values: Record<string, string> = {
  APP_ENV: 'test',
  PORT: '4000',
  LOG_LEVEL: 'silent',
  PUBLIC_WEB_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://civiclink_app:app@localhost:5432/civiclink_test',
  MIGRATION_DATABASE_URL: 'postgresql://civiclink_owner:owner@localhost:5432/civiclink_test',
  DB_POOL_MAX: '2',
  JWT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  JWT_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  JWT_KEY_ID: 'script-1',
  COOKIE_ENC_KEY: randomBytes(32).toString('base64'),
  LINK_SIGNING_SECRET: randomBytes(48).toString('base64url'),
  IP_HASH_SECRET: randomBytes(48).toString('base64url'),
  GOOGLE_CLIENT_ID: 'script-google',
  GOOGLE_CLIENT_SECRET: 'script-google-secret',
  APPLE_CLIENT_ID: 'script.apple',
  APPLE_TEAM_ID: 'TEAMID1234',
  APPLE_KEY_ID: 'KEYID12345',
  APPLE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  ADMIN_GOOGLE_CLIENT_ID: 'script-admin-google',
  ADMIN_GOOGLE_CLIENT_SECRET: 'script-admin-secret',
  ADMIN_GOOGLE_HD: 'qubalink.com',
  BOOTSTRAP_SUPER_ADMIN_EMAIL: 'bootstrap@qubalink.com',
  GOOGLE_MAPS_API_KEY: 'script-maps',
  STRIPE_SECRET_KEY: 'sk_test_script',
  STRIPE_WEBHOOK_SECRET: 'whsec_script',
  EMAIL_PROVIDER: 'console',
  EMAIL_FROM: 'CivicLink <no-reply@civiclink.local>',
  CONTACT_INBOX: 'hello@qubalink.com',
  PUSH_PROVIDER: 'console',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  POSTHOG_HOST: 'https://us.i.posthog.com',
  AWS_REGION: 'us-east-1',
  S3_BUCKET_EXPORTS: 'civiclink-script-exports',
  S3_BUCKET_SNAPSHOTS: 'civiclink-script-snapshots',
  GRAPHQL_INTROSPECTION: 'true',
};

for (const [key, value] of Object.entries(values)) {
  if (!process.env[key]) process.env[key] = value;
}
