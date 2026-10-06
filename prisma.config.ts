import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Used only by the Prisma CLI (migrate, seed, studio).
 * The runtime app reads DATABASE_URL via src/config/env.ts and never imports this file.
 * SHADOW_DATABASE_URL is required for `migrate dev` in development; deploy/generate do not use it.
 */
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('MIGRATION_DATABASE_URL'),
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
