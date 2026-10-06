import type { ServiceContext } from '../../graphql/context.js';
import type { NotificationChannel } from '../../generated/prisma/enums.js';
import { directTx, type RunTx } from '../../auth/tx.js';
import type { ActorType } from '../../generated/prisma/enums.js';
import { systemClock, type Clock } from '../../lib/clock.js';
import {
  AlertAlreadySentError,
  fromZod,
  NoRecipientsError,
  NotFoundError,
  RateLimitedError,
  RecipientsChangedError,
  ValidationError,
} from '../../lib/errors.js';
import { buildConnection, clampFirst, decodeCursor, type Connection } from '../../lib/pagination.js';
import type { EmailSender } from '../notifications/email.js';
import type { JobQueue } from '../notifications/notifications.service.js';
import { MemoryRateGate, type RateGate } from '../notifications/rate-gate.js';
import { renderNotificationEmail, renderPush } from '../notifications/templates.js';
import type { AlertDto, AlertPreview, ChannelStats } from './alerts.dto.js';
import { adminAlertsSchema, alertIdSchema, saveAlertSchema, sendAlertSchema } from './alerts.inputs.js';
import type { AlertPatch, AlertsRepo } from './alerts.ports.js';

const HOUR_MS = 60 * 60 * 1000;

export interface AuditWriter {
  record(
    tx: unknown,
    entry: {
      actorType: ActorType;
      actorId: string | null;
      entityType: string;
      entityId: string;
      action: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      requestId: string | null;
    },
  ): Promise<void>;
}

export interface AlertsDeps {
  repo: AlertsRepo;
  email: EmailSender;
  enqueue: JobQueue;
  audit: AuditWriter;
  clock?: Clock;
  rate?: RateGate;
  withTx?: RunTx;
  webUrl: string;
  fanoutQueue?: string;
}

export function recipientsMatch(confirmed: number, current: number): boolean {
  if (current <= 0) return false;
  return Math.abs(confirmed - current) <= current * 0.05;
}

export class AlertsService {
  private readonly clock: Clock;
  private readonly rate: RateGate;
  private readonly withTx: RunTx;

  constructor(private readonly deps: AlertsDeps) {
    this.clock = deps.clock ?? systemClock;
    this.rate = deps.rate ?? new MemoryRateGate();
    this.withTx = deps.withTx ?? directTx;
  }

  async adminAlerts(ctx: ServiceContext, input: unknown): Promise<Connection<AlertDto> & { totalCount: number }> {
    ctx.authz.require('admin.alert:read');
    const parsed = parse(adminAlertsSchema, input ?? {});
    const first = clampFirst(parsed.first, 100, 20);
    const decoded = parsed.after ? decodeCursor(parsed.after) : undefined;
    if (parsed.after && !decoded) {
      throw new ValidationError('Invalid cursor.', [{ path: 'after', code: 'custom', message: 'Invalid cursor.' }]);
    }
    const page = await this.deps.repo.list({
      limit: first + 1,
      ...(parsed.filter?.status ? { status: parsed.filter.status } : {}),
      ...(parsed.filter?.targetOfficeId ? { targetOfficeId: parsed.filter.targetOfficeId } : {}),
      ...(decoded ? { after: decoded } : {}),
    });
    const connection = buildConnection(page.rows, first, page.total);
    return { ...connection, totalCount: page.total };
  }

  async adminAlert(ctx: ServiceContext, input: unknown): Promise<AlertDto & { stats: ChannelStats[] }> {
    ctx.authz.require('admin.alert:read');
    const parsed = parse(alertIdSchema, input);
    const alert = await this.deps.repo.find(parsed.id);
    if (!alert) throw new NotFoundError();
    const stats = await this.deps.repo.channelStats(alert.id);
    return { ...alert, stats };
  }

