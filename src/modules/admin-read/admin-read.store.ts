import type { FreshnessForce } from '../civic/record-rules.js';
import type { ActivityAudience, ActivityEvent, ActivityKind } from './activity.js';

export interface SearchHit {
  id: string;
  label: string;
  displayId: string | null;
}

export interface SearchGroup {
  total: number;
  items: SearchHit[];
}

export interface AttentionCandidate {
  kind: 'CORRECTION' | 'RECORD' | 'SOURCE' | 'ALERT';
  id: string;
  label: string;
  since: Date;
  correctionStatus?: 'SUBMITTED' | 'IN_REVIEW';
  failedDeliveries?: number;
  sourceIssue?: 'FAILED' | 'OVERDUE';
}

export interface RecentEditRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  label: string;
  recordType: string;
  actorName: string | null;
  createdAt: Date;
}

export interface PilotRow {
  id: string;
  name: string;
  displayId: string;
  hasBoundary: boolean;
  officeCount: number;
  lastUpdatedAt: Date;
  outdatedAfterDays: number;
  override: FreshnessForce;
}

export interface DashboardRaw {
  pendingCorrections: number;
  oldestPendingAt: Date | null;
  outdatedRecords: number;
  sourceIssues: number;
  alertsNeedingAttention: number;
  officials: number;
  offices: number;
  jurisdictions: number;
  services: number;
  attention: AttentionCandidate[];
  recent: RecentEditRow[];
  pilots: PilotRow[];
}

export interface ActivityRow {
  id: string;
  kind: ActivityKind;
  audience: ActivityAudience;
  title: string;
  preview: string;
  entityType: string;
  entityId: string;
  createdAt: Date;
  unread: boolean;
}

export interface AdminReadStore {
  dashboard(now: Date): Promise<DashboardRaw>;
  search(pattern: string): Promise<Record<'offices' | 'officials' | 'jurisdictions' | 'services' | 'sources' | 'corrections', SearchGroup>>;
  record(event: ActivityEvent): Promise<void>;
  listActivity(input: {
    adminId: string;
    includeSuperAdmin: boolean;
    limit: number;
    cursor?: { createdAt: Date; id: string };
    now: Date;
  }): Promise<{ rows: ActivityRow[]; total: number }>;
  unreadCount(adminId: string, includeSuperAdmin: boolean, now: Date): Promise<number>;
  markRead(adminId: string, includeSuperAdmin: boolean, ids: string[] | 'all', now: Date): Promise<number>;
  deleteOlderThan(cutoff: Date): Promise<number>;
}
