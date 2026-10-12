import { Prisma } from '../../generated/prisma/client.js';
import { GovLevel, JurisdictionType, type CivicEntityType } from '../../generated/prisma/enums.js';
import { dbCall, prisma, type Db } from '../../db/prisma.js';
import { ValidationError } from '../../lib/errors.js';
import type { PendingQuery, PipelineStore, SourceListQuery, SourceWrite } from './pipeline.ports.js';
import type { CivicRow, PendingRow, RunRow, SourceRow } from './records.js';
import { sourceConfigFromJson } from './source-config.js';
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
  createdAt: Date;
  config: Prisma.JsonValue;
}): SourceRow {
  return { ...row, config: sourceConfigFromJson(row.config) };
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
    return { rows: rows.map(toSource), total };
  }

  async findSource(id: string): Promise<SourceRow | null> {
    const row = await dbCall(() => this.db.source.findUnique({ where: { id } }));
    return row ? toSource(row) : null;
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
      config: input.config as Prisma.InputJsonValue,
    };
    const id = input.id;
    const row = id
      ? await dbCall(() => this.db.source.update({ where: { id }, data }))
      : await dbCall(() => this.db.source.create({ data }));
    return { ...toSource(row), config: input.config };
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
    await dbCall(() =>
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
      }),
    );
  }

  async listActiveSources(): Promise<SourceRow[]> {
    const rows = await dbCall(() => this.db.source.findMany({ where: { active: true }, orderBy: { name: 'asc' } }));
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
    await dbCall(() => this.db.source.update({ where: { id: sourceId }, data: { lastRunAt: now } }));
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
      await dbCall(() => this.db.jurisdiction.update({ where: { id: existing.id }, data }));
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
          ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${record.fields.geometry}), 4326))),
          ${record.fields.boundaryVintage?.slice(0, 20) ?? null},
          ${sourceId}::uuid,
          ${record.matchKey.slice(0, 2048)},
          ${now},
          'ACTIVE'::"RecordStatus",
          ${now}
        )
        ON CONFLICT (type, geoid) DO UPDATE SET
          name = EXCLUDED.name,
          level = EXCLUDED.level,
          subtype = EXCLUDED.subtype,
          parent_id = COALESCE(EXCLUDED.parent_id, jurisdictions.parent_id),
          district_code = EXCLUDED.district_code,
          state = EXCLUDED.state,
          boundary = EXCLUDED.boundary,
          boundary_vintage = EXCLUDED.boundary_vintage,
          source_id = EXCLUDED.source_id,
          source_record_url = EXCLUDED.source_record_url,
          last_updated_at = EXCLUDED.last_updated_at,
          status = 'ACTIVE'::"RecordStatus",
          updated_at = ${now}
      `,
    );
  }

  private async upsertOfficial(sourceId: string, record: NormalisedRecord, now: Date): Promise<void> {
    const existing = await dbCall(() => this.db.official.findFirst({ where: { sourceRecordUrl: record.matchKey } }));
    const data = {
      fullName: (record.fields.fullName ?? 'Unknown').slice(0, 120),
      party: record.fields.party?.slice(0, 60) ?? null,
      website: record.fields.website ?? null,
      sourceId,
      sourceRecordUrl: record.matchKey.slice(0, 2048),
      lastUpdatedAt: now,
      externalIds: { matchKey: record.matchKey },
    };
    if (existing) {
      await dbCall(() => this.db.official.update({ where: { id: existing.id }, data }));
      return;
    }
    await dbCall(() =>
      this.db.official.create({
        data: { ...data, slug: slugFor(record.matchKey) },
      }),
    );
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
      await dbCall(() => this.db.office.update({ where: { id: existing.id }, data }));
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

function jurisdictionPatch(field: string, value: string | null): { name?: string; website?: string | null } {
  if (field === 'name' && value) return { name: value.slice(0, 150) };
  if (field === 'website') return { website: value };
  throw new ValidationError('That field cannot be applied.');
}
