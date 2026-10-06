import type { ServiceContext } from '../graphql/context.js';
import { systemClock, type Clock } from '../lib/clock.js';

export interface PurgeCandidate {
  requestId: string;
  userId: string;
  purgedAt: Date | null;
}

export interface PurgeSnapshot {
  email: string;
  displayName: string;
  status: string;
  purgedAt: Date | null;
  savedLocations: number;
  follows: number;
  notifications: number;
  preferences: number;
  pushSubscriptions: number;
  sessions: number;
  identities: number;
  lookups: number;
  correctionUserId: string | null;
}

export interface RetentionStore {
  dueDeletions(now: Date): Promise<PurgeCandidate[]>;
  purgeUser(userId: string, requestId: string, now: Date): Promise<void>;
  snapshot(userId: string, requestId: string): Promise<PurgeSnapshot | null>;
  deleteExpiredLookups(now: Date): Promise<number>;
  deleteExpiredSessions(cutoff: Date): Promise<number>;
  deleteOldStripeEvents(cutoff: Date): Promise<number>;
}

export class RetentionService {
  constructor(
    private readonly store: RetentionStore,
    private readonly clock: Clock = systemClock,
  ) {}

  async purge(ctx: ServiceContext): Promise<{ purged: number }> {
    ctx.authz.require('system.retention:run');
    const due = await this.store.dueDeletions(this.clock.now());
    let purged = 0;
    for (const request of due) {
      if (request.purgedAt) continue;
      await this.store.purgeUser(request.userId, request.requestId, this.clock.now());
      purged += 1;
    }
    return { purged };
  }

  async lookups(ctx: ServiceContext): Promise<{ deleted: number }> {
    ctx.authz.require('system.retention:run');
    const deleted = await this.store.deleteExpiredLookups(this.clock.now());
    return { deleted };
  }

  async sessions(ctx: ServiceContext): Promise<{ deleted: number }> {
    ctx.authz.require('system.retention:run');
    const cutoff = new Date(this.clock.now().getTime() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await this.store.deleteExpiredSessions(cutoff);
    return { deleted };
  }

  async stripeEvents(ctx: ServiceContext): Promise<{ deleted: number }> {
    ctx.authz.require('system.retention:run');
    const cutoff = new Date(this.clock.now().getTime() - 90 * 24 * 60 * 60 * 1000);
    const deleted = await this.store.deleteOldStripeEvents(cutoff);
    return { deleted };
  }
}

export function deletedEmail(userId: string): string {
  return `deleted+${userId}@invalid`;
}

export const DELETED_DISPLAY_NAME = 'Deleted user';
