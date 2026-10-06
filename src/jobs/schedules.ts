import { QUEUES } from './queues.js';

/** UTC cron expressions. pg-boss uses a 5-field cron. */
export const SCHEDULES = [
  { queue: QUEUES.locationsReresolve, cron: '0 3 * * *' },
  { queue: QUEUES.linkCheck, cron: '30 3 * * *' },
  { queue: QUEUES.retentionLookups, cron: '0 4 * * *' },
  { queue: QUEUES.retentionSessions, cron: '15 4 * * *' },
  { queue: QUEUES.retentionStripeEvents, cron: '30 4 * * *' },
  { queue: QUEUES.accountsPurge, cron: '45 4 * * *' },
  { queue: QUEUES.billingSync, cron: '0 5 * * *' },
  { queue: QUEUES.sourceRun, cron: '0 * * * *' },
] as const;

export interface Scheduler {
  schedule(name: string, cron: string, data?: object): Promise<void>;
}

export async function registerSchedules(boss: Scheduler): Promise<void> {
  for (const item of SCHEDULES) {
    await boss.schedule(item.queue, item.cron, {});
  }
}
