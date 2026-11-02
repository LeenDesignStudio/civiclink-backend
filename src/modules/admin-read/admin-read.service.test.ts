import { describe, expect, it } from 'vitest';
import { Authz } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { ForbiddenError, ValidationError } from '../../lib/errors.js';
import type { ChangeLogEntry } from '../audit/audit.dto.js';
import type { ActivityEvent } from './activity.js';
import { AdminReadService, shapeDashboard } from './admin-read.service.js';
import type { ActivityRow, AdminReadStore, DashboardRaw } from './admin-read.store.js';

const NOW = new Date('2026-06-10T12:00:00.000Z');
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function systemCtx(): ServiceContext {
  const principal = { kind: 'system' as const, job: 'admin.activity.purge' };
  return { requestId: 'job', principal, authz: new Authz(principal), ipHash: 'system' };
}

function ctx(role: 'SUPER_ADMIN' | 'ADMIN_STAFF' | 'resident'): ServiceContext {
  if (role === 'resident') {
    const principal = {
      kind: 'resident' as const,
      userId: ADMIN,
      status: 'ACTIVE' as const,
      termsAccepted: true,
      sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };
    return { requestId: 'req', principal, authz: new Authz(principal), ipHash: 'h' };
  }
  const principal = {
    kind: 'admin' as const,
    adminId: ADMIN,
    role,
    sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  };
  return { requestId: 'req', principal, authz: new Authz(principal), ipHash: 'h' };
}

function emptyGroup() {
  return { total: 0, items: [] };
}

class Store implements AdminReadStore {
  events: ActivityEvent[] = [];
  searches: string[] = [];
  marked: Array<string[] | 'all'> = [];
  includeSuper: boolean[] = [];
  purgedAt: Date | null = null;
  dashboardRaw: DashboardRaw = {
    pendingCorrections: 2,
    oldestPendingAt: new Date('2026-06-04T12:00:00.000Z'),
    outdatedRecords: 1,
    sourceIssues: 1,
    alertsNeedingAttention: 1,
    officials: 4,
    offices: 3,
    jurisdictions: 2,
    services: 1,
    attention: [
      { kind: 'RECORD', id: '11111111-1111-4111-8111-111111111111', label: 'Clerk', since: new Date('2026-06-01T12:00:00.000Z') },
      { kind: 'CORRECTION', id: '22222222-2222-4222-8222-222222222222', label: 'COR-00000001', since: new Date('2026-06-08T12:00:00.000Z'), correctionStatus: 'SUBMITTED' },
      { kind: 'SOURCE', id: '33333333-3333-4333-8333-333333333333', label: 'Census', since: new Date('2026-05-01T12:00:00.000Z'), sourceIssue: 'FAILED' },
      { kind: 'ALERT', id: '44444444-4444-4444-8444-444444444444', label: 'Notice', since: new Date('2026-06-09T12:00:00.000Z'), failedDeliveries: 12 },
      { kind: 'RECORD', id: '55555555-5555-4555-8555-555555555555', label: 'Older', since: new Date('2026-01-01T12:00:00.000Z') },
      { kind: 'RECORD', id: '66666666-6666-4666-8666-666666666666', label: 'Sixth', since: new Date('2026-01-02T12:00:00.000Z') },
    ],
    recent: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        entityType: 'OFFICE',
        entityId: '11111111-1111-4111-8111-111111111111',
        action: 'CREATE',
        label: 'Clerk',
        recordType: 'OFFICE',
        actorName: 'Ada',
        createdAt: NOW,
      },
      {
        id: '88888888-8888-4888-8888-888888888888',
        entityType: 'OFFICE',
        entityId: '11111111-1111-4111-8111-111111111111',
        action: 'NOTE',
        label: 'Skip',
        recordType: 'OFFICE',
        actorName: null,
        createdAt: NOW,
      },
    ],
    pilots: [
      {
        id: '99999999-9999-4999-8999-999999999999',
        name: 'Seed County',
        displayId: 'JUR-00000001',
        hasBoundary: true,
        officeCount: 2,
        lastUpdatedAt: NOW,
        outdatedAfterDays: 90,
        override: 'NONE',
      },
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
        name: 'Open County',
        displayId: 'JUR-00000002',
        hasBoundary: false,
        officeCount: 0,
        lastUpdatedAt: NOW,
        outdatedAfterDays: 90,
        override: 'NONE',
      },
    ],
  };

  dashboard(): Promise<DashboardRaw> {
    return Promise.resolve(this.dashboardRaw);
  }

  search(pattern: string) {
    this.searches.push(pattern);
    return Promise.resolve({
      offices: emptyGroup(),
      officials: emptyGroup(),
      jurisdictions: emptyGroup(),
      services: emptyGroup(),
      sources: emptyGroup(),
      corrections: emptyGroup(),
    });
  }

  record(event: ActivityEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  listActivity(input: { includeSuperAdmin: boolean }): Promise<{ rows: ActivityRow[]; total: number }> {
    this.includeSuper.push(input.includeSuperAdmin);
    return Promise.resolve({ rows: [], total: 0 });
  }

  unreadCount(): Promise<number> {
    return Promise.resolve(0);
  }

  markRead(_adminId: string, _include: boolean, ids: string[] | 'all'): Promise<number> {
    this.marked.push(ids);
    return Promise.resolve(ids === 'all' ? 3 : ids.length);
  }

  deleteOlderThan(cutoff: Date): Promise<number> {
    this.purgedAt = cutoff;
    return Promise.resolve(2);
  }
}

