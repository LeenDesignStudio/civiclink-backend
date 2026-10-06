import { describe, expect, it } from 'vitest';
import { Authz, systemPrincipal } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { directTx } from '../../auth/tx.js';
import { ValidationError } from '../../lib/errors.js';
import { FakeClock } from '../../lib/clock.js';
import type { PipelineStore, PendingQuery, SourceListQuery, SourceWrite } from './pipeline.ports.js';
import { PipelineService } from './pipeline.service.js';
import type { CivicRow, PendingRow, RunRow, SourceRow } from './records.js';
import type { HttpFetcher, HttpResult, NormalisedRecord } from './types.js';

class MemoryStore implements PipelineStore {
  sources: SourceRow[] = [];
  runs: RunRow[] = [];
  civic: CivicRow[] = [];
  pending: PendingRow[] = [];
  upserts = 0;
  private n = 0;

  listSources(query: SourceListQuery): Promise<{ rows: SourceRow[]; total: number }> {
    return Promise.resolve({ rows: this.sources.slice(0, query.limit), total: this.sources.length });
  }

  findSource(id: string): Promise<SourceRow | null> {
    return Promise.resolve(this.sources.find((row) => row.id === id) ?? null);
  }

  nameTaken(name: string, excludeId?: string): Promise<boolean> {
    return Promise.resolve(this.sources.some((row) => row.name === name && row.id !== excludeId));
  }

  saveSource(input: SourceWrite, now: Date): Promise<SourceRow> {
    const existing = input.id ? this.sources.find((row) => row.id === input.id) : undefined;
    if (existing) {
      Object.assign(existing, input, { config: input.config });
      return Promise.resolve(existing);
    }
    this.n += 1;
    const row: SourceRow = {
      id: input.id ?? `00000000-0000-4000-8000-${this.n.toString(16).padStart(12, '0')}`,
      name: input.name,
      publisher: input.publisher,
      url: input.url,
      termsUrl: input.termsUrl,
      method: input.method,
      schedule: input.schedule,
      freshnessDays: input.freshnessDays,
      levels: input.levels,
      collectorKey: input.collectorKey,
      active: input.active,
      lastRunAt: null,
      config: input.config,
      createdAt: now,
    };
    this.sources.push(row);
    return Promise.resolve(row);
  }

  activeRun(sourceId: string): Promise<RunRow | null> {
    return Promise.resolve(
      this.runs.find((row) => row.sourceId === sourceId && (row.status === 'QUEUED' || row.status === 'RUNNING')) ?? null,
    );
  }

  createRun(sourceId: string, triggeredBy: string | null, now: Date): Promise<RunRow> {
    this.n += 1;
    const run: RunRow = {
      id: `10000000-0000-4000-8000-${this.n.toString(16).padStart(12, '0')}`,
      sourceId,
      status: 'QUEUED',
      triggeredBy,
      snapshotSha: null,
      added: 0,
      changed: 0,
      retired: 0,
      pending: 0,
      error: null,
      createdAt: now,
    };
    this.runs.push(run);
    return Promise.resolve(run);
  }

  markRunning(runId: string, _now: Date): Promise<RunRow | null> {
    const run = this.runs.find((row) => row.id === runId);
    if (!run) return Promise.resolve(null);
    run.status = 'RUNNING';
    return Promise.resolve(run);
  }

  finishRun(
    runId: string,
    patch: { status: 'SUCCEEDED' | 'FAILED'; sha?: string; added: number; changed: number; pending: number; error: string | null },
  ): Promise<void> {
    const run = this.runs.find((row) => row.id === runId);
    if (run) {
      run.status = patch.status;
      run.added = patch.added;
      run.changed = patch.changed;
      run.pending = patch.pending;
      run.error = patch.error;
      if (patch.sha) run.snapshotSha = patch.sha;
    }
    return Promise.resolve();
  }

  lastSucceededSha(sourceId: string): Promise<string | null> {
    const runs = this.runs.filter((row) => row.sourceId === sourceId && row.status === 'SUCCEEDED' && row.snapshotSha);
    return Promise.resolve(runs[runs.length - 1]?.snapshotSha ?? null);
  }

  listRuns(sourceId: string, limit: number): Promise<RunRow[]> {
    return Promise.resolve(this.runs.filter((row) => row.sourceId === sourceId).slice(0, limit));
  }

  findCivic(matchKey: string): Promise<CivicRow | null> {
    return Promise.resolve(this.civic.find((row) => row.matchKey === matchKey) ?? null);
  }

