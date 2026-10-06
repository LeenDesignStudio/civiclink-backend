import type { Clock } from '../../lib/clock.js';
import { systemClock } from '../../lib/clock.js';

const CORRECTION_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'APPLIED', 'DISMISSED'] as const;
const LEVELS = ['FEDERAL', 'STATE', 'COUNTY', 'MUNICIPAL', 'EDUCATION', 'SPECIAL'] as const;

export interface DashboardCounts {
  correctionsByStatus: { status: string; count: number }[];
  correctionsOlderThan5d: number;
  staleRecordsByLevel: { level: string; count: number }[];
  failedSourceRuns: number;
  pendingSourceChanges: number;
  alertsLast7d: number;
  alertFailures: number;
}

export interface DashboardRepo {
  correctionCounts(): Promise<{ status: string; count: number }[]>;
  correctionsOlderThan(since: Date): Promise<number>;
  staleByLevel(now: Date): Promise<{ level: string; count: number }[]>;
  failedSourceRuns(): Promise<number>;
  pendingSourceChanges(): Promise<number>;
  alertsSince(since: Date): Promise<number>;
  alertFailuresSince(since: Date): Promise<number>;
}

export class DashboardService {
  constructor(
    private readonly repo: DashboardRepo,
    private readonly clock: Clock = systemClock,
  ) {}

  async counts(): Promise<DashboardCounts> {
    const now = this.clock.now();
    const olderThan = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [corrections, old, stale, failedRuns, pending, alerts, failures] = await Promise.all([
      this.repo.correctionCounts(),
      this.repo.correctionsOlderThan(olderThan),
      this.repo.staleByLevel(now),
      this.repo.failedSourceRuns(),
      this.repo.pendingSourceChanges(),
      this.repo.alertsSince(week),
      this.repo.alertFailuresSince(week),
    ]);
    const byStatus = new Map(corrections.map((row) => [row.status, row.count]));
    const byLevel = new Map(stale.map((row) => [row.level, row.count]));
    return {
      correctionsByStatus: CORRECTION_STATUSES.map((status) => ({ status, count: byStatus.get(status) ?? 0 })),
      correctionsOlderThan5d: old,
      staleRecordsByLevel: LEVELS.map((level) => ({ level, count: byLevel.get(level) ?? 0 })),
      failedSourceRuns: failedRuns,
      pendingSourceChanges: pending,
      alertsLast7d: alerts,
      alertFailures: failures,
    };
  }
}
