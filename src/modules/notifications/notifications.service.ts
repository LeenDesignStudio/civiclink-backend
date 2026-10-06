import { randomUUID } from 'node:crypto';
import type { ServiceContext } from '../../graphql/context.js';
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationType,
} from '../../generated/prisma/enums.js';
import { systemClock, type Clock } from '../../lib/clock.js';
import {
  fromZod,
  InAppLockedError,
  NotFoundError,
  RateLimitedError,
  UpstreamError,
} from '../../lib/errors.js';
import { buildConnection, clampFirst, decodeCursor, type Connection } from '../../lib/pagination.js';
import type { Analytics } from '../analytics/analytics.js';
import {
  notificationFailed,
  notificationDelivered,
  notificationOpened,
  notificationClicked,
  notificationPrefChanged,
  notificationSent,
} from '../analytics/events.js';
import type { EmailSender } from './email.js';
import {
  LINK_TTL_MS,
  readClick,
  readOpen,
  readUnsub,
  signCategoryLink,
  signDeliveryLink,
  type LinkSecrets,
} from './links.js';
import type { DeliveryDto, NotificationDto, PreferenceDto } from './notifications.dto.js';
import {
  deleteNotificationSchema,
  deliveryJobSchema,
  fanoutSchema,
  finalizeAlertSchema,
  markReadSchema,
  notificationsQuerySchema,
  pushTokenSchema,
  removePushSchema,
  updatePreferenceSchema,
  type FanoutInput,
} from './notifications.inputs.js';
import type { NotificationsRepo } from './notifications.ports.js';
import type { PushSender } from './push.js';
import { MemoryRateGate, type RateGate } from './rate-gate.js';
import { renderNotificationEmail, renderPush } from './templates.js';
import { assertReturnTo } from '../../auth/return-to.js';
import { Authz, systemPrincipal } from '../../authz/authz.js';
import { ValidationError } from '../../lib/errors.js';

const CATEGORIES: NotificationCategory[] = ['ALERTS', 'UPDATES'];
const CHANNELS: NotificationChannel[] = ['IN_APP', 'EMAIL', 'PUSH'];
const HOUR_MS = 60 * 60 * 1000;

export interface JobQueue {
  enqueue(name: string, data: Record<string, unknown>, options?: { singletonKey?: string }): Promise<void>;
}

export interface NotificationsDeps {
  repo: NotificationsRepo;
  email: EmailSender;
  push: PushSender;
  clock?: Clock;
  links: LinkSecrets;
  rate?: RateGate;
  enqueue?: JobQueue;
  analytics?: Analytics;
  queues?: { email: string; push: string; finalize: string };
  markAlertSent?: (alertId: string, recipientCount: number, sentAt: Date) => Promise<void>;
}

export class NotificationsService {
  private readonly clock: Clock;
  private readonly rate: RateGate;

  constructor(private readonly deps: NotificationsDeps) {
    this.clock = deps.clock ?? systemClock;
    this.rate = deps.rate ?? new MemoryRateGate();
  }

