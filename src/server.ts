import * as Sentry from '@sentry/node';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { buildContainer } from './app/container.js';
import { createAppleOidc, AppleOAuth } from './auth/oauth/apple.js';
import { createGoogleOidc, GoogleOAuth } from './auth/oauth/google.js';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { registerAdminAuthRoutes } from './http/routes/admin-auth.js';
import { registerAuthRoutes } from './http/routes/auth.js';
import { registerUnsubscribeRoutes } from './http/routes/unsubscribe.js';
import { buildServer } from './http/server.js';
import { logger } from './lib/logger.js';
import { createPostgresRateGate } from './lib/rate-limit.js';

let shuttingDown = false;

export function isServerMain(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  return metaUrl === pathToFileURL(argv1).href;
}

export async function start(): Promise<void> {
  if (env.SENTRY_DSN) {
    Sentry.init({ dsn: env.SENTRY_DSN, environment: env.APP_ENV });
  }
  const container = buildContainer();
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
  const app = await buildServer({
    services: container.services,
    rateGate: createPostgresRateGate(pool),
    ...(container.devExports ? { devExports: container.devExports } : {}),
    readiness: {
      isShuttingDown: () => shuttingDown,
      pingDb: async () => {
        await prisma.$queryRaw`SELECT 1`;
        return true;
      },
    },
  });
  const [residentGoogle, appleClient, adminGoogle] = await Promise.all([
    createGoogleOidc(),
    createAppleOidc(),
    createGoogleOidc({
      clientId: env.ADMIN_GOOGLE_CLIENT_ID,
      clientSecret: env.ADMIN_GOOGLE_CLIENT_SECRET,
    }),
  ]);
  registerAuthRoutes(app, {
    google: new GoogleOAuth(residentGoogle),
    apple: new AppleOAuth(appleClient),
    residents: container.services.residents,
    sessions: container.sessions,
    webUrl: env.PUBLIC_WEB_URL,
  });
  registerAdminAuthRoutes(app, {
    google: new GoogleOAuth(adminGoogle, {
      audience: env.ADMIN_GOOGLE_CLIENT_ID,
      hostedDomain: env.ADMIN_GOOGLE_HD,
    }),
    adminAuth: container.adminAuth,
    webUrl: env.PUBLIC_WEB_URL,
  });
  registerUnsubscribeRoutes(app, {
    notifications: container.services.notifications,
    webUrl: env.PUBLIC_WEB_URL,
  });
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown started');
    const timer = setTimeout(() => process.exit(1), 20_000);
    try {
      await app.close();
      await container.stopJobs();
      await pool.end();
      await prisma.$disconnect();
      clearTimeout(timer);
      logger.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.fatal({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (error) => {
    logger.fatal({ err: error }, 'unhandledRejection');
    void shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaughtException');
    void shutdown('uncaughtException');
  });
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'api listening');
}

if (isServerMain(import.meta.url, process.argv[1])) {
  void start();
}
