import type { Tx } from '../../auth/tx.js';
import type { AlertStatus, NotificationChannel } from '../../generated/prisma/enums.js';
import type { AlertDto, ChannelStats } from './alerts.dto.js';

export interface AlertListQuery {
  status?: AlertStatus;
  targetOfficeId?: string;
  limit: number;
  after?: { createdAt: Date; id: string };
}

export interface NewAlert {
  targetOfficeId: string | null;
  targetOfficialId: string | null;
  title: string;
  body: string;
  link: string | null;
  channels: NotificationChannel[];
  createdBy: string;
  createdAt: Date;
}

export interface AlertPatch {
  targetOfficeId: string | null;
  targetOfficialId: string | null;
  title: string;
  body: string;
  link: string | null;
  channels: NotificationChannel[];
}

export interface AlertsRepo {
  list(query: AlertListQuery): Promise<{ rows: AlertDto[]; total: number }>;
  find(id: string): Promise<AlertDto | null>;
  insert(row: NewAlert): Promise<AlertDto>;
  updateDraft(id: string, patch: AlertPatch): Promise<AlertDto | null>;
  deleteDraft(id: string): Promise<'deleted' | 'missing' | 'sent'>;
  followerCount(alert: Pick<AlertDto, 'targetOfficeId' | 'targetOfficialId'>): Promise<number>;
  previewCounts(alert: AlertDto): Promise<{ inApp: number; email: number; push: number; followers: number }>;
  claimDraft(id: string, senderId: string, tx?: Tx): Promise<boolean>;
  markSent(id: string, recipientCount: number, sentAt: Date): Promise<void>;
  channelStats(alertId: string): Promise<ChannelStats[]>;
  adminEmail(adminId: string): Promise<string | null>;
  targetExists(alert: Pick<AlertDto, 'targetOfficeId' | 'targetOfficialId'>): Promise<boolean>;
}

export type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