  async saveAlertDraft(ctx: ServiceContext, input: unknown): Promise<{ alert: AlertDto }> {
    ctx.authz.require('admin.alert:write');
    const admin = ctx.authz.requireAdmin();
    const parsed = parse(saveAlertSchema, input);
    const channels = withInApp(parsed.channels ?? ['EMAIL', 'PUSH']);
    const link =
      parsed.link ??
      (parsed.targetOfficeId
        ? `${this.deps.webUrl.replace(/\/$/, '')}/offices/${parsed.targetOfficeId}`
        : `${this.deps.webUrl.replace(/\/$/, '')}/officials/${parsed.targetOfficialId ?? ''}`);
    const patch: AlertPatch = {
      targetOfficeId: parsed.targetOfficeId ?? null,
      targetOfficialId: parsed.targetOfficialId ?? null,
      title: parsed.title,
      body: parsed.body,
      link,
      channels,
    };
    if (!(await this.deps.repo.targetExists(patch))) throw new NotFoundError();
    if (!parsed.id) {
      const alert = await this.withTx(async (tx) => {
        const created = await this.deps.repo.insert({ ...patch, createdBy: admin.adminId, createdAt: this.clock.now() });
        await this.deps.audit.record(tx, {
          actorType: 'ADMIN',
          actorId: admin.adminId,
          entityType: 'alert',
          entityId: created.id,
          action: 'alert.draft',
          before: null,
          after: snapshot(created),
          requestId: ctx.requestId,
        });
        return created;
      });
      return { alert };
    }
    const existing = await this.deps.repo.find(parsed.id);
    if (!existing) throw new NotFoundError();
    if (existing.status !== 'DRAFT') throw new AlertAlreadySentError();
    const alert = await this.withTx(async (tx) => {
      const updated = await this.deps.repo.updateDraft(parsed.id ?? existing.id, patch);
      if (!updated) throw new AlertAlreadySentError();
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: admin.adminId,
        entityType: 'alert',
        entityId: updated.id,
        action: 'alert.draft',
        before: snapshot(existing),
        after: snapshot(updated),
        requestId: ctx.requestId,
      });
      return updated;
    });
    return { alert };
  }

  async deleteAlertDraft(ctx: ServiceContext, input: unknown): Promise<{ id: string }> {
    ctx.authz.require('admin.alert:write');
    const admin = ctx.authz.requireAdmin();
    const parsed = parse(alertIdSchema, input);
    const existing = await this.deps.repo.find(parsed.id);
    if (!existing) throw new NotFoundError();
    if (existing.status !== 'DRAFT') throw new AlertAlreadySentError();
    const outcome = await this.withTx(async (tx) => {
      const result = await this.deps.repo.deleteDraft(parsed.id);
      if (result === 'missing') throw new NotFoundError();
      if (result === 'sent') throw new AlertAlreadySentError();
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: admin.adminId,
        entityType: 'alert',
        entityId: parsed.id,
        action: 'alert.delete',
        before: snapshot(existing),
        after: null,
        requestId: ctx.requestId,
      });
      return result;
    });
    if (outcome !== 'deleted') throw new AlertAlreadySentError();
    return { id: parsed.id };
  }

  async previewAlert(ctx: ServiceContext, input: unknown): Promise<AlertPreview> {
    ctx.authz.require('admin.alert:write');
    const parsed = parse(alertIdSchema, input);
    const alert = await this.deps.repo.find(parsed.id);
    if (!alert) throw new NotFoundError();
    const counts = await this.deps.repo.previewCounts(alert);
    const email = renderNotificationEmail({
      title: alert.title,
      body: alert.body,
      unsubscribeUrl: `${this.deps.webUrl}/u/unsub`,
      openPixelUrl: `${this.deps.webUrl}/u/o`,
      clickUrl: alert.link,
    });
    const push = renderPush({ title: alert.title, body: alert.body, link: alert.link });
    return {
      inApp: { title: alert.title, body: alert.body },
      email: { subject: email.subject, text: email.text },
      push: { title: push.title, body: push.body },
      recipientCount: {
        inApp: counts.inApp,
        email: alert.channels.includes('EMAIL') ? counts.email : 0,
        push: alert.channels.includes('PUSH') ? counts.push : 0,
        followers: counts.followers,
      },
    };
  }

  async sendTestAlert(ctx: ServiceContext, input: unknown): Promise<{ sent: boolean }> {
    ctx.authz.require('admin.alert:write');
    const admin = ctx.authz.requireAdmin();
    const parsed = parse(alertIdSchema, input);
    const alert = await this.deps.repo.find(parsed.id);
    if (!alert) throw new NotFoundError();
    const to = await this.deps.repo.adminEmail(admin.adminId);
    if (!to) throw new NotFoundError();
    const rendered = renderNotificationEmail({
      title: `[Test] ${alert.title}`,
      body: alert.body,
      unsubscribeUrl: `${this.deps.webUrl}/u/unsub`,
      openPixelUrl: `${this.deps.webUrl}/u/o`,
      clickUrl: alert.link,
    });
    await this.deps.email.send({ to, subject: rendered.subject, text: rendered.text, html: rendered.html });
    return { sent: true };
  }

  async sendAlert(ctx: ServiceContext, input: unknown): Promise<{ alert: AlertDto }> {
    ctx.authz.require('admin.alert:send');
    const admin = ctx.authz.requireAdmin();
    const parsed = parse(sendAlertSchema, input);
    const gate = this.rate.consume(`alert_send:${admin.adminId}`, 10, HOUR_MS, this.clock.now());
    if (!gate.ok) throw new RateLimitedError(gate.retryAfterSeconds);
    const alert = await this.withTx(async (tx) => {
      const current = await this.deps.repo.find(parsed.id);
      if (!current) throw new NotFoundError();
      if (current.status !== 'DRAFT') throw new AlertAlreadySentError();
      const followers = await this.deps.repo.followerCount(current);
      if (followers === 0) throw new NoRecipientsError();
      if (!recipientsMatch(parsed.confirmRecipientCount, followers)) throw new RecipientsChangedError();
      const claimed = await this.deps.repo.claimDraft(parsed.id, admin.adminId, tx);
      if (!claimed) throw new AlertAlreadySentError();
      const sending = { ...current, status: 'SENDING' as const, sentBy: admin.adminId, recipientCount: followers };
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: admin.adminId,
        entityType: 'alert',
        entityId: current.id,
        action: 'alert.send',
        before: snapshot(current),
        after: snapshot(sending),
        requestId: ctx.requestId,
      });
      return sending;
    });
    await this.deps.enqueue.enqueue(this.deps.fanoutQueue ?? 'notify.fanout', {
      alertId: alert.id,
      recipientCount: alert.recipientCount ?? 0,
      type: 'ALERT',
      title: alert.title,
      body: alert.body,
      ...(alert.link ? { link: alert.link } : {}),
      sourceRef: `alert:${alert.id}`,
      ...(alert.targetOfficeId ? { officeId: alert.targetOfficeId } : {}),
      ...(alert.targetOfficialId ? { officialId: alert.targetOfficialId } : {}),
      channels: alert.channels,
    });
    return { alert };
  }
}

function withInApp(channels: ('EMAIL' | 'PUSH')[]): NotificationChannel[] {
  const set = new Set<NotificationChannel>(['IN_APP']);
  for (const channel of channels) set.add(channel);
  return [...set];
}

function snapshot(alert: AlertDto): Record<string, unknown> {
  return {
    title: alert.title,
    body: alert.body,
    link: alert.link,
    status: alert.status,
    channels: alert.channels,
    targetOfficeId: alert.targetOfficeId,
    targetOfficialId: alert.targetOfficialId,
  };
}

function parse<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: Parameters<typeof fromZod>[0] } }, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw fromZod(result.error);
}
