import { describe, expect, it } from 'vitest';
import { Authz, systemPrincipal } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { InAppLockedError } from '../../lib/errors.js';
import { FakeClock } from '../../lib/clock.js';
import type { NotificationCategory, NotificationChannel } from '../../generated/prisma/enums.js';
import { signCategoryLink, LINK_TTL_MS } from './links.js';
import type { DeliveryContext, DeliveryDto, FollowerRow, NotificationDto, PreferenceDto } from './notifications.dto.js';
import type {
  DeliveryPatch,
  NewDelivery,
  NewNotification,
  NotificationListQuery,
  NotificationsRepo,
} from './notifications.ports.js';
import { NotificationsService } from './notifications.service.js';
import { FakeEmail } from '../../../test/fakes/email.js';
import { FakePush } from '../../../test/fakes/push.js';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OFFICE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECRET = 's'.repeat(32);

class MemoryNotifications implements NotificationsRepo {
  notifications: NotificationDto[] = [];
  deliveries: DeliveryDto[] = [];
  prefs: (PreferenceDto & { userId: string })[] = [];
  people: FollowerRow[] = [];
  pushes: { userId: string; token: string; revokedAt: Date | null }[] = [];
  private n = 0;

  list(userId: string, query: NotificationListQuery): Promise<NotificationDto[]> {
    return Promise.resolve(
      this.notifications
        .filter((row) => row.userId === userId && row.deletedAt === null)
        .filter((row) => (query.filter === 'UNREAD' ? row.readAt === null : true))
        .filter((row) => (query.filter === 'ALERTS' ? row.type === 'ALERT' : true))
        .filter((row) => (query.filter === 'UPDATES' ? row.type === 'RECORD_UPDATE' : true))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, query.limit),
    );
  }

  unreadCount(userId: string): Promise<number> {
    return Promise.resolve(
      this.notifications.filter((row) => row.userId === userId && !row.deletedAt && !row.readAt).length,
    );
  }

  markRead(userId: string, ids: string[] | 'all', now: Date): Promise<number> {
    let count = 0;
    for (const row of this.notifications) {
      if (row.userId !== userId || row.deletedAt || row.readAt) continue;
      if (ids !== 'all' && !ids.includes(row.id)) continue;
      row.readAt = now;
      count += 1;
    }
    return Promise.resolve(count);
  }

  softDelete(userId: string, id: string, now: Date): Promise<NotificationDto | null> {
    const row = this.notifications.find((item) => item.id === id && item.userId === userId && !item.deletedAt);
    if (!row) return Promise.resolve(null);
    row.deletedAt = now;
    return Promise.resolve(row);
  }

  preferences(userId: string): Promise<PreferenceDto[]> {
    return Promise.resolve(
      this.prefs.filter((row) => row.userId === userId).map(({ category, channel, enabled }) => ({ category, channel, enabled })),
    );
  }

  setPreference(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<PreferenceDto> {
    const existing = this.prefs.find((row) => row.userId === userId && row.category === category && row.channel === channel);
    if (existing) existing.enabled = enabled;
    else this.prefs.push({ userId, category, channel, enabled });
    return Promise.resolve({ category, channel, enabled });
  }

  upsertPush(input: { userId: string; token: string; userAgent: string | null; now: Date }): Promise<void> {
    const existing = this.pushes.find((row) => row.token === input.token);
    if (existing) {
      existing.userId = input.userId;
      existing.revokedAt = null;
    } else {
      this.pushes.push({ userId: input.userId, token: input.token, revokedAt: null });
    }
    return Promise.resolve();
  }

  removePush(userId: string, token: string): Promise<void> {
    this.pushes = this.pushes.filter((row) => !(row.userId === userId && row.token === token));
    return Promise.resolve();
  }

  revokePushToken(token: string, now: Date): Promise<void> {
    const row = this.pushes.find((item) => item.token === token);
    if (row) row.revokedAt = now;
    return Promise.resolve();
  }

  followers(): Promise<FollowerRow[]> {
    return Promise.resolve(this.people);
  }

  usersByIds(userIds: string[]): Promise<FollowerRow[]> {
    return Promise.resolve(this.people.filter((row) => userIds.includes(row.userId)));
  }

  enabledChannels(userIds: string[], category: NotificationCategory): Promise<Map<string, { email: boolean; push: boolean }>> {
    const map = new Map<string, { email: boolean; push: boolean }>();
    for (const userId of userIds) {
      const email = this.prefs.find((row) => row.userId === userId && row.category === category && row.channel === 'EMAIL');
      const push = this.prefs.find((row) => row.userId === userId && row.category === category && row.channel === 'PUSH');
      map.set(userId, { email: email ? email.enabled : true, push: push ? push.enabled : true });
    }
    return Promise.resolve(map);
  }

  activePushTokens(userId: string): Promise<string[]> {
    return Promise.resolve(this.pushes.filter((row) => row.userId === userId && !row.revokedAt).map((row) => row.token));
  }

  insertNotification(row: NewNotification): Promise<{ notification: NotificationDto; created: boolean }> {
    const existing = this.notifications.find((item) => item.userId === row.userId && item.sourceRef === row.sourceRef);
    if (existing) return Promise.resolve({ notification: existing, created: false });
    this.n += 1;
    const notification: NotificationDto = {
      id: `00000000-0000-4000-8000-${this.n.toString(16).padStart(12, '0')}`,
      userId: row.userId,
      type: row.type,
      title: row.title,
      body: row.body,
      link: row.link,
      sourceRef: row.sourceRef,
      readAt: null,
      deletedAt: null,
      createdAt: row.createdAt,
    };
    this.notifications.push(notification);
    return Promise.resolve({ notification, created: true });
  }

  insertDelivery(row: NewDelivery): Promise<DeliveryDto | null> {
    if (this.deliveries.some((item) => item.dedupeKey === row.dedupeKey)) return Promise.resolve(null);
    this.n += 1;
    const delivery: DeliveryDto = {
      id: `10000000-0000-4000-8000-${this.n.toString(16).padStart(12, '0')}`,
      notificationId: row.notificationId,
      userId: row.userId,
      channel: row.channel,
      status: row.status,
      dedupeKey: row.dedupeKey,
      providerMessageId: null,
      attempts: 0,
      error: null,
      sentAt: row.sentAt,
      openedAt: null,
      clickedAt: null,
    };
    this.deliveries.push(delivery);
    return Promise.resolve(delivery);
  }

  deliveryContext(id: string): Promise<DeliveryContext | null> {
    const delivery = this.deliveries.find((row) => row.id === id);
    if (!delivery) return Promise.resolve(null);
    const notification = this.notifications.find((row) => row.id === delivery.notificationId);
    if (!notification) return Promise.resolve(null);
    const follower = this.people.find((row) => row.userId === notification.userId);
    return this.activePushTokens(notification.userId).then((pushTokens) => ({
      delivery,
      notification,
      email: follower?.email ?? null,
      pushTokens,
    }));
  }

  markDelivery(id: string, patch: DeliveryPatch): Promise<void> {
    const row = this.deliveries.find((item) => item.id === id);
    if (!row) return Promise.resolve();
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.providerMessageId !== undefined) row.providerMessageId = patch.providerMessageId;
    if (patch.attempts !== undefined) row.attempts = patch.attempts;
    if (patch.error !== undefined) row.error = patch.error;
    if (patch.sentAt !== undefined) row.sentAt = patch.sentAt;
    if (patch.openedAt !== undefined) row.openedAt = patch.openedAt;
    if (patch.clickedAt !== undefined) row.clickedAt = patch.clickedAt;
    return Promise.resolve();
  }

  notificationForDelivery(deliveryId: string): Promise<NotificationDto | null> {
    const delivery = this.deliveries.find((row) => row.id === deliveryId);
    if (!delivery) return Promise.resolve(null);
    return Promise.resolve(this.notifications.find((row) => row.id === delivery.notificationId) ?? null);
  }
}

