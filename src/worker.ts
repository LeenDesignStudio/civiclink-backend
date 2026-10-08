import { pathToFileURL } from 'node:url';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { logger } from './lib/logger.js';
import { systemClock } from './lib/clock.js';
import { startBoss } from './jobs/boss.js';
import { registerHandlers, type WorkerServices } from './jobs/handlers/index.js';
import { registerSchedules } from './jobs/schedules.js';
import { RetentionRepo } from './jobs/retention.repo.js';
import { RetentionService } from './jobs/retention.js';
import { ConsoleEmailSender, SesEmailSender } from './modules/notifications/email.js';
import { NotificationsRepo } from './modules/notifications/notifications.repo.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';
import { ConsolePushSender, FcmPushSender } from './modules/notifications/push.js';
import { AlertsRepo } from './modules/alerts/alerts.repo.js';
import { AuditRepo } from './modules/audit/audit.repo.js';
import { AuditService } from './modules/audit/audit.service.js';
import { PipelineRepo } from './modules/pipeline/pipeline.repo.js';
import { PipelineService } from './modules/pipeline/pipeline.service.js';
import { BillingRepo } from './modules/billing/billing.repo.js';
import { BillingService } from './modules/billing/billing.service.js';
import { StripeBillingProvider } from './modules/billing/stripe.provider.js';

export function isWorkerMain(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  return metaUrl === pathToFileURL(argv1).href;
}

export async function startWorker(): Promise<{ stop: () => Promise<void> }> {
  const boss = await startBoss(env.DATABASE_URL);
  const notificationsRepo = new NotificationsRepo(prisma);
  const alertsRepo = new AlertsRepo(prisma);
  const email =
    env.EMAIL_PROVIDER === 'ses'
      ? new SesEmailSender({
          fetchFn: fetch,
          endpoint: `https://email.${env.AWS_REGION}.amazonaws.com/v2/email/outbound-emails`,
          from: env.EMAIL_FROM,
        })
      : new ConsoleEmailSender();
  const push =
    env.PUSH_PROVIDER === 'fcm'
      ? new FcmPushSender({
          fetchFn: fetch,
          endpoint: 'https://fcm.googleapis.com/v1/projects/civiclink/messages:send',
          authorization: `Bearer ${env.FCM_SERVICE_ACCOUNT_JSON ?? ''}`,
        })
      : new ConsolePushSender();
  const notifications = new NotificationsService({
    repo: notificationsRepo,
    email,
    push,
    clock: systemClock,
    links: { secret: env.LINK_SIGNING_SECRET, webUrl: env.PUBLIC_WEB_URL },
    enqueue: {
      enqueue: async (name, data, options) => {
        await boss.send(name, data, options?.singletonKey ? { singletonKey: options.singletonKey } : {});
      },
    },
    markAlertSent: (alertId, recipientCount, sentAt) => alertsRepo.markSent(alertId, recipientCount, sentAt),
  });
  const audit = new AuditService(new AuditRepo(prisma));
  const store = new PipelineRepo(prisma);
  const pipeline = new PipelineService({
    store,
    fetch: {
      get: async (url, init) => {
        const response = await fetch(url, {
          ...(init.headers ? { headers: init.headers } : {}),
          signal: AbortSignal.timeout(init.timeoutMs),
        });
        const bytes = new Uint8Array(await response.arrayBuffer());
        return {
          status: response.status,
          body: bytes,
          contentType: response.headers.get('content-type') ?? '',
        };
      },
    },
    audit,
    clock: systemClock,
  });
  const retention = new RetentionService(new RetentionRepo(prisma), systemClock);
  const billing = new BillingService({
    repo: new BillingRepo(prisma),
    provider: StripeBillingProvider.fromApiKey(env.STRIPE_SECRET_KEY),
    publicWebUrl: env.PUBLIC_WEB_URL,
  });
  const services: WorkerServices = {
    notifications,
    pipeline,
    retention,
    applyBillingEvent: (_ctx, event) => billing.applyStripeEvent(event).then(() => undefined),
  };
  await registerHandlers(boss, services);
  await registerSchedules(boss);
  return {
    stop: async () => {
      await boss.stop({ graceful: true, timeout: 20_000 });
      await prisma.$disconnect();
    },
  };
}

if (isWorkerMain(import.meta.url, process.argv[1])) {
  startWorker()
    .then((worker) => {
      const shutdown = (): void => {
        worker.stop().then(
          () => {
            process.exit(0);
          },
          () => {
            process.exit(1);
          },
        );
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    })
    .catch((err: unknown) => {
      logger.fatal({ err: err instanceof Error ? err.name : 'error' }, 'worker failed to start');
      process.exit(1);
    });
}
