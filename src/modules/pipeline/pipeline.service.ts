import { randomUUID } from 'node:crypto';
import type { ServiceContext } from '../../graphql/context.js';
import type { ActorType } from '../../generated/prisma/enums.js';
import { directTx, type RunTx } from '../../auth/tx.js';
import { postgresMessage } from '../../db/prisma.js';
import { systemClock, type Clock } from '../../lib/clock.js';
import {
  fromZod,
  NotFoundError,
  RunInProgressError,
  SourceInactiveError,
  UnknownCollectorError,
  UpstreamError,
  ValidationError,
  isAppError,
} from '../../lib/errors.js';
import { z } from 'zod';
import { collectorFor } from './collectors.js';
import type { PipelineStore } from './pipeline.ports.js';
import {
  BULK_CAP,
  isPendingField,
  PAGE_CAP,
  sameAttributes,
  type Collector,
  type HttpFetcher,
  type NormalisedRecord,
  type RawSnapshot,
  type RunCounts,
  type ZipConvertRequest,
} from './types.js';
import type { SourceRow } from './records.js';

const runSchema = z
  .object({
    sourceId: z.uuid(),
    runId: z.uuid().optional(),
    state: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .optional(),
    county: z.string().trim().min(1).max(80).optional(),
    tigerYear: z.number().int().min(2000).max(2100).optional(),
  })
  .strict();

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

export interface PipelineDeps {
  store: PipelineStore;
  fetch: HttpFetcher;
  audit: AuditWriter;
  clock?: Clock;
  withTx?: RunTx;
  caps?: { bulk: number; page: number };
  userAgent?: string;
  pace?: { wait(): Promise<void> };
  convertZip?: (request: ZipConvertRequest) => Promise<Uint8Array>;
}

export class PipelineService {
  private readonly clock: Clock;
  private readonly withTx: RunTx;
  private readonly caps: { bulk: number; page: number };

  constructor(private readonly deps: PipelineDeps) {
    this.clock = deps.clock ?? systemClock;
    this.withTx = deps.withTx ?? directTx;
    this.caps = deps.caps ?? { bulk: BULK_CAP, page: PAGE_CAP };
  }

  async runSource(ctx: ServiceContext, input: unknown): Promise<RunCounts> {
    ctx.authz.require('system.pipeline:run');
    const parsed = parse(runSchema, input);
    const loaded = await this.deps.store.findSource(parsed.sourceId);
    if (!loaded) throw new NotFoundError();
    const source = applyScope(loaded, parsed);
    if (!source.active) throw new SourceInactiveError();
    if (!source.collectorKey) throw new UnknownCollectorError();
    const collector = collectorFor(source.collectorKey);
    if (!collector) throw new UnknownCollectorError();
    const active = await this.deps.store.activeRun(source.id);
    if (active && active.id !== parsed.runId) throw new RunInProgressError();
    const now = this.clock.now();
    const queued = parsed.runId
      ? await this.deps.store.markRunning(parsed.runId, now)
      : await this.deps.store.createRun(source.id, null, now);
    if (!queued) throw new NotFoundError();
    const run = (await this.deps.store.markRunning(queued.id, now)) ?? queued;
    try {
      const { snapshot, records } = await this.fetchRecords(source, collector);
      const previous = await this.deps.store.lastSucceededSha(source.id);
      if (previous && previous === snapshot.sha256 && snapshot.skipped !== 'robots') {
        await this.finish(run.id, { sha: snapshot.sha256, added: 0, changed: 0, retired: 0, pending: 0 });
        return withNotice({ skipped: true, added: 0, changed: 0, retired: 0, pending: 0, sha: snapshot.sha256 }, snapshot);
      }
      if (snapshot.skipped === 'robots') {
        await this.finish(run.id, { sha: snapshot.sha256, added: 0, changed: 0, retired: 0, pending: 0 });
        return withNotice({ skipped: true, added: 0, changed: 0, retired: 0, pending: 0, sha: snapshot.sha256 }, snapshot);
      }
      const page = source.method === 'PAGE_COLLECTION' || collector.key === 'page.directory';
      let added = 0;
      let changed = 0;
      let pending = 0;
      for (const record of records) {
        if (page) {
          pending += await this.queuePageChange(run.id, record);
          continue;
        }
        const before = await this.deps.store.findCivic(record.matchKey);
        const outcome = await this.deps.store.upsertCivic(source.id, record, this.clock.now());
        if (outcome === 'unchanged') continue;
        if (outcome === 'added') added += 1;
        else changed += 1;
        const after = await this.deps.store.findCivic(record.matchKey);
        await this.withTx(async (tx) => {
          await this.deps.audit.record(tx, {
            actorType: 'SOURCE',
            actorId: source.id,
            entityType: record.entityType.toLowerCase(),
            entityId: after?.entityId ?? source.id,
            action: outcome === 'added' ? 'source.add' : 'source.change',
            before: before ? { ...withoutGeometry(before.fields) } : null,
            after: after ? { ...withoutGeometry(after.fields) } : { ...withoutGeometry(record.fields) },
            requestId: ctx.requestId,
          });
        });
      }
      const retired = await this.retireMissing(source, records, true);
      await this.finish(run.id, { sha: snapshot.sha256, added, changed, retired, pending });
      await this.deps.store.touchSource(source.id, this.clock.now());
      return withNotice({ skipped: false, added, changed, retired, pending, sha: snapshot.sha256 }, snapshot);
    } catch (err) {
      const message = (err instanceof ValidationError ? err.message : (postgresMessage(err) ?? 'Source run failed.')).slice(0, 500);
      try {
        await this.fail(run.id, message);
      } catch {
        // Report the original failure. A second database error would hide it.
      }
      if (isAppError(err)) throw err;
      throw new UpstreamError(undefined, { cause: err });
    }
  }

