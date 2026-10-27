import type { ServiceContext } from '../graphql/context.js';
import type { Clock } from '../lib/clock.js';
import { isAppError, NotFoundError, UpstreamError } from '../lib/errors.js';
import type { EmailMessage, EmailSender } from '../modules/notifications/email.js';

export interface ContactDelivery {
  name: string;
  email: string;
  topic: string;
  message: string;
  emailedAt: Date | null;
}

export interface ContactDeliveryStore {
  findForDelivery(id: string): Promise<ContactDelivery | null>;
  markEmailed(id: string, at: Date): Promise<void>;
}

export interface DeletionNotice {
  email: string;
  purgeAfter: Date;
}

export interface DeletionNoticeStore {
  pendingDeletionNotice(userId: string): Promise<DeletionNotice | null>;
}

export interface AdminPasswordRecipient {
  email: string;
  status: string;
}

export interface AdminPasswordMailStore {
  findForPasswordMail(adminUserId: string): Promise<AdminPasswordRecipient | null>;
}

export class OutboundMail {
  constructor(
    private readonly deps: {
      email: EmailSender;
      contactInbox: string;
      purgeDays: number;
      clock: Clock;
      contacts: ContactDeliveryStore;
      residents: DeletionNoticeStore;
      admins: AdminPasswordMailStore;
    },
  ) {}

  async sendContact(ctx: ServiceContext, id: string): Promise<void> {
    ctx.authz.require('system.notifications:deliver');
    const row = await this.deps.contacts.findForDelivery(id);
    if (!row) throw new NotFoundError();
    if (row.emailedAt) return;
    await this.deliver({
      to: this.deps.contactInbox,
      replyTo: row.email,
      subject: `CivicLink contact: ${row.topic}`,
      text: [`Name: ${row.name}`, `Email: ${row.email}`, `Topic: ${row.topic}`, '', row.message].join('\n'),
      html: `<p><strong>Name:</strong> ${escapeHtml(row.name)}</p><p><strong>Email:</strong> ${escapeHtml(row.email)}</p><p><strong>Topic:</strong> ${escapeHtml(row.topic)}</p><p>${escapeHtml(row.message)}</p>`,
    });
    await this.deps.contacts.markEmailed(id, this.deps.clock.now());
  }

  async sendAccountDeletion(ctx: ServiceContext, userId: string): Promise<void> {
    ctx.authz.require('system.notifications:deliver');
    const notice = await this.deps.residents.pendingDeletionNotice(userId);
    if (!notice) throw new NotFoundError();
    const purgeDate = notice.purgeAfter.toISOString().slice(0, 10);
    const days = String(this.deps.purgeDays);
    const text = [
      'Your CivicLink account is scheduled for deletion.',
      `It will be permanently removed on ${purgeDate}.`,
      `You can restore it by signing in within ${days} days of the request and choosing Restore.`,
    ].join('\n\n');
    const html = `<p>Your CivicLink account is scheduled for deletion.</p><p>It will be permanently removed on ${escapeHtml(purgeDate)}.</p><p>You can restore it by signing in within ${escapeHtml(days)} days of the request and choosing Restore.</p>`;
    await this.deliver({
      to: notice.email,
      subject: 'Your CivicLink account is scheduled for deletion',
      text,
      html,
    });
  }

  async sendAdminPasswordLink(
    ctx: ServiceContext,
    input: { adminUserId: string; purpose: 'INVITE' | 'RESET'; url: string },
  ): Promise<void> {
    ctx.authz.require('system.notifications:deliver');
    const admin = await this.deps.admins.findForPasswordMail(input.adminUserId);
    if (!admin || admin.status === 'DEACTIVATED') throw new NotFoundError();
    const invite = input.purpose === 'INVITE';
    const text = invite
      ? `Set your CivicLink admin password:\n\n${input.url}\n\nThis link expires in 7 days and can be used once.`
      : `Reset your CivicLink admin password:\n\n${input.url}\n\nThis link expires in 60 minutes and can be used once.`;
    const html = `<p>${escapeHtml(text).replaceAll('\n', '<br>')}</p>`;
    await this.deliver({
      to: admin.email,
      subject: invite ? 'Set your CivicLink admin password' : 'Reset your CivicLink admin password',
      text,
      html,
    });
  }

  private async deliver(message: EmailMessage): Promise<void> {
    try {
      await this.deps.email.send(message);
    } catch (err) {
      if (isAppError(err)) throw err;
      throw new UpstreamError(undefined, { cause: err });
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
