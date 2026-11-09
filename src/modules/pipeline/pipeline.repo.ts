import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { GovLevel, JurisdictionType, PhotoStatus, type CivicEntityType } from '../../generated/prisma/enums.js';
import { dbCall, postgresMessage, prisma, type Db } from '../../db/prisma.js';
import { ValidationError } from '../../lib/errors.js';
import { clipPhone, parsePublishedAddress } from './contacts.js';
import type { PilotList, PilotPlace } from './pilot-list.js';
import type { PendingQuery, PipelineStore, SourceListQuery, SourceWrite } from './pipeline.ports.js';
import type { CivicRow, PendingRow, RunRow, SourceRow } from './records.js';
import { sourceConfigFromJson } from './source-config.js';
import { refreshWrite } from '../civic/record-rules.js';
import { electedYearByTerm, firstElectedYear, parseTermHistory } from './term-years.js';
import { sameAttributes, type NormalisedRecord } from './types.js';

const LEVELS = new Set<string>(Object.values(GovLevel));
const TYPES = new Set<string>(Object.values(JurisdictionType));

function toSource(row: {
  id: string;
  name: string;
  publisher: string;
  url: string;
  termsUrl: string;
  method: SourceRow['method'];
  schedule: SourceRow['schedule'];
  freshnessDays: number;
  levels: string[];
  collectorKey: string | null;
  active: boolean;
  lastRunAt: Date | null;
  displayId?: string;
  kind?: SourceRow['kind'];
  notes?: string | null;
  recordStatus?: SourceRow['recordStatus'];
  lastSuccessAt?: Date | null;
  lastAttemptAt?: Date | null;
  createdAt: Date;
  config: Prisma.JsonValue;
}): SourceRow {
  const { kind, displayId, notes, recordStatus, lastSuccessAt, lastAttemptAt, ...rest } = row;
  return {
    ...rest,
    config: sourceConfigFromJson(row.config),
    ...(kind !== undefined ? { kind } : {}),
    ...(displayId !== undefined ? { displayId } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(recordStatus !== undefined ? { recordStatus } : {}),
    ...(lastSuccessAt !== undefined ? { lastSuccessAt } : {}),
    ...(lastAttemptAt !== undefined ? { lastAttemptAt } : {}),
  };
}

function toRun(row: {
  id: string;
  sourceId: string;
  status: RunRow['status'];
  triggeredBy: string | null;
  snapshotSha: string | null;
  added: number;
  changed: number;
  retired: number;
  pending: number;
  error: string | null;
  createdAt: Date;
}): RunRow {
  return row;
}

export class PipelineRepo implements PipelineStore {
  constructor(private readonly db: Db = prisma) {}

  async listSources(query: SourceListQuery): Promise<{ rows: SourceRow[]; total: number }> {
    const where = query.after
      ? {
          OR: [
            { createdAt: { lt: query.after.createdAt } },
            { createdAt: query.after.createdAt, id: { lt: query.after.id } },
          ],
        }
      : {};
    const [rows, total] = await dbCall(() =>
      Promise.all([
        this.db.source.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit }),
        this.db.source.count(),
      ]),
    );
    const counts = await this.recordsUsing(rows.map((row) => row.id));
    return {
      rows: rows.map((row) => ({ ...toSource(row), recordsUsingCount: counts.get(row.id) ?? 0 })),
      total,
    };
  }

  async sourceTiles(now: Date): Promise<{ total: number; healthy: number; overdueOrFailed: number; paused: number }> {
    const rows = await dbCall(() =>
      this.db.$queryRaw<Array<{ total: number; healthy: number; overdue_or_failed: number; paused: number }>>`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE health = 'HEALTHY')::int AS healthy,
          count(*) FILTER (WHERE health IN ('OVERDUE', 'FAILED'))::int AS overdue_or_failed,
          count(*) FILTER (WHERE health = 'PAUSED')::int AS paused
        FROM (
          SELECT CASE
            WHEN s.record_status IN ('PAUSED', 'RETIRED') THEN 'PAUSED'
            WHEN EXISTS (
              SELECT 1 FROM source_runs r
              WHERE r.source_id = s.id
                AND r.status = 'FAILED'
                AND r.created_at = (SELECT max(r2.created_at) FROM source_runs r2 WHERE r2.source_id = s.id)
            ) THEN 'FAILED'
            WHEN s.last_success_at IS NULL
              OR s.last_success_at < ${now} - (s.freshness_days * INTERVAL '1 day') THEN 'OVERDUE'
            ELSE 'HEALTHY'
          END AS health
          FROM sources s
        ) counted
      `,
    );
    const row = rows[0];
    return {
      total: row?.total ?? 0,
      healthy: row?.healthy ?? 0,
      overdueOrFailed: row?.overdue_or_failed ?? 0,
      paused: row?.paused ?? 0,
    };
  }

  async findSource(id: string): Promise<SourceRow | null> {
    const row = await dbCall(() => this.db.source.findUnique({ where: { id } }));
    if (!row) return null;
    const counts = await this.recordsUsing([row.id]);
    return { ...toSource(row), recordsUsingCount: counts.get(row.id) ?? 0 };
  }

  async nameTaken(name: string, excludeId?: string): Promise<boolean> {
    const row = await dbCall(() =>
      this.db.source.findFirst({
        where: { name, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
        select: { id: true },
      }),
    );
    return row !== null;
  }

  async saveSource(input: SourceWrite, _now: Date): Promise<SourceRow> {
    const recordStatus: 'ACTIVE' | 'PAUSED' = input.active ? 'ACTIVE' : 'PAUSED';
    const data = {
      name: input.name,
      publisher: input.publisher,
      url: input.url,
      termsUrl: input.termsUrl,
      method: input.method,
      schedule: input.schedule,
      freshnessDays: input.freshnessDays,
      levels: input.levels.filter((level): level is GovLevel => LEVELS.has(level)),
      collectorKey: input.collectorKey,
      active: input.active,
      recordStatus,
      kind: input.kind ?? kindForMethod(input.method),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
    };
    const id = input.id;
    const row = id
      ? await dbCall(() => this.db.source.update({ where: { id }, data }))
      : await dbCall(() => this.db.source.create({ data }));
    return toSource(row);
  }

  async activeRun(sourceId: string): Promise<RunRow | null> {
    const row = await dbCall(() =>
      this.db.sourceRun.findFirst({
        where: { sourceId, status: { in: ['QUEUED', 'RUNNING'] } },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return row ? toRun(row) : null;
  }

  async createRun(sourceId: string, triggeredBy: string | null, now: Date): Promise<RunRow> {
    const row = await dbCall(() =>
      this.db.sourceRun.create({
        data: { sourceId, triggeredBy, status: 'QUEUED', createdAt: now },
      }),
    );
    return toRun(row);
  }

  async markRunning(runId: string, now: Date): Promise<RunRow | null> {
    const result = await dbCall(() =>
      this.db.sourceRun.updateMany({
        where: { id: runId, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status: 'RUNNING', startedAt: now },
      }),
    );
    if (result.count !== 1) return null;
    const row = await dbCall(() => this.db.sourceRun.findUnique({ where: { id: runId } }));
    return row ? toRun(row) : null;
  }

  async finishRun(
    runId: string,
    patch: {
      status: 'SUCCEEDED' | 'FAILED';
      sha?: string;
      added: number;
      changed: number;
      pending: number;
      retired?: number;
      error: string | null;
    },
    now: Date,
  ): Promise<void> {
    const run = await dbCall(() =>
      this.db.sourceRun.update({
        where: { id: runId },
        data: {
          status: patch.status,
          finishedAt: now,
          added: patch.added,
          changed: patch.changed,
          pending: patch.pending,
          error: patch.error,
          ...(patch.sha ? { snapshotSha: patch.sha } : {}),
          ...(patch.retired !== undefined ? { retired: patch.retired } : {}),
        },
        select: { sourceId: true },
      }),
    );
    await dbCall(() =>
      this.db.source.update({
        where: { id: run.sourceId },
        data: {
          lastAttemptAt: now,
          ...(patch.status === 'SUCCEEDED' ? { lastSuccessAt: now } : {}),
        },
      }),
    );
  }

  async listActiveSources(): Promise<SourceRow[]> {
    const rows = await dbCall(() =>
      this.db.source.findMany({ where: { active: true, recordStatus: 'ACTIVE' }, orderBy: { name: 'asc' } }),
    );
    return rows.map(toSource);
  }

  async listActiveJurisdictions(sourceId: string, state: string): Promise<{ type: string; geoid: string }[]> {
    const rows = await dbCall(() =>
      this.db.jurisdiction.findMany({
        where: { sourceId, state, status: 'ACTIVE', geoid: { not: null } },
        select: { type: true, geoid: true },
      }),
    );
    return rows.flatMap((row) => (row.geoid ? [{ type: row.type, geoid: row.geoid }] : []));
  }

  async retireJurisdictionsExcept(input: {
    sourceId: string;
    state: string;
    geoids: string[];
    types: string[];
    now: Date;
  }): Promise<number> {
    const types = input.types.filter((type) => TYPES.has(type));
    const geoids = [...new Set(input.geoids.filter((geoid) => geoid.length > 0))];
    if (types.length === 0 || geoids.length === 0) return 0;
    const typeList = Prisma.join(types.map((type) => Prisma.sql`${type}::"JurisdictionType"`));
    const geoidList = Prisma.join(geoids);
    return dbCall(() =>
      this.db.$executeRaw`
        UPDATE jurisdictions
        SET status = 'RETIRED'::"RecordStatus", updated_at = ${input.now}
        WHERE source_id = ${input.sourceId}::uuid
          AND state = ${input.state}
          AND status = 'ACTIVE'::"RecordStatus"
          AND type IN (${typeList})
          AND geoid IS NOT NULL
          AND geoid NOT IN (${geoidList})
      `,
    );
  }

  async lastSucceededSha(sourceId: string): Promise<string | null> {
    const row = await dbCall(() =>
      this.db.sourceRun.findFirst({
        where: { sourceId, status: 'SUCCEEDED', snapshotSha: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { snapshotSha: true },
      }),
    );
    return row?.snapshotSha ?? null;
  }

  async listRuns(sourceId: string, limit: number): Promise<RunRow[]> {
    const rows = await dbCall(() =>
      this.db.sourceRun.findMany({
        where: { sourceId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    );
    return rows.map(toRun);
  }

  async findCivic(matchKey: string): Promise<CivicRow | null> {
    const official = await dbCall(() =>
      this.db.official.findFirst({
        where: { sourceRecordUrl: matchKey },
        select: { id: true, fullName: true, party: true, website: true, displayName: true },
      }),
    );
    if (official) {
      return {
        matchKey,
        entityType: 'OFFICIAL',
        entityId: official.id,
        fields: {
          fullName: official.fullName,
          party: official.party,
          website: official.website,
          title: official.displayName,
          phone: null,
          email: null,
        },
      };
    }
    const officeId = officeIdFromKey(matchKey);
    if (officeId) {
      const office = await dbCall(() =>
        this.db.office.findUnique({
          where: { id: officeId },
          select: { id: true, phone: true, email: true, addresses: { take: 1, select: { street: true } } },
        }),
      );
      if (office) {
        return {
          matchKey,
          entityType: 'OFFICE',
          entityId: office.id,
          fields: {
            phone: office.phone,
            email: office.email,
            address: office.addresses[0]?.street ?? null,
          },
        };
      }
    }
    const geoid = matchKey.startsWith('tiger:') ? matchKey.slice('tiger:'.length) : matchKey;
    const jurisdiction = await dbCall(() =>
      this.db.jurisdiction.findFirst({
        where: { geoid },
        select: { id: true, name: true, geoid: true, state: true, type: true, level: true, subtype: true, boundaryVintage: true },
      }),
    );
    if (!jurisdiction) return null;
    return {
      matchKey,
      entityType: 'JURISDICTION',
      entityId: jurisdiction.id,
      fields: {
        name: jurisdiction.name,
        geoid: jurisdiction.geoid,
        state: jurisdiction.state,
        type: jurisdiction.type,
        level: jurisdiction.level,
        subtype: jurisdiction.subtype,
        boundaryVintage: jurisdiction.boundaryVintage,
      },
    };
  }

  async upsertCivic(sourceId: string, record: NormalisedRecord, now: Date): Promise<'added' | 'changed' | 'unchanged'> {
    if (record.entityType === 'OFFICIAL' && record.fields.officeKey) {
      return this.upsertOfficial(sourceId, record, now);
    }
    const existing = await this.findCivic(record.matchKey);
    const attributesSame = Boolean(existing && sameAttributes(existing.fields, record.fields));
    const refreshBoundary = Boolean(record.fields.geometry || record.fields.boundaryVintage || record.fields.parentGeoid);
    if (attributesSame && !refreshBoundary) return 'unchanged';
    if (record.entityType === 'JURISDICTION') {
      await this.upsertJurisdiction(sourceId, record, now);
    } else if (record.entityType === 'OFFICIAL') {
      await this.upsertOfficial(sourceId, record, now);
    } else if (record.entityType === 'OFFICE') {
      await this.upsertOffice(sourceId, record, now);
    }
    if (!existing) return 'added';
    return attributesSame ? 'unchanged' : 'changed';
  }

  async addPending(input: {
    sourceRunId: string;
    entityType: CivicEntityType;
    entityId: string | null;
    field: string;
    oldValue: string | null;
    newValue: string;
    now: Date;
  }): Promise<void> {
    await dbCall(() =>
      this.db.pendingSourceChange.create({
        data: {
          sourceRunId: input.sourceRunId,
          entityType: input.entityType,
          entityId: input.entityId,
          field: input.field.slice(0, 80),
          oldValue: input.oldValue === null ? Prisma.DbNull : input.oldValue,
          newValue: input.newValue,
          createdAt: input.now,
        },
      }),
    );
  }

  async listPending(query: PendingQuery): Promise<PendingRow[]> {
    const rows = await dbCall(() =>
      this.db.pendingSourceChange.findMany({
        where: {
          ...(query.decision ? { decision: query.decision } : {}),
          ...(query.sourceId ? { sourceRun: { sourceId: query.sourceId } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
    );
    return rows.map(toPending);
  }

  async findPending(id: string): Promise<PendingRow | null> {
    const row = await dbCall(() => this.db.pendingSourceChange.findUnique({ where: { id } }));
    return row ? toPending(row) : null;
  }

  async decidePending(id: string, decision: 'ACCEPTED' | 'REJECTED', adminId: string, now: Date): Promise<boolean> {
    const result = await dbCall(() =>
      this.db.pendingSourceChange.updateMany({
        where: { id, decision: 'PENDING' },
        data: { decision, decidedBy: adminId, decidedAt: now },
      }),
    );
    return result.count === 1;
  }

  async applyField(entityType: CivicEntityType, entityId: string, field: string, value: string | null): Promise<void> {
    if (entityType === 'OFFICIAL') {
      const data = officialPatch(field, value);
      await dbCall(() => this.db.official.update({ where: { id: entityId }, data }));
      return;
    }
    if (entityType === 'OFFICE' && field === 'address') {
      const existing = await dbCall(() => this.db.officeAddress.findFirst({ where: { officeId: entityId }, orderBy: { id: 'asc' } }));
      if (!existing) throw new ValidationError('That field cannot be applied.');
      await dbCall(() => this.db.officeAddress.update({ where: { id: existing.id }, data: { street: (value ?? '').slice(0, 200) } }));
      return;
    }
    if (entityType === 'OFFICE') {
      const data = officePatch(field, value);
      await dbCall(() => this.db.office.update({ where: { id: entityId }, data }));
      return;
    }
    if (entityType === 'JURISDICTION') {
      const data = jurisdictionPatch(field, value);
      await dbCall(() => this.db.jurisdiction.update({ where: { id: entityId }, data }));
      return;
    }
    throw new ValidationError('That field cannot be applied.');
  }

  async applyDirectory(sourceRunId: string, raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new ValidationError('That directory change could not be read.');
    }
    const result = directorySchema.safeParse(parsed);
    if (!result.success) throw new ValidationError('That directory change could not be read.');
    const body = result.data;
    const run = await dbCall(() => this.db.sourceRun.findUnique({ where: { id: sourceRunId }, select: { sourceId: true } }));
    if (!run) throw new ValidationError('That change has no source.');
    const now = new Date();
    const geoid = body.jurisdictionGeoid ?? null;
    const jurisdiction = geoid
      ? await dbCall(() =>
          this.db.jurisdiction.findFirst({
            where: { geoid, status: 'ACTIVE' },
            select: { id: true, state: true },
          }),
        )
      : null;
    let officeId = body.officeId ?? null;
    if (!officeId) {
      if (!jurisdiction) throw new ValidationError('That jurisdiction is not loaded yet.');
      const name = body.officeName.slice(0, 150);
      const existing = await dbCall(() => this.db.office.findFirst({ where: { jurisdictionId: jurisdiction.id, name } }));
      if (existing) {
        officeId = existing.id;
      } else {
        const created = await dbCall(() =>
          this.db.office.create({
            data: {
              name,
              slug: slugFor(`page-office:${body.jurisdictionGeoid}:${name}`),
              jurisdictionId: jurisdiction.id,
              selectionMethod: 'ELECTED',
              phone: clipPhone(body.phone ?? null),
              email: body.email?.slice(0, 254) ?? null,
              sourceId: run.sourceId,
              sourceRecordUrl: `page:${body.jurisdictionGeoid}:${body.fullName.toLowerCase()}`.slice(0, 2048),
              lastUpdatedAt: now,
            },
          }),
        );
        officeId = created.id;
      }
    }
    if (body.phone || body.email) {
      await dbCall(() =>
        this.db.office.update({
          where: { id: officeId },
          data: {
            ...(body.phone ? { phone: clipPhone(body.phone) } : {}),
            ...(body.email ? { email: body.email.slice(0, 254) } : {}),
            sourceId: run.sourceId,
            lastUpdatedAt: now,
          },
        }),
      );
    }
    const matchKey = `page:${body.jurisdictionGeoid ?? 'office'}:${body.fullName.toLowerCase()}`;
    let official = await dbCall(() => this.db.official.findFirst({ where: { sourceRecordUrl: matchKey } }));
    if (!official) {
      official = await dbCall(() =>
        this.db.official.create({
          data: {
            fullName: body.fullName.slice(0, 120),
            displayName: body.title?.slice(0, 120) ?? null,
            slug: slugFor(matchKey),
            sourceId: run.sourceId,
            sourceRecordUrl: matchKey.slice(0, 2048),
            lastUpdatedAt: now,
            externalIds: { matchKey },
          },
        }),
      );
    }
    const current = await dbCall(() => this.db.officeTerm.findFirst({ where: { officeId, isCurrent: true } }));
    if (!current || current.officialId !== official.id) {
      if (current) {
        await dbCall(() =>
          this.db.officeTerm.update({ where: { id: current.id }, data: { isCurrent: false, termEnd: dateOnly(now) } }),
        );
      }
      await dbCall(() =>
        this.db.officeTerm.create({
          data: { officeId, officialId: official.id, status: 'ELECTED', isCurrent: true },
        }),
      );
    }
    if (body.address) {
      await this.writeOfficeAddress(officeId, 'Office', body.address, jurisdiction?.state ?? null);
    }
  }

  async findOfficeIdByKey(officeKey: string): Promise<string | null> {
    const office = await dbCall(() => this.db.office.findFirst({ where: { sourceRecordUrl: officeKey }, select: { id: true } }));
    return office?.id ?? null;
  }

  async hasPendingField(entityId: string, field: string): Promise<boolean> {
    const count = await dbCall(() =>
      this.db.pendingSourceChange.count({ where: { entityId, field, decision: 'PENDING' } }),
    );
    return count > 0;
  }

  async markPilot(list: PilotList): Promise<number> {
    const states = [
      ...new Set([
        ...list.states,
        ...list.counties.map((row) => row.state),
        ...list.places.map((row) => row.state),
        ...list.schoolDistricts.map((row) => row.state),
        ...list.specialDistricts.map((row) => row.state),
      ]),
    ];
    let count = 0;
    if (states.length > 0) {
      const marked = await dbCall(() =>
        this.db.jurisdiction.updateMany({
          where: {
            status: 'ACTIVE',
            state: { in: states },
            type: { in: ['STATE', 'CONGRESSIONAL_DISTRICT', 'STATE_SENATE_DISTRICT', 'STATE_HOUSE_DISTRICT', 'ZCTA'] },
          },
          data: { isPilot: true },
        }),
      );
      count += marked.count;
    }
    const named: Array<{ type: JurisdictionType; rows: PilotPlace[] }> = [
      { type: 'COUNTY', rows: list.counties },
      { type: 'MUNICIPALITY', rows: list.places },
      { type: 'SCHOOL_DISTRICT', rows: list.schoolDistricts },
      { type: 'SPECIAL_DISTRICT', rows: list.specialDistricts },
    ];
    for (const group of named) {
      for (const place of group.rows) {
        const marked = await dbCall(() =>
          this.db.jurisdiction.updateMany({
            where: {
              status: 'ACTIVE',
              type: group.type,
              state: place.state,
              name: { equals: place.name, mode: 'insensitive' },
            },
            data: { isPilot: true },
          }),
        );
        count += marked.count;
      }
    }
    return count;
  }

  async reresolveLocations(now: Date): Promise<number> {
    return dbCall(() =>
      this.db.$executeRaw`
        UPDATE saved_locations AS sl
        SET jurisdiction_ids = matched.ids,
            resolved_at = ${now},
            updated_at = ${now}
        FROM (
          SELECT sl2.id,
                 COALESCE(array_agg(j.id) FILTER (WHERE j.id IS NOT NULL), ARRAY[]::uuid[]) AS ids
          FROM saved_locations sl2
          LEFT JOIN jurisdictions j
            ON j.status = 'ACTIVE'
           AND j.boundary IS NOT NULL
           AND sl2.point IS NOT NULL
           AND ST_Contains(j.boundary, sl2.point)
          GROUP BY sl2.id
        ) AS matched
        WHERE sl.id = matched.id
      `,
    );
  }

  async servicesWithUrls(): Promise<{ id: string; url: string }[]> {
    const rows = await dbCall(() =>
      this.db.service.findMany({
        where: { status: 'ACTIVE', url: { not: null } },
        select: { id: true, url: true },
      }),
    );
    return rows.flatMap((row) => (row.url ? [{ id: row.id, url: row.url }] : []));
  }

  async setLinkBroken(id: string, broken: boolean, now: Date): Promise<void> {
    await dbCall(() =>
      this.db.service.update({ where: { id }, data: { linkBroken: broken, lastValidatedAt: now } }),
    );
  }

  async touchSource(sourceId: string, now: Date): Promise<void> {
    await dbCall(() => this.db.source.update({ where: { id: sourceId }, data: { lastRunAt: now, lastAttemptAt: now } }));
  }

  private async upsertJurisdiction(sourceId: string, record: NormalisedRecord, now: Date): Promise<void> {
    if (record.fields.geometry) {
      await this.writeBoundary(sourceId, record, now);
      return;
    }
    const geoid = record.fields.geoid ?? record.matchKey.slice(0, 40);
    const type = asType(record.fields.type ?? null);
    const existing = await dbCall(() => this.db.jurisdiction.findFirst({ where: { geoid, type } }));
    const parentId = await this.parentId(record);
    const data = {
      name: (record.fields.name ?? geoid).slice(0, 150),
      level: asLevel(record.fields.level ?? null),
      type,
      geoid,
      state: record.fields.state?.slice(0, 2) ?? null,
      subtype: record.fields.subtype?.slice(0, 80) ?? null,
      boundaryVintage: record.fields.boundaryVintage?.slice(0, 20) ?? null,
      sourceId,
      sourceRecordUrl: record.matchKey.slice(0, 2048),
      lastUpdatedAt: now,
      ...(parentId ? { parentId } : {}),
    };
    if (existing) {
      const write = refreshWrite(existing, data);
      await dbCall(() =>
        this.db.jurisdiction.update({
          where: { id: existing.id },
          data: { ...write.data, ...(write.sourceChangedSinceOverride ? { sourceChangedSinceOverride: true } : {}) },
        }),
      );
      return;
    }
    await dbCall(() => this.db.jurisdiction.create({ data }));
  }

  private async parentId(record: NormalisedRecord): Promise<string | null> {
    const parentType = record.fields.parentType;
    const parentGeoid = record.fields.parentGeoid;
    if (!parentType || !parentGeoid || !TYPES.has(parentType)) return null;
    const parent = await dbCall(() =>
      this.db.jurisdiction.findFirst({
        where: { geoid: parentGeoid, type: parentType as JurisdictionType },
        select: { id: true },
      }),
    );
    return parent?.id ?? null;
  }

  private async recordsUsing(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await dbCall(() =>
      this.db.$queryRaw<Array<{ source_id: string; n: number }>>`
        SELECT source_id::text AS source_id, COUNT(*)::int AS n
        FROM (
          SELECT source_id FROM jurisdictions WHERE source_id::text IN (${Prisma.join(ids)})
          UNION ALL
          SELECT source_id FROM offices WHERE source_id::text IN (${Prisma.join(ids)})
          UNION ALL
          SELECT source_id FROM officials WHERE source_id::text IN (${Prisma.join(ids)})
          UNION ALL
          SELECT source_id FROM services WHERE source_id::text IN (${Prisma.join(ids)})
        ) used
        GROUP BY source_id
      `,
    );
    return new Map(rows.map((row) => [row.source_id, row.n]));
  }

  private async writeBoundary(sourceId: string, record: NormalisedRecord, now: Date): Promise<void> {
    const geoid = (record.fields.geoid ?? '').slice(0, 40);
    if (!geoid || !record.fields.geometry) return;
    const type = asType(record.fields.type ?? null);
    const level = asLevel(record.fields.level ?? null);
    const parentType = record.fields.parentType && TYPES.has(record.fields.parentType) ? record.fields.parentType : null;
    const parentGeoid = parentType ? record.fields.parentGeoid ?? null : null;
    const parentSql =
      parentType && parentGeoid
        ? Prisma.sql`(SELECT id FROM jurisdictions WHERE type = ${parentType}::"JurisdictionType" AND geoid = ${parentGeoid} LIMIT 1)`
        : Prisma.sql`NULL`;
    try {
      await dbCall(() =>
        this.db.$executeRaw`
        INSERT INTO jurisdictions (
          name, level, type, subtype, parent_id, district_code, geoid, state,
          boundary, boundary_vintage, source_id, source_record_url, last_updated_at, status, updated_at
        ) VALUES (
          ${(record.fields.name ?? geoid).slice(0, 150)},
          ${level}::"GovLevel",
          ${type}::"JurisdictionType",
          ${record.fields.subtype?.slice(0, 80) ?? null},
          ${parentSql},
          ${record.fields.districtCode?.slice(0, 40) ?? null},
          ${geoid},
          ${record.fields.state?.slice(0, 2) ?? null},
          (
            SELECT CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL ELSE ST_Multi(g) END
            FROM (
              SELECT ST_Force2D(ST_CollectionExtract(
                ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${record.fields.geometry}), 4326)),
                3
              )) AS g
            ) extracted
          ),
          ${record.fields.boundaryVintage?.slice(0, 20) ?? null},
          ${sourceId}::uuid,
          ${record.matchKey.slice(0, 2048)},
          ${now},
          'ACTIVE'::"RecordStatus",
          ${now}
        )
        ON CONFLICT (type, geoid) DO UPDATE SET
          level = EXCLUDED.level,
          subtype = EXCLUDED.subtype,
          parent_id = COALESCE(EXCLUDED.parent_id, jurisdictions.parent_id),
          district_code = EXCLUDED.district_code,
          state = EXCLUDED.state,
          boundary = EXCLUDED.boundary,
          boundary_vintage = EXCLUDED.boundary_vintage,
          source_id = CASE WHEN jurisdictions.override_active THEN jurisdictions.source_id ELSE EXCLUDED.source_id END,
          source_record_url = CASE WHEN jurisdictions.override_active THEN jurisdictions.source_record_url ELSE EXCLUDED.source_record_url END,
          last_updated_at = CASE WHEN jurisdictions.override_active THEN jurisdictions.last_updated_at ELSE EXCLUDED.last_updated_at END,
          name = CASE WHEN jurisdictions.override_active THEN jurisdictions.name ELSE EXCLUDED.name END,
          source_changed_since_override = CASE
            WHEN jurisdictions.override_active AND (
              jurisdictions.name IS DISTINCT FROM EXCLUDED.name
              OR jurisdictions.source_id IS DISTINCT FROM EXCLUDED.source_id
              OR jurisdictions.source_record_url IS DISTINCT FROM EXCLUDED.source_record_url
            ) THEN true
            ELSE jurisdictions.source_changed_since_override
          END,
          status = 'ACTIVE'::"RecordStatus",
          updated_at = ${now}
      `,
      );
    } catch (err) {
      const detail = postgresMessage(err) ?? 'database rejected the row';
      throw new ValidationError(`Boundary rejected for ${geoid}: ${detail}`);
    }
  }

  private async upsertOfficial(sourceId: string, record: NormalisedRecord, now: Date): Promise<'added' | 'changed' | 'unchanged'> {
    const existing = await dbCall(() => this.db.official.findFirst({ where: { sourceRecordUrl: record.matchKey } }));
    const photo = photoWrite(record.fields);
    const data = {
      fullName: (record.fields.fullName ?? 'Unknown').slice(0, 120),
      ...(record.fields.title ? { displayName: record.fields.title.slice(0, 120) } : {}),
      party: record.fields.party?.slice(0, 60) ?? null,
      ...(record.fields.website ? { website: httpsField(record.fields.website) } : {}),
      ...photo,
      sourceId,
      sourceRecordUrl: record.matchKey.slice(0, 2048),
      lastUpdatedAt: now,
      externalIds: { matchKey: record.matchKey },
    };
    let officialId: string;
    let outcome: 'added' | 'changed' | 'unchanged';
    if (!existing) {
      const created = await dbCall(() =>
        this.db.official.create({
          data: { ...data, slug: slugFor(record.matchKey) },
        }),
      );
      officialId = created.id;
      outcome = 'added';
    } else {
      officialId = existing.id;
      const stored = {
        fullName: existing.fullName,
        party: existing.party,
        website: existing.website,
        title: existing.displayName,
        phone: null,
        email: null,
      };
      const comparable = { ...record.fields };
      if (comparable.website === undefined) comparable.website = existing.website;
      if (comparable.title === undefined) comparable.title = existing.displayName;
      const photoChanged =
        (photo.photoUrl !== undefined && (photo.photoUrl ?? null) !== (existing.photoUrl ?? null)) ||
        (photo.photoStatus !== undefined && photo.photoStatus !== existing.photoStatus);
      if (sameAttributes(stored, comparable) && !photoChanged) {
        outcome = 'unchanged';
      } else {
        const write = refreshWrite(existing, data);
        await dbCall(() =>
          this.db.official.update({
            where: { id: existing.id },
            data: { ...write.data, ...(write.sourceChangedSinceOverride ? { sourceChangedSinceOverride: true } : {}) },
          }),
        );
        outcome = 'changed';
      }
    }
    const linked = await this.linkSeat(sourceId, officialId, record, now);
    const years = await this.writeElectedYears(officialId, record.fields.termsJson ?? null);
    if (outcome === 'unchanged' && (linked || years)) return 'changed';
    return outcome;
  }

  private async linkSeat(sourceId: string, officialId: string, record: NormalisedRecord, now: Date): Promise<boolean> {
    const officeKey = record.fields.officeKey;
    const officeName = record.fields.officeName;
    const jurisdictionType = record.fields.jurisdictionType;
    const jurisdictionGeoid = record.fields.jurisdictionGeoid;
    if (!officeKey || !officeName || !jurisdictionType || !jurisdictionGeoid || !TYPES.has(jurisdictionType)) return false;
    const jurisdiction = await dbCall(() =>
      this.db.jurisdiction.findFirst({
        where: { type: jurisdictionType as JurisdictionType, geoid: jurisdictionGeoid, status: 'ACTIVE' },
        select: { id: true },
      }),
    );
    if (!jurisdiction) return false;
    const email = record.fields.contactEmail ? record.fields.contactEmail.slice(0, 254) : null;
    const website = record.fields.website ? httpsField(record.fields.website) : null;
    const phone = clipPhone(record.fields.phone ?? null);
    const contactUrl = record.fields.contactUrl ? httpsField(record.fields.contactUrl) : null;
    const seatLabel = record.fields.seatLabel?.slice(0, 60) ?? null;
    const name = officeName.slice(0, 150);
    let office = await dbCall(() => this.db.office.findFirst({ where: { sourceRecordUrl: officeKey } }));
    if (!office) {
      office = await dbCall(() =>
        this.db.office.findFirst({ where: { jurisdictionId: jurisdiction.id, name } }),
      );
    }
    let wrote = false;
    if (!office) {
      office = await dbCall(() =>
        this.db.office.create({
          data: {
            name,
            slug: slugFor(officeKey),
            jurisdictionId: jurisdiction.id,
            seatLabel,
            selectionMethod: 'ELECTED',
            officeType: 'ELECTED',
            email,
            website,
            phone,
            contactUrl,
            holderUnknown: false,
            sourceId,
            sourceRecordUrl: officeKey.slice(0, 2048),
            lastUpdatedAt: now,
          },
        }),
      );
      wrote = true;
    } else if (!office.overrideActive) {
      const nextEmail = record.fields.contactEmail ? email : office.email;
      const nextWebsite = record.fields.website ? website : office.website;
      const nextPhone = record.fields.phone ? phone : office.phone;
      const nextContact = record.fields.contactUrl ? contactUrl : office.contactUrl;
      const patch = {
        name,
        seatLabel,
        email: nextEmail,
        website: nextWebsite,
        phone: nextPhone,
        contactUrl: nextContact,
        holderUnknown: false,
        jurisdictionId: jurisdiction.id,
        sourceRecordUrl: officeKey.slice(0, 2048),
        lastUpdatedAt: now,
      };
      const differs =
        office.name !== patch.name ||
        office.seatLabel !== patch.seatLabel ||
        office.email !== patch.email ||
        office.website !== patch.website ||
        office.phone !== patch.phone ||
        office.contactUrl !== patch.contactUrl ||
        office.holderUnknown ||
        office.jurisdictionId !== patch.jurisdictionId ||
        office.sourceRecordUrl !== patch.sourceRecordUrl;
      if (differs) {
        const officeId = office.id;
        await dbCall(() => this.db.office.update({ where: { id: officeId }, data: patch }));
        wrote = true;
      }
    }
    const officeId = office.id;
    const termStart = dateOrNull(record.fields.termStart ?? null);
    const termEnd = dateOrNull(record.fields.termEnd ?? null);
    const seated = await dbCall(() =>
      this.db.$transaction(async (tx) => {
        const current = await tx.officeTerm.findFirst({
          where: { officeId, isCurrent: true },
        });
        let changed = false;
        if (current && current.officialId !== officialId) {
          await tx.officeTerm.update({
            where: { id: current.id },
            data: { isCurrent: false, termEnd: current.termEnd ?? dateOnly(now) },
          });
          changed = true;
        }
        const moved = await tx.officeTerm.updateMany({
          where: { officialId, isCurrent: true, officeId: { not: officeId } },
          data: { isCurrent: false, termEnd: dateOnly(now) },
        });
        if (moved.count > 0) changed = true;
        const held = current && current.officialId === officialId ? current : null;
        if (held) {
          const sameStart = sameDay(held.termStart, termStart);
          const sameEnd = sameDay(held.termEnd, termEnd);
          if (!sameStart || !sameEnd) {
            await tx.officeTerm.update({
              where: { id: held.id },
              data: { termStart, termEnd, status: 'ELECTED' },
            });
            changed = true;
          }
          return changed;
        }
        await tx.officeTerm.create({
          data: {
            officeId,
            officialId,
            status: 'ELECTED',
            isCurrent: true,
            termStart,
            termEnd,
          },
        });
        return true;
      }),
    );
    const past = await this.writePastTerms(sourceId, officialId, record, officeKey, now);
    if (!office.overrideActive) {
      const state = record.fields.state;
      const labeled = [
        record.fields.capitolAddress ? { label: 'Capitol', raw: record.fields.capitolAddress } : null,
        record.fields.districtAddress ? { label: 'District', raw: record.fields.districtAddress } : null,
        !record.fields.capitolAddress && record.fields.address ? { label: 'Office', raw: record.fields.address } : null,
      ];
      for (const item of labeled) {
        if (!item) continue;
        if (await this.writeOfficeAddress(officeId, item.label, item.raw, state ?? null)) wrote = true;
      }
    }
    return wrote || seated || past;
  }

  private async writePastTerms(
    sourceId: string,
    officialId: string,
    record: NormalisedRecord,
    currentOfficeKey: string,
    now: Date,
  ): Promise<boolean> {
    const history = parseTermHistory(record.fields.termsJson ?? null);
    const currentStart = record.fields.termStart ?? null;
    let wrote = false;
    for (const past of history) {
      if (past.officeKey === currentOfficeKey && past.start === currentStart) continue;
      if (!TYPES.has(past.jurisdictionType) || !past.jurisdictionGeoid) continue;
      const officeId = await this.ensureHistoricalOffice(sourceId, past, now);
      if (!officeId) continue;
      if (await this.ensureHistoricalTerm(officeId, officialId, past.start, past.end)) wrote = true;
    }
    return wrote;
  }

  private async ensureHistoricalOffice(
    sourceId: string,
    past: { officeKey: string; officeName: string; jurisdictionType: string; jurisdictionGeoid: string; seatLabel: string | null },
    now: Date,
  ): Promise<string | null> {
    const existing = await dbCall(() =>
      this.db.office.findFirst({ where: { sourceRecordUrl: past.officeKey }, select: { id: true } }),
    );
    if (existing) return existing.id;
    const jurisdiction = await dbCall(() =>
      this.db.jurisdiction.findFirst({
        where: { type: past.jurisdictionType as JurisdictionType, geoid: past.jurisdictionGeoid, status: 'ACTIVE' },
        select: { id: true },
      }),
    );
    if (!jurisdiction) return null;
    const name = past.officeName.slice(0, 150);
    const named = await dbCall(() =>
      this.db.office.findFirst({ where: { jurisdictionId: jurisdiction.id, name }, select: { id: true } }),
    );
    if (named) return named.id;
    const created = await dbCall(() =>
      this.db.office.create({
        data: {
          name,
          slug: slugFor(past.officeKey),
          jurisdictionId: jurisdiction.id,
          seatLabel: past.seatLabel?.slice(0, 60) ?? null,
          selectionMethod: 'ELECTED',
          officeType: 'ELECTED',
          holderUnknown: true,
          sourceId,
          sourceRecordUrl: past.officeKey.slice(0, 2048),
          lastUpdatedAt: now,
        },
        select: { id: true },
      }),
    );
    return created.id;
  }

  private async ensureHistoricalTerm(
    officeId: string,
    officialId: string,
    start: string | null,
    end: string | null,
  ): Promise<boolean> {
    const termStart = dateOrNull(start);
    const termEnd = dateOrNull(end);
    const existing = await dbCall(() =>
      this.db.officeTerm.findMany({
        where: { officeId, officialId, isCurrent: false },
        select: { id: true, termStart: true, termEnd: true },
      }),
    );
    const held = existing.find((term) => sameDay(term.termStart, termStart));
    if (held) {
      if (sameDay(held.termEnd, termEnd)) return false;
      await dbCall(() => this.db.officeTerm.update({ where: { id: held.id }, data: { termEnd } }));
      return true;
    }
    await dbCall(() =>
      this.db.officeTerm.create({
        data: { officeId, officialId, status: 'ELECTED', isCurrent: false, termStart, termEnd },
      }),
    );
    return true;
  }

  private async writeElectedYears(officialId: string, termsJson: string | null): Promise<boolean> {
    const terms = await dbCall(() =>
      this.db.officeTerm.findMany({
        where: { officialId },
        select: { id: true, officeId: true, termStart: true, termEnd: true, electedYear: true },
      }),
    );
    const dated = terms.map((term) => ({
      key: term.id,
      officeKey: term.officeId,
      start: term.termStart ? term.termStart.toISOString().slice(0, 10) : null,
      end: term.termEnd ? term.termEnd.toISOString().slice(0, 10) : null,
    }));
    const years = electedYearByTerm(dated);
    let wrote = false;
    for (const term of terms) {
      const year = years.get(term.id) ?? null;
      if (term.electedYear === year) continue;
      await dbCall(() => this.db.officeTerm.update({ where: { id: term.id }, data: { electedYear: year } }));
      wrote = true;
    }
    const sourceStarts = parseTermHistory(termsJson).map((term) => term.start);
    const first = firstElectedYear([...dated.map((term) => term.start), ...sourceStarts]);
    const official = await dbCall(() =>
      this.db.official.findUnique({ where: { id: officialId }, select: { firstElectedYear: true } }),
    );
    if (official && official.firstElectedYear !== first) {
      await dbCall(() => this.db.official.update({ where: { id: officialId }, data: { firstElectedYear: first } }));
      wrote = true;
    }
    return wrote;
  }

  private async writeOfficeAddress(officeId: string, label: string, raw: string, state: string | null): Promise<boolean> {
    const parsed = parsePublishedAddress(raw, state);
    if (!parsed) return false;
    const existing = await dbCall(() => this.db.officeAddress.findFirst({ where: { officeId, label } }));
    if (!existing) {
      await dbCall(() => this.db.officeAddress.create({ data: { officeId, label: label.slice(0, 60), ...parsed } }));
      return true;
    }
    if (existing.street === parsed.street && existing.city === parsed.city && existing.state === parsed.state && existing.zip === parsed.zip) {
      return false;
    }
    await dbCall(() => this.db.officeAddress.update({ where: { id: existing.id }, data: parsed }));
    return true;
  }

  private async upsertOffice(sourceId: string, record: NormalisedRecord, now: Date): Promise<void> {
    const existing = await dbCall(() => this.db.office.findFirst({ where: { sourceRecordUrl: record.matchKey } }));
    if (!existing && !record.fields.jurisdictionId) return;
    const data = {
      name: (record.fields.name ?? 'Office').slice(0, 150),
      phone: record.fields.phone ?? null,
      email: record.fields.email ?? null,
      website: record.fields.website ?? null,
      sourceId,
      sourceRecordUrl: record.matchKey.slice(0, 2048),
      lastUpdatedAt: now,
    };
    if (existing) {
      const write = refreshWrite(existing, data);
      await dbCall(() =>
        this.db.office.update({
          where: { id: existing.id },
          data: { ...write.data, ...(write.sourceChangedSinceOverride ? { sourceChangedSinceOverride: true } : {}) },
        }),
      );
      return;
    }
    await dbCall(() =>
      this.db.office.create({
        data: {
          ...data,
          slug: slugFor(record.matchKey),
          jurisdictionId: record.fields.jurisdictionId ?? '',
          selectionMethod: 'ELECTED',
        },
      }),
    );
  }
}

function kindForMethod(method: SourceRow['method']): NonNullable<SourceRow['kind']> {
  if (method === 'BULK') return 'BULK_EXPORT';
  if (method === 'PAGE_COLLECTION') return 'SCHEDULED_PAGE';
  if (method === 'API') return 'API';
  return 'MANUAL';
}

function toPending(row: {
  id: string;
  sourceRunId: string;
  entityType: CivicEntityType;
  entityId: string | null;
  field: string;
  oldValue: Prisma.JsonValue | null;
  newValue: Prisma.JsonValue;
  decision: PendingRow['decision'];
  createdAt: Date;
}): PendingRow {
  return {
    id: row.id,
    sourceRunId: row.sourceRunId,
    entityType: row.entityType,
    entityId: row.entityId,
    field: row.field,
    oldValue: jsonString(row.oldValue),
    newValue: jsonString(row.newValue) ?? '',
    decision: row.decision,
    createdAt: row.createdAt,
  };
}

function jsonString(value: Prisma.JsonValue | null): string | null {
  if (typeof value === 'string') return value;
  if (value === null) return null;
  return JSON.stringify(value);
}

function officeIdFromKey(matchKey: string): string | null {
  const match = /^office:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::|$)/i.exec(matchKey);
  return match?.[1] ?? null;
}

function asLevel(value: string | null): GovLevel {
  if (value && LEVELS.has(value)) return value as GovLevel;
  return 'COUNTY';
}

function asType(value: string | null): JurisdictionType {
  if (value && TYPES.has(value)) return value as JurisdictionType;
  return 'COUNTY';
}

function photoWrite(fields: Record<string, string | null>): { photoUrl?: string | null; photoStatus?: PhotoStatus } {
  const url = httpsField(fields.photoUrl);
  if (fields.photoStatus === 'BROKEN') return { photoUrl: null, photoStatus: PhotoStatus.BROKEN };
  if (fields.photoStatus === 'OK' && url) return { photoUrl: url, photoStatus: PhotoStatus.OK };
  if (fields.photoStatus === 'NONE') return { photoUrl: null, photoStatus: PhotoStatus.NONE };
  if (url) return { photoUrl: url };
  return {};
}

function httpsField(value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';
  if (!text.startsWith('https://') || text.length > 2048) return null;
  return text;
}

function dateOrNull(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function sameDay(left: Date | null, right: Date | null): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return dateOnly(left).getTime() === dateOnly(right).getTime();
}

function slugFor(matchKey: string): string {
  const slug = matchKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 160);
  return slug.length > 0 ? slug : 'record';
}

function officialPatch(field: string, value: string | null): {
  fullName?: string;
  party?: string | null;
  website?: string | null;
  displayName?: string | null;
} {
  if (field === 'fullName' && value) return { fullName: value.slice(0, 120) };
  if (field === 'title' || field === 'displayName') return { displayName: value?.slice(0, 120) ?? null };
  if (field === 'party') return { party: value?.slice(0, 60) ?? null };
  if (field === 'website') return { website: value };
  throw new ValidationError('That field cannot be applied.');
}

function officePatch(
  field: string,
  value: string | null,
): { name?: string; phone?: string | null; email?: string | null; website?: string | null; contactUrl?: string | null } {
  if (field === 'name' && value) return { name: value.slice(0, 150) };
  if (field === 'phone') return { phone: value };
  if (field === 'email') return { email: value };
  if (field === 'website') return { website: value };
  if (field === 'contactUrl') return { contactUrl: value };
  throw new ValidationError('That field cannot be applied.');
}

const directorySchema = z
  .object({
    officeId: z.uuid().nullable().optional(),
    officeName: z.string().trim().min(1).max(150),
    jurisdictionGeoid: z.string().trim().min(2).max(40).nullable().optional(),
    fullName: z.string().trim().min(1).max(120),
    title: z.string().trim().max(120).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    email: z.string().trim().max(254).nullable().optional(),
    address: z.string().trim().max(300).nullable().optional(),
  })
  .strict();

function jurisdictionPatch(field: string, value: string | null): { name?: string; website?: string | null } {
  if (field === 'name' && value) return { name: value.slice(0, 150) };
  if (field === 'website') return { website: value };
  throw new ValidationError('That field cannot be applied.');
}