  async previewSource(ctx: ServiceContext, input: unknown): Promise<RunCounts> {
    ctx.authz.require('system.pipeline:run');
    const parsed = parse(runSchema, input);
    const loaded = await this.deps.store.findSource(parsed.sourceId);
    if (!loaded) throw new NotFoundError();
    const source = applyScope(loaded, parsed);
    if (!source.active) throw new SourceInactiveError();
    if (!source.collectorKey) throw new UnknownCollectorError();
    const collector = collectorFor(source.collectorKey);
    if (!collector) throw new UnknownCollectorError();
    const { snapshot, records } = await this.fetchRecords(source, collector);
    if (snapshot.skipped === 'robots') {
      return withNotice({ skipped: true, added: 0, changed: 0, retired: 0, pending: 0, sha: snapshot.sha256 }, snapshot);
    }
    const previous = await this.deps.store.lastSucceededSha(source.id);
    if (previous && previous === snapshot.sha256) {
      return withNotice({ skipped: true, added: 0, changed: 0, retired: 0, pending: 0, sha: snapshot.sha256 }, snapshot);
    }
    const page = source.method === 'PAGE_COLLECTION' || collector.key === 'page.directory';
    let added = 0;
    let changed = 0;
    let pending = 0;
    for (const record of records) {
      const existing = await this.deps.store.findCivic(record.matchKey);
      if (page) {
        pending += countPending(existing?.fields, record);
        continue;
      }
      if (!existing) added += 1;
      else if (!sameAttributes(existing.fields, record.fields)) changed += 1;
    }
    const retired = await this.retireMissing(source, records, false);
    return withNotice({ skipped: false, added, changed, retired, pending, sha: snapshot.sha256 }, snapshot);
  }

  async locationsReresolve(ctx: ServiceContext): Promise<{ updated: number }> {
    ctx.authz.require('system.locations:reresolve');
    const updated = await this.deps.store.reresolveLocations(this.clock.now());
    return { updated };
  }

  async linkCheck(ctx: ServiceContext): Promise<{ checked: number; broken: number }> {
    ctx.authz.require('system.locations:reresolve');
    const rows = await this.deps.store.servicesWithUrls();
    let broken = 0;
    for (const row of rows) {
      let response: Awaited<ReturnType<HttpFetcher['get']>>;
      try {
        response = await this.deps.fetch.get(row.url, { maxBytes: 4096, timeoutMs: 8_000, headers: { 'user-agent': 'CivicLinkBot/1.0' } });
      } catch (err) {
        if (isAppError(err)) throw err;
        throw new UpstreamError(undefined, { cause: err });
      }
      const isBroken = response.status >= 400;
      await this.deps.store.setLinkBroken(row.id, isBroken, this.clock.now());
      if (isBroken) broken += 1;
    }
    return { checked: rows.length, broken };
  }

