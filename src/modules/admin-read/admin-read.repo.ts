import { Prisma } from '../../generated/prisma/client.js';
import { dbCall, type Db } from '../../db/prisma.js';
import type { ActivityEvent } from './activity.js';
import type {
  ActivityRow,
  AdminReadStore,
  AttentionCandidate,
  DashboardRaw,
  PilotRow,
  RecentEditRow,
  SearchGroup,
  SearchHit,
} from './admin-read.store.js';

type SearchKey = 'offices' | 'officials' | 'jurisdictions' | 'services' | 'sources' | 'corrections';
type LabelColumn = 'name' | 'full_name' | 'title' | 'display_id';

const OUTDATED = Prisma.sql`(o.freshness_override = 'FORCE_OUTDATED' OR (o.freshness_override = 'NONE' AND o.last_updated_at < CURRENT_TIMESTAMP - (s.freshness_days * INTERVAL '1 day')))`;
const ATTENTION_SINCE = Prisma.sql`CASE WHEN o.freshness_override = 'FORCE_OUTDATED' THEN COALESCE(o.overridden_at, o.last_updated_at) ELSE o.last_updated_at + (s.freshness_days * INTERVAL '1 day') END`;

const LATEST_FAILED = Prisma.sql`EXISTS (
  SELECT 1 FROM source_runs r
  WHERE r.source_id = s.id
    AND r.status = 'FAILED'
    AND r.created_at = (SELECT max(r2.created_at) FROM source_runs r2 WHERE r2.source_id = s.id)
)`;

interface HitRow {
  id: string;
  label: string;
  display_id: string | null;
  total: bigint | number;
}

export class AdminReadRepo implements AdminReadStore {
  constructor(private readonly db: Db) {}

  async dashboard(now: Date): Promise<DashboardRaw> {
    const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [pendingCorrections, oldest, outdatedRecords, sourceIssues, alertsNeedingAttention, officials, offices, jurisdictions, services, attention, recent, pilots] =
      await Promise.all([
        dbCall(() => this.db.correction.count({ where: { status: { in: ['SUBMITTED', 'IN_REVIEW'] } } })),
        dbCall(() =>
          this.db.correction.findFirst({
            where: { status: { in: ['SUBMITTED', 'IN_REVIEW'] } },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          }),
        ),
        this.outdatedCount(),
        this.sourceIssueCount(now),
        dbCall(() =>
          this.db.alert.count({
            where: { status: { in: ['FAILED', 'PARTLY_FAILED'] }, sentAt: { gte: week } },
          }),
        ),
        dbCall(() => this.db.official.count({ where: { status: 'ACTIVE' } })),
        dbCall(() => this.db.office.count({ where: { status: 'ACTIVE' } })),
        dbCall(() => this.db.jurisdiction.count({ where: { status: 'ACTIVE' } })),
        dbCall(() => this.db.service.count({ where: { status: 'ACTIVE' } })),
        this.attention(now),
        this.recentEdits(),
        this.pilots(),
      ]);
    return {
      pendingCorrections,
      oldestPendingAt: oldest?.createdAt ?? null,
      outdatedRecords,
      sourceIssues,
      alertsNeedingAttention,
      officials,
      offices,
      jurisdictions,
      services,
      attention,
      recent,
      pilots,
    };
  }

  async search(pattern: string): Promise<Record<SearchKey, SearchGroup>> {
    const [offices, officials, jurisdictions, services, sources, corrections] = await Promise.all([
      this.hits('offices', 'name', pattern),
      this.hits('officials', 'full_name', pattern),
      this.hits('jurisdictions', 'name', pattern),
      this.hits('services', 'title', pattern),
      this.hits('sources', 'name', pattern),
      this.hits('corrections', 'display_id', pattern),
    ]);
    return { offices, officials, jurisdictions, services, sources, corrections };
  }

  async record(event: ActivityEvent): Promise<void> {
    await dbCall(() =>
      this.db.adminActivity.create({
        data: {
          kind: event.kind,
          audience: event.audience,
          title: event.title.slice(0, 120),
          preview: event.preview.slice(0, 200),
          entityType: event.entityType.slice(0, 40),
          entityId: event.entityId,
        },
        select: { id: true },
      }),
    );
  }

