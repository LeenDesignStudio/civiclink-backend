import type {
  AdminCorrection,
  CivicEntityType,
  CorrectionField,
  CorrectionNoteDto,
  CorrectionStatus,
  DismissReason,
  GovLevel,
  ResidentCorrection,
} from './corrections.dto.js';

export type TxRunner = <T>(
  fn: (tx: unknown) => Promise<T>,
  options?: { isolation?: 'Serializable' | 'ReadCommitted' },
) => Promise<T>;

export interface ActiveEntity {
  entityType: CivicEntityType;
  entityId: string;
  level: GovLevel | null;
  currentValue: string | null;
}

export interface StoredCorrection {
  id: string;
  userId: string | null;
  entityType: CivicEntityType;
  entityId: string;
  field: CorrectionField;
  currentValueSnapshot: { value: string | null } | null;
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
  submitterDisplayName: string | null;
  level: GovLevel | null;
  createdAt: Date;
  updatedAt: Date;
  notes: CorrectionNoteDto[];
}

export interface NewCorrection {
  userId: string;
  entityType: CivicEntityType;
  entityId: string;
  field: CorrectionField;
  currentValueSnapshot: { value: string | null };
  proposedValue: string | null;
  details: string | null;
  evidenceUrl: string | null;
  lookupToken: string | null;
  submitterDisplayName: string | null;
  level: GovLevel | null;
  createdAt: Date;
}

export interface CorrectionPatch {
  status?: CorrectionStatus;
  assigneeId?: string | null;
  dismissReason?: DismissReason | null;
  dismissNote?: string | null;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  updatedAt: Date;
}

export interface ApplyTargetInput {
  entityType: CivicEntityType;
  entityId: string;
  field: CorrectionField;
  value: string | null;
  lastUpdatedAt: Date;
  sourceId?: string;
  sourceUrl?: string;
}

export interface AdminListQuery {
  status?: CorrectionStatus;
  level?: GovLevel;
  entityType?: CivicEntityType;
  olderThan?: Date;
  assigneeId?: string;
  limit: number;
  after?: { createdAt: Date; id: string };
}

export interface CorrectionsRepo {
  findActiveEntity(
    entityType: CivicEntityType,
    entityId: string,
    field: CorrectionField,
  ): Promise<ActiveEntity | null>;
  findOpen(
    userId: string,
    entityType: CivicEntityType,
    entityId: string,
    field: CorrectionField,
    tx?: unknown,
  ): Promise<StoredCorrection | null>;
  countSince(userId: string, since: Date, tx?: unknown): Promise<number>;
  insert(row: NewCorrection, tx?: unknown): Promise<StoredCorrection>;
  listOwned(userId: string, page: { limit: number; after?: { createdAt: Date; id: string } }): Promise<StoredCorrection[]>;
  countOwned(userId: string): Promise<number>;
  listAdmin(query: AdminListQuery): Promise<StoredCorrection[]>;
  countAdmin(query: Omit<AdminListQuery, 'limit' | 'after'>): Promise<number>;
  findById(id: string, tx?: unknown): Promise<StoredCorrection | null>;
  update(id: string, patch: CorrectionPatch, tx?: unknown): Promise<StoredCorrection | null>;
  applyTarget(input: ApplyTargetInput, tx?: unknown): Promise<{ before: string | null }>;
  addNote(correctionId: string, adminId: string, body: string, createdAt: Date, tx?: unknown): Promise<CorrectionNoteDto>;
  assigneeCanResolve(adminId: string): Promise<boolean>;
  submitterDisplayName(userId: string): Promise<string | null>;
}

export interface AuditEntry {
  actorType: 'RESIDENT' | 'ADMIN' | 'SYSTEM' | 'SOURCE';
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  requestId: string | null;
}

export interface AuditRecorder {
  record(entry: AuditEntry, tx?: unknown): Promise<void>;
}

export interface CorrectionQueue {
  enqueue(name: string, payload: { entityType: string; entityId: string; kind: 'RECORD_UPDATE' }): Promise<void>;
}

export function toResident(row: StoredCorrection): ResidentCorrection {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    field: row.field,
    proposedValue: row.proposedValue,
    details: row.details,
    evidenceUrl: row.evidenceUrl,
    status: row.status,
    dismissReason: row.dismissReason,
    dismissNote: row.dismissNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toAdmin(row: StoredCorrection): AdminCorrection {
  return {
    ...toResident(row),
    currentValueSnapshot: row.currentValueSnapshot,
    assigneeId: row.assigneeId,
    submitterDisplayName: row.submitterDisplayName,
    lookupToken: row.lookupToken,
    resolvedAt: row.resolvedAt,
    notes: row.notes.map((note) => ({
      id: note.id,
      adminId: note.adminId,
      body: note.body,
      createdAt: note.createdAt,
    })),
  };
}
