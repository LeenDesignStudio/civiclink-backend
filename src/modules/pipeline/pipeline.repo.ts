import { Prisma } from '../../generated/prisma/client.js';
import { GovLevel, JurisdictionType, type CivicEntityType } from '../../generated/prisma/enums.js';
import { dbCall, prisma, type Db } from '../../db/prisma.js';
import { ValidationError } from '../../lib/errors.js';
import type { PendingQuery, PipelineStore, SourceListQuery, SourceWrite } from './pipeline.ports.js';
import type { CivicRow, PendingRow, RunRow, SourceRow } from './records.js';
import type { NormalisedRecord } from './types.js';

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
}): SourceRow {
  return { ...row, config: {} };
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
    patch: { status: 'SUCCEEDED' | 'FAILED'; sha?: string; added: number; changed: number; pending: number; error: string | null },
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
        },
      }),
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
        select: { id: true, fullName: true, party: true, website: true },
      }),
    );
    if (official) {
      return {
        matchKey,
        entityType: 'OFFICIAL',
        entityId: official.id,
        fields: { fullName: official.fullName, party: official.party, website: official.website, phone: null, email: null },
      };
    }
    const geoid = matchKey.startsWith('tiger:') ? matchKey.slice('tiger:'.length) : matchKey;
    const jurisdiction = await dbCall(() =>
      this.db.jurisdiction.findFirst({
        where: { geoid },
        select: { id: true, name: true, geoid: true, state: true, type: true, level: true },
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
      },
    };
  }

  async upsertCivic(sourceId: string, record: NormalisedRecord, now: Date): Promise<'added' | 'changed' | 'unchanged'> {
    const existing = await this.findCivic(record.matchKey);
    if (existing && sameFields(existing.fields, record.fields)) return 'unchanged';
    if (record.entityType === 'JURISDICTION') {
      await this.upsertJurisdiction(sourceId, record, now);
    } else if (record.entityType === 'OFFICIAL') {
      await this.upsertOfficial(sourceId, record, now);
    } else if (record.entityType === 'OFFICE') {
      await this.upsertOffice(sourceId, record, now);
    }
    return existing ? 'changed' : 'added';
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
    const geoid = record.fields.geoid ?? record.matchKey.slice(0, 40);
    const type = asType(record.fields.type ?? null);
    const existing = await dbCall(() => this.db.jurisdiction.findFirst({ where: { geoid, type } }));
    const data = {
      name: (record.fields.name ?? geoid).slice(0, 150),
      level: asLevel(record.fields.level ?? null),
      type,
      geoid,
      state: record.fields.state?.slice(0, 2) ?? null,
      sourceId,
      lastUpdatedAt: now,
    };
    if (existing) {
      await dbCall(() => this.db.jurisdiction.update({ where: { id: existing.id }, data }));
      return;
    }
    await dbCall(() => this.db.jurisdiction.create({ data }));
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

function sameFields(left: Record<string, string | null>, right: Record<string, string | null>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? null) !== (right[key] ?? null)) return false;
  }
  return true;
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

function officialPatch(field: string, value: string | null): { fullName?: string; party?: string | null; website?: string | null } {
  if (field === 'fullName' && value) return { fullName: value.slice(0, 120) };
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
