import type { ActorType } from '../../generated/prisma/enums.js';
import type { Connection } from '../../lib/pagination.js';

export type AuditJson = Record<string, unknown>;

export interface ChangeLogEntry {
  actorType: ActorType;
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: AuditJson | null;
  after: AuditJson | null;
  requestId: string | null;
}

export interface ChangeLogDto {
  id: string;
  actorType: ActorType;
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: AuditJson | null;
  after: AuditJson | null;
  requestId: string | null;
  createdAt: Date;
}

export interface ChangeLogPage extends Connection<ChangeLogDto> {
  totalCount: number;
}
