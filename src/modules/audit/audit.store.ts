import type { Tx } from '../../auth/tx.js';
import type { ChangeLogDto, ChangeLogEntry } from './audit.dto.js';

export interface ChangeLogListQuery {
  entityType: string;
  entityId: string;
  limit: number;
  cursor?: { createdAt: Date; id: string };
}

export interface AuditStore {
  insert(tx: Tx, entry: ChangeLogEntry): Promise<void>;
  list(query: ChangeLogListQuery): Promise<{ rows: ChangeLogDto[]; total: number }>;
}
