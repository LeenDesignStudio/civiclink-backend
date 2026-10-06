import { Prisma } from '../../generated/prisma/client.js';
import { dbCall, type Db } from '../../db/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import type {
  CivicEntityType,
  CorrectionField,
  CorrectionNoteDto,
  CorrectionStatus,
  DismissReason,
  GovLevel,
} from './corrections.dto.js';
import type {
  ActiveEntity,
  AdminListQuery,
  ApplyTargetInput,
  AuditEntry,
  AuditRecorder,
  CorrectionPatch,
  CorrectionsRepo as CorrectionsStore,
  NewCorrection,
  StoredCorrection,
} from './corrections.ports.js';

function bind(db: Db, tx: unknown): Db {
  if (typeof tx === 'object' && tx !== null && '$queryRaw' in tx) return tx as Db;
  return db;
}

type NoteRow = { id: string; adminId: string; body: string; createdAt: Date };

type CorrectionRow = {
  id: string;
  userId: string | null;
  entityType: CivicEntityType;
  entityId: string;
  field: CorrectionField;
  currentValueSnapshot: unknown;
  proposedValue: string | null;
  details: string | null;
  evidenceUrl: string | null;
  lookupToken: string | null;
  status: CorrectionStatus;
  assigneeId: string | null;
  dismissReason: DismissReason | null;
  dismissNote: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  notes?: NoteRow[];
  user?: { displayName: string } | null;
};

function snapshotOf(value: unknown): { value: string | null } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('value' in value)) return null;
  const inner = (value as { value?: unknown }).value;
  if (inner === null) return { value: null };
  return typeof inner === 'string' ? { value: inner } : null;
}

function toStored(row: CorrectionRow, level: GovLevel | null): StoredCorrection {
  return {
    id: row.id,
    userId: row.userId,
    entityType: row.entityType,
    entityId: row.entityId,
    field: row.field,
    currentValueSnapshot: snapshotOf(row.currentValueSnapshot),
    proposedValue: row.proposedValue,
    details: row.details,
    evidenceUrl: row.evidenceUrl,
    lookupToken: row.lookupToken,
    status: row.status,
    assigneeId: row.assigneeId,
    dismissReason: row.dismissReason,
    dismissNote: row.dismissNote,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
    submitterDisplayName: row.user?.displayName ?? null,
    level,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    notes: (row.notes ?? []).map((note) => ({
      id: note.id,
      adminId: note.adminId,
      body: note.body,
      createdAt: note.createdAt,
    })),
  };
}

const detailInclude = {
  notes: { orderBy: { createdAt: 'asc' as const } },
  user: { select: { displayName: true } },
};

export class CorrectionsRepo implements CorrectionsStore {
  constructor(private readonly db: Db) {}

  async findActiveEntity(
    entityType: CivicEntityType,
    entityId: string,
    field: CorrectionField,
  ): Promise<ActiveEntity | null> {
    if (entityType === 'OFFICE') {
      const row = await dbCall(() =>
        this.db.office.findFirst({
          where: { id: entityId, status: 'ACTIVE' },
          select: {
            phone: true,
            email: true,
            website: true,
            name: true,
            jurisdiction: { select: { level: true } },
            addresses: { orderBy: { sortOrder: 'asc' }, take: 1, select: { street: true } },
          },
        }),
      );
      if (!row) return null;
      const current =
        field === 'PHONE'
          ? row.phone
          : field === 'EMAIL'
            ? row.email
            : field === 'WEBSITE'
              ? row.website
              : field === 'TITLE'
                ? row.name
                : field === 'OFFICE_ADDRESS'
                  ? (row.addresses[0]?.street ?? null)
                  : null;
      return { entityType, entityId, level: row.jurisdiction.level, currentValue: current };
    }
    if (entityType === 'OFFICIAL') {
      const row = await dbCall(() =>
        this.db.official.findFirst({
          where: { id: entityId, status: 'ACTIVE' },
          select: { fullName: true, displayName: true, party: true, website: true },
        }),
      );
      if (!row) return null;
      const current =
        field === 'OFFICEHOLDER_NAME'
          ? row.fullName
          : field === 'TITLE'
            ? row.displayName
            : field === 'PARTY'
              ? row.party
              : field === 'WEBSITE'
                ? row.website
                : null;
      return { entityType, entityId, level: await this.levelFor(entityType, entityId), currentValue: current };
    }
    if (entityType === 'SERVICE') {
      const row = await dbCall(() =>
        this.db.service.findFirst({
          where: { id: entityId, status: 'ACTIVE' },
          select: { description: true, phoneContact: true, url: true },
        }),
      );
      if (!row) return null;
      const current =
        field === 'SERVICE_DETAILS'
          ? row.description
          : field === 'PHONE'
            ? row.phoneContact
            : field === 'WEBSITE'
              ? row.url
              : null;
      return { entityType, entityId, level: await this.levelFor(entityType, entityId), currentValue: current };
    }
    const row = await dbCall(() =>
      this.db.jurisdiction.findFirst({
        where: { id: entityId, status: 'ACTIVE' },
        select: { level: true, districtCode: true },
      }),
    );
    if (!row) return null;
    return {
      entityType,
      entityId,
      level: row.level,
      currentValue: field === 'DISTRICT' ? row.districtCode : null,
    };
  }

