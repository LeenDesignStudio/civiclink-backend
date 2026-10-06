import type {
  DeliveryStatus,
  NotificationCategory,
  NotificationChannel,
  NotificationType,
} from '../../generated/prisma/enums.js';

export interface NotificationDto {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  sourceRef: string;
  readAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface PreferenceDto {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface DeliveryDto {
  id: string;
  notificationId: string;
  userId: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  dedupeKey: string;
  providerMessageId: string | null;
  attempts: number;
  error: string | null;
  sentAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
}

export interface FollowerRow {
  userId: string;
  email: string;
}

export interface DeliveryContext {
  delivery: DeliveryDto;
  notification: NotificationDto;
  email: string | null;
  pushTokens: string[];
}
