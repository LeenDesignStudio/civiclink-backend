import { dbCall, prisma, type Db } from '../../db/prisma.js';
import type { DashboardRepo as DashboardStore } from './dashboard.js';

export class DashboardRepo implements DashboardStore {
  constructor(private readonly db: Db = prisma) {}

  async correctionCounts(): Promise<{ status: string; count: number }[]> {
    const rows = await dbCall(() => this.db.correction.groupBy({ by: ['status'], _count: { _all: true } }));
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }

  async correctionsOlderThan(since: Date): Promise<number> {
    return dbCall(() =>
      this.db.correction.count({
        where: { status: { in: ['SUBMITTED', 'IN_REVIEW'] }, createdAt: { lt: since } },
      }),
    );
  }

  async staleByLevel(): Promise<{ level: string; count: number }[]> {
    const rows = await dbCall(() =>
      this.db.jurisdiction.groupBy({
        by: ['level'],
        where: { status: 'ACTIVE', freshnessOverride: 'FORCE_OUTDATED' },
        _count: { _all: true },
      }),
    );
    return rows.map((row) => ({ level: row.level, count: row._count._all }));
  }

  async failedSourceRuns(): Promise<number> {
    return dbCall(() => this.db.sourceRun.count({ where: { status: 'FAILED' } }));
  }

  async pendingSourceChanges(): Promise<number> {
    return dbCall(() => this.db.pendingSourceChange.count({ where: { decision: 'PENDING' } }));
  }

  async alertsSince(since: Date): Promise<number> {
    return dbCall(() => this.db.alert.count({ where: { createdAt: { gte: since } } }));
  }

  async alertFailuresSince(since: Date): Promise<number> {
    return dbCall(() =>
      this.db.notificationDelivery.count({
        where: { status: 'FAILED', createdAt: { gte: since }, notification: { type: 'ALERT' } },
      }),
    );
  }
}
