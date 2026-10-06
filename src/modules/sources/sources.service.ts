import type { ServiceContext } from '../../graphql/context.js';
import type { ActorType } from '../../generated/prisma/enums.js';
import { directTx, type RunTx } from '../../auth/tx.js';
import { systemClock, type Clock } from '../../lib/clock.js';
import {
  AlreadyDecidedError,
  ConflictError,
  fromZod,
  NotFoundError,
  PreconditionError,
  RunInProgressError,
  SourceInactiveError,
  UnknownCollectorError,
  ValidationError,
} from '../../lib/errors.js';
import { buildConnection, clampFirst, decodeCursor, type Connection } from '../../lib/pagination.js';
import { z } from 'zod';
import type { JobQueue } from '../notifications/notifications.service.js';
import { isKnownCollector } from '../pipeline/collectors.js';
import type { PipelineStore } from '../pipeline/pipeline.ports.js';
import type { PendingRow, RunRow, SourceRow } from '../pipeline/records.js';
import type { Selector } from '../pipeline/types.js';
import type { DashboardCounts, DashboardService } from './dashboard.js';

const https = z.url().refine((value) => value.startsWith('https://'), 'Use an https URL.');

const upsertSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(2).max(150),
    publisher: z.string().trim().min(2).max(150),
    url: https,
    termsUrl: https,
    method: z.enum(['API', 'BULK', 'PAGE_COLLECTION', 'MANUAL']),
    schedule: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ON_DEMAND']),
    freshnessDays: z.number().int().min(1).max(3650),
    levels: z.array(z.enum(['FEDERAL', 'STATE', 'COUNTY', 'MUNICIPAL', 'EDUCATION', 'SPECIAL'])).max(6),
    collectorKey: z.string().trim().min(1).max(80).optional(),
    active: z.boolean(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const idSchema = z.object({ sourceId: z.uuid() }).strict();
const decideSchema = z
  .object({
    id: z.uuid(),
    decision: z.enum(['ACCEPTED', 'REJECTED']),
  })
  .strict();

const listSchema = z
  .object({
    first: z.number().int().min(1).max(100).optional(),
    after: z.string().min(1).max(500).optional(),
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

export interface SourcesDeps {
  store: PipelineStore;
  audit: AuditWriter;
  enqueue: JobQueue;
  dashboard: DashboardService;
  clock?: Clock;
  withTx?: RunTx;
  knownCollector?: (key: string) => boolean;
}

export class SourcesService {
  private readonly clock: Clock;
  private readonly withTx: RunTx;
  private readonly known: (key: string) => boolean;

  constructor(private readonly deps: SourcesDeps) {
    this.clock = deps.clock ?? systemClock;
    this.withTx = deps.withTx ?? directTx;
    this.known = deps.knownCollector ?? isKnownCollector;
  }

  async adminSources(ctx: ServiceContext, input: unknown): Promise<Connection<SourceRow> & { totalCount: number }> {
    ctx.authz.require('admin.civic:read');
    const parsed = parse(listSchema, input ?? {});
    const first = clampFirst(parsed.first, 100, 20);
    const decoded = parsed.after ? decodeCursor(parsed.after) : undefined;
    if (parsed.after && !decoded) {
      throw new ValidationError('Invalid cursor.', [{ path: 'after', code: 'custom', message: 'Invalid cursor.' }]);
    }
    const page = await this.deps.store.listSources({
      limit: first + 1,
      ...(decoded ? { after: decoded } : {}),
    });
    return { ...buildConnection(page.rows, first, page.total), totalCount: page.total };
  }

  async adminSource(ctx: ServiceContext, input: unknown): Promise<{ source: SourceRow; runs: RunRow[] }> {
    ctx.authz.require('admin.civic:read');
    const parsed = parse(idSchema, input);
    const source = await this.deps.store.findSource(parsed.sourceId);
    if (!source) throw new NotFoundError();
    const runs = await this.deps.store.listRuns(source.id, 20);
    return { source, runs };
  }

  async upsertSource(ctx: ServiceContext, input: unknown): Promise<{ source: SourceRow }> {
    ctx.authz.require('admin.source:write');
    const admin = ctx.authz.requireAdmin();
    const parsed = parse(upsertSchema, input);
    if (parsed.collectorKey && !this.known(parsed.collectorKey)) throw new UnknownCollectorError();
    if (await this.deps.store.nameTaken(parsed.name, parsed.id)) throw new ConflictError();
    const source = await this.withTx(async (tx) => {
      const saved = await this.deps.store.saveSource(
        {
          ...(parsed.id ? { id: parsed.id } : {}),
          name: parsed.name,
          publisher: parsed.publisher,
          url: parsed.url,
          termsUrl: parsed.termsUrl,
          method: parsed.method,
          schedule: parsed.schedule,
          freshnessDays: parsed.freshnessDays,
          levels: parsed.levels,
          collectorKey: parsed.collectorKey ?? null,
          active: parsed.active,
          config: configOf(parsed.config),
        },
        this.clock.now(),
      );
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: admin.adminId,
        entityType: 'source',
        entityId: saved.id,
        action: 'source.upsert',
        before: null,
        after: { name: saved.name, collectorKey: saved.collectorKey, active: saved.active },
        requestId: ctx.requestId,
      });
      return saved;
    });
    return { source };
  }

  async triggerSourceRefresh(ctx: ServiceContext, input: unknown): Promise<{ run: RunRow }> {
    ctx.authz.require('admin.source:run');
    const admin = ctx.authz.requireAdmin();
    const parsed = parse(idSchema, input);
    const source = await this.deps.store.findSource(parsed.sourceId);
    if (!source) throw new NotFoundError();
    if (!source.active) throw new SourceInactiveError();
    if (await this.deps.store.activeRun(source.id)) throw new RunInProgressError();
    const run = await this.withTx(async (tx) => {
      const created = await this.deps.store.createRun(source.id, admin.adminId, this.clock.now());
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: admin.adminId,
        entityType: 'source',
        entityId: source.id,
        action: 'source.refresh',
        before: null,
        after: { runId: created.id },
        requestId: ctx.requestId,
      });
      return created;
    });
    await this.deps.enqueue.enqueue('source.run', { sourceId: source.id, runId: run.id }, { singletonKey: source.id });
    return { run };
  }

  async pendingSourceChanges(ctx: ServiceContext, input: unknown): Promise<PendingRow[]> {
    ctx.authz.require('admin.civic:read');
    const parsed = z
      .object({
        sourceId: z.uuid().optional(),
        decision: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional(),
        first: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .safeParse(input ?? {});
    if (!parsed.success) throw fromZod(parsed.error);
    return this.deps.store.listPending({
      ...(parsed.data.sourceId ? { sourceId: parsed.data.sourceId } : {}),
      ...(parsed.data.decision ? { decision: parsed.data.decision } : {}),
      limit: parsed.data.first ?? 20,
    });
  }

  async decideSourceChange(ctx: ServiceContext, input: unknown): Promise<{ change: PendingRow }> {
    ctx.authz.require('admin.source:decide');
    const admin = ctx.authz.requireAdmin();
    const parsed = parse(decideSchema, input);
    const existing = await this.deps.store.findPending(parsed.id);
    if (!existing) throw new NotFoundError();
    if (existing.decision !== 'PENDING') throw new AlreadyDecidedError();
    const change = await this.withTx(async (tx) => {
      if (parsed.decision === 'ACCEPTED') {
        if (!existing.entityId) throw new PreconditionError('This change has no record to update.');
        await this.deps.store.applyField(existing.entityType, existing.entityId, existing.field, existing.newValue);
      }
      const ok = await this.deps.store.decidePending(parsed.id, parsed.decision, admin.adminId, this.clock.now());
      if (!ok) throw new AlreadyDecidedError();
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: admin.adminId,
        entityType: 'pending_source_change',
        entityId: existing.id,
        action: parsed.decision === 'ACCEPTED' ? 'source.accept' : 'source.reject',
        before: { decision: 'PENDING', value: existing.oldValue },
        after: { decision: parsed.decision, value: existing.newValue },
        requestId: ctx.requestId,
      });
      return { ...existing, decision: parsed.decision };
    });
    return { change };
  }

  async adminDashboardCounts(ctx: ServiceContext): Promise<DashboardCounts> {
    ctx.authz.require('admin.dashboard:read');
    return this.deps.dashboard.counts();
  }
}

