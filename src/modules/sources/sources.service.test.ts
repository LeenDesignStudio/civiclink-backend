import { describe, expect, it } from 'vitest';
import { Authz } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { directTx } from '../../auth/tx.js';
import {
  AlreadyDecidedError,
  RunInProgressError,
  SourceInactiveError,
  UnknownCollectorError,
} from '../../lib/errors.js';
import { FakeClock } from '../../lib/clock.js';
import { DashboardService, type DashboardRepo } from './dashboard.js';
import { SourcesService } from './sources.service.js';
import type { PipelineStore } from '../pipeline/pipeline.ports.js';
import type { PendingRow, SourceRow } from '../pipeline/records.js';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE = '11111111-1111-4111-8111-111111111111';

class Store implements Pick<
  PipelineStore,
  | 'listSources'
  | 'findSource'
  | 'nameTaken'
  | 'saveSource'
  | 'activeRun'
  | 'createRun'
  | 'listRuns'
  | 'findPending'
  | 'decidePending'
  | 'applyField'
  | 'listPending'
  | 'markRunning'
  | 'finishRun'
  | 'lastSucceededSha'
  | 'findCivic'
  | 'upsertCivic'
  | 'addPending'
  | 'reresolveLocations'
  | 'servicesWithUrls'
  | 'setLinkBroken'
  | 'touchSource'
> {
  source: SourceRow = {
    id: SOURCE,
    name: 'Census',
    publisher: 'Census',
    url: 'https://example.com/data',
    termsUrl: 'https://example.com/terms',
    method: 'BULK',
    schedule: 'WEEKLY',
    freshnessDays: 90,
    levels: ['COUNTY'],
    collectorKey: 'tiger.boundaries',
    active: true,
    lastRunAt: null,
    config: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  running = false;
  pending: PendingRow | null = null;
  applied: string | null = null;

  listSources(): Promise<{ rows: SourceRow[]; total: number }> {
    return Promise.resolve({ rows: [this.source], total: 1 });
  }
  findSource(): Promise<SourceRow | null> {
    return Promise.resolve(this.source);
  }
  nameTaken(): Promise<boolean> {
    return Promise.resolve(false);
  }
  saveSource(): Promise<SourceRow> {
    return Promise.resolve(this.source);
  }
  activeRun(): Promise<null> {
    return Promise.resolve(this.running ? ({ id: 'run', sourceId: SOURCE, status: 'RUNNING' } as never) : null);
  }
  createRun(): Promise<never> {
    return Promise.resolve({ id: 'run', sourceId: SOURCE, status: 'QUEUED' } as never);
  }
  listRuns(): Promise<never[]> {
    return Promise.resolve([]);
  }
  findPending(): Promise<PendingRow | null> {
    return Promise.resolve(this.pending);
  }
  decidePending(id: string, decision: 'ACCEPTED' | 'REJECTED'): Promise<boolean> {
    if (!this.pending || this.pending.id !== id || this.pending.decision !== 'PENDING') return Promise.resolve(false);
    this.pending.decision = decision;
    return Promise.resolve(true);
  }
  applyField(_type: PendingRow['entityType'], _id: string, _field: string, value: string | null): Promise<void> {
    this.applied = value;
    return Promise.resolve();
  }
  listPending(): Promise<PendingRow[]> {
    return Promise.resolve(this.pending ? [this.pending] : []);
  }
  markRunning(): Promise<null> {
    return Promise.resolve(null);
  }
  finishRun(): Promise<void> {
    return Promise.resolve();
  }
  lastSucceededSha(): Promise<null> {
    return Promise.resolve(null);
  }
  findCivic(): Promise<null> {
    return Promise.resolve(null);
  }
  upsertCivic(): Promise<'unchanged'> {
    return Promise.resolve('unchanged');
  }
  addPending(): Promise<void> {
    return Promise.resolve();
  }
  reresolveLocations(): Promise<number> {
    return Promise.resolve(0);
  }
  servicesWithUrls(): Promise<{ id: string; url: string }[]> {
    return Promise.resolve([]);
  }
  setLinkBroken(): Promise<void> {
    return Promise.resolve();
  }
  touchSource(): Promise<void> {
    return Promise.resolve();
  }
}

const emptyDashboard: DashboardRepo = {
  correctionCounts: () => Promise.resolve([]),
  correctionsOlderThan: () => Promise.resolve(0),
  staleByLevel: () => Promise.resolve([]),
  failedSourceRuns: () => Promise.resolve(0),
  pendingSourceChanges: () => Promise.resolve(0),
  alertsSince: () => Promise.resolve(0),
  alertFailuresSince: () => Promise.resolve(0),
};

function editor(): ServiceContext {
  const principal = { kind: 'admin' as const, adminId: ADMIN, role: 'EDITOR' as const, sessionId: 's' };
  return { requestId: 'req', principal, authz: new Authz(principal), ipHash: 'ip' };
}

function service(store: Store) {
  return new SourcesService({
    store,
    audit: { record: () => Promise.resolve() },
    enqueue: { enqueue: () => Promise.resolve() },
    dashboard: new DashboardService(emptyDashboard, new FakeClock(new Date('2026-06-01T00:00:00Z'))),
    clock: new FakeClock(new Date('2026-06-01T00:00:00Z')),
    withTx: directTx,
  });
}

describe('SourcesService', () => {
  it('rejects an unknown collector key', async () => {
    const sources = service(new Store());
    await expect(
      sources.upsertSource(editor(), {
        name: 'Mystery',
        publisher: 'Nobody',
        url: 'https://example.com/a',
        termsUrl: 'https://example.com/t',
        method: 'API',
        schedule: 'DAILY',
        freshnessDays: 30,
        levels: ['STATE'],
        collectorKey: 'not.real',
        active: true,
      }),
    ).rejects.toBeInstanceOf(UnknownCollectorError);
  });

  it('rejects refresh while a run is active or the source is inactive', async () => {
    const store = new Store();
    store.running = true;
    await expect(service(store).triggerSourceRefresh(editor(), { sourceId: SOURCE })).rejects.toBeInstanceOf(
      RunInProgressError,
    );
    store.running = false;
    store.source.active = false;
    await expect(service(store).triggerSourceRefresh(editor(), { sourceId: SOURCE })).rejects.toBeInstanceOf(
      SourceInactiveError,
    );
  });

  it('rejects a second decision and applies an accepted value', async () => {
    const store = new Store();
    store.pending = {
      id: '33333333-3333-4333-8333-333333333333',
      sourceRunId: 'run',
      entityType: 'OFFICIAL',
      entityId: '22222222-2222-4222-8222-222222222222',
      field: 'phone',
      oldValue: '111',
      newValue: '222',
      decision: 'PENDING',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const sources = service(store);
    await sources.decideSourceChange(editor(), { id: store.pending.id, decision: 'ACCEPTED' });
    expect(store.applied).toBe('222');
    await expect(
      sources.decideSourceChange(editor(), { id: store.pending.id, decision: 'REJECTED' }),
    ).rejects.toBeInstanceOf(AlreadyDecidedError);
  });

  it('returns zero-safe dashboard counts', async () => {
    const counts = await service(new Store()).adminDashboardCounts(editor());
    expect(counts.correctionsByStatus.every((row) => row.count === 0)).toBe(true);
    expect(counts.staleRecordsByLevel).toHaveLength(6);
    expect(counts.failedSourceRuns).toBe(0);
    expect(counts.pendingSourceChanges).toBe(0);
  });
});