  async findOpen(
    userId: string,
    entityType: CivicEntityType,
    entityId: string,
    field: CorrectionField,
    tx?: unknown,
  ): Promise<StoredCorrection | null> {
    const row = await dbCall(() =>
      bind(this.db, tx).correction.findFirst({
        where: { userId, entityType, entityId, field, status: { in: ['SUBMITTED', 'IN_REVIEW'] } },
        include: detailInclude,
      }),
    );
    if (!row) return null;
    return toStored(row, await this.levelFor(row.entityType, row.entityId));
  }

  async countSince(userId: string, since: Date, tx?: unknown): Promise<number> {
    return dbCall(() =>
      bind(this.db, tx).correction.count({ where: { userId, createdAt: { gte: since } } }),
    );
  }

  async insert(row: NewCorrection, tx?: unknown): Promise<StoredCorrection> {
    const created = await dbCall(() =>
      bind(this.db, tx).correction.create({
        data: {
          userId: row.userId,
          entityType: row.entityType,
          entityId: row.entityId,
          field: row.field,
          currentValueSnapshot: row.currentValueSnapshot,
          proposedValue: row.proposedValue,
          details: row.details,
          evidenceUrl: row.evidenceUrl,
          lookupToken: row.lookupToken,
          status: 'SUBMITTED',
          createdAt: row.createdAt,
        },
        include: detailInclude,
      }),
    );
    return toStored(created, row.level);
  }

