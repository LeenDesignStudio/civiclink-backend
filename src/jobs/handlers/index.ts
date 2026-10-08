import { isAppError } from '../../lib/errors.js';
import type { ServiceContext } from '../../graphql/context.js';
import { Authz, systemPrincipal } from '../../authz/authz.js';
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
}

export function isPermanent(err: unknown): boolean {
  return isAppError(err) && !err.retryable;
}

export async function registerHandlers(boss: Boss, services: WorkerServices): Promise<void> {
  const names = Object.values(QUEUES);
  for (const name of names) {
    await boss.createQueue(name, QUEUE_OPTIONS[name]);
  }
  await work(boss, QUEUES.notifyFanout, async (data) => {
    const record = objectOf(data);
    const { alertId, recipientCount, ...fanout } = record;
    const result = await services.notifications.fanout(system('notify.fanout'), fanout);
    if (typeof alertId === 'string') {
      const count = typeof recipientCount === 'number' ? recipientCount : result.notifications.length;
      await boss.send(QUEUES.alertFinalize, { alertId, recipientCount: count }, { singletonKey: alertId });
    }
  });
  await work(boss, QUEUES.notifyEmail, (data) => services.notifications.deliverEmail(system('notify.deliver.email'), data));
  await work(boss, QUEUES.notifyPush, (data) => services.notifications.deliverPush(system('notify.deliver.push'), data));
  await work(boss, QUEUES.alertFinalize, (data) => services.notifications.finalizeAlert(system('alert.finalize'), data));
  await work(boss, QUEUES.sourceRun, (data) => services.pipeline.runSource(system('source.run'), data));
  await work(boss, QUEUES.locationsReresolve, () => services.pipeline.locationsReresolve(system('locations.reresolve')));
  await work(boss, QUEUES.linkCheck, () => services.pipeline.linkCheck(system('services.linkcheck')));
  await work(boss, QUEUES.accountsPurge, () => services.retention.purge(system('accounts.purge')));
  await work(boss, QUEUES.retentionLookups, () => services.retention.lookups(system('retention.lookups')));
  await work(boss, QUEUES.retentionSessions, () => services.retention.sessions(system('retention.sessions')));
  await work(boss, QUEUES.retentionStripeEvents, () => services.retention.stripeEvents(system('retention.stripeEvents')));
  await work(boss, QUEUES.billingSync, async () => {
    if (services.billingSync) await services.billingSync(system('billing.syncPlans'));
  });
  await work(boss, QUEUES.billingApply, async (data) => {
    const event = objectOf(data).event;
    if (services.applyBillingEvent) await services.applyBillingEvent(system('billing.applyEvent'), event);
  });
  await work(boss, QUEUES.emailContact, async (data) => {
    const id = objectOf(data).id;
    if (services.sendContact && typeof id === 'string') await services.sendContact(system('email.contact'), id);
  });
  await work(boss, QUEUES.emailAccountDeletion, async (data) => {
    const id = objectOf(data).id;
    if (services.sendAccountDeletion && typeof id === 'string') {
      await services.sendAccountDeletion(system('email.accountDeletion'), id);
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

function system(job: string): ServiceContext {
  const principal = systemPrincipal(job);
  return { requestId: job, principal, authz: new Authz(principal), ipHash: 'system' };
}

function objectOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
