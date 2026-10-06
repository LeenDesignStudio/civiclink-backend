import type { ServiceContext } from '../../graphql/context.js';
import type { Clock } from '../../lib/clock.js';
import {
  CorrectionDailyLimitError,
  DuplicateCorrectionError,
  NotFoundError,
  PreconditionError,
  ValidationError,
} from '../../lib/errors.js';
import { buildConnection, clampFirst, decodeCursor, type Connection } from '../../lib/pagination.js';
import { parseInput } from '../locations/locations.service.js';
import type { AdminCorrection, CorrectionStatus, ResidentCorrection } from './corrections.dto.js';
import {
  addCorrectionNoteSchema,
  adminCorrectionsSchema,
  applyCorrectionSchema,
  assignCorrectionSchema,
  correctionIdSchema,
  dismissCorrectionSchema,
  myCorrectionsSchema,
  submitCorrectionSchema,
} from './corrections.inputs.js';
import {
  toAdmin,
  toResident,
  type AuditRecorder,
  type CorrectionQueue,
  type CorrectionsRepo,
  type StoredCorrection,
  type TxRunner,
} from './corrections.ports.js';
import { httpUrl, normalizeProposed } from './corrections.values.js';

const DAILY_LIMIT = 10;

export interface CorrectionsDeps {
  repo: CorrectionsRepo;
  audit: AuditRecorder;
  withTx: TxRunner;
  clock: Clock;
  queue?: CorrectionQueue;
}

export class CorrectionsService {
  constructor(private readonly deps: CorrectionsDeps) {}

  async submitCorrection(ctx: ServiceContext, input: unknown): Promise<{ correction: ResidentCorrection }> {
    ctx.authz.require('self.corrections:create');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parseInput(submitCorrectionSchema, input);
    const entity = await this.deps.repo.findActiveEntity(parsed.entityType, parsed.entityId, parsed.field);
    if (!entity) throw new NotFoundError();
    const proposedValue = normalizeProposed(parsed.entityType, parsed.field, parsed.proposedValue, 'proposedValue');
    const evidenceUrl = parsed.evidenceUrl ? httpUrl(parsed.evidenceUrl, 'evidenceUrl') : null;
    const displayName = await this.deps.repo.submitterDisplayName(userId);
    const now = this.deps.clock.now();
    const stored = await this.deps.withTx(
      async (tx) => {
        const open = await this.deps.repo.findOpen(userId, parsed.entityType, parsed.entityId, parsed.field, tx);
        if (open) throw new DuplicateCorrectionError();
        const since = startOfUtcDay(now);
        const count = await this.deps.repo.countSince(userId, since, tx);
        if (count >= DAILY_LIMIT) throw new CorrectionDailyLimitError(secondsUntilUtcMidnight(now));
        const created = await this.deps.repo.insert(
          {
            userId,
            entityType: parsed.entityType,
            entityId: parsed.entityId,
            field: parsed.field,
            currentValueSnapshot: { value: entity.currentValue },
            proposedValue,
            details: parsed.details ?? null,
            evidenceUrl,
            lookupToken: parsed.lookupToken ?? null,
            submitterDisplayName: displayName,
            level: entity.level,
            createdAt: now,
          },
          tx,
        );
        await this.deps.audit.record(
          {
            actorType: 'RESIDENT',
            actorId: null,
            entityType: 'Correction',
            entityId: created.id,
            action: 'SUBMIT',
            before: null,
            after: {
              entityType: created.entityType,
              entityId: created.entityId,
              field: created.field,
              proposedValue: created.proposedValue,
            },
            requestId: ctx.requestId,
          },
          tx,
        );
        return created;
      },
      { isolation: 'Serializable' },
    );
    return { correction: toResident(stored) };
  }

  async myCorrections(ctx: ServiceContext, input: unknown): Promise<Connection<ResidentCorrection>> {
    ctx.authz.require('self.corrections:read');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = parseInput(myCorrectionsSchema, input ?? {});
    const first = clampFirst(parsed.first, 100, 20);
    const after = cursor(parsed.after);
    const rows = await this.deps.repo.listOwned(userId, { limit: first + 1, ...(after ? { after } : {}) });
    const page = buildConnection(rows, first);
    return {
      edges: page.edges.map((edge) => ({ cursor: edge.cursor, node: toResident(edge.node) })),
      pageInfo: page.pageInfo,
    };
  }