  upsertCivic(_sourceId: string, record: NormalisedRecord): Promise<'added' | 'changed' | 'unchanged'> {
    this.upserts += 1;
    const existing = this.civic.find((row) => row.matchKey === record.matchKey);
    if (!existing) {
      this.n += 1;
      this.civic.push({
        matchKey: record.matchKey,
        entityType: record.entityType,
        entityId: `20000000-0000-4000-8000-${this.n.toString(16).padStart(12, '0')}`,
        fields: { ...record.fields },
      });
      return Promise.resolve('added');
    }
    const same = Object.entries(record.fields).every(([key, value]) => existing.fields[key] === value);
    if (same) return Promise.resolve('unchanged');
    existing.fields = { ...existing.fields, ...record.fields };
    return Promise.resolve('changed');
  }

  addPending(input: {
    sourceRunId: string;
    entityType: CivicRow['entityType'];
    entityId: string | null;
    field: string;
    oldValue: string | null;
    newValue: string;
    now: Date;
  }): Promise<void> {
    this.n += 1;
    this.pending.push({
      id: `30000000-0000-4000-8000-${this.n.toString(16).padStart(12, '0')}`,
      sourceRunId: input.sourceRunId,
      entityType: input.entityType,
      entityId: input.entityId,
      field: input.field,
      oldValue: input.oldValue,
      newValue: input.newValue,
      decision: 'PENDING',
      createdAt: input.now,
    });
    return Promise.resolve();
  }

  listPending(query: PendingQuery): Promise<PendingRow[]> {
    return Promise.resolve(
      this.pending
        .filter((row) => (query.decision ? row.decision === query.decision : true))
        .slice(0, query.limit),
    );
  }

  findPending(id: string): Promise<PendingRow | null> {
    return Promise.resolve(this.pending.find((row) => row.id === id) ?? null);
  }

  decidePending(): Promise<boolean> {
    return Promise.resolve(true);
  }

  applyField(entityType: CivicRow['entityType'], entityId: string, field: string, value: string | null): Promise<void> {
    const row = this.civic.find((item) => item.entityId === entityId && item.entityType === entityType);
    if (row) row.fields[field] = value;
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

  touchSource(sourceId: string, now: Date): Promise<void> {
    const source = this.sources.find((row) => row.id === sourceId);
    if (source) source.lastRunAt = now;
    return Promise.resolve();
  }
}

function system(): ServiceContext {
  const principal = systemPrincipal('source.run');
  return { requestId: 'req', principal, authz: new Authz(principal), ipHash: 'ip' };
}

function source(partial: Partial<SourceRow> & Pick<SourceRow, 'method' | 'collectorKey' | 'url'>): SourceRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Fixture',
    publisher: 'Census',
    termsUrl: 'https://example.com/terms',
    schedule: 'WEEKLY',
    freshnessDays: 90,
    levels: ['COUNTY'],
    active: true,
    lastRunAt: null,
    config: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  };
}

function fetcher(map: Record<string, HttpResult | 'too-big'>): HttpFetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    get(url, init) {
      calls.push(url);
      const hit = map[url];
      if (hit === 'too-big') {
        return Promise.resolve({ status: 200, body: new Uint8Array(init.maxBytes + 5), contentType: 'application/json' });
      }
      if (!hit) return Promise.resolve({ status: 404, body: new Uint8Array(), contentType: 'text/plain' });
      return Promise.resolve(hit);
    },
  };
}

const geo = JSON.stringify({
  type: 'FeatureCollection',
  features: [{ properties: { GEOID: '01001', NAME: 'Autauga', STATE: '01', type: 'COUNTY', level: 'COUNTY' } }],
});

