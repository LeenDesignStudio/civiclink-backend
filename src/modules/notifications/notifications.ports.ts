import type { Tx } from '../../auth/tx.js';
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationType,
} from '../../generated/prisma/enums.js';
import type { DeliveryContext, DeliveryDto, FollowerRow, NotificationDto, PreferenceDto } from './notifications.dto.js';

export interface NotificationListQuery {
  filter: 'ALL' | 'UNREAD' | 'ALERTS' | 'UPDATES';
  limit: number;
  after?: { createdAt: Date; id: string };
}

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  sourceRef: string;
  createdAt: Date;
}

export interface NewDelivery {
  notificationId: string;
  userId: string;
  channel: NotificationChannel;
  status: DeliveryDto['status'];
  dedupeKey: string;
  sentAt: Date | null;
  createdAt: Date;
}

export interface DeliveryPatch {
  status?: DeliveryDto['status'];
  providerMessageId?: string | null;
  attempts?: number;
  error?: string | null;
  sentAt?: Date | null;
  openedAt?: Date | null;
  clickedAt?: Date | null;
}

export interface NotificationsRepo {
  list(userId: string, query: NotificationListQuery): Promise<NotificationDto[]>;
  unreadCount(userId: string): Promise<number>;
  markRead(userId: string, ids: string[] | 'all', now: Date): Promise<number>;
  softDelete(userId: string, id: string, now: Date): Promise<NotificationDto | null>;
  preferences(userId: string): Promise<PreferenceDto[]>;
  setPreference(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<PreferenceDto>;
  upsertPush(input: { userId: string; token: string; userAgent: string | null; now: Date }): Promise<void>;
  removePush(userId: string, token: string): Promise<void>;
  revokePushToken(token: string, now: Date): Promise<void>;
  followers(target: { officeId?: string; officialId?: string }): Promise<FollowerRow[]>;
  usersByIds(userIds: string[]): Promise<FollowerRow[]>;
  enabledChannels(
    userIds: string[],
    category: NotificationCategory,
  ): Promise<Map<string, { email: boolean; push: boolean }>>;
  activePushTokens(userId: string): Promise<string[]>;
  insertNotification(row: NewNotification): Promise<{ notification: NotificationDto; created: boolean }>;
  insertDelivery(row: NewDelivery): Promise<DeliveryDto | null>;
  deliveryContext(id: string): Promise<DeliveryContext | null>;
  markDelivery(id: string, patch: DeliveryPatch): Promise<void>;
  notificationForDelivery(deliveryId: string): Promise<NotificationDto | null>;
}

export type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
