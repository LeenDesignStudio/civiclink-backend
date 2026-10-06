import { z } from 'zod';

const pem = z.string().refine((value) => value.includes('-----BEGIN'), 'Expected a PEM key');

const optionalText = z
  .string()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const envSchema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    PUBLIC_WEB_URL: z.url(),
    CORS_ORIGINS: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    MIGRATION_DATABASE_URL: z.string().min(1),
    SHADOW_DATABASE_URL: optionalText,
    TEST_DATABASE_URL: optionalText,
    TEST_MIGRATION_DATABASE_URL: optionalText,
    DB_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
    JWT_PRIVATE_KEY: pem,
    JWT_PUBLIC_KEY: pem,
    JWT_KEY_ID: z.string().min(1).max(64),
    JWT_PREVIOUS_PUBLIC_KEY: optionalText,
    COOKIE_ENC_KEY: z.string().min(1),
    LINK_SIGNING_SECRET: z.string().min(32),
    IP_HASH_SECRET: z.string().min(32),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    APPLE_CLIENT_ID: z.string().min(1),
    APPLE_TEAM_ID: z.string().min(1),
    APPLE_KEY_ID: z.string().min(1),
    APPLE_PRIVATE_KEY: pem,
    ADMIN_GOOGLE_CLIENT_ID: z.string().min(1),
    ADMIN_GOOGLE_CLIENT_SECRET: z.string().min(1),
    ADMIN_GOOGLE_HD: z.string().min(1),
    BOOTSTRAP_SUPER_ADMIN_EMAIL: z.email(),
    GOOGLE_MAPS_API_KEY: z.string().min(1),
    STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
    EMAIL_PROVIDER: z.enum(['ses', 'console']),
    EMAIL_FROM: z.string().min(3),
    CONTACT_INBOX: z.email(),
    PUSH_PROVIDER: z.enum(['fcm', 'console']),
    FCM_SERVICE_ACCOUNT_JSON: optionalText,
    TURNSTILE_SECRET_KEY: z.string().min(1),
    POSTHOG_API_KEY: optionalText,
    POSTHOG_HOST: z.url().default('https://us.i.posthog.com'),
    SENTRY_DSN: optionalText,
    AWS_REGION: z.string().min(1),
    S3_BUCKET_EXPORTS: z.string().min(1),
    S3_BUCKET_SNAPSHOTS: z.string().min(1),
    LIMIT_DEFAULT_MAX_SAVED_LOCATIONS: z.coerce.number().int().positive().default(5),
    LIMIT_DEFAULT_MAX_FOLLOWS: z.coerce.number().int().positive().default(50),
    ACCOUNT_PURGE_DAYS: z.coerce.number().int().positive().default(30),
    ANON_LOOKUP_TTL_DAYS: z.coerce.number().int().positive().default(30),
    FRESHNESS_DEFAULT_DAYS: z.coerce.number().int().positive().default(90),
    GRAPHQL_INTROSPECTION: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
  })
  .superRefine((value, ctx) => {
    let cookieOk = false;
    try {
      cookieOk = Buffer.from(value.COOKIE_ENC_KEY, 'base64').length === 32;
    } catch {
      cookieOk = false;
    }
    if (!cookieOk) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_ENC_KEY'],
        message: 'COOKIE_ENC_KEY must be base64 for 32 bytes',
      });
    }
    if (value.APP_ENV === 'development' && !value.SHADOW_DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SHADOW_DATABASE_URL'],
        message: 'Required in development',
      });
    }
    if (
      (value.APP_ENV === 'staging' || value.APP_ENV === 'production') &&
      !value.DATABASE_URL.includes('sslmode=verify-full')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'sslmode=verify-full is required outside development and test',
      });
    }
    if (
      (value.APP_ENV === 'staging' || value.APP_ENV === 'production') &&
      value.EMAIL_PROVIDER === 'console'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVIDER'],
        message: 'console is only allowed in development and test',
      });
    }
    if (
      (value.APP_ENV === 'staging' || value.APP_ENV === 'production') &&
      value.PUSH_PROVIDER === 'console'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUSH_PROVIDER'],
        message: 'console is only allowed in development and test',
      });
    }
    if (value.PUSH_PROVIDER === 'fcm' && !value.FCM_SERVICE_ACCOUNT_JSON) {
      ctx.addIssue({
        code: 'custom',
        path: ['FCM_SERVICE_ACCOUNT_JSON'],
        message: 'Required when PUSH_PROVIDER=fcm',
      });
    }
    if (value.JWT_PREVIOUS_PUBLIC_KEY && !value.JWT_PREVIOUS_PUBLIC_KEY.includes('-----BEGIN')) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_PREVIOUS_PUBLIC_KEY'],
        message: 'Expected a PEM key',
      });
    }
  })
  .transform((value) => {
    const introspection = value.APP_ENV === 'production' ? false : value.GRAPHQL_INTROSPECTION;
    return {
      ...value,
      CORS_ORIGINS: value.CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
      GRAPHQL_INTROSPECTION: introspection,
      cookieEncKey: Buffer.from(value.COOKIE_ENC_KEY, 'base64'),
    };
  });

export type Env = z.infer<typeof envSchema>;

export type EnvSource = Record<string, string | undefined>;

export function parseEnv(source: EnvSource): { ok: true; env: Env } | { ok: false; keys: string[] } {
  const result = envSchema.safeParse(source);
  if (result.success) return { ok: true, env: result.data };
  const keys = [
    ...new Set(
      result.error.issues
        .map((issue) => issue.path[0])
        .filter((key): key is string => typeof key === 'string'),
    ),
  ].sort();
  return { ok: false, keys };
}

export function loadEnv(
  source: EnvSource,
  hooks?: {
    exit?: (code: number) => never;
    write?: (chunk: string) => void;
  },
): Env {
  const parsed = parseEnv(source);
  if (!parsed.ok) {
    const write = hooks?.write ?? ((chunk: string) => process.stderr.write(chunk));
    write(`Invalid environment configuration. Invalid keys: ${parsed.keys.join(', ')}\n`);
    const exit = hooks?.exit ?? ((code: number): never => process.exit(code));
    return exit(1);
  }
  return Object.freeze(parsed.env);
}

export const env: Env = loadEnv(process.env);
