import type { AlertStatus, NotificationChannel } from '../../generated/prisma/enums.js';

export interface ChannelStats {
  channel: NotificationChannel;
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  skipped: number;
  opens: number;
  clicks: number;
}

export interface AlertDto {
  id: string;
  targetOfficeId: string | null;
  targetOfficialId: string | null;
  title: string;
  body: string;
  link: string | null;
  channels: NotificationChannel[];
  status: AlertStatus;
  createdBy: string;
  sentBy: string | null;
  sentAt: Date | null;
  recipientCount: number | null;
  createdAt: Date;
}

const STAT_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH'] as const;

export function emptyStats(): ChannelStats[] {
  return STAT_CHANNELS.map((channel) => ({
    channel,
    queued: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    skipped: 0,
    opens: 0,
    clicks: 0,
  }));
}

export interface AlertPreview {
  inApp: { title: string; body: string };
  email: { subject: string; text: string };
  push: { title: string; body: string };
  recipientCount: { inApp: number; email: number; push: number; followers: number };
}