  async notifications(ctx: ServiceContext, input: unknown): Promise<Connection<NotificationDto>> {
    ctx.authz.require('self.notifications:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parse(notificationsQuerySchema, input);
    const first = clampFirst(parsed.first, 50, 20);
    const decoded = parsed.after ? decodeCursor(parsed.after) : undefined;
    if (parsed.after && !decoded) {
      throw new ValidationError('Invalid cursor.', [{ path: 'after', code: 'custom', message: 'Invalid cursor.' }]);
    }
    const rows = await this.deps.repo.list(userId, {
      filter: parsed.filter ?? 'ALL',
      limit: first + 1,
      ...(decoded ? { after: decoded } : {}),
    });
    return buildConnection(rows, first);
  }

  async unreadNotificationCount(ctx: ServiceContext): Promise<number> {
    ctx.authz.require('self.notifications:manage');
    const userId = ctx.authz.requireResident({ active: true });
    return this.deps.repo.unreadCount(userId);
  }

  async markNotificationsRead(ctx: ServiceContext, input: unknown): Promise<{ updatedCount: number }> {
    ctx.authz.require('self.notifications:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parse(markReadSchema, input);
    const updatedCount = await this.deps.repo.markRead(
      userId,
      parsed.all ? 'all' : (parsed.ids ?? []),
      this.clock.now(),
    );
    return { updatedCount };
  }

  async deleteNotification(ctx: ServiceContext, input: unknown): Promise<{ notification: NotificationDto }> {
    ctx.authz.require('self.notifications:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parse(deleteNotificationSchema, input);
    const notification = await this.deps.repo.softDelete(userId, parsed.id, this.clock.now());
    if (!notification) throw new NotFoundError();
    return { notification };
  }

  async notificationPreferences(ctx: ServiceContext): Promise<PreferenceDto[]> {
    ctx.authz.require('self.notifications:manage');
    const userId = ctx.authz.requireResident({ active: true });
    return fillPreferences(await this.deps.repo.preferences(userId));
  }

  async updateNotificationPreference(ctx: ServiceContext, input: unknown): Promise<{ preference: PreferenceDto }> {
    ctx.authz.require('self.notifications:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parse(updatePreferenceSchema, input);
    if (parsed.channel === 'IN_APP' && !parsed.enabled) throw new InAppLockedError();
    const preference = await this.deps.repo.setPreference(userId, parsed.category, parsed.channel, parsed.enabled);
    await this.track(userId, notificationPrefChanged(parsed));
    return { preference };
  }

  async registerPushSubscription(ctx: ServiceContext, input: unknown): Promise<{ registered: boolean }> {
    ctx.authz.require('self.notifications:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parse(pushTokenSchema, input);
    await this.deps.repo.upsertPush({
      userId,
      token: parsed.token,
      userAgent: parsed.userAgent ?? null,
      now: this.clock.now(),
    });
    return { registered: true };
  }

  async removePushSubscription(ctx: ServiceContext, input: unknown): Promise<{ removed: boolean }> {
    ctx.authz.require('self.notifications:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parse(removePushSchema, input);
    await this.deps.repo.removePush(userId, parsed.token);
    return { removed: true };
  }

  async sendTestNotification(ctx: ServiceContext): Promise<{ notification: NotificationDto }> {
    ctx.authz.require('self.notifications:manage');
    const userId = ctx.authz.requireResident({ active: true });
    const gate = this.rate.consume(`test_notification:${userId}`, 3, HOUR_MS, this.clock.now());
    if (!gate.ok) throw new RateLimitedError(gate.retryAfterSeconds);
    const result = await this.fanout(systemJobContext(ctx, 'notify.fanout'), {
      type: 'SYSTEM',
      title: 'Test notification',
      body: 'This is a test from CivicLink.',
      sourceRef: `test:${userId}:${this.clock.now().getTime()}`,
      userIds: [userId],
      channels: ['IN_APP', 'EMAIL', 'PUSH'],
    });
    const notification = result.notifications[0];
    if (!notification) throw new NotFoundError();
    for (const delivery of result.deliveries) {
      if (delivery.channel === 'EMAIL' && delivery.status === 'QUEUED') {
        await this.deliverEmail(systemJobContext(ctx, 'notify.deliver.email'), { deliveryId: delivery.id });
      }
      if (delivery.channel === 'PUSH' && delivery.status === 'QUEUED') {
        await this.deliverPush(systemJobContext(ctx, 'notify.deliver.push'), { deliveryId: delivery.id });
      }
    }
    return { notification };
  }

  async fanout(
    ctx: ServiceContext,
    input: unknown,
  ): Promise<{ notifications: NotificationDto[]; deliveries: DeliveryDto[] }> {
    ctx.authz.require('system.notifications:deliver');
    const parsed = parse(fanoutSchema, input);
    const followers = await this.resolveFollowers(parsed);
    const category = categoryFor(parsed.type);
    const prefs = await this.deps.repo.enabledChannels(
      followers.map((row) => row.userId),
      category,
    );
    const notifications: NotificationDto[] = [];
    const deliveries: DeliveryDto[] = [];
    const now = this.clock.now();
    for (const follower of followers) {
      const inserted = await this.deps.repo.insertNotification({
        userId: follower.userId,
        type: parsed.type,
        title: parsed.title,
        body: parsed.body,
        link: parsed.link ?? null,
        sourceRef: parsed.sourceRef,
        createdAt: now,
      });
      notifications.push(inserted.notification);
      if (!inserted.created) continue;
      const pref = prefs.get(follower.userId) ?? { email: true, push: true };
      for (const channel of wantedChannels(parsed.channels)) {
        if (channel === 'EMAIL' && !pref.email) continue;
        if (channel === 'PUSH' && !pref.push) continue;
        const delivery = await this.deps.repo.insertDelivery({
          notificationId: inserted.notification.id,
          userId: follower.userId,
          channel,
          status: channel === 'IN_APP' ? 'SENT' : 'QUEUED',
          dedupeKey: `${parsed.sourceRef}:${follower.userId}:${channel}`,
          sentAt: channel === 'IN_APP' ? now : null,
          createdAt: now,
        });
        if (!delivery) continue;
        deliveries.push(delivery);
        if (channel === 'EMAIL') await this.enqueue(this.deps.queues?.email ?? 'notify.deliver.email', delivery.id);
        if (channel === 'PUSH') await this.enqueue(this.deps.queues?.push ?? 'notify.deliver.push', delivery.id);
        await this.track(follower.userId, notificationSent({ channel, type: parsed.type }));
      }
    }
    return { notifications, deliveries };
  }

  async deliverEmail(ctx: ServiceContext, input: unknown): Promise<void> {
    ctx.authz.require('system.notifications:deliver');
    const parsed = parse(deliveryJobSchema, input);
    const context = await this.deps.repo.deliveryContext(parsed.deliveryId);
    if (!context) throw new NotFoundError();
    if (context.delivery.status !== 'QUEUED') return;
    if (context.delivery.channel !== 'EMAIL') return;
    if (!context.email) {
      await this.deps.repo.markDelivery(context.delivery.id, {
        status: 'SKIPPED',
        error: 'missing address',
        attempts: context.delivery.attempts + 1,
      });
      return;
    }
    const expires = new Date(this.clock.now().getTime() + LINK_TTL_MS);
    const category = categoryFor(context.notification.type);
    const path = allowlistedPath(context.notification.link, this.deps.links.webUrl);
    const unsub = signCategoryLink(this.deps.links.secret, 'unsub', context.notification.userId, category, expires);
    const open = signDeliveryLink(this.deps.links.secret, 'o', context.delivery.id, expires);
    const click = path
      ? signDeliveryLink(this.deps.links.secret, 'c', context.delivery.id, expires, path)
      : undefined;
    const web = this.deps.links.webUrl.replace(/\/$/, '');
    const rendered = renderNotificationEmail({
      title: context.notification.title,
      body: context.notification.body,
      unsubscribeUrl: `${web}/u/unsub?t=${encodeURIComponent(unsub)}`,
      openPixelUrl: `${web}/u/o?t=${encodeURIComponent(open)}`,
      clickUrl: click && path ? `${web}/u/c?t=${encodeURIComponent(click)}&r=${encodeURIComponent(path)}` : null,
    });
    try {
      const sent = await this.deps.email.send({
        to: context.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      await this.deps.repo.markDelivery(context.delivery.id, {
        status: 'SENT',
        providerMessageId: sent.messageId,
        attempts: context.delivery.attempts + 1,
        sentAt: this.clock.now(),
        error: null,
      });
      await this.track(context.notification.userId, notificationDelivered({ channel: 'EMAIL', type: context.notification.type }));
    } catch (err) {
      await this.deps.repo.markDelivery(context.delivery.id, {
        attempts: context.delivery.attempts + 1,
        error: 'provider',
      });
      await this.track(context.notification.userId, notificationFailed({ channel: 'EMAIL', type: context.notification.type }));
      if (err instanceof UpstreamError || err instanceof RateLimitedError) throw err;
      throw new UpstreamError(undefined, { cause: err });
    }
  }

  async deliverPush(ctx: ServiceContext, input: unknown): Promise<void> {
    ctx.authz.require('system.notifications:deliver');
    const parsed = parse(deliveryJobSchema, input);
    const context = await this.deps.repo.deliveryContext(parsed.deliveryId);
    if (!context) throw new NotFoundError();
    if (context.delivery.status !== 'QUEUED') return;
    if (context.delivery.channel !== 'PUSH') return;
    const payload = renderPush({
      title: context.notification.title,
      body: context.notification.body,
      link: context.notification.link,
    });
    if (context.pushTokens.length === 0) {
      await this.deps.repo.markDelivery(context.delivery.id, {
        status: 'SKIPPED',
        attempts: context.delivery.attempts + 1,
        error: 'no subscription',
      });
      return;
    }
    let sentId: string | null = null;
    let failed = 0;
    for (const token of context.pushTokens) {
      const result = await this.deps.push.send({
        token,
        title: payload.title,
        body: payload.body,
        link: payload.link,
      });
      if (result.status === 404 || result.status === 410) {
        await this.deps.repo.revokePushToken(token, this.clock.now());
        failed += 1;
        continue;
      }
      if (result.status >= 200 && result.status < 300) {
        sentId = result.messageId;
      } else {
        failed += 1;
      }
    }
    if (!sentId) {
      await this.deps.repo.markDelivery(context.delivery.id, {
        status: 'FAILED',
        attempts: context.delivery.attempts + 1,
        error: failed > 0 ? 'revoked' : 'provider',
      });
      await this.track(context.notification.userId, notificationFailed({ channel: 'PUSH', type: context.notification.type }));
      return;
    }
    await this.deps.repo.markDelivery(context.delivery.id, {
      status: 'SENT',
      providerMessageId: sentId,
      attempts: context.delivery.attempts + 1,
      sentAt: this.clock.now(),
      error: null,
    });
    await this.track(context.notification.userId, notificationDelivered({ channel: 'PUSH', type: context.notification.type }));
  }

  async finalizeAlert(ctx: ServiceContext, input: unknown): Promise<void> {
    ctx.authz.require('system.notifications:deliver');
    const parsed = parse(finalizeAlertSchema, input);
    if (!this.deps.markAlertSent) return;
    await this.deps.markAlertSent(parsed.alertId, parsed.recipientCount, this.clock.now());
  }

  async unsubscribeFromToken(token: string): Promise<boolean> {
    const claims = readUnsub(this.deps.links.secret, token, this.clock.now());
    if (!claims) return false;
    await this.deps.repo.setPreference(claims.userId, claims.category, 'EMAIL', false);
    await this.track(claims.userId, notificationPrefChanged({ category: claims.category, channel: 'EMAIL', enabled: false }));
    return true;
  }

  async openFromToken(token: string): Promise<boolean> {
    const claims = readOpen(this.deps.links.secret, token, this.clock.now());
    if (!claims) return false;
    const notification = await this.deps.repo.notificationForDelivery(claims.deliveryId);
    await this.deps.repo.markDelivery(claims.deliveryId, { openedAt: this.clock.now(), status: 'DELIVERED' });
    if (notification) {
      await this.track(notification.userId, notificationOpened({ channel: 'EMAIL', type: notification.type }));
    }
    return true;
  }

  async clickFromToken(token: string, redirect: string | undefined): Promise<string | undefined> {
    const claims = readClick(this.deps.links.secret, token, this.clock.now());
    if (!claims) return undefined;
    if (redirect !== undefined && redirect !== claims.path) return undefined;
    let path: string;
    try {
      path = assertReturnTo(claims.path);
    } catch {
      return undefined;
    }
    const notification = await this.deps.repo.notificationForDelivery(claims.deliveryId);
    await this.deps.repo.markDelivery(claims.deliveryId, { clickedAt: this.clock.now() });
    if (notification) {
      await this.track(notification.userId, notificationClicked({ channel: 'EMAIL', type: notification.type }));
    }
    return path;
  }

  private async resolveFollowers(parsed: FanoutInput) {
    if (parsed.userIds && parsed.userIds.length > 0) {
      const rows = await this.deps.repo.usersByIds(parsed.userIds);
      return uniqueFollowers(rows);
    }
    const target: { officeId?: string; officialId?: string } = {};
    if (parsed.officeId) target.officeId = parsed.officeId;
    if (parsed.officialId) target.officialId = parsed.officialId;
    return uniqueFollowers(await this.deps.repo.followers(target));
  }

  private async enqueue(queue: string, deliveryId: string): Promise<void> {
    if (!this.deps.enqueue) return;
    await this.deps.enqueue.enqueue(queue, { deliveryId }, { singletonKey: deliveryId });
  }

  private async track(distinctId: string, event: { name: string; properties: Record<string, string | number | boolean> }): Promise<void> {
    if (!this.deps.analytics) return;
    await this.deps.analytics.track(distinctId, event.name, event.properties);
  }
}

export function categoryFor(type: NotificationType): NotificationCategory {
  return type === 'ALERT' ? 'ALERTS' : 'UPDATES';
}

export function fillPreferences(rows: PreferenceDto[]): PreferenceDto[] {
  const out: PreferenceDto[] = [];
  for (const category of CATEGORIES) {
    for (const channel of CHANNELS) {
      const found = rows.find((row) => row.category === category && row.channel === channel);
      if (channel === 'IN_APP') {
        out.push({ category, channel, enabled: true });
      } else {
        out.push({ category, channel, enabled: found ? found.enabled : true });
      }
    }
  }
  return out;
}

function wantedChannels(channels: NotificationChannel[]): NotificationChannel[] {
  const set = new Set<NotificationChannel>(['IN_APP']);
  for (const channel of channels) set.add(channel);
  return [...set];
}

function systemJobContext(ctx: ServiceContext, job: string): ServiceContext {
  const principal = systemPrincipal(job);
  return {
    requestId: ctx.requestId,
    principal,
    authz: new Authz(principal),
    ipHash: ctx.ipHash,
    ...(ctx.userAgent !== undefined ? { userAgent: ctx.userAgent } : {}),
  };
}

function uniqueFollowers<T extends { userId: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    out.push(row);
  }
  return out;
}

function allowlistedPath(link: string | null, webUrl: string): string | undefined {
  if (!link) return undefined;
  try {
    if (link.startsWith('/')) return assertReturnTo(link);
    const url = new URL(link);
    const base = new URL(webUrl);
    if (url.origin !== base.origin) return undefined;
    return assertReturnTo(`${url.pathname}${url.search}`);
  } catch {
    return undefined;
  }
}

function parse<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: Parameters<typeof fromZod>[0] } }, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw fromZod(result.error);
}

export function newId(): string {
  return randomUUID();
}
