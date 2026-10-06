import { dbCall, type Db } from '../../db/prisma.js';
import type { Confidence, LocationLabel, SavedLocationDto } from './locations.dto.js';
import type {
  LocationsRepo as LocationsStore,
  LookupReader,
  LookupRecord,
  NewSavedLocation,
  SavedLocationGeometry,
  SavedLocationPatch,
} from './locations.ports.js';

function bind(db: Db, tx: unknown): Db {
  if (typeof tx === 'object' && tx !== null && '$queryRaw' in tx) return tx as Db;
  return db;
}

type LocationRow = {
  id: string;
  label: LocationLabel;
  customName: string | null;
  displayAddress: string;
  normalizedAddress: string;
  geocodePrecision: string | null;
  isDefault: boolean;
  jurisdictionIds: string[];
  confidence: Confidence;
  resolvedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

const locationSelect = {
  id: true,
  label: true,
  customName: true,
  displayAddress: true,
  normalizedAddress: true,
  geocodePrecision: true,
  isDefault: true,
  jurisdictionIds: true,
  confidence: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toDto(row: LocationRow): SavedLocationDto {
  return {
    id: row.id,
    label: row.label,
    customName: row.customName,
    displayAddress: row.displayAddress,
    normalizedAddress: row.normalizedAddress,
    geocodePrecision: row.geocodePrecision,
    isDefault: row.isDefault,
    jurisdictionIds: row.jurisdictionIds,
    confidence: row.confidence,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class LocationsRepo implements LocationsStore {
  constructor(private readonly db: Db) {}

  async listOwned(userId: string): Promise<SavedLocationDto[]> {
    const rows = await dbCall(() =>
      this.db.savedLocation.findMany({
        where: { userId },
        select: locationSelect,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      }),
    );
    return rows.map(toDto);
  }

  async findOwned(userId: string, id: string, tx?: unknown): Promise<SavedLocationDto | null> {
    const row = await dbCall(() =>
      bind(this.db, tx).savedLocation.findFirst({ where: { id, userId }, select: locationSelect }),
    );
    return row ? toDto(row) : null;
  }

  async findLabel(userId: string, label: 'HOME' | 'WORK', tx?: unknown): Promise<SavedLocationDto | null> {
    const row = await dbCall(() =>
      bind(this.db, tx).savedLocation.findFirst({ where: { userId, label }, select: locationSelect }),
    );
    return row ? toDto(row) : null;
  }

  async countOwned(userId: string, tx?: unknown): Promise<number> {
    return dbCall(() => bind(this.db, tx).savedLocation.count({ where: { userId } }));
  }

  async clearDefault(userId: string, tx?: unknown): Promise<void> {
    await dbCall(() =>
      bind(this.db, tx).savedLocation.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
    );
  }

  async insert(row: NewSavedLocation, tx?: unknown): Promise<SavedLocationDto> {
    const created = await dbCall(() =>
      bind(this.db, tx).savedLocation.create({
        data: {
          userId: row.userId,
          label: row.label,
          customName: row.customName,
          displayAddress: row.displayAddress,
          normalizedAddress: row.normalizedAddress,
          geocodePrecision: row.geocodePrecision,
          isDefault: row.isDefault,
          jurisdictionIds: row.jurisdictionIds,
          confidence: row.confidence,
          resolvedAt: row.resolvedAt,
        },
        select: locationSelect,
      }),
    );
    return toDto(created);
  }

  async updateOwned(
    userId: string,
    id: string,
    patch: SavedLocationPatch,
    tx?: unknown,
  ): Promise<SavedLocationDto | null> {
    const db = bind(this.db, tx);
    const existing = await dbCall(() => db.savedLocation.findFirst({ where: { id, userId }, select: { id: true } }));
    if (!existing) return null;
    const updated = await dbCall(() =>
      db.savedLocation.update({
        where: { id },
        data: { label: patch.label, customName: patch.customName },
        select: locationSelect,
      }),
    );
    return toDto(updated);
  }

  async markDefault(userId: string, id: string, tx?: unknown): Promise<SavedLocationDto | null> {
    const db = bind(this.db, tx);
    const existing = await dbCall(() => db.savedLocation.findFirst({ where: { id, userId }, select: { id: true } }));
    if (!existing) return null;
    const updated = await dbCall(() =>
      db.savedLocation.update({ where: { id }, data: { isDefault: true }, select: locationSelect }),
    );
    return toDto(updated);
  }

  async deleteOwned(userId: string, id: string, tx?: unknown): Promise<boolean> {
    const result = await dbCall(() => bind(this.db, tx).savedLocation.deleteMany({ where: { id, userId } }));
    return result.count > 0;
  }

  async promoteNewest(userId: string, tx?: unknown): Promise<SavedLocationDto | null> {
    const db = bind(this.db, tx);
    const newest = await dbCall(() =>
      db.savedLocation.findFirst({
        where: { userId },
        select: locationSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    if (!newest) return null;
    const updated = await dbCall(() =>
      db.savedLocation.update({ where: { id: newest.id }, data: { isDefault: true }, select: locationSelect }),
    );
    return toDto(updated);
  }
}

export class PrismaLookupReader implements LookupReader {
  constructor(private readonly db: Db) {}

  async findByToken(token: string): Promise<LookupRecord | null> {
    const row = await dbCall(() =>
      this.db.lookup.findUnique({
        where: { token },
        select: {
          token: true,
          method: true,
          displayLabel: true,
          jurisdictionIds: true,
          confidence: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
    );
    if (!row) return null;
    const flags = await dbCall(() =>
      this.db.$queryRaw<{ has_point: boolean; has_area: boolean }[]>`
        SELECT
          (geom IS NOT NULL AND ST_GeometryType(geom) = 'ST_Point') AS has_point,
          (geom IS NOT NULL AND ST_GeometryType(geom) <> 'ST_Point') AS has_area
        FROM lookups
        WHERE token = ${token}
      `,
    );
    const flag = flags[0];
    return {
      token: row.token,
      method: row.method,
      displayLabel: row.displayLabel,
      jurisdictionIds: row.jurisdictionIds,
      confidence: row.confidence,
      expiresAt: row.expiresAt,
      hasPoint: flag?.has_point ?? false,
      hasArea: flag?.has_area ?? false,
      geocodePrecision: null,
      createdAt: row.createdAt,
    };
  }
}

export class PrismaSavedLocationGeometry implements SavedLocationGeometry {
  constructor(private readonly db: Db) {}

  async copyPoint(savedLocationId: string, lookupToken: string, tx?: unknown): Promise<void> {
    const db = bind(this.db, tx);
    await dbCall(() =>
      db.$executeRaw`
        UPDATE saved_locations AS sl
        SET point = l.geom
        FROM lookups AS l
        WHERE sl.id = ${savedLocationId}::uuid
          AND l.token = ${lookupToken}
          AND l.geom IS NOT NULL
          AND ST_GeometryType(l.geom) = 'ST_Point'
      `,
    );
  }
}
