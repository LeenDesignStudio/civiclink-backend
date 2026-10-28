import { Prisma } from '../../generated/prisma/client.js';
import type { NotificationChannel } from '../../generated/prisma/enums.js';
import { dbCall, prisma, type Db } from '../../db/prisma.js';
import type { AlertDto, ChannelStats } from './alerts.dto.js';
import type { AlertListQuery, AlertPatch, AlertsRepo as AlertsStore, NewAlert } from './alerts.ports.js';

const CHANNELS: NotificationChannel[] = ['IN_APP', 'EMAIL', 'PUSH'];

function toAlert(row: {
  id: string;
  displayId: string;
  targetOfficeId: string | null;
  targetOfficialId: string | null;
  title: string;
  body: string;
  link: string | null;
  channels: NotificationChannel[];
  status: AlertDto['status'];
  createdBy: string;
  sentBy: string | null;
  sentAt: Date | null;
  recipientCount: number | null;
  createdAt: Date;
  sender?: { name: string | null } | null;
}): AlertDto {
  const { sender, ...alert } = row;
  return { ...alert, channels: [...alert.channels], sentByName: sender?.name ?? null };
}

export class AlertsRepo implements AlertsStore {
  constructor(private readonly db: Db = prisma) {}

  async list(query: AlertListQuery): Promise<{ rows: AlertDto[]; total: number }> {
    const where = alertWhere(query, true);
    const counted = alertWhere(query, false);
    const [rows, total] = await dbCall(() =>
      Promise.all([
        this.db.alert.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit,
          include: { sender: { select: { name: true } } },
        }),
        this.db.alert.count({ where: counted }),
      ]),
    );
    return { rows: rows.map(toAlert), total };
  }

  async find(id: string): Promise<AlertDto | null> {
    const row = await dbCall(() =>
      this.db.alert.findUnique({ where: { id }, include: { sender: { select: { name: true } } } }),
    );
    return row ? toAlert(row) : null;
  }

  async insert(row: NewAlert): Promise<AlertDto> {
    const created = await dbCall(() =>
      this.db.alert.create({
        data: {
          targetOfficeId: row.targetOfficeId,
          targetOfficialId: row.targetOfficialId,
          title: row.title,
          body: row.body,
          link: row.link,
          channels: row.channels,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
        },
      }),
    );
    return toAlert(created);
  }

  async updateDraft(id: string, patch: AlertPatch): Promise<AlertDto | null> {
    const result = await dbCall(() =>
      this.db.alert.updateMany({
        where: { id, status: 'DRAFT' },
        data: {
          targetOfficeId: patch.targetOfficeId,
          targetOfficialId: patch.targetOfficialId,
          title: patch.title,
          body: patch.body,
          link: patch.link,
          channels: patch.channels,
        },
      }),
    );
    if (result.count !== 1) return null;
    return this.find(id);
  }

  async deleteDraft(id: string): Promise<'deleted' | 'missing' | 'sent'> {
    const existing = await this.find(id);
    if (!existing) return 'missing';
    if (existing.status !== 'DRAFT') return 'sent';
    await dbCall(() => this.db.alert.delete({ where: { id } }));
    return 'deleted';
  }

  async followerCount(alert: Pick<AlertDto, 'targetOfficeId' | 'targetOfficialId'>): Promise<number> {
    return dbCall(() =>
      this.db.follow.count({
        where: {
          ...(alert.targetOfficeId ? { officeId: alert.targetOfficeId } : {}),
          ...(alert.targetOfficialId ? { officialId: alert.targetOfficialId } : {}),
          user: { status: 'ACTIVE' },
        },
      }),
    );
  }

  async previewCounts(alert: AlertDto): Promise<{ inApp: number; email: number; push: number; followers: number }> {
    const followers = await dbCall(() =>
      this.db.follow.findMany({
        where: {
          ...(alert.targetOfficeId ? { officeId: alert.targetOfficeId } : {}),
          ...(alert.targetOfficialId ? { officialId: alert.targetOfficialId } : {}),
          user: { status: 'ACTIVE' },
        },
        select: { userId: true },
      }),
    );
    const ids = [...new Set(followers.map((row) => row.userId))];
    if (ids.length === 0) return { inApp: 0, email: 0, push: 0, followers: 0 };
    const prefs = await dbCall(() =>
      this.db.notificationPreference.findMany({
        where: { userId: { in: ids }, category: 'ALERTS', channel: { in: ['EMAIL', 'PUSH'] } },
        select: { userId: true, channel: true, enabled: true },
      }),
    );
    let emailOff = 0;
    let pushOff = 0;
    for (const pref of prefs) {
      if (pref.channel === 'EMAIL' && !pref.enabled) emailOff += 1;
      if (pref.channel === 'PUSH' && !pref.enabled) pushOff += 1;
    }
    return { inApp: ids.length, email: ids.length - emailOff, push: ids.length - pushOff, followers: ids.length };
  }

  async claimDraft(id: string, senderId: string): Promise<boolean> {
    const result = await dbCall(() =>
      this.db.alert.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'SENDING', sentBy: senderId },
      }),
    );
    return result.count === 1;
  }

  async markSent(id: string, recipientCount: number, sentAt: Date): Promise<void> {
    const status = await this.deliveryStatus(id);
    await dbCall(() =>
      this.db.alert.updateMany({
        where: { id, status: { in: ['SENDING', 'DRAFT'] } },
        data: { status, recipientCount, sentAt },
      }),
    );
  }

  async channelStats(alertId: string): Promise<ChannelStats[]> {
    const rows = await dbCall(() =>
      this.db.notificationDelivery.findMany({
        where: { notification: { sourceRef: `alert:${alertId}` } },
        select: { channel: true, status: true, openedAt: true, clickedAt: true },
      }),
    );
    return CHANNELS.map((channel) => {
      const matching = rows.filter((row) => row.channel === channel);
      return {
        channel,
        queued: matching.filter((row) => row.status === 'QUEUED').length,
        sent: matching.filter((row) => row.status === 'SENT').length,
        delivered: matching.filter((row) => row.status === 'DELIVERED').length,
        failed: matching.filter((row) => row.status === 'FAILED').length,
        skipped: matching.filter((row) => row.status === 'SKIPPED').length,
        opens: matching.filter((row) => row.openedAt !== null).length,
        clicks: matching.filter((row) => row.clickedAt !== null).length,
      };
    });
  }

  async failureReasons(alertId: string): Promise<{ reason: string; count: number }[]> {
    const rows = await dbCall(() =>
      this.db.notificationDelivery.findMany({
        where: { notification: { sourceRef: `alert:${alertId}` }, status: 'FAILED' },
        select: { error: true },
      }),
    );
    const counts = new Map<string, number>();
    for (const row of rows) {
      const reason = row.error?.slice(0, 120) || 'Unknown';
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5);
  }

  async alertTiles(now: Date): Promise<{ total: number; sent7d: number; drafts: number; failedOrPartly: number }> {
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const [total, sent7d, drafts, failedOrPartly] = await dbCall(() =>
      Promise.all([
        this.db.alert.count(),
        this.db.alert.count({ where: { status: 'SENT', sentAt: { gte: since } } }),
        this.db.alert.count({ where: { status: 'DRAFT' } }),
        this.db.alert.count({ where: { status: { in: ['FAILED', 'PARTLY_FAILED'] } } }),
      ]),
    );
    return { total, sent7d, drafts, failedOrPartly };
  }

  private async deliveryStatus(alertId: string): Promise<'SENT' | 'PARTLY_FAILED' | 'FAILED'> {
    const rows = await dbCall(() =>
      this.db.notificationDelivery.findMany({
        where: { notification: { sourceRef: `alert:${alertId}` } },
        select: { status: true },
      }),
    );
    const failed = rows.filter((row) => row.status === 'FAILED').length;
    const ok = rows.filter((row) => row.status === 'SENT' || row.status === 'DELIVERED').length;
    if (failed === 0) return 'SENT';
    if (ok === 0) return 'FAILED';
    return 'PARTLY_FAILED';
  }

  async adminEmail(adminId: string): Promise<string | null> {
    const row = await dbCall(() => this.db.adminUser.findUnique({ where: { id: adminId }, select: { email: true } }));
    return row?.email ?? null;
  }

  async targetExists(alert: Pick<AlertDto, 'targetOfficeId' | 'targetOfficialId'>): Promise<boolean> {
    if (alert.targetOfficeId) {
      const row = await dbCall(() =>
        this.db.office.findFirst({ where: { id: alert.targetOfficeId ?? '', status: 'ACTIVE' }, select: { id: true } }),
      );
      return row !== null;
    }
    if (alert.targetOfficialId) {
      const row = await dbCall(() =>
        this.db.official.findFirst({ where: { id: alert.targetOfficialId ?? '', status: 'ACTIVE' }, select: { id: true } }),
      );
      return row !== null;
    }
    return false;
  }
}