function configOf(value: Record<string, unknown> | undefined): SourceRow['config'] {
  if (!value) return {};
  const config: SourceRow['config'] = {};
  if (Array.isArray(value.urls)) config.urls = value.urls.filter((item): item is string => typeof item === 'string');
  if (Array.isArray(value.states)) config.states = value.states.filter((item): item is string => typeof item === 'string');
  if (Array.isArray(value.layers)) config.layers = value.layers.filter((item): item is string => typeof item === 'string');
  if (Array.isArray(value.allowedHosts)) {
    config.allowedHosts = value.allowedHosts.filter((item): item is string => typeof item === 'string');
  }
  const item = selectorOf(value.item);
  if (item) config.item = item;
  if (value.fields && typeof value.fields === 'object' && !Array.isArray(value.fields)) {
    const fields: Record<string, Selector> = {};
    for (const [key, field] of Object.entries(value.fields)) {
      const selector = selectorOf(field);
      if (selector) fields[key] = selector;
    }
    if (Object.keys(fields).length > 0) config.fields = fields;
  }
  return config;
}

function selectorOf(value: unknown): Selector | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.tag !== 'string' || record.tag.length === 0) return undefined;
  const selector: Selector = { tag: record.tag };
  if (typeof record.className === 'string') selector.className = record.className;
  if (typeof record.attr === 'string') selector.attr = record.attr;
  return selector;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw fromZod(result.error);
}
