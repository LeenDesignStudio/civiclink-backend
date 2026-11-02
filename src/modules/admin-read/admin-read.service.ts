import { z } from 'zod';
import type { Tx } from '../../auth/tx.js';
import type { ServiceContext } from '../../graphql/context.js';
import { systemClock, type Clock } from '../../lib/clock.js';
import { fromZod, ValidationError } from '../../lib/errors.js';
import { buildConnection, clampFirst, decodeCursor, type Connection } from '../../lib/pagination.js';
import type { ChangeLogEntry } from '../audit/audit.dto.js';
import type { ActivityEvent } from './activity.js';
import {
  ageDays,
  alertReason,
  coverageSummary,
  fullyCovered,
  pendingReason,
  pilotFreshness,
  recentActionLabel,
  recentTypeLabel,
  searchPattern,
} from './admin-read.rules.js';
import type { ActivityRow, AdminReadStore, AttentionCandidate, DashboardRaw, SearchGroup } from './admin-read.store.js';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const searchSchema = z.object({ q: z.string().trim().min(2, 'Enter at least 2 characters.').max(100) }).strict();

const listSchema = z
  .object({
    first: z.number().int().min(1).max(100).nullish(),
    after: z.string().min(1).max(500).nullish(),
  })
  .strict();

const markSchema = z
  .object({
    ids: z.array(z.uuid()).max(100).optional(),
    all: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.all === true || (value.ids?.length ?? 0) > 0, {
    message: 'Choose the items or mark all as read.',
  });

export interface AttentionItem {
  kind: AttentionCandidate['kind'];
  id: string;
  entityType: string;
  label: string;
  reason: string;
  ageDays: number;
}

export interface RecentEdit {
  id: string;
  entityType: string;
  entityId: string;
  label: string;
  typeLabel: string;
  actionLabel: string;
  actorName: string | null;
  createdAt: Date;
}

export interface PilotCoverageRow {
  id: string;
  name: string;
  displayId: string;
  boundary: 'OK' | 'MISSING';
  officeCount: number;
  freshness: 'CURRENT' | 'MAY_BE_OUTDATED';
}

export interface DashboardView {
  pendingCorrections: number;
  oldestPendingDays: number | null;
  outdatedRecords: number;
  sourceIssues: number;
  alertsNeedingAttention: number;
  officials: number;
  offices: number;
  jurisdictions: number;
  services: number;
  needsAttention: AttentionItem[];
  recentlyEdited: RecentEdit[];
  pilotCoverage: {
    summary: string;
    covered: number;
    total: number;
    rows: PilotCoverageRow[];
  };
}

export type SearchView = Record<
  'offices' | 'officials' | 'jurisdictions' | 'services' | 'sources' | 'corrections',
  SearchGroup
>;

export interface AdminReadDeps {
  store: AdminReadStore;
  audit: { record(tx: Tx, entry: ChangeLogEntry): Promise<void> };
  runTx: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  clock?: Clock;
}

export class AdminReadService {
  private readonly clock: Clock;

  constructor(private readonly deps: AdminReadDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  async record(event: ActivityEvent): Promise<void> {
    await this.deps.store.record(event);
  }

  async dashboard(ctx: ServiceContext): Promise<DashboardView> {
    ctx.authz.require('admin.dashboard:read');
    const now = this.clock.now();
    const raw = await this.deps.store.dashboard(now);
    return shapeDashboard(raw, now);
  }

  async search(ctx: ServiceContext, input: unknown): Promise<SearchView> {
    ctx.authz.require('admin.dashboard:read');
    const parsed = searchSchema.safeParse(input);
    if (!parsed.success) throw fromZod(parsed.error);
    return this.deps.store.search(searchPattern(parsed.data.q));
  }

  async activity(ctx: ServiceContext, input: unknown): Promise<Connection<ActivityRow> & { totalCount: number }> {
    ctx.authz.require('admin.dashboard:read');
    const admin = ctx.authz.requireAdmin();
    const parsed = listSchema.safeParse(input ?? {});
    if (!parsed.success) throw fromZod(parsed.error);
    const first = clampFirst(parsed.data.first);
    let cursor: { createdAt: Date; id: string } | undefined;
    if (parsed.data.after) {
      const decoded = decodeCursor(parsed.data.after);
      if (!decoded) throw new ValidationError('That page cursor is not valid.');
      cursor = decoded;
    }
    const page = await this.deps.store.listActivity({
      adminId: admin.adminId,
      includeSuperAdmin: admin.role === 'SUPER_ADMIN',
      limit: first + 1,
      ...(cursor ? { cursor } : {}),
      now: this.clock.now(),
    });
    const connection = buildConnection(page.rows, first, page.total);
    return { ...connection, totalCount: page.total };
  }

  async unreadCount(ctx: ServiceContext): Promise<number> {
    ctx.authz.require('admin.dashboard:read');
    const admin = ctx.authz.requireAdmin();
    return this.deps.store.unreadCount(admin.adminId, admin.role === 'SUPER_ADMIN', this.clock.now());
  }

  async markRead(ctx: ServiceContext, input: unknown): Promise<{ updated: number }> {
    ctx.authz.require('admin.dashboard:read');
    const admin = ctx.authz.requireAdmin();
    const parsed = markSchema.safeParse(input);
    if (!parsed.success) throw fromZod(parsed.error);
    const ids = parsed.data.all === true ? 'all' : (parsed.data.ids ?? []);
    const updated = await this.deps.runTx(async (tx) => {
      const count = await this.deps.store.markRead(admin.adminId, admin.role === 'SUPER_ADMIN', ids, this.clock.now());
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: admin.adminId,
        entityType: 'admin_activity',
        entityId: admin.adminId,
        action: 'admin.activity_read',
        before: null,
        after: { all: ids === 'all', updated: count },
        requestId: ctx.requestId,
      });
      return count;
    });
    return { updated };
  }

  async purge(ctx: ServiceContext): Promise<{ deleted: number }> {
    ctx.authz.require('system.retention:run');
    const cutoff = new Date(this.clock.now().getTime() - RETENTION_MS);
    const deleted = await this.deps.store.deleteOlderThan(cutoff);
    return { deleted };
  }
}