function service(store: Store) {
  const entries: ChangeLogEntry[] = [];
  const read = new AdminReadService({
    store,
    clock: { now: () => NOW },
    runTx: (fn) => fn(undefined),
    audit: {
      record: (_tx, entry) => {
        entries.push(entry);
        return Promise.resolve();
      },
    },
  });
  return { read, entries };
}

describe('admin read service', () => {
  it('shapes the dashboard and keeps the five oldest attention rows', async () => {
    const store = new Store();
    const { read } = service(store);
    const view = await read.dashboard(ctx('ADMIN_STAFF'));
    expect(view.oldestPendingDays).toBe(6);
    expect(view.needsAttention.map((row) => row.label)).toEqual(['Older', 'Sixth', 'Census', 'Clerk', 'COR-00000001']);
    expect(view.needsAttention[2]?.reason).toBe('Refresh failed');
    expect(view.needsAttention[4]?.reason).toBe('Pending 2 days');
    expect(view.recentlyEdited).toHaveLength(1);
    expect(view.recentlyEdited[0]?.actionLabel).toBe('Created');
    expect(view.pilotCoverage.summary).toBe('1 of 2 pilot jurisdictions fully covered');
    expect(view.pilotCoverage.rows[1]?.boundary).toBe('MISSING');
  });

  it('refuses a search shorter than two characters and escapes the rest', async () => {
    const store = new Store();
    const { read } = service(store);
    await expect(read.search(ctx('SUPER_ADMIN'), { q: ' a ' })).rejects.toBeInstanceOf(ValidationError);
    expect(store.searches).toEqual([]);
    await read.search(ctx('SUPER_ADMIN'), { q: '100%' });
    expect(store.searches).toEqual(['%100\\%%']);
  });

  it('hides super-admin activity from staff and audits a mark-all', async () => {
    const store = new Store();
    const { read, entries } = service(store);
    await read.activity(ctx('ADMIN_STAFF'), {});
    await read.activity(ctx('SUPER_ADMIN'), {});
    expect(store.includeSuper).toEqual([false, true]);
    await expect(read.dashboard(ctx('resident'))).rejects.toBeInstanceOf(ForbiddenError);
    const marked = await read.markRead(ctx('SUPER_ADMIN'), { all: true });
    expect(marked.updated).toBe(3);
    expect(entries[0]?.action).toBe('admin.activity_read');
    await expect(read.markRead(ctx('SUPER_ADMIN'), {})).rejects.toBeInstanceOf(ValidationError);
    await expect(read.purge(ctx('ADMIN_STAFF'))).rejects.toBeInstanceOf(ForbiddenError);
    const purged = await read.purge(systemCtx());
    expect(purged.deleted).toBe(2);
    expect(store.purgedAt?.toISOString()).toBe('2026-05-11T12:00:00.000Z');
  });

  it('drops unknown recent actions when shaping a dashboard', () => {
    const view = shapeDashboard(
      {
        pendingCorrections: 0,
        oldestPendingAt: null,
        outdatedRecords: 0,
        sourceIssues: 0,
        alertsNeedingAttention: 0,
        officials: 0,
        offices: 0,
        jurisdictions: 0,
        services: 0,
        attention: [],
        recent: [],
        pilots: [],
      },
      NOW,
    );
    expect(view.oldestPendingDays).toBeNull();
    expect(view.pilotCoverage.summary).toBe('0 of 0 pilot jurisdictions fully covered');
  });
});
