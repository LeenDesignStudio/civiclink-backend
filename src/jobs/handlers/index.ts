import { isAppError } from '../../lib/errors.js';
import type { ServiceContext } from '../../graphql/context.js';
import { Authz, systemPrincipal } from '../../authz/authz.js';
import type { Permission } from '../../authz/permissions.js';
import type { Boss, BossJob } from '../boss.js';
import { QUEUE_OPTIONS, QUEUES, type QueueName } from '../queues.js';
import type { RetentionService } from '../retention.js';
import type { NotificationsService } from '../../modules/notifications/notifications.service.js';
import type { PipelineService } from '../../modules/pipeline/pipeline.service.js';

export interface WorkerServices {
  notifications: Pick<NotificationsService, 'fanout' | 'deliverEmail' | 'deliverPush' | 'finalizeAlert'>;
  pipeline: Pick<PipelineService, 'runSource' | 'locationsReresolve' | 'linkCheck'>;
  retention: Pick<RetentionService, 'purge' | 'lookups' | 'sessions' | 'stripeEvents'>;
  billingSync?: (ctx: ServiceContext) => Promise<void>;
  applyBillingEvent?: (ctx: ServiceContext, event: unknown) => Promise<void>;
  sendContact?: (ctx: ServiceContext, id: string) => Promise<void>;
  sendAccountDeletion?: (ctx: ServiceContext, id: string) => Promise<void>;
  sendAdminPasswordLink?: (
    ctx: ServiceContext,
    input: { adminUserId: string; purpose: 'INVITE' | 'RESET'; url: string },
  ) => Promise<void>;
}

export function isPermanent(err: unknown): boolean {
  return isAppError(err) && !err.retryable;
}

const JOB_PERMISSION: Record<QueueName, Permission> = {
  [QUEUES.notifyFanout]: 'system.notifications:deliver',
  [QUEUES.notifyEmail]: 'system.notifications:deliver',
  [QUEUES.notifyPush]: 'system.notifications:deliver',
  [QUEUES.alertFinalize]: 'system.notifications:deliver',
  [QUEUES.billingApply]: 'system.billing:sync',
  [QUEUES.billingSync]: 'system.billing:sync',
  [QUEUES.sourceRun]: 'system.pipeline:run',
  [QUEUES.locationsReresolve]: 'system.locations:reresolve',
  [QUEUES.linkCheck]: 'system.locations:reresolve',
  [QUEUES.retentionLookups]: 'system.retention:run',
  [QUEUES.retentionSessions]: 'system.retention:run',
  [QUEUES.retentionStripeEvents]: 'system.retention:run',
  [QUEUES.accountsPurge]: 'system.retention:run',
  [QUEUES.emailContact]: 'system.notifications:deliver',
  [QUEUES.emailAccountDeletion]: 'system.notifications:deliver',
  [QUEUES.emailAdminPasswordReset]: 'system.notifications:deliver',
};

/** Every job handler calls this with the System principal before doing work. */
export function authorizeJob(ctx: ServiceContext, name: QueueName): void {
  ctx.authz.require(JOB_PERMISSION[name]);
}

