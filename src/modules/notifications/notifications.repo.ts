import { Prisma } from '../../generated/prisma/client.js';
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationType,
} from '../../generated/prisma/enums.js';
import { dbCall, prisma, type Db } from '../../db/prisma.js';
import { ConflictError } from '../../lib/errors.js';
import type { DeliveryContext, DeliveryDto, FollowerRow, NotificationDto, PreferenceDto } from './notifications.dto.js';
import type {
  DeliveryPatch,
  NewDelivery,
  NewNotification,
  NotificationListQuery,
  NotificationsRepo as NotificationsStore,
} from './notifications.ports.js';

type NotificationRow = {
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
};

function toNotification(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    sourceRef: row.sourceRef,
    readAt: row.readAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
  };
}

export class NotificationsRepo implements NotificationsStore {
  constructor(private readonly db: Db = prisma) {}

  async list(userId: string, query: NotificationListQuery): Promise<NotificationDto[]> {
    const rows = await dbCall(() =>
      this.db.notification.findMany({
        where: {
          userId,
          deletedAt: null,
          ...(query.filter === 'UNREAD' ? { readAt: null } : {}),
          ...(query.filter === 'ALERTS' ? { type: 'ALERT' as const } : {}),
          ...(query.filter === 'UPDATES' ? { type: 'RECORD_UPDATE' as const } : {}),
          ...(query.after
            ? {
                OR: [
                  { createdAt: { lt: query.after.createdAt } },
                  { createdAt: query.after.createdAt, id: { lt: query.after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      }),
    );
    return rows.map(toNotification);
  }

  async unreadCount(userId: string): Promise<number> {
    return dbCall(() =>
      this.db.notification.count({ where: { userId, deletedAt: null, readAt: null } }),
    );
  }

  async markRead(userId: string, ids: string[] | 'all', now: Date): Promise<number> {
    const result = await dbCall(() =>
      this.db.notification.updateMany({
        where: {
          userId,
          deletedAt: null,
          readAt: null,
          ...(ids === 'all' ? {} : { id: { in: ids } }),
        },
        data: { readAt: now },
      }),
    );
    return result.count;
  }

  async softDelete(userId: string, id: string, now: Date): Promise<NotificationDto | null> {
    const existing = await dbCall(() =>
      this.db.notification.findFirst({ where: { id, userId, deletedAt: null } }),
    );
    if (!existing) return null;
    const row = await dbCall(() =>
      this.db.notification.update({ where: { id }, data: { deletedAt: now } }),
    );
    return toNotification(row);
  }

  async preferences(userId: string): Promise<PreferenceDto[]> {
    const rows = await dbCall(() =>
      this.db.notificationPreference.findMany({
        where: { userId },
        select: { category: true, channel: true, enabled: true },
      }),
    );
    return rows;
  }

  async setPreference(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<PreferenceDto> {
    const row = await dbCall(() =>
      this.db.notificationPreference.upsert({
        where: { userId_category_channel: { userId, category, channel } },
        create: { userId, category, channel, enabled },
        update: { enabled },
        select: { category: true, channel: true, enabled: true },
      }),
    );
    return row;
  }

  async upsertPush(input: { userId: string; token: string; userAgent: string | null; now: Date }): Promise<void> {
    await dbCall(() =>
      this.db.pushSubscription.upsert({
        where: { token: input.token },
        create: {
          userId: input.userId,
          token: input.token,
          userAgent: input.userAgent,
          lastSeenAt: input.now,
        },
        update: {
          userId: input.userId,
          userAgent: input.userAgent,
          revokedAt: null,
          lastSeenAt: input.now,
        },
      }),
    );
  }

  async removePush(userId: string, token: string): Promise<void> {
    await dbCall(() => this.db.pushSubscription.deleteMany({ where: { userId, token } }));
  }

  async revokePushToken(token: string, now: Date): Promise<void> {
    await dbCall(() => this.db.pushSubscription.updateMany({ where: { token }, data: { revokedAt: now } }));
  }

  async followers(target: { officeId?: string; officialId?: string }): Promise<FollowerRow[]> {
    if (!target.officeId && !target.officialId) return [];
    const rows = await dbCall(() =>
      this.db.follow.findMany({
        where: {
          ...(target.officeId ? { officeId: target.officeId } : {}),
          ...(target.officialId ? { officialId: target.officialId } : {}),
          user: { status: 'ACTIVE' },
        },
        select: { userId: true, user: { select: { email: true } } },
      }),
    );
    return rows.map((row) => ({ userId: row.userId, email: row.user.email }));
  }

  async usersByIds(userIds: string[]): Promise<FollowerRow[]> {
    if (userIds.length === 0) return [];
    const rows = await dbCall(() =>
      this.db.user.findMany({
        where: { id: { in: userIds }, status: 'ACTIVE' },
        select: { id: true, email: true },
      }),
    );
    return rows.map((row) => ({ userId: row.id, email: row.email }));
  }

  async enabledChannels(
    userIds: string[],
    category: NotificationCategory,
  ): Promise<Map<string, { email: boolean; push: boolean }>> {
    const map = new Map<string, { email: boolean; push: boolean }>();
    for (const userId of userIds) map.set(userId, { email: true, push: true });
    if (userIds.length === 0) return map;
    const rows = await dbCall(() =>
      this.db.notificationPreference.findMany({
        where: { userId: { in: userIds }, category, channel: { in: ['EMAIL', 'PUSH'] } },
        select: { userId: true, channel: true, enabled: true },
      }),
    );
    for (const row of rows) {
      const current = map.get(row.userId) ?? { email: true, push: true };
      if (row.channel === 'EMAIL') current.email = row.enabled;
      if (row.channel === 'PUSH') current.push = row.enabled;
      map.set(row.userId, current);
    }
    return map;
  }

  async activePushTokens(userId: string): Promise<string[]> {
    const rows = await dbCall(() =>
      this.db.pushSubscription.findMany({
        where: { userId, revokedAt: null },
        select: { token: true },
      }),
    );
    return rows.map((row) => row.token);
  }

  async insertNotification(row: NewNotification): Promise<{ notification: NotificationDto; created: boolean }> {
    try {
      const created = await dbCall(() =>
        this.db.notification.create({
          data: {
            userId: row.userId,
            type: row.type,
            title: row.title,
            body: row.body,
            link: row.link,
            sourceRef: row.sourceRef,
            createdAt: row.createdAt,
          },
        }),
      );
      return { notification: toNotification(created), created: true };
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      const existing = await dbCall(() =>
        this.db.notification.findUnique({
          where: { userId_sourceRef: { userId: row.userId, sourceRef: row.sourceRef } },
        }),
      );
      if (!existing) throw err;
      return { notification: toNotification(existing), created: false };
    }
  }

  async insertDelivery(row: NewDelivery): Promise<DeliveryDto | null> {
    try {
      const created = await dbCall(() =>
        this.db.notificationDelivery.create({
          data: {
            notificationId: row.notificationId,
            channel: row.channel,
            status: row.status,
            dedupeKey: row.dedupeKey,
            sentAt: row.sentAt,
            createdAt: row.createdAt,
          },
        }),
      );
      return toDelivery(created, row.userId);
    } catch (err) {
      if (err instanceof ConflictError) return null;
      throw err;
    }
  }

  async deliveryContext(id: string): Promise<DeliveryContext | null> {
    const row = await dbCall(() =>
      this.db.notificationDelivery.findUnique({
        where: { id },
        include: {
          notification: { include: { user: { select: { email: true } } } },
        },
      }),
    );
    if (!row) return null;
    const tokens = await this.activePushTokens(row.notification.userId);
    return {
      delivery: toDelivery(row, row.notification.userId),
      notification: toNotification(row.notification),
      email: row.notification.user.email,
      pushTokens: tokens,
    };
  }

  async markDelivery(id: string, patch: DeliveryPatch): Promise<void> {
    const data: Prisma.NotificationDeliveryUpdateInput = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.providerMessageId !== undefined) data.providerMessageId = patch.providerMessageId;
    if (patch.attempts !== undefined) data.attempts = patch.attempts;
    if (patch.error !== undefined) data.error = patch.error;
    if (patch.sentAt !== undefined) data.sentAt = patch.sentAt;
    if (patch.openedAt !== undefined) data.openedAt = patch.openedAt;
    if (patch.clickedAt !== undefined) data.clickedAt = patch.clickedAt;
    await dbCall(() => this.db.notificationDelivery.update({ where: { id }, data }));
  }

  async notificationForDelivery(deliveryId: string): Promise<NotificationDto | null> {
    const row = await dbCall(() =>
      this.db.notificationDelivery.findUnique({
        where: { id: deliveryId },
        include: { notification: true },
      }),
    );
    return row ? toNotification(row.notification) : null;
  }
}

function toDelivery(
  row: {
    id: string;
    notificationId: string;
    channel: DeliveryDto['channel'];
    status: DeliveryDto['status'];
    dedupeKey: string;
    providerMessageId: string | null;
    attempts: number;
    error: string | null;
    sentAt: Date | null;
    openedAt: Date | null;
    clickedAt: Date | null;
  },
  userId: string,
): DeliveryDto {
  return {
    id: row.id,
    notificationId: row.notificationId,
    userId,
    channel: row.channel,
    status: row.status,
    dedupeKey: row.dedupeKey,
    providerMessageId: row.providerMessageId,
    attempts: row.attempts,
    error: row.error,
    sentAt: row.sentAt,
    openedAt: row.openedAt,
    clickedAt: row.clickedAt,
  };
}