  async listOwned(
    userId: string,
    page: { limit: number; after?: { createdAt: Date; id: string } },
  ): Promise<StoredCorrection[]> {
    const rows = await dbCall(() =>
      this.db.correction.findMany({
        where: {
          userId,
          ...(page.after
            ? {
                OR: [
                  { createdAt: { lt: page.after.createdAt } },
                  { createdAt: page.after.createdAt, id: { lt: page.after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: page.limit,
        include: { user: { select: { displayName: true } } },
      }),
    );
    return Promise.all(rows.map(async (row) => toStored(row, await this.levelFor(row.entityType, row.entityId))));
  }

  countOwned(userId: string): Promise<number> {
    return dbCall(() => this.db.correction.count({ where: { userId } }));
  }

  async listAdmin(query: AdminListQuery): Promise<StoredCorrection[]> {
    const rows = await dbCall(() =>
      this.db.correction.findMany({
        where: adminWhere(query),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: query.level ? Math.min(query.limit * 5, 200) : query.limit,
        include: detailInclude,
      }),
    );
    const mapped = await Promise.all(
      rows.map(async (row) => toStored(row, await this.levelFor(row.entityType, row.entityId))),
    );
    const filtered = query.level ? mapped.filter((row) => row.level === query.level) : mapped;
    return filtered.slice(0, query.limit);
  }

  async countAdmin(query: Omit<AdminListQuery, 'limit' | 'after'>): Promise<number> {
    if (!query.level) return dbCall(() => this.db.correction.count({ where: adminWhere(query) }));
    const rows = await dbCall(() =>
      this.db.correction.findMany({
        where: adminWhere(query),
        select: { entityType: true, entityId: true },
      }),
    );
    const levels = await Promise.all(rows.map((row) => this.levelFor(row.entityType, row.entityId)));
    return levels.filter((level) => level === query.level).length;
  }

  async findById(id: string, tx?: unknown): Promise<StoredCorrection | null> {
    const row = await dbCall(() => bind(this.db, tx).correction.findUnique({ where: { id }, include: detailInclude }));
    if (!row) return null;
    return toStored(row, await this.levelFor(row.entityType, row.entityId));
  }

  async update(id: string, patch: CorrectionPatch, tx?: unknown): Promise<StoredCorrection | null> {
    const db = bind(this.db, tx);
    const existing = await dbCall(() => db.correction.findUnique({ where: { id }, select: { id: true } }));
    if (!existing) return null;
    const updated = await dbCall(() =>
      db.correction.update({
        where: { id },
        data: {
          updatedAt: patch.updatedAt,
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.assigneeId !== undefined ? { assigneeId: patch.assigneeId } : {}),
          ...(patch.dismissReason !== undefined ? { dismissReason: patch.dismissReason } : {}),
          ...(patch.dismissNote !== undefined ? { dismissNote: patch.dismissNote } : {}),
          ...(patch.resolvedAt !== undefined ? { resolvedAt: patch.resolvedAt } : {}),
          ...(patch.resolvedBy !== undefined ? { resolvedBy: patch.resolvedBy } : {}),
        },
        include: detailInclude,
      }),
    );
    return toStored(updated, await this.levelFor(updated.entityType, updated.entityId));
  }

  async applyTarget(input: ApplyTargetInput, tx?: unknown): Promise<{ before: string | null }> {
    const db = bind(this.db, tx);
    if (input.entityType === 'OFFICE') return this.applyOffice(db, input);
    if (input.entityType === 'OFFICIAL') return this.applyOfficial(db, input);
    if (input.entityType === 'SERVICE') return this.applyService(db, input);
    return this.applyJurisdiction(db, input);
  }

  async addNote(
    correctionId: string,
    adminId: string,
    body: string,
    createdAt: Date,
    tx?: unknown,
  ): Promise<CorrectionNoteDto> {
    return dbCall(() =>
      bind(this.db, tx).correctionNote.create({
        data: { correctionId, adminId, body, createdAt },
        select: { id: true, adminId: true, body: true, createdAt: true },
      }),
    );
  }

  async assigneeCanResolve(adminId: string): Promise<boolean> {
    const admin = await dbCall(() =>
      this.db.adminUser.findFirst({
        where: { id: adminId, status: 'ACTIVE' },
        select: { role: true },
      }),
    );
    return admin?.role === 'EDITOR' || admin?.role === 'SUPER_ADMIN';
  }

  async submitterDisplayName(userId: string): Promise<string | null> {
    const user = await dbCall(() => this.db.user.findUnique({ where: { id: userId }, select: { displayName: true } }));
    return user?.displayName ?? null;
  }

  private async applyOffice(db: Db, input: ApplyTargetInput): Promise<{ before: string | null }> {
    const row = await dbCall(() =>
      db.office.findUnique({
        where: { id: input.entityId },
        select: {
          phone: true,
          email: true,
          website: true,
          name: true,
          sourceId: true,
          addresses: { orderBy: { sortOrder: 'asc' }, take: 1, select: { id: true, street: true } },
        },
      }),
    );
    if (!row) throw new NotFoundError();
    let before: string | null = null;
    const data: {
      lastUpdatedAt: Date;
      phone?: string;
      email?: string;
      website?: string;
      name?: string;
      sourceId?: string;
      sourceRecordUrl?: string;
    } = { lastUpdatedAt: input.lastUpdatedAt };
    if (input.field === 'PHONE') {
      before = row.phone;
      if (input.value) data.phone = input.value;
    } else if (input.field === 'EMAIL') {
      before = row.email;
      if (input.value) data.email = input.value;
    } else if (input.field === 'WEBSITE') {
      before = row.website;
      if (input.value) data.website = input.value;
    } else if (input.field === 'TITLE') {
      before = row.name;
      if (input.value) data.name = input.value;
    } else if (input.field === 'OFFICE_ADDRESS') {
      before = row.addresses[0]?.street ?? null;
      const address = row.addresses[0];
      if (address && input.value) {
        await dbCall(() => db.officeAddress.update({ where: { id: address.id }, data: { street: input.value ?? address.street } }));
      }
    }
    if (input.sourceId) data.sourceId = input.sourceId;
    if (input.sourceUrl) data.sourceRecordUrl = input.sourceUrl;
    await dbCall(() => db.office.update({ where: { id: input.entityId }, data }));
    return { before };
  }

  private async applyOfficial(db: Db, input: ApplyTargetInput): Promise<{ before: string | null }> {
    const row = await dbCall(() =>
      db.official.findUnique({
        where: { id: input.entityId },
        select: { fullName: true, displayName: true, party: true, website: true },
      }),
    );
    if (!row) throw new NotFoundError();
    let before: string | null = null;
    const data: {
      lastUpdatedAt: Date;
      fullName?: string;
      displayName?: string;
      party?: string;
      website?: string;
      sourceId?: string;
      sourceRecordUrl?: string;
    } = { lastUpdatedAt: input.lastUpdatedAt };
    if (input.field === 'OFFICEHOLDER_NAME' && input.value) {
      before = row.fullName;
      data.fullName = input.value;
    } else if (input.field === 'TITLE') {
      before = row.displayName;
      if (input.value) data.displayName = input.value;
    } else if (input.field === 'PARTY') {
      before = row.party;
      if (input.value) data.party = input.value;
    } else if (input.field === 'WEBSITE') {
      before = row.website;
      if (input.value) data.website = input.value;
    }
    if (input.sourceId) data.sourceId = input.sourceId;
    if (input.sourceUrl) data.sourceRecordUrl = input.sourceUrl;
    await dbCall(() => db.official.update({ where: { id: input.entityId }, data }));
    return { before };
  }

  private async applyService(db: Db, input: ApplyTargetInput): Promise<{ before: string | null }> {
    const row = await dbCall(() =>
      db.service.findUnique({
        where: { id: input.entityId },
        select: { description: true, phoneContact: true, url: true },
      }),
    );
    if (!row) throw new NotFoundError();
    let before: string | null = null;
    const data: {
      lastValidatedAt: Date;
      description?: string;
      phoneContact?: string;
      url?: string;
      sourceId?: string;
    } = { lastValidatedAt: input.lastUpdatedAt };
    if (input.field === 'SERVICE_DETAILS' && input.value) {
      before = row.description;
      data.description = input.value;
    } else if (input.field === 'PHONE') {
      before = row.phoneContact;
      if (input.value) data.phoneContact = input.value;
    } else if (input.field === 'WEBSITE') {
      before = row.url;
      if (input.value) data.url = input.value;
    }
    if (input.sourceId) data.sourceId = input.sourceId;
    await dbCall(() => db.service.update({ where: { id: input.entityId }, data }));
    return { before };
  }

  private async applyJurisdiction(db: Db, input: ApplyTargetInput): Promise<{ before: string | null }> {
    const row = await dbCall(() =>
      db.jurisdiction.findUnique({ where: { id: input.entityId }, select: { districtCode: true } }),
    );
    if (!row) throw new NotFoundError();
    const data: {
      lastUpdatedAt: Date;
      districtCode?: string;
      sourceId?: string;
      sourceRecordUrl?: string;
    } = { lastUpdatedAt: input.lastUpdatedAt };
    if (input.field === 'DISTRICT' && input.value) data.districtCode = input.value;
    if (input.sourceId) data.sourceId = input.sourceId;
    if (input.sourceUrl) data.sourceRecordUrl = input.sourceUrl;
    await dbCall(() => db.jurisdiction.update({ where: { id: input.entityId }, data }));
    return { before: row.districtCode };
  }

  private async levelFor(entityType: CivicEntityType, entityId: string): Promise<GovLevel | null> {
    if (entityType === 'JURISDICTION') {
      const row = await dbCall(() => this.db.jurisdiction.findUnique({ where: { id: entityId }, select: { level: true } }));
      return row?.level ?? null;
    }
    if (entityType === 'OFFICE') {
      const row = await dbCall(() =>
        this.db.office.findUnique({ where: { id: entityId }, select: { jurisdiction: { select: { level: true } } } }),
      );
      return row?.jurisdiction.level ?? null;
    }
    if (entityType === 'OFFICIAL') {
      const term = await dbCall(() =>
        this.db.officeTerm.findFirst({
          where: { officialId: entityId },
          orderBy: { isCurrent: 'desc' },
          select: { office: { select: { jurisdiction: { select: { level: true } } } } },
        }),
      );
      return term?.office.jurisdiction.level ?? null;
    }
    const link = await dbCall(() =>
      this.db.serviceLink.findFirst({
        where: { serviceId: entityId },
        select: {
          jurisdiction: { select: { level: true } },
          office: { select: { jurisdiction: { select: { level: true } } } },
        },
      }),
    );
    return link?.jurisdiction?.level ?? link?.office?.jurisdiction.level ?? null;
  }
}

function adminWhere(query: Omit<AdminListQuery, 'limit'>): {
  status?: CorrectionStatus;
  entityType?: CivicEntityType;
  assigneeId?: string;
  createdAt?: { lt: Date } | { gt: Date } | { lt: Date; gt?: Date };
  OR?: ({ createdAt: { gt: Date } } | { createdAt: Date; id: { gt: string } })[];
} {
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(query.olderThan ? { createdAt: { lt: query.olderThan } } : {}),
    ...(query.after
      ? {
          OR: [
            { createdAt: { gt: query.after.createdAt } },
            { createdAt: query.after.createdAt, id: { gt: query.after.id } },
          ],
        }
      : {}),
  };
}

export class PrismaAuditRecorder implements AuditRecorder {
  constructor(private readonly db: Db) {}

  async record(entry: AuditEntry, tx?: unknown): Promise<void> {
    await dbCall(() =>
      bind(this.db, tx).changeLog.create({
        data: {
          actorType: entry.actorType,
          actorId: entry.actorId,
          entityType: entry.entityType,
          entityId: entry.entityId,
          action: entry.action,
          before: entry.before === null ? Prisma.JsonNull : (entry.before as Prisma.InputJsonValue),
          after: entry.after === null ? Prisma.JsonNull : (entry.after as Prisma.InputJsonValue),
          requestId: entry.requestId,
        },
      }),
    );
  }
}