export async function registerHandlers(boss: Boss, services: WorkerServices): Promise<void> {
  const names = Object.values(QUEUES);
  for (const name of names) {
    await boss.createQueue(name, QUEUE_OPTIONS[name]);
  }
  await work(boss, QUEUES.notifyFanout, async (data) => {
    const ctx = jobContext('notify.fanout', QUEUES.notifyFanout);
    const record = objectOf(data);
    const { alertId, recipientCount, ...fanout } = record;
    const result = await services.notifications.fanout(ctx, fanout);
    if (typeof alertId === 'string') {
      const count = typeof recipientCount === 'number' ? recipientCount : result.notifications.length;
      await boss.send(QUEUES.alertFinalize, { alertId, recipientCount: count }, { singletonKey: alertId });
    }
  });
  await work(boss, QUEUES.notifyEmail, (data) =>
    services.notifications.deliverEmail(jobContext('notify.deliver.email', QUEUES.notifyEmail), data),
  );
  await work(boss, QUEUES.notifyPush, (data) =>
    services.notifications.deliverPush(jobContext('notify.deliver.push', QUEUES.notifyPush), data),
  );
  await work(boss, QUEUES.alertFinalize, (data) =>
    services.notifications.finalizeAlert(jobContext('alert.finalize', QUEUES.alertFinalize), data),
  );
  await work(boss, QUEUES.sourceRun, (data) =>
    services.pipeline.runSource(jobContext('source.run', QUEUES.sourceRun), data),
  );
  await work(boss, QUEUES.locationsReresolve, () =>
    services.pipeline.locationsReresolve(jobContext('locations.reresolve', QUEUES.locationsReresolve)),
  );
  await work(boss, QUEUES.linkCheck, () =>
    services.pipeline.linkCheck(jobContext('services.linkcheck', QUEUES.linkCheck)),
  );
  await work(boss, QUEUES.accountsPurge, () =>
    services.retention.purge(jobContext('accounts.purge', QUEUES.accountsPurge)),
  );
  await work(boss, QUEUES.retentionLookups, () =>
    services.retention.lookups(jobContext('retention.lookups', QUEUES.retentionLookups)),
  );
  await work(boss, QUEUES.retentionSessions, () =>
    services.retention.sessions(jobContext('retention.sessions', QUEUES.retentionSessions)),
  );
  await work(boss, QUEUES.retentionStripeEvents, () =>
    services.retention.stripeEvents(jobContext('retention.stripeEvents', QUEUES.retentionStripeEvents)),
  );
  await work(boss, QUEUES.billingSync, async () => {
    const ctx = jobContext('billing.syncPlans', QUEUES.billingSync);
    if (services.billingSync) await services.billingSync(ctx);
  });
  await work(boss, QUEUES.billingApply, async (data) => {
    const ctx = jobContext('billing.applyEvent', QUEUES.billingApply);
    const event = objectOf(data).event;
    if (services.applyBillingEvent) await services.applyBillingEvent(ctx, event);
  });
  await work(boss, QUEUES.emailContact, async (data) => {
    const ctx = jobContext('email.contact', QUEUES.emailContact);
    const id = stringField(data, 'contactMessageId') ?? stringField(data, 'id');
    if (services.sendContact && id) await services.sendContact(ctx, id);
  });
  await work(boss, QUEUES.emailAccountDeletion, async (data) => {
    const ctx = jobContext('email.accountDeletion', QUEUES.emailAccountDeletion);
    const id = stringField(data, 'id');
    if (services.sendAccountDeletion && id) await services.sendAccountDeletion(ctx, id);
  });
  await work(boss, QUEUES.emailAdminPasswordReset, async (data) => {
    const ctx = jobContext('email.adminPasswordReset', QUEUES.emailAdminPasswordReset);
    const record = objectOf(data);
    const adminUserId = stringField(record, 'adminUserId');
    const purpose = record.purpose === 'INVITE' || record.purpose === 'RESET' ? record.purpose : undefined;
    const url = stringField(record, 'url');
    if (services.sendAdminPasswordLink && adminUserId && purpose && url) {
      await services.sendAdminPasswordLink(ctx, { adminUserId, purpose, url });
    }
  });
}

async function work(boss: Boss, name: QueueName, handler: (data: unknown) => Promise<unknown>): Promise<void> {
  await boss.work(name, async (jobs: BossJob[]) => {
    for (const job of jobs) {
      try {
        await handler(job.data);
      } catch (err) {
        if (isPermanent(err)) {
          await boss.fail(name, job.id);
          continue;
        }
        throw err;
      }
    }
  });
}

function jobContext(job: string, queue: QueueName): ServiceContext {
  const principal = systemPrincipal(job);
  const ctx: ServiceContext = { requestId: job, principal, authz: new Authz(principal), ipHash: 'system' };
  authorizeJob(ctx, queue);
  return ctx;
}

function objectOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringField(value: unknown, key: string): string | undefined {
  const field = objectOf(value)[key];
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}