describe('PipelineService', () => {
  it('does not duplicate records when the match key is stable', async () => {
    const store = new MemoryStore();
    store.sources.push(source({ method: 'BULK', collectorKey: 'tiger.boundaries', url: 'https://example.com/tiger.json' }));
    const http = fetcher({
      'https://example.com/tiger.json': { status: 200, body: new TextEncoder().encode(geo), contentType: 'application/json' },
    });
    const service = new PipelineService({
      store,
      fetch: http,
      audit: { record: () => Promise.resolve() },
      clock: new FakeClock(new Date('2026-01-01T00:00:00Z')),
      withTx: directTx,
    });
    const changed = geo.replace('Autauga', 'Autauga');
    const second = changed.replace('"01001"', '"01001"') + '\n';
    await service.runSource(system(), { sourceId: store.sources[0]?.id });
    http.calls.length = 0;
    const map = http as ReturnType<typeof fetcher>;
    const original = map.get.bind(map);
    map.get = (url, init) => {
      if (url.endsWith('tiger.json')) {
        map.calls.push(url);
        return Promise.resolve({ status: 200, body: new TextEncoder().encode(second), contentType: 'application/json' });
      }
      return original(url, init);
    };
    await service.runSource(system(), { sourceId: store.sources[0]?.id });
    expect(store.civic).toHaveLength(1);
    expect(store.civic[0]?.matchKey).toBe('tiger:01001');
  });

  it('skips apply when the snapshot sha is unchanged', async () => {
    const store = new MemoryStore();
    store.sources.push(source({ method: 'BULK', collectorKey: 'tiger.boundaries', url: 'https://example.com/tiger.json' }));
    const http = fetcher({
      'https://example.com/tiger.json': { status: 200, body: new TextEncoder().encode(geo), contentType: 'application/json' },
    });
    const service = new PipelineService({
      store,
      fetch: http,
      audit: { record: () => Promise.resolve() },
      withTx: directTx,
      clock: new FakeClock(new Date('2026-01-01T00:00:00Z')),
    });
    await service.runSource(system(), { sourceId: store.sources[0]?.id });
    const upserts = store.upserts;
    const again = await service.runSource(system(), { sourceId: store.sources[0]?.id });
    expect(again.skipped).toBe(true);
    expect(store.upserts).toBe(upserts);
  });

  it('writes a pending change for page collection instead of civic rows', async () => {
    const store = new MemoryStore();
    const html = '<article class="directory-item"><h2>Ada Mayor</h2><span class="phone">222</span></article>';
    store.civic.push({
      matchKey: 'page:ada mayor',
      entityType: 'OFFICIAL',
      entityId: '22222222-2222-4222-8222-222222222222',
      fields: { fullName: 'Ada Mayor', phone: '111', email: null },
    });
    store.sources.push(
      source({
        method: 'PAGE_COLLECTION',
        collectorKey: 'page.directory',
        url: 'https://example.com/directory',
      }),
    );
    const http = fetcher({
      'https://example.com/robots.txt': { status: 200, body: new TextEncoder().encode('User-agent: *\nAllow: /'), contentType: 'text/plain' },
      'https://example.com/directory': { status: 200, body: new TextEncoder().encode(html), contentType: 'text/html' },
    });
    const service = new PipelineService({
      store,
      fetch: http,
      audit: { record: () => Promise.resolve() },
      withTx: directTx,
      clock: new FakeClock(new Date('2026-01-01T00:00:00Z')),
    });
    const result = await service.runSource(system(), { sourceId: store.sources[0]?.id });
    expect(result.pending).toBeGreaterThan(0);
    expect(store.civic[0]?.fields.phone).toBe('111');
    expect(store.pending.some((row) => row.field === 'phone' && row.newValue === '222')).toBe(true);
    expect(store.upserts).toBe(0);
  });

  it('aborts an oversized download', async () => {
    const store = new MemoryStore();
    store.sources.push(source({ method: 'PAGE_COLLECTION', collectorKey: 'page.directory', url: 'https://example.com/directory' }));
    const http = fetcher({
      'https://example.com/robots.txt': { status: 404, body: new Uint8Array(), contentType: 'text/plain' },
      'https://example.com/directory': 'too-big',
    });
    const service = new PipelineService({
      store,
      fetch: http,
      audit: { record: () => Promise.resolve() },
      withTx: directTx,
      caps: { bulk: 50, page: 8 },
    });
    await expect(service.runSource(system(), { sourceId: store.sources[0]?.id })).rejects.toBeInstanceOf(ValidationError);
    expect(store.runs.some((row) => row.status === 'FAILED')).toBe(true);
    expect(store.civic).toHaveLength(0);
  });

  it('skips a URL disallowed by robots.txt', async () => {
    const store = new MemoryStore();
    store.sources.push(source({ method: 'PAGE_COLLECTION', collectorKey: 'page.directory', url: 'https://example.com/directory' }));
    const http = fetcher({
      'https://example.com/robots.txt': {
        status: 200,
        body: new TextEncoder().encode('User-agent: *\nDisallow: /directory'),
        contentType: 'text/plain',
      },
      'https://example.com/directory': {
        status: 200,
        body: new TextEncoder().encode('<article class="directory-item"><h2>Ada Mayor</h2></article>'),
        contentType: 'text/html',
      },
    });
    const service = new PipelineService({
      store,
      fetch: http,
      audit: { record: () => Promise.resolve() },
      withTx: directTx,
    });
    const result = await service.runSource(system(), { sourceId: store.sources[0]?.id });
    expect(result.skipped).toBe(true);
    expect(http.calls).not.toContain('https://example.com/directory');
    expect(store.pending).toHaveLength(0);
    expect(store.civic).toHaveLength(0);
  });
});