function resident(userId: string): ServiceContext {
  const principal = {
    kind: 'resident' as const,
    userId,
    status: 'ACTIVE' as const,
    termsAccepted: true,
    sessionId: 'session',
  };
  return { requestId: 'req', principal, authz: new Authz(principal), ipHash: 'ip' };
}

function system(): ServiceContext {
  const principal = systemPrincipal('notify.fanout');
  return { requestId: 'req', principal, authz: new Authz(principal), ipHash: 'ip' };
}

describe('NotificationsService', () => {
  it('respects preferences and always creates in-app', async () => {
    const repo = new MemoryNotifications();
    repo.people = [
      { userId: USER_A, email: 'a@example.com' },
      { userId: USER_B, email: 'b@example.com' },
    ];
    repo.prefs.push(
      { userId: USER_A, category: 'ALERTS', channel: 'EMAIL', enabled: false },
      { userId: USER_A, category: 'ALERTS', channel: 'PUSH', enabled: true },
      { userId: USER_B, category: 'ALERTS', channel: 'EMAIL', enabled: true },
      { userId: USER_B, category: 'ALERTS', channel: 'PUSH', enabled: false },
    );
    const email = new FakeEmail();
    const service = new NotificationsService({
      repo,
      email,
      push: new FakePush(),
      clock: new FakeClock(new Date('2026-01-01T00:00:00Z')),
      links: { secret: SECRET, webUrl: 'http://localhost:3000' },
    });
    const result = await service.fanout(system(), {
      type: 'ALERT',
      title: 'Council vote',
      body: 'The council meets tonight.',
      sourceRef: `alert:${OFFICE}`,
      officeId: OFFICE,
      channels: ['EMAIL', 'PUSH'],
    });
    const channels = (userId: string) =>
      result.deliveries.filter((row) => row.userId === userId).map((row) => row.channel).sort();
    expect(channels(USER_A)).toEqual(['IN_APP', 'PUSH']);
    expect(channels(USER_B)).toEqual(['EMAIL', 'IN_APP']);
    expect(email.sent).toHaveLength(0);
    expect(result.notifications).toHaveLength(2);
  });

  it('does not call the provider again when delivery is no longer queued', async () => {
    const repo = new MemoryNotifications();
    repo.people = [{ userId: USER_A, email: 'a@example.com' }];
    const email = new FakeEmail();
    const service = new NotificationsService({
      repo,
      email,
      push: new FakePush(),
      clock: new FakeClock(new Date('2026-01-01T00:00:00Z')),
      links: { secret: SECRET, webUrl: 'http://localhost:3000' },
    });
    const result = await service.fanout(system(), {
      type: 'ALERT',
      title: 'Council vote',
      body: 'The council meets tonight.',
      link: 'http://localhost:3000/offices/mayor',
      sourceRef: 'alert:once',
      officeId: OFFICE,
      channels: ['EMAIL'],
    });
    const delivery = result.deliveries.find((row) => row.channel === 'EMAIL');
    expect(delivery).toBeDefined();
    await service.deliverEmail(system(), { deliveryId: delivery?.id });
    await service.deliverEmail(system(), { deliveryId: delivery?.id });
    expect(email.sent).toHaveLength(1);
  });

  it('unsubscribe turns off only that category email', async () => {
    const repo = new MemoryNotifications();
    const service = new NotificationsService({
      repo,
      email: new FakeEmail(),
      push: new FakePush(),
      clock: new FakeClock(new Date('2026-01-01T00:00:00Z')),
      links: { secret: SECRET, webUrl: 'http://localhost:3000' },
    });
    await service.updateNotificationPreference(resident(USER_A), {
      category: 'UPDATES',
      channel: 'EMAIL',
      enabled: true,
    });
    const token = signCategoryLink(
      SECRET,
      'unsub',
      USER_A,
      'ALERTS',
      new Date(Date.now() + LINK_TTL_MS),
    );
    expect(await service.unsubscribeFromToken(token)).toBe(true);
    const prefs = await service.notificationPreferences(resident(USER_A));
    expect(prefs.find((row) => row.category === 'ALERTS' && row.channel === 'EMAIL')?.enabled).toBe(false);
    expect(prefs.find((row) => row.category === 'UPDATES' && row.channel === 'EMAIL')?.enabled).toBe(true);
    expect(prefs.find((row) => row.channel === 'IN_APP')?.enabled).toBe(true);
    expect(await service.unsubscribeFromToken('nope')).toBe(false);
  });

  it('refuses to disable in-app notifications', async () => {
    const service = new NotificationsService({
      repo: new MemoryNotifications(),
      email: new FakeEmail(),
      push: new FakePush(),
      links: { secret: SECRET, webUrl: 'http://localhost:3000' },
    });
    await expect(
      service.updateNotificationPreference(resident(USER_A), {
        category: 'ALERTS',
        channel: 'IN_APP',
        enabled: false,
      }),
    ).rejects.toBeInstanceOf(InAppLockedError);
  });

  it('revokes a push subscription on 404', async () => {
    const repo = new MemoryNotifications();
    repo.people = [{ userId: USER_A, email: 'a@example.com' }];
    await repo.upsertPush({ userId: USER_A, token: 'device-token', userAgent: null, now: new Date() });
    const push = new FakePush();
    push.status = 404;
    const service = new NotificationsService({
      repo,
      email: new FakeEmail(),
      push,
      clock: new FakeClock(new Date('2026-01-01T00:00:00Z')),
      links: { secret: SECRET, webUrl: 'http://localhost:3000' },
    });
    const result = await service.fanout(system(), {
      type: 'RECORD_UPDATE',
      title: 'Phone updated',
      body: 'A followed office changed.',
      sourceRef: 'update:1',
      officeId: OFFICE,
      channels: ['PUSH'],
    });
    const delivery = result.deliveries.find((row) => row.channel === 'PUSH');
    await service.deliverPush(system(), { deliveryId: delivery?.id });
    expect(repo.pushes[0]?.revokedAt).toBeInstanceOf(Date);
    expect(delivery && repo.deliveries.find((row) => row.id === delivery.id)?.status).toBe('FAILED');
  });
});