  async adminCorrections(ctx: ServiceContext, input: unknown): Promise<Connection<AdminCorrection>> {
    ctx.authz.require('admin.correction:read');
    const admin = ctx.authz.requireAdmin();
    const parsed = parseInput(adminCorrectionsSchema, input ?? {});
    const first = clampFirst(parsed.first, 100, 20);
    const after = cursor(parsed.after);
    const filter = parsed.filter;
    const olderThan =
      filter?.olderThanDays !== undefined
        ? new Date(this.deps.clock.now().getTime() - filter.olderThanDays * 86_400_000)
        : undefined;
    const query = {
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.level ? { level: filter.level } : {}),
      ...(filter?.entityType ? { entityType: filter.entityType } : {}),
      ...(olderThan ? { olderThan } : {}),
      ...(filter?.assignedToMe ? { assigneeId: admin.adminId } : {}),
    };
    const [rows, totalCount] = await Promise.all([
      this.deps.repo.listAdmin({ ...query, limit: first + 1, ...(after ? { after } : {}) }),
      this.deps.repo.countAdmin(query),
    ]);
    const page = buildConnection(rows, first, totalCount);
    return {
      edges: page.edges.map((edge) => ({ cursor: edge.cursor, node: toAdmin(edge.node) })),
      pageInfo: page.pageInfo,
      ...(page.totalCount !== undefined ? { totalCount: page.totalCount } : {}),
    };
  }

  async adminCorrection(ctx: ServiceContext, input: unknown): Promise<AdminCorrection> {
    ctx.authz.require('admin.correction:read');
    ctx.authz.requireAdmin();
    const parsed = parseInput(correctionIdSchema, input);
    const row = await this.deps.repo.findById(parsed.id);
    if (!row) throw new NotFoundError();
    return toAdmin(row);
  }

  async assignCorrection(ctx: ServiceContext, input: unknown): Promise<{ correction: AdminCorrection }> {
    const admin = this.resolver(ctx);
    const parsed = parseInput(assignCorrectionSchema, input);
    const assigneeId = parsed.assigneeId ?? admin.adminId;
    const allowed = await this.deps.repo.assigneeCanResolve(assigneeId);
    if (!allowed) {
      throw new ValidationError('That admin cannot resolve corrections.', [
        { path: 'assigneeId', code: 'custom', message: 'That admin cannot resolve corrections.' },
      ]);
    }
    const correction = await this.transition(ctx, parsed.id, (current, tx) => {
      assertOpen(current.status);
      return this.deps.repo.update(current.id, { assigneeId, updatedAt: this.deps.clock.now() }, tx);
    }, 'ASSIGN');
    return { correction };
  }

  async markCorrectionInReview(ctx: ServiceContext, input: unknown): Promise<{ correction: AdminCorrection }> {
    this.resolver(ctx);
    const parsed = parseInput(correctionIdSchema, input);
    const correction = await this.transition(ctx, parsed.id, (current, tx) => {
      if (current.status !== 'SUBMITTED') throw new PreconditionError();
      return this.deps.repo.update(current.id, { status: 'IN_REVIEW', updatedAt: this.deps.clock.now() }, tx);
    }, 'IN_REVIEW');
    return { correction };
  }

  async applyCorrection(ctx: ServiceContext, input: unknown): Promise<{ correction: AdminCorrection }> {
    const admin = this.resolver(ctx);
    const parsed = parseInput(applyCorrectionSchema, input);
    const sourceUrl = parsed.sourceUrl ? httpUrl(parsed.sourceUrl, 'sourceUrl') : undefined;
    const now = this.deps.clock.now();
    let entityType = '';
    let entityId = '';
    const correction = await this.deps.withTx(
      async (tx) => {
        const current = await this.deps.repo.findById(parsed.id, tx);
        if (!current) throw new NotFoundError();
        assertOpen(current.status);
        const value = normalizeProposed(current.entityType, current.field, parsed.value, 'value');
        const applied = await this.deps.repo.applyTarget(
          {
            entityType: current.entityType,
            entityId: current.entityId,
            field: current.field,
            value,
            lastUpdatedAt: now,
            ...(parsed.sourceId ? { sourceId: parsed.sourceId } : {}),
            ...(sourceUrl ? { sourceUrl } : {}),
          },
          tx,
        );
        const updated = await this.deps.repo.update(
          current.id,
          { status: 'APPLIED', resolvedAt: now, resolvedBy: admin.adminId, updatedAt: now },
          tx,
        );
        if (!updated) throw new NotFoundError();
        await this.deps.audit.record(
          {
            actorType: 'ADMIN',
            actorId: admin.adminId,
            entityType: 'Correction',
            entityId: current.id,
            action: 'APPLY',
            before: { status: current.status },
            after: { status: 'APPLIED' },
            requestId: ctx.requestId,
          },
          tx,
        );
        await this.deps.audit.record(
          {
            actorType: 'ADMIN',
            actorId: admin.adminId,
            entityType: current.entityType,
            entityId: current.entityId,
            action: 'UPDATE',
            before: { value: applied.before },
            after: {
              value,
              lastUpdatedAt: now.toISOString(),
              ...(parsed.sourceId ? { sourceId: parsed.sourceId } : {}),
              ...(sourceUrl ? { sourceUrl } : {}),
            },
            requestId: ctx.requestId,
          },
          tx,
        );
        entityType = current.entityType;
        entityId = current.entityId;
        return updated;
      },
      { isolation: 'Serializable' },
    );
    if (parsed.notifyFollowers && this.deps.queue) {
      await this.deps.queue.enqueue('notify.fanout', { entityType, entityId, kind: 'RECORD_UPDATE' });
    }
    return { correction: toAdmin(correction) };
  }

  async dismissCorrection(ctx: ServiceContext, input: unknown): Promise<{ correction: AdminCorrection }> {
    const admin = this.resolver(ctx);
    const parsed = parseInput(dismissCorrectionSchema, input);
    const now = this.deps.clock.now();
    const correction = await this.transition(ctx, parsed.id, (current, tx) => {
      assertOpen(current.status);
      return this.deps.repo.update(
        current.id,
        {
          status: 'DISMISSED',
          dismissReason: parsed.reason,
          dismissNote: parsed.note ?? null,
          resolvedAt: now,
          resolvedBy: admin.adminId,
          updatedAt: now,
        },
        tx,
      );
    }, 'DISMISS');
    return { correction };
  }

  async addCorrectionNote(ctx: ServiceContext, input: unknown): Promise<{ correction: AdminCorrection }> {
    const admin = this.resolver(ctx);
    const parsed = parseInput(addCorrectionNoteSchema, input);
    const now = this.deps.clock.now();
    const correction = await this.deps.withTx(
      async (tx) => {
        const current = await this.deps.repo.findById(parsed.id, tx);
        if (!current) throw new NotFoundError();
        await this.deps.repo.addNote(current.id, admin.adminId, parsed.body, now, tx);
        const updated = await this.deps.repo.update(current.id, { updatedAt: now }, tx);
        if (!updated) throw new NotFoundError();
        await this.deps.audit.record(
          {
            actorType: 'ADMIN',
            actorId: admin.adminId,
            entityType: 'Correction',
            entityId: current.id,
            action: 'NOTE',
            before: null,
            after: { note: true },
            requestId: ctx.requestId,
          },
          tx,
        );
        return updated;
      },
      { isolation: 'Serializable' },
    );
    return { correction: toAdmin(correction) };
  }

  private resolver(ctx: ServiceContext): { adminId: string } {
    ctx.authz.require('admin.correction:resolve');
    return ctx.authz.requireAdmin();
  }

  private async transition(
    ctx: ServiceContext,
    id: string,
    apply: (current: StoredCorrection, tx: unknown) => Promise<StoredCorrection | null>,
    action: string,
  ): Promise<AdminCorrection> {
    const admin = ctx.authz.requireAdmin();
    const updated = await this.deps.withTx(
      async (tx) => {
        const current = await this.deps.repo.findById(id, tx);
        if (!current) throw new NotFoundError();
        const next = await apply(current, tx);
        if (!next) throw new NotFoundError();
        await this.deps.audit.record(
          {
            actorType: 'ADMIN',
            actorId: admin.adminId,
            entityType: 'Correction',
            entityId: current.id,
            action,
            before: { status: current.status, assigneeId: current.assigneeId },
            after: { status: next.status, assigneeId: next.assigneeId },
            requestId: ctx.requestId,
          },
          tx,
        );
        return next;
      },
      { isolation: 'Serializable' },
    );
    return toAdmin(updated);
  }
}

function assertOpen(status: CorrectionStatus): void {
  if (status !== 'SUBMITTED' && status !== 'IN_REVIEW') throw new PreconditionError();
}

function cursor(after: string | undefined): { createdAt: Date; id: string } | undefined {
  if (!after) return undefined;
  const decoded = decodeCursor(after);
  if (!decoded) {
    throw new ValidationError('Invalid cursor.', [
      { path: 'after', code: 'custom', message: 'Invalid cursor.' },
    ]);
  }
  return decoded;
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function secondsUntilUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}
