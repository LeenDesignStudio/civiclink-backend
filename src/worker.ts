import { pathToFileURL } from 'node:url';
import { env } from './config/env.js';
import { prisma, withTx } from './db/prisma.js';
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
import { httpGet } from './modules/pipeline/http.js';
import { convertTigerZip } from './modules/pipeline/ogr.js';
import { createRequestPacer } from './modules/pipeline/pace.js';
import { PipelineRepo } from './modules/pipeline/pipeline.repo.js';
import { PipelineService } from './modules/pipeline/pipeline.service.js';
import { civicLinkUserAgent } from './modules/pipeline/types.js';
import { BillingRepo } from './modules/billing/billing.repo.js';
import { BillingService } from './modules/billing/billing.service.js';
import { StripeBillingProvider } from './modules/billing/stripe.provider.js';
import { ContactRepo } from './modules/contact/contact.repo.js';
import { ResidentsRepo } from './modules/residents/residents.repo.js';
import { OutboundMail } from './jobs/outbound-mail.js';

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
    fetch: { get: httpGet },
    audit,
    clock: systemClock,
    userAgent: civicLinkUserAgent(env.CONTACT_INBOX),
    pace: createRequestPacer(1000),
    convertZip: convertTigerZip,
    withTx: (fn) => withTx((tx) => fn(tx)),
  });
  const retention = new RetentionService(new RetentionRepo(prisma), systemClock);
  const billing = new BillingService({
    repo: new BillingRepo(prisma),
    provider: StripeBillingProvider.fromApiKey(env.STRIPE_SECRET_KEY),
    publicWebUrl: env.PUBLIC_WEB_URL,
    queue: {
      enqueue: async (name, data, options) => {
        await boss.send(name, data, { singletonKey: options.singletonKey });
      },
    },
  });
  const mail = new OutboundMail({
    email,
    contactInbox: env.CONTACT_INBOX,
    purgeDays: env.ACCOUNT_PURGE_DAYS,
    clock: systemClock,
    contacts: new ContactRepo(prisma),
    residents: new ResidentsRepo(prisma),
  });
  const services: WorkerServices = {
    notifications,
    pipeline,
    retention,
    billingSync: (ctx) => billing.syncPlans(ctx).then(() => undefined),
    applyBillingEvent: (ctx, event) => billing.applyStripeEventAsSystem(ctx, event).then(() => undefined),
    sendContact: (ctx, id) => mail.sendContact(ctx, id),
    sendAccountDeletion: (ctx, id) => mail.sendAccountDeletion(ctx, id),
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
      const name = err instanceof Error ? err.name : 'unknown';
      const message = err instanceof Error ? err.message : String(err);
      const code = err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : undefined;
      logger.fatal({ err: name, ...(code ? { code } : {}), message: message.slice(0, 300) }, 'worker failed to start');
      process.exit(1);
    });
}