  private async fetchRecords(source: SourceRow, collector: Collector): Promise<{ snapshot: Awaited<ReturnType<Collector['fetch']>>; records: NormalisedRecord[] }> {
    const cap = source.method === 'PAGE_COLLECTION' || collector.key === 'page.directory' ? this.caps.page : this.caps.bulk;
    const snapshot = await collector.fetch({
      source,
      fetch: this.deps.fetch,
      maxBytes: cap,
      ...(this.deps.userAgent ? { userAgent: this.deps.userAgent } : {}),
      ...(this.deps.pace ? { pace: this.deps.pace } : {}),
      ...(this.deps.convertZip ? { convertZip: this.deps.convertZip } : {}),
    });
    if (snapshot.body.byteLength > cap) throw new ValidationError('Download exceeded the size cap.');
    if (snapshot.skipped === 'robots') return { snapshot, records: [] };
    return { snapshot, records: collector.normalise(snapshot) };
  }

  private async retireMissing(source: SourceRow, records: NormalisedRecord[], write: boolean): Promise<number> {
    if (source.collectorKey !== 'tiger.boundaries' || !source.config.state) return 0;
    const geoids = records.flatMap((record) => (record.fields.geoid ? [record.fields.geoid] : []));
    const types = [...new Set(records.flatMap((record) => (record.fields.type ? [record.fields.type] : [])))];
    if (geoids.length === 0 || types.length === 0) return 0;
    if (!write) {
      const live = await this.deps.store.listActiveJurisdictions(source.id, source.config.state);
      const typeSet = new Set(types);
      const geoidSet = new Set(geoids);
      return live.filter((row) => typeSet.has(row.type) && !geoidSet.has(row.geoid)).length;
    }
    return this.deps.store.retireJurisdictionsExcept({
      sourceId: source.id,
      state: source.config.state,
      geoids,
      types,
      now: this.clock.now(),
    });
  }

  private async queuePageChange(runId: string, record: NormalisedRecord): Promise<number> {
    const existing = await this.deps.store.findCivic(record.matchKey);
    let count = 0;
    for (const [field, value] of Object.entries(record.fields)) {
      if (!isPendingField(field)) continue;
      const previous = existing?.fields[field] ?? null;
      if (previous === value) continue;
      await this.deps.store.addPending({
        sourceRunId: runId,
        entityType: record.entityType,
        entityId: existing?.entityId ?? record.entityId ?? null,
        field,
        oldValue: previous,
        newValue: value ?? '',
        now: this.clock.now(),
      });
      count += 1;
    }
    return count;
  }

  private async finish(
    runId: string,
    patch: { sha: string; added: number; changed: number; retired: number; pending: number },
  ): Promise<void> {
    await this.deps.store.finishRun(
      runId,
      { status: 'SUCCEEDED', sha: patch.sha, added: patch.added, changed: patch.changed, retired: patch.retired, pending: patch.pending, error: null },
      this.clock.now(),
    );
  }

  private async fail(runId: string, error: string): Promise<void> {
    await this.deps.store.finishRun(runId, { status: 'FAILED', added: 0, changed: 0, pending: 0, error }, this.clock.now());
  }
}

export function newRunId(): string {
  return randomUUID();
}

function applyScope(
  source: SourceRow,
  scope: { state?: string | undefined; county?: string | undefined; tigerYear?: number | undefined },
): SourceRow {
  const config = { ...source.config };
  if (scope.state) config.state = scope.state.toUpperCase();
  if (scope.county) config.county = scope.county;
  if (scope.tigerYear) config.tigerYear = scope.tigerYear;
  return { ...source, config };
}

function withNotice(counts: RunCounts, snapshot: RawSnapshot): RunCounts {
  if (!snapshot.notice) return counts;
  return { ...counts, note: snapshot.notice };
}

function countPending(existing: Record<string, string | null> | undefined, record: NormalisedRecord): number {
  let count = 0;
  for (const [field, value] of Object.entries(record.fields)) {
    if (!isPendingField(field)) continue;
    if ((existing?.[field] ?? null) !== value) count += 1;
  }
  return count;
}

function withoutGeometry(fields: Record<string, string | null>): Record<string, string | null> {
  if (!('geometry' in fields)) return fields;
  const copy = { ...fields };
  delete copy.geometry;
  return copy;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw fromZod(result.error);
}

export function capFor(source: SourceRow): number {
  return source.method === 'PAGE_COLLECTION' ? PAGE_CAP : BULK_CAP;
}
