import type { CivicEntityType } from '../../generated/prisma/enums.js';
import type { SourceConfig } from './types.js';

export interface CivicRow {
  matchKey: string;
  entityType: CivicEntityType;
  entityId: string;
  fields: Record<string, string | null>;
}

export interface PendingRow {
  id: string;
  sourceRunId: string;
  entityType: CivicEntityType;
  entityId: string | null;
  field: string;
  oldValue: string | null;
  newValue: string;
  decision: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  createdAt: Date;
}

export interface RunRow {
  id: string;
  sourceId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  triggeredBy: string | null;
  snapshotSha: string | null;
  added: number;
  changed: number;
  retired: number;
  pending: number;
  error: string | null;
  createdAt: Date;
}

export interface SourceRow {
  id: string;
  name: string;
  publisher: string;
  url: string;
  termsUrl: string;
  method: 'API' | 'BULK' | 'PAGE_COLLECTION' | 'MANUAL';
  schedule: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ON_DEMAND';
  freshnessDays: number;
  levels: string[];
  collectorKey: string | null;
  active: boolean;
  lastRunAt: Date | null;
  config: SourceConfig;
  createdAt: Date;
}
