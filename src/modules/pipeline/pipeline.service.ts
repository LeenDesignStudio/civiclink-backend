import { randomUUID } from 'node:crypto';
import type { ServiceContext } from '../../graphql/context.js';
import type { ActorType } from '../../generated/prisma/enums.js';
import { directTx, type RunTx } from '../../auth/tx.js';
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
import { BULK_CAP, PAGE_CAP, type HttpFetcher, type NormalisedRecord } from './types.js';
import type { SourceRow } from './records.js';

const runSchema = z.object({ sourceId: z.uuid(), runId: z.uuid().optional() }).strict();

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

  async runSource(ctx: ServiceContext, input: unknown): Promise<{ skipped: boolean; added: number; changed: number; pending: number }> {
    ctx.authz.require('system.pipeline:run');
    const parsed = parse(runSchema, input);
    const source = await this.deps.store.findSource(parsed.sourceId);
    if (!source) throw new NotFoundError();
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
    const cap = source.method === 'PAGE_COLLECTION' || collector.key === 'page.directory' ? this.caps.page : this.caps.bulk;
    let bodyLength = 0;
    try {
      const snapshot = await collector.fetch({ source, fetch: this.deps.fetch, maxBytes: cap });
      bodyLength = snapshot.body.byteLength;
      if (bodyLength > cap) {
        await this.fail(run.id, 'Download exceeded the size cap.');
        throw new ValidationError('Download exceeded the size cap.');
      }
      const previous = await this.deps.store.lastSucceededSha(source.id);
      if (previous && previous === snapshot.sha256 && snapshot.skipped !== 'robots') {
        await this.deps.store.finishRun(
          run.id,
          { status: 'SUCCEEDED', sha: snapshot.sha256, added: 0, changed: 0, pending: 0, error: null },
          this.clock.now(),
        );
        return { skipped: true, added: 0, changed: 0, pending: 0 };
      }
      if (snapshot.skipped === 'robots') {
        await this.deps.store.finishRun(
          run.id,
          { status: 'SUCCEEDED', sha: snapshot.sha256, added: 0, changed: 0, pending: 0, error: null },
          this.clock.now(),
        );
        return { skipped: true, added: 0, changed: 0, pending: 0 };
      }
      const records = collector.normalise(snapshot);
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
            before: before ? { ...before.fields } : null,
            after: after ? { ...after.fields } : { ...record.fields },
            requestId: ctx.requestId,
          });
        });
      }
      await this.deps.store.finishRun(
        run.id,
        { status: 'SUCCEEDED', sha: snapshot.sha256, added, changed, pending, error: null },
        this.clock.now(),
      );
      await this.deps.store.touchSource(source.id, this.clock.now());
      return { skipped: false, added, changed, pending };
    } catch (err) {
      if (!(err instanceof ValidationError)) await this.fail(run.id, 'Source run failed.');
      if (isAppError(err)) throw err;
      throw new UpstreamError(undefined, { cause: err });
    }
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
      const response = await this.deps.fetch.get(row.url, { maxBytes: 4096, timeoutMs: 8_000, headers: { 'user-agent': 'CivicLinkBot/1.0' } });
      const isBroken = response.status >= 400;
      await this.deps.store.setLinkBroken(row.id, isBroken, this.clock.now());
      if (isBroken) broken += 1;
    }
    return { checked: rows.length, broken };
  }

  private async queuePageChange(runId: string, record: NormalisedRecord): Promise<number> {
    const existing = await this.deps.store.findCivic(record.matchKey);
    let count = 0;
    for (const [field, value] of Object.entries(record.fields)) {
      const previous = existing?.fields[field] ?? null;
      if (previous === value) continue;
      await this.deps.store.addPending({
        sourceRunId: runId,
        entityType: record.entityType,
        entityId: existing?.entityId ?? null,
        field,
        oldValue: previous,
        newValue: value ?? '',
        now: this.clock.now(),
      });
      count += 1;
    }
    return count;
  }

  private async fail(runId: string, error: string): Promise<void> {
    await this.deps.store.finishRun(
      runId,
      { status: 'FAILED', added: 0, changed: 0, pending: 0, error },
      this.clock.now(),
    );
  }
}

export function newRunId(): string {
  return randomUUID();
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw fromZod(result.error);
}

export function capFor(source: SourceRow): number {
  return source.method === 'PAGE_COLLECTION' ? PAGE_CAP : BULK_CAP;
}
