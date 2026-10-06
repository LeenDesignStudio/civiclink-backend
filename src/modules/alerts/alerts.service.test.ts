import { describe, expect, it } from 'vitest';
import { Authz } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import {
  AlertAlreadySentError,
  ForbiddenError,
  NoRecipientsError,
  RecipientsChangedError,
} from '../../lib/errors.js';
import { directTx } from '../../auth/tx.js';
import { FakeClock } from '../../lib/clock.js';
import type { AlertDto, ChannelStats } from './alerts.dto.js';
import type { AlertListQuery, AlertPatch, AlertsRepo, NewAlert } from './alerts.ports.js';
import { AlertsService } from './alerts.service.js';
import { emptyStats } from './alerts.dto.js';
import { FakeEmail } from '../../../test/fakes/email.js';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OFFICE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

class MemoryAlerts implements AlertsRepo {
  rows: AlertDto[] = [];
  followers = 0;
  offices = new Set<string>([OFFICE]);
  emails = new Map<string, string>([[ADMIN, 'comms@qubalink.com']]);
  private n = 0;

  list(query: AlertListQuery): Promise<{ rows: AlertDto[]; total: number }> {
    const rows = this.rows.filter((row) => (query.status ? row.status === query.status : true));
    return Promise.resolve({ rows: rows.slice(0, query.limit), total: rows.length });
  }

  find(id: string): Promise<AlertDto | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  insert(row: NewAlert): Promise<AlertDto> {
    this.n += 1;
    const alert: AlertDto = {
      id: `00000000-0000-4000-8000-${this.n.toString(16).padStart(12, '0')}`,
      targetOfficeId: row.targetOfficeId,
      targetOfficialId: row.targetOfficialId,
      title: row.title,
      body: row.body,
      link: row.link,
      channels: row.channels,
      status: 'DRAFT',
      createdBy: row.createdBy,
      sentBy: null,
      sentAt: null,
      recipientCount: null,
      createdAt: row.createdAt,
    };
    this.rows.push(alert);
    return Promise.resolve(alert);
  }

  updateDraft(id: string, patch: AlertPatch): Promise<AlertDto | null> {
    const row = this.rows.find((item) => item.id === id);
    if (!row || row.status !== 'DRAFT') return Promise.resolve(null);
    Object.assign(row, patch);
    return Promise.resolve(row);
  }

  deleteDraft(id: string): Promise<'deleted' | 'missing' | 'sent'> {
    const row = this.rows.find((item) => item.id === id);
    if (!row) return Promise.resolve('missing');
    if (row.status !== 'DRAFT') return Promise.resolve('sent');
    this.rows = this.rows.filter((item) => item.id !== id);
    return Promise.resolve('deleted');
  }

  followerCount(): Promise<number> {
    return Promise.resolve(this.followers);
  }

  previewCounts(): Promise<{ inApp: number; email: number; push: number; followers: number }> {
    return Promise.resolve({
      inApp: this.followers,
      email: this.followers,
      push: this.followers,
      followers: this.followers,
    });
  }

  claimDraft(id: string, senderId: string): Promise<boolean> {
    const row = this.rows.find((item) => item.id === id && item.status === 'DRAFT');
    if (!row) return Promise.resolve(false);
    row.status = 'SENDING';
    row.sentBy = senderId;
    return Promise.resolve(true);
  }

  markSent(id: string, recipientCount: number, sentAt: Date): Promise<void> {
    const row = this.rows.find((item) => item.id === id);
    if (row) {
      row.status = 'SENT';
      row.recipientCount = recipientCount;
      row.sentAt = sentAt;
    }
    return Promise.resolve();
  }

  channelStats(): Promise<ChannelStats[]> {
    return Promise.resolve(emptyStats());
  }

  adminEmail(adminId: string): Promise<string | null> {
    return Promise.resolve(this.emails.get(adminId) ?? null);
  }

  targetExists(alert: Pick<AlertDto, 'targetOfficeId' | 'targetOfficialId'>): Promise<boolean> {
    if (alert.targetOfficeId) return Promise.resolve(this.offices.has(alert.targetOfficeId));
    return Promise.resolve(alert.targetOfficialId !== null);
  }
}

function admin(role: 'VIEWER' | 'COMMUNICATIONS' | 'EDITOR'): ServiceContext {
  const principal = { kind: 'admin' as const, adminId: ADMIN, role, sessionId: 'session' };
  return { requestId: 'req', principal, authz: new Authz(principal), ipHash: 'ip' };
}

function service(repo: MemoryAlerts) {
  return new AlertsService({
    repo,
    email: new FakeEmail(),
    enqueue: { enqueue: () => Promise.resolve() },
    audit: { record: () => Promise.resolve() },
    clock: new FakeClock(new Date('2026-01-01T00:00:00Z')),
    withTx: directTx,
    webUrl: 'https://civiclink.example',
  });
}

const draftInput = {
  targetOfficeId: OFFICE,
  title: 'Water notice',
  body: 'Boil water until further notice from the city.',
  channels: ['EMAIL'],
};

describe('AlertsService', () => {
  it('rejects send when the draft was already sent', async () => {
    const repo = new MemoryAlerts();
    repo.followers = 10;
    const alerts = service(repo);
    const { alert } = await alerts.saveAlertDraft(admin('COMMUNICATIONS'), draftInput);
    await alerts.sendAlert(admin('COMMUNICATIONS'), { id: alert.id, confirmRecipientCount: 10 });
    await expect(
      alerts.sendAlert(admin('COMMUNICATIONS'), { id: alert.id, confirmRecipientCount: 10 }),
    ).rejects.toBeInstanceOf(AlertAlreadySentError);
    await expect(alerts.saveAlertDraft(admin('COMMUNICATIONS'), { ...draftInput, id: alert.id })).rejects.toBeInstanceOf(
      AlertAlreadySentError,
    );
  });

  it('rejects send when the confirmed count drifted more than 5 percent', async () => {
    const repo = new MemoryAlerts();
    repo.followers = 10;
    const alerts = service(repo);
    const { alert } = await alerts.saveAlertDraft(admin('COMMUNICATIONS'), draftInput);
    await expect(
      alerts.sendAlert(admin('COMMUNICATIONS'), { id: alert.id, confirmRecipientCount: 20 }),
    ).rejects.toBeInstanceOf(RecipientsChangedError);
    expect(repo.rows[0]?.status).toBe('DRAFT');
  });

  it('rejects send when nobody follows the target', async () => {
    const repo = new MemoryAlerts();
    repo.followers = 0;
    const alerts = service(repo);
    const { alert } = await alerts.saveAlertDraft(admin('COMMUNICATIONS'), draftInput);
    await expect(
      alerts.sendAlert(admin('COMMUNICATIONS'), { id: alert.id, confirmRecipientCount: 0 }),
    ).rejects.toBeInstanceOf(NoRecipientsError);
  });

  it('denies sendAlert for a viewer', async () => {
    const repo = new MemoryAlerts();
    repo.followers = 4;
    const alerts = service(repo);
    const { alert } = await alerts.saveAlertDraft(admin('COMMUNICATIONS'), draftInput);
    await expect(
      alerts.sendAlert(admin('VIEWER'), { id: alert.id, confirmRecipientCount: 4 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