export function shapeDashboard(raw: DashboardRaw, now: Date): DashboardView {
  const rows = raw.pilots.map((row) => {
    const boundary = row.hasBoundary ? 'OK' : 'MISSING';
    return {
      id: row.id,
      name: row.name,
      displayId: row.displayId,
      boundary,
      officeCount: row.officeCount,
      freshness: pilotFreshness({
        lastUpdatedAt: row.lastUpdatedAt,
        outdatedAfterDays: row.outdatedAfterDays,
        now,
        override: row.override,
      }),
      covered: fullyCovered(row.hasBoundary, row.officeCount),
    } as const;
  });
  const covered = rows.filter((row) => row.covered).length;
  const needsAttention = [...raw.attention]
    .sort((left, right) => left.since.getTime() - right.since.getTime() || left.id.localeCompare(right.id))
    .slice(0, 5)
    .map((row) => toAttention(row, now));
  const recentlyEdited = raw.recent.flatMap((row) => {
    const actionLabel = recentActionLabel(row.action);
    if (!actionLabel) return [];
    return [
      {
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        label: row.label,
        typeLabel: recentTypeLabel(row.recordType),
        actionLabel,
        actorName: row.actorName,
        createdAt: row.createdAt,
      },
    ];
  });
  return {
    pendingCorrections: raw.pendingCorrections,
    oldestPendingDays: raw.oldestPendingAt ? ageDays(raw.oldestPendingAt, now) : null,
    outdatedRecords: raw.outdatedRecords,
    sourceIssues: raw.sourceIssues,
    alertsNeedingAttention: raw.alertsNeedingAttention,
    officials: raw.officials,
    offices: raw.offices,
    jurisdictions: raw.jurisdictions,
    services: raw.services,
    needsAttention,
    recentlyEdited,
    pilotCoverage: {
      summary: coverageSummary(covered, rows.length),
      covered,
      total: rows.length,
      rows: rows.map(({ covered: _covered, ...row }) => row),
    },
  };
}

function toAttention(row: AttentionCandidate, now: Date): AttentionItem {
  const days = ageDays(row.since, now);
  let reason = 'May be outdated';
  if (row.kind === 'CORRECTION' && row.correctionStatus) reason = pendingReason(row.correctionStatus, days);
  else if (row.kind === 'SOURCE') reason = row.sourceIssue === 'OVERDUE' ? 'Overdue' : 'Refresh failed';
  else if (row.kind === 'ALERT') reason = alertReason(row.failedDeliveries ?? 0);
  return {
    kind: row.kind,
    id: row.id,
    entityType: row.entityType ?? row.kind,
    label: row.label,
    reason,
    ageDays: days,
  };
}