function alertWhere(query: AlertListQuery, withCursor: boolean): Prisma.AlertWhereInput {
  const and: Prisma.AlertWhereInput[] = [];
  if (query.status) and.push({ status: query.status });
  if (query.targetOfficeId) and.push({ targetOfficeId: query.targetOfficeId });
  if (query.channel) and.push({ channels: { has: query.channel } });
  if (query.targetType === 'OFFICE') and.push({ targetOfficeId: { not: null } });
  if (query.targetType === 'OFFICIAL') and.push({ targetOfficialId: { not: null } });
  if (query.sentBy) and.push({ sentBy: query.sentBy });
  if (query.sentFrom || query.sentTo) {
    and.push({
      sentAt: {
        ...(query.sentFrom ? { gte: query.sentFrom } : {}),
        ...(query.sentTo ? { lte: query.sentTo } : {}),
      },
    });
  }
  if (query.q) {
    and.push({
      OR: [
        { displayId: { contains: query.q, mode: 'insensitive' as const } },
        { title: { contains: query.q, mode: 'insensitive' as const } },
      ],
    });
  }
  if (withCursor && query.after) {
    and.push({
      OR: [
        { createdAt: { lt: query.after.createdAt } },
        { createdAt: query.after.createdAt, id: { lt: query.after.id } },
      ],
    });
  }
  return and.length > 0 ? { AND: and } : {};
}

