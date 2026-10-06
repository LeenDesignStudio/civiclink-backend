import type { NotificationCategory, NotificationChannel } from '../../generated/prisma/enums.js';

export interface DefaultPreference {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

/** D-09: Alerts in-app + email; Updates in-app only. Push stays off until the resident opts in. */
export function defaultNotificationPreferences(): DefaultPreference[] {
  return [
    { category: 'ALERTS', channel: 'IN_APP', enabled: true },
    { category: 'ALERTS', channel: 'EMAIL', enabled: true },
    { category: 'ALERTS', channel: 'PUSH', enabled: false },
    { category: 'UPDATES', channel: 'IN_APP', enabled: true },
    { category: 'UPDATES', channel: 'EMAIL', enabled: false },
    { category: 'UPDATES', channel: 'PUSH', enabled: false },
  ];
}

export interface NotificationPrefsHook {
  ensureDefaults(userId: string): Promise<void>;
}
