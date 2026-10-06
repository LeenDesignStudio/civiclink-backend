export const QUEUES = {
  notifyFanout: 'notify.fanout',
  notifyEmail: 'notify.deliver.email',
  notifyPush: 'notify.deliver.push',
  alertFinalize: 'alert.finalize',
  billingApply: 'billing.applyEvent',
  billingSync: 'billing.syncPlans',
  sourceRun: 'source.run',
  locationsReresolve: 'locations.reresolve',
  linkCheck: 'services.linkcheck',
  retentionLookups: 'retention.lookups',
  retentionSessions: 'retention.sessions',
  retentionStripeEvents: 'retention.stripeEvents',
  accountsPurge: 'accounts.purge',
  emailContact: 'email.contact',
  emailAccountDeletion: 'email.accountDeletion',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const QUEUE_OPTIONS: Record<QueueName, { retryLimit: number; retryBackoff: boolean; expireInSeconds: number }> = {
  [QUEUES.notifyFanout]: { retryLimit: 5, retryBackoff: true, expireInSeconds: 900 },
  [QUEUES.notifyEmail]: { retryLimit: 3, retryBackoff: true, expireInSeconds: 120 },
  [QUEUES.notifyPush]: { retryLimit: 3, retryBackoff: true, expireInSeconds: 120 },
  [QUEUES.alertFinalize]: { retryLimit: 3, retryBackoff: true, expireInSeconds: 300 },
  [QUEUES.billingApply]: { retryLimit: 8, retryBackoff: true, expireInSeconds: 300 },
  [QUEUES.billingSync]: { retryLimit: 3, retryBackoff: true, expireInSeconds: 600 },
  [QUEUES.sourceRun]: { retryLimit: 2, retryBackoff: true, expireInSeconds: 3600 },
  [QUEUES.locationsReresolve]: { retryLimit: 2, retryBackoff: true, expireInSeconds: 3600 },
  [QUEUES.linkCheck]: { retryLimit: 2, retryBackoff: true, expireInSeconds: 3600 },
  [QUEUES.retentionLookups]: { retryLimit: 2, retryBackoff: true, expireInSeconds: 600 },
  [QUEUES.retentionSessions]: { retryLimit: 2, retryBackoff: true, expireInSeconds: 600 },
  [QUEUES.retentionStripeEvents]: { retryLimit: 2, retryBackoff: true, expireInSeconds: 600 },
  [QUEUES.accountsPurge]: { retryLimit: 3, retryBackoff: true, expireInSeconds: 1800 },
  [QUEUES.emailContact]: { retryLimit: 3, retryBackoff: true, expireInSeconds: 120 },
  [QUEUES.emailAccountDeletion]: { retryLimit: 3, retryBackoff: true, expireInSeconds: 120 },
};