  async listActivity(input: {
    adminId: string;
    includeSuperAdmin: boolean;
    limit: number;
    cursor?: { createdAt: Date; id: string };
    now: Date;
  }): Promise<{ rows: ActivityRow[]; total: number }> {
    const cutoff = new Date(input.now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const audience = input.includeSuperAdmin ? (['ALL', 'SUPER_ADMIN'] as const) : (['ALL'] as const);
    const cursor = input.cursor
      ? {
          OR: [
            { createdAt: { lt: input.cursor.createdAt } },
            { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
          ],
        }
      : {};
    const where = { createdAt: { gte: cutoff }, audience: { in: [...audience] }, ...cursor };
    const [rows, total] = await dbCall(() =>
      Promise.all([
        this.db.adminActivity.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: input.limit,
          include: { reads: { where: { adminId: input.adminId }, select: { adminId: true } } },
        }),
        this.db.adminActivity.count({ where: { createdAt: { gte: cutoff }, audience: { in: [...audience] } } }),
      ]),
    );
    return {
      total,
      rows: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        audience: row.audience,
        title: row.title,
        preview: row.preview,
        entityType: row.entityType,
        entityId: row.entityId,
        createdAt: row.createdAt,
        unread: row.reads.length === 0,
      })),
    };
  }

  async unreadCount(adminId: string, includeSuperAdmin: boolean, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const audience = includeSuperAdmin ? (['ALL', 'SUPER_ADMIN'] as const) : (['ALL'] as const);
    return dbCall(() =>
      this.db.adminActivity.count({
        where: {
          createdAt: { gte: cutoff },
          audience: { in: [...audience] },
          reads: { none: { adminId } },
        },
      }),
    );
  }

  async markRead(adminId: string, includeSuperAdmin: boolean, ids: string[] | 'all', now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const audience = includeSuperAdmin ? (['ALL', 'SUPER_ADMIN'] as const) : (['ALL'] as const);
    const visible = await dbCall(() =>
      this.db.adminActivity.findMany({
        where: {
          createdAt: { gte: cutoff },
          audience: { in: [...audience] },
          ...(ids === 'all' ? {} : { id: { in: ids } }),
          reads: { none: { adminId } },
        },
        select: { id: true },
      }),
    );
    if (visible.length === 0) return 0;
    const result = await dbCall(() =>
      this.db.adminActivityRead.createMany({
        data: visible.map((row) => ({ activityId: row.id, adminId, readAt: now })),
        skipDuplicates: true,
      }),
    );
    return result.count;
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await dbCall(() => this.db.adminActivity.deleteMany({ where: { createdAt: { lt: cutoff } } }));
    return result.count;
  }

  private async hits(table: SearchKey, label: LabelColumn, pattern: string): Promise<SearchGroup> {
    const relation = quoted(table);
    const column = quoted(label);
    const rows = await dbCall(() =>
      this.db.$queryRaw<HitRow[]>(Prisma.sql`
        SELECT id::text AS id, ${column} AS label, display_id, count(*) OVER() AS total
        FROM ${relation}
        WHERE ${column} ILIKE ${pattern} ESCAPE '\\'
           OR display_id ILIKE ${pattern} ESCAPE '\\'
        ORDER BY ${column} ASC, id ASC
        LIMIT 5
      `),
    );
    const items: SearchHit[] = rows.map((row) => ({
      id: row.id,
      label: row.label,
      displayId: row.display_id,
    }));
    const first = rows[0];
    return { total: first ? Number(first.total) : 0, items };
  }

  private async outdatedCount(): Promise<number> {
    const rows = await dbCall(() =>
      this.db.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
        SELECT (
          (SELECT count(*) FROM offices o JOIN sources s ON s.id = o.source_id WHERE o.status = 'ACTIVE' AND ${OUTDATED})
          + (SELECT count(*) FROM officials o JOIN sources s ON s.id = o.source_id WHERE o.status = 'ACTIVE' AND ${OUTDATED})
          + (SELECT count(*) FROM jurisdictions o JOIN sources s ON s.id = o.source_id WHERE o.status = 'ACTIVE' AND ${OUTDATED})
        )::int AS count
      `),
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async sourceIssueCount(now: Date): Promise<number> {
    const rows = await dbCall(() =>
      this.db.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
        SELECT count(*)::int AS count
        FROM sources s
        WHERE s.record_status = 'ACTIVE'
          AND (
            ${LATEST_FAILED}
            OR (
              NOT ${LATEST_FAILED}
              AND (s.last_success_at IS NULL OR s.last_success_at < ${now}::timestamptz - (s.freshness_days * INTERVAL '1 day'))
            )
          )
      `),
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async attention(now: Date): Promise<AttentionCandidate[]> {
    const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [corrections, records, sources, alerts] = await Promise.all([
      dbCall(() =>
        this.db.$queryRaw<Array<{ id: string; label: string; status: 'SUBMITTED' | 'IN_REVIEW'; since: Date }>>`
          SELECT id::text AS id, display_id AS label, status::text AS status, created_at AS since
          FROM corrections
          WHERE status IN ('SUBMITTED', 'IN_REVIEW')
          ORDER BY created_at ASC, id ASC
          LIMIT 5
        `,
      ),
      dbCall(() =>
        this.db.$queryRaw<Array<{ id: string; entity_type: string; label: string; since: Date }>>(Prisma.sql`
          SELECT id, entity_type, label, since FROM (
            SELECT o.id::text AS id, 'OFFICE' AS entity_type, o.name AS label, ${ATTENTION_SINCE} AS since
            FROM offices o JOIN sources s ON s.id = o.source_id
            WHERE o.status = 'ACTIVE' AND ${OUTDATED}
            UNION ALL
            SELECT o.id::text, 'OFFICIAL', o.full_name, ${ATTENTION_SINCE}
            FROM officials o JOIN sources s ON s.id = o.source_id
            WHERE o.status = 'ACTIVE' AND ${OUTDATED}
            UNION ALL
            SELECT o.id::text, 'JURISDICTION', o.name, ${ATTENTION_SINCE}
            FROM jurisdictions o JOIN sources s ON s.id = o.source_id
            WHERE o.status = 'ACTIVE' AND ${OUTDATED}
          ) records
          ORDER BY since ASC, id ASC
          LIMIT 5
        `),
      ),
      dbCall(() =>
        this.db.$queryRaw<Array<{ id: string; label: string; since: Date; issue: 'FAILED' | 'OVERDUE' }>>(Prisma.sql`
          SELECT s.id::text AS id, s.name AS label,
            CASE WHEN ${LATEST_FAILED} THEN 'FAILED' ELSE 'OVERDUE' END AS issue,
            CASE
              WHEN ${LATEST_FAILED} THEN COALESCE(s.last_attempt_at, s.updated_at)
              WHEN s.last_success_at IS NULL THEN s.created_at
              ELSE s.last_success_at + (s.freshness_days * INTERVAL '1 day')
            END AS since
          FROM sources s
          WHERE s.record_status = 'ACTIVE'
            AND (
              ${LATEST_FAILED}
              OR s.last_success_at IS NULL
              OR s.last_success_at < ${now}::timestamptz - (s.freshness_days * INTERVAL '1 day')
            )
          ORDER BY since ASC, s.id ASC
          LIMIT 5
        `),
      ),
      dbCall(() =>
        this.db.$queryRaw<Array<{ id: string; label: string; since: Date; failed: bigint | number }>>`
          SELECT a.id::text AS id, a.title AS label, a.sent_at AS since,
            (
              SELECT count(*) FROM notification_deliveries d
              JOIN notifications n ON n.id = d.notification_id
              WHERE n.source_ref = 'alert:' || a.id::text AND d.status = 'FAILED'
            ) AS failed
          FROM alerts a
          WHERE a.status IN ('FAILED', 'PARTLY_FAILED') AND a.sent_at >= ${week}::timestamptz
          ORDER BY a.sent_at ASC, a.id ASC
          LIMIT 5
        `,
      ),
    ]);
    return [
      ...corrections.map((row) => ({
        kind: 'CORRECTION' as const,
        id: row.id,
        entityType: 'CORRECTION',
        label: row.label,
        since: row.since,
        correctionStatus: row.status,
      })),
      ...records.map((row) => ({
        kind: 'RECORD' as const,
        id: row.id,
        entityType: row.entity_type,
        label: row.label,
        since: row.since,
      })),
      ...sources.map((row) => ({
        kind: 'SOURCE' as const,
        id: row.id,
        entityType: 'SOURCE',
        label: row.label,
        since: row.since,
        sourceIssue: row.issue,
      })),
      ...alerts.map((row) => ({
        kind: 'ALERT' as const,
        id: row.id,
        entityType: 'ALERT',
        label: row.label,
        since: row.since,
        failedDeliveries: Number(row.failed),
      })),
    ];
  }

  private async recentEdits(): Promise<RecentEditRow[]> {
    const rows = await dbCall(() =>
      this.db.$queryRaw<
        Array<{
          id: string;
          entity_type: string;
          entity_id: string;
          action: string;
          label: string | null;
          record_type: string | null;
          actor_name: string | null;
          created_at: Date;
        }>
      >`
        SELECT c.id::text AS id, c.entity_type, c.entity_id::text AS entity_id, c.action, c.created_at,
          au.name AS actor_name,
          COALESCE(j.name, o.name, p.full_name, sv.title, so.name, cor.display_id, 'Record') AS label,
          COALESCE(cor.entity_type::text, c.entity_type) AS record_type
        FROM change_log c
        LEFT JOIN admin_users au ON c.actor_type = 'ADMIN' AND au.id = c.actor_id
        LEFT JOIN jurisdictions j ON c.entity_type = 'JURISDICTION' AND j.id = c.entity_id
        LEFT JOIN offices o ON c.entity_type = 'OFFICE' AND o.id = c.entity_id
        LEFT JOIN officials p ON c.entity_type = 'OFFICIAL' AND p.id = c.entity_id
        LEFT JOIN services sv ON c.entity_type = 'SERVICE' AND sv.id = c.entity_id
        LEFT JOIN sources so ON c.entity_type IN ('source', 'SOURCE') AND so.id = c.entity_id
        LEFT JOIN corrections cor ON c.entity_type IN ('CORRECTION', 'Correction') AND cor.id = c.entity_id
        WHERE (
          c.entity_type IN ('JURISDICTION', 'OFFICE', 'OFFICIAL', 'SERVICE', 'source', 'SOURCE')
          AND c.action IN ('CREATE', 'UPDATE', 'RETIRE', 'RESTORE', 'source.add', 'source.change', 'source.upsert')
        ) OR (
          c.entity_type IN ('CORRECTION', 'Correction') AND c.action = 'APPLY'
        )
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT 10
      `,
    );
    return rows.map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      label: row.label ?? 'Record',
      recordType: row.record_type ?? row.entity_type,
      actorName: row.actor_name,
      createdAt: row.created_at,
    }));
  }

  private async pilots(): Promise<PilotRow[]> {
    const rows = await dbCall(() =>
      this.db.$queryRaw<
        Array<{
          id: string;
          name: string;
          display_id: string;
          has_boundary: boolean;
          office_count: bigint | number;
          last_updated_at: Date;
          freshness_days: number;
          freshness_override: PilotRow['override'];
        }>
      >`
        SELECT j.id::text AS id, j.name, j.display_id, (j.boundary IS NOT NULL) AS has_boundary,
          (SELECT count(*) FROM offices o WHERE o.jurisdiction_id = j.id AND o.status = 'ACTIVE') AS office_count,
          j.last_updated_at, s.freshness_days, j.freshness_override::text AS freshness_override
        FROM jurisdictions j
        JOIN sources s ON s.id = j.source_id
        WHERE j.is_pilot = true AND j.status = 'ACTIVE'
        ORDER BY j.name ASC, j.id ASC
      `,
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      displayId: row.display_id,
      hasBoundary: row.has_boundary,
      officeCount: Number(row.office_count),
      lastUpdatedAt: row.last_updated_at,
      outdatedAfterDays: row.freshness_days,
      override: row.freshness_override,
    }));
  }
}

const QUOTED: Record<SearchKey | LabelColumn, Prisma.Sql> = {
  offices: Prisma.raw('"offices"'),
  officials: Prisma.raw('"officials"'),
  jurisdictions: Prisma.raw('"jurisdictions"'),
  services: Prisma.raw('"services"'),
  sources: Prisma.raw('"sources"'),
  corrections: Prisma.raw('"corrections"'),
  name: Prisma.raw('"name"'),
  full_name: Prisma.raw('"full_name"'),
  title: Prisma.raw('"title"'),
  display_id: Prisma.raw('"display_id"'),
};

function quoted(name: SearchKey | LabelColumn): Prisma.Sql {
  return QUOTED[name];
}
