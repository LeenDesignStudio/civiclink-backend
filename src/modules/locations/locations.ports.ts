import type { Confidence, LocationLabel, SavedLocationDto } from './locations.dto.js';

/**
 * Runs `fn` inside a transaction. Production wiring passes `withTx` from `src/db/prisma.ts`
 * with `isolation: 'Serializable'`, so concurrent limit checks cannot both succeed.
 * Unit tests inject a runner that holds a shared lock and executes overlapping calls one at a time.
 */
export type TxRunner = <T>(
  fn: (tx: unknown) => Promise<T>,
  options?: { isolation?: 'Serializable' | 'ReadCommitted' },
) => Promise<T>;

export type LookupMethod = 'ADDRESS' | 'ZIP' | 'CITY_STATE' | 'DEVICE';

export interface LookupRecord {
  token: string;
  method: LookupMethod;
  displayLabel: string;
  jurisdictionIds: string[];
  confidence: Confidence;
  expiresAt: Date | null;
  hasPoint: boolean;
  hasArea: boolean;
  geocodePrecision: string | null;
  createdAt: Date;
}

export interface LookupReader {
  findByToken(token: string): Promise<LookupRecord | null>;
}

export interface SavedLocationGeometry {
  copyPoint(savedLocationId: string, lookupToken: string, tx?: unknown): Promise<void>;
}

export interface NewSavedLocation {
  userId: string;
  label: LocationLabel;
  customName: string | null;
  displayAddress: string;
  normalizedAddress: string;
  geocodePrecision: string | null;
  isDefault: boolean;
  jurisdictionIds: string[];
  confidence: Confidence;
  resolvedAt: Date;
}

export interface SavedLocationPatch {
  label: LocationLabel;
  customName: string | null;
}

export interface LocationsRepo {
  listOwned(userId: string): Promise<SavedLocationDto[]>;
  findOwned(userId: string, id: string, tx?: unknown): Promise<SavedLocationDto | null>;
  findLabel(userId: string, label: 'HOME' | 'WORK', tx?: unknown): Promise<SavedLocationDto | null>;
  countOwned(userId: string, tx?: unknown): Promise<number>;
  clearDefault(userId: string, tx?: unknown): Promise<void>;
  insert(row: NewSavedLocation, tx?: unknown): Promise<SavedLocationDto>;
  updateOwned(userId: string, id: string, patch: SavedLocationPatch, tx?: unknown): Promise<SavedLocationDto | null>;
  markDefault(userId: string, id: string, tx?: unknown): Promise<SavedLocationDto | null>;
  deleteOwned(userId: string, id: string, tx?: unknown): Promise<boolean>;
  promoteNewest(userId: string, tx?: unknown): Promise<SavedLocationDto | null>;
}
