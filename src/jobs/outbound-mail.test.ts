import { describe, expect, it } from 'vitest';
import { Authz, systemPrincipal } from '../authz/authz.js';
import type { ServiceContext } from '../graphql/context.js';
import { ForbiddenError, NotFoundError, UpstreamError } from '../lib/errors.js';
import { isPermanent } from './handlers/index.js';
import { OutboundMail, type ContactDelivery, type DeletionNotice } from './outbound-mail.js';
import { FakeEmail } from '../../test/fakes/email.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-04-01T00:00:00.000Z');

function systemCtx(): ServiceContext {
  const principal = systemPrincipal('email.contact');
  return { requestId: 'job', principal, authz: new Authz(principal), ipHash: 'system' };
}

function viewerCtx(): ServiceContext {
  const principal = { kind: 'admin' as const, adminId: 'admin-1', role: 'ADMIN_STAFF' as const, sessionId: 's' };
  return { requestId: 'job', principal, authz: new Authz(principal), ipHash: 'system' };
}

describe('outbound mail', () => {
  it('sends a contact message to the inbox with Reply-To and sets emailed_at', async () => {
    const email = new FakeEmail();
    const contacts = new MemoryContacts({
      name: 'Ada <Lovelace>',
      email: 'ada@example.com',
      topic: 'DATA_ACCURACY',
      message: 'The office phone is wrong.',
      emailedAt: null,
    });
    const mail = new OutboundMail({
      email,
      contactInbox: 'hello@qubalink.com',
      purgeDays: 30,
      clock: { now: () => NOW },
      admins: { findForPasswordMail: () => Promise.resolve(null) },
      contacts,
      residents: new MemoryResidents(null),
    });
    await mail.sendContact(systemCtx(), 'msg-1');
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({
      to: 'hello@qubalink.com',
      replyTo: 'ada@example.com',
      subject: 'CivicLink contact: DATA_ACCURACY',
    });
    expect(email.sent[0]?.text).toContain('Ada <Lovelace>');
    expect(email.sent[0]?.text).toContain('ada@example.com');
    expect(email.sent[0]?.text).toContain('DATA_ACCURACY');
    expect(email.sent[0]?.text).toContain('The office phone is wrong.');
    expect(email.sent[0]?.html).toContain('Ada &lt;Lovelace&gt;');
    expect(contacts.emailedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('sends a deletion confirmation without tokens or ids', async () => {
    const email = new FakeEmail();
    const mail = new OutboundMail({
      email,
      contactInbox: 'hello@qubalink.com',
      purgeDays: 30,
      clock: { now: () => NOW },
      admins: { findForPasswordMail: () => Promise.resolve(null) },
      contacts: new MemoryContacts(null),
      residents: new MemoryResidents({ email: 'ada@example.com', purgeAfter: new Date('2026-05-01T00:00:00.000Z') }),
    });
    await mail.sendAccountDeletion(systemCtx(), USER);
    const sent = email.sent[0];
    expect(sent?.to).toBe('ada@example.com');
    expect(sent?.replyTo).toBeUndefined();
    expect(sent?.text).toContain('scheduled for deletion');
    expect(sent?.text).toContain('2026-05-01');
    expect(sent?.text).toContain('within 30 days');
    expect(sent?.html).toContain('2026-05-01');
    expect(sent?.html).toContain('within 30 days');
    expect(sent?.text).not.toContain(USER);
    expect(sent?.html).not.toContain(USER);
    expect(sent?.text.toLowerCase()).not.toContain('token');
    expect(sent?.html.toLowerCase()).not.toContain('token');
  });

  it('maps a provider failure to UPSTREAM_UNAVAILABLE and leaves emailed_at unset so the job retries', async () => {
    const email = new FakeEmail();
    email.failNext = true;
    const contacts = new MemoryContacts({
      name: 'Ada',
      email: 'ada@example.com',
      topic: 'GENERAL',
      message: 'Hello',
      emailedAt: null,
    });
    const mail = new OutboundMail({
      email,
      contactInbox: 'hello@qubalink.com',
      purgeDays: 30,
      clock: { now: () => NOW },
      admins: { findForPasswordMail: () => Promise.resolve(null) },
      contacts,
      residents: new MemoryResidents(null),
    });
    const err: unknown = await mail.sendContact(systemCtx(), 'msg-1').then(
      () => null,
      (error: unknown) => error,
    );
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(isPermanent(err)).toBe(false);
    expect(contacts.emailedAt).toBeNull();
  });

  it('rejects a mail job without system.notifications:deliver', async () => {
    const mail = new OutboundMail({
      email: new FakeEmail(),
      contactInbox: 'hello@qubalink.com',
      purgeDays: 30,
      clock: { now: () => NOW },
      admins: { findForPasswordMail: () => Promise.resolve(null) },
      contacts: new MemoryContacts(null),
      residents: new MemoryResidents(null),
    });
    await expect(mail.sendContact(viewerCtx(), 'msg-1')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(mail.sendAccountDeletion(viewerCtx(), USER)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('does not send a contact message that was already emailed', async () => {
    const email = new FakeEmail();
    const mail = new OutboundMail({
      email,
      contactInbox: 'hello@qubalink.com',
      purgeDays: 30,
      clock: { now: () => NOW },
      admins: { findForPasswordMail: () => Promise.resolve(null) },
      contacts: new MemoryContacts({
        name: 'Ada',
        email: 'ada@example.com',
        topic: 'GENERAL',
        message: 'Hello',
        emailedAt: NOW,
      }),
      residents: new MemoryResidents(null),
    });
    await mail.sendContact(systemCtx(), 'msg-1');
    expect(email.sent).toHaveLength(0);
  });

  it('rejects a missing deletion notice', async () => {
    const mail = new OutboundMail({
      email: new FakeEmail(),
      contactInbox: 'hello@qubalink.com',
      purgeDays: 30,
      clock: { now: () => NOW },
      admins: { findForPasswordMail: () => Promise.resolve(null) },
      contacts: new MemoryContacts(null),
      residents: new MemoryResidents(null),
    });
    await expect(mail.sendAccountDeletion(systemCtx(), USER)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sends a password link to the admin email and not to the logs', async () => {
    const email = new FakeEmail();
    const url = 'https://civic.example/admin/update-password?token=one-time';
    const mail = new OutboundMail({
      email,
      contactInbox: 'hello@qubalink.com',
      purgeDays: 30,
      clock: { now: () => NOW },
      contacts: new MemoryContacts(null),
      residents: new MemoryResidents(null),
      admins: { findForPasswordMail: () => Promise.resolve({ email: 'ada@qubalink.com', status: 'ACTIVE' }) },
    });
    await mail.sendAdminPasswordLink(systemCtx(), { adminUserId: 'admin-1', purpose: 'RESET', url });
    expect(email.sent[0]?.to).toBe('ada@qubalink.com');
    expect(email.sent[0]?.text).toContain(url);
    expect(email.sent[0]?.text).toContain('60 minutes');
    expect(email.sent[0]?.text).not.toContain('admin-1');
  });
});

class MemoryContacts {
  emailedAt: Date | null;

  constructor(private readonly row: ContactDelivery | null) {
    this.emailedAt = row?.emailedAt ?? null;
  }

  findForDelivery(): Promise<ContactDelivery | null> {
    if (!this.row) return Promise.resolve(null);
    return Promise.resolve({ ...this.row, emailedAt: this.emailedAt });
  }

  markEmailed(_id: string, at: Date): Promise<void> {
    this.emailedAt = at;
    return Promise.resolve();
  }
}

class MemoryResidents {
  constructor(private readonly notice: DeletionNotice | null) {}

  pendingDeletionNotice(): Promise<DeletionNotice | null> {
    return Promise.resolve(this.notice);
  }
}
