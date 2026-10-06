import type { Tx } from '../../auth/tx.js';
import type { CivicEntityType } from '../../generated/prisma/enums.js';
import type { CivicRow, PendingRow, RunRow, SourceRow } from './records.js';
import type { NormalisedRecord } from './types.js';

export interface SourceListQuery {
  limit: number;
  after?: { createdAt: Date; id: string };
}

export interface PendingQuery {
  sourceId?: string;
  decision?: PendingRow['decision'];
  limit: number;
}

export interface SourceWrite {
  id?: string;
  name: string;
  publisher: string;
  url: string;
  termsUrl: string;
  method: SourceRow['method'];
  schedule: SourceRow['schedule'];
  freshnessDays: number;
  levels: SourceRow['levels'];
  collectorKey: string | null;
  active: boolean;
  config: SourceRow['config'];
}

export interface PipelineStore {
  listSources(query: SourceListQuery): Promise<{ rows: SourceRow[]; total: number }>;
  findSource(id: string): Promise<SourceRow | null>;
  nameTaken(name: string, excludeId?: string): Promise<boolean>;
  saveSource(input: SourceWrite, now: Date): Promise<SourceRow>;
  activeRun(sourceId: string): Promise<RunRow | null>;
  createRun(sourceId: string, triggeredBy: string | null, now: Date): Promise<RunRow>;
  markRunning(runId: string, now: Date): Promise<RunRow | null>;
  finishRun(
    runId: string,
    patch: { status: 'SUCCEEDED' | 'FAILED'; sha?: string; added: number; changed: number; pending: number; error: string | null },
    now: Date,
  ): Promise<void>;
  lastSucceededSha(sourceId: string): Promise<string | null>;
  listRuns(sourceId: string, limit: number): Promise<RunRow[]>;
  findCivic(matchKey: string): Promise<CivicRow | null>;
  upsertCivic(sourceId: string, record: NormalisedRecord, now: Date): Promise<'added' | 'changed' | 'unchanged'>;
  addPending(input: {
    sourceRunId: string;
    entityType: CivicEntityType;
    entityId: string | null;
    field: string;
    oldValue: string | null;
    newValue: string;
    now: Date;
  }): Promise<void>;
  listPending(query: PendingQuery): Promise<PendingRow[]>;
  findPending(id: string): Promise<PendingRow | null>;
  decidePending(id: string, decision: 'ACCEPTED' | 'REJECTED', adminId: string, now: Date): Promise<boolean>;
  applyField(entityType: CivicEntityType, entityId: string, field: string, value: string | null): Promise<void>;
  reresolveLocations(now: Date): Promise<number>;
  servicesWithUrls(): Promise<{ id: string; url: string }[]>;
  setLinkBroken(id: string, broken: boolean, now: Date): Promise<void>;
  touchSource(sourceId: string, now: Date): Promise<void>;
}

export type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
