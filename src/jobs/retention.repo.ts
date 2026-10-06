import { dbCall, prisma, type Db } from '../db/prisma.js';
import { deletedEmail, DELETED_DISPLAY_NAME, type PurgeCandidate, type RetentionStore } from './retention.js';

export class RetentionRepo implements RetentionStore {
  constructor(private readonly db: Db = prisma) {}

  async dueDeletions(now: Date): Promise<PurgeCandidate[]> {
    const rows = await dbCall(() =>
      this.db.deletionRequest.findMany({
        where: { purgeAfter: { lte: now }, restoredAt: null, purgedAt: null },
        select: { id: true, userId: true, purgedAt: true },
      }),
    );
    return rows.map((row) => ({ requestId: row.id, userId: row.userId, purgedAt: row.purgedAt }));
  }

  async purgeUser(userId: string, requestId: string, now: Date): Promise<void> {
    const request = await dbCall(() => this.db.deletionRequest.findUnique({ where: { id: requestId } }));
    if (!request || request.purgedAt) return;
    await dbCall(() =>
      this.db.$transaction(async (tx) => {
        const current = await tx.deletionRequest.findUnique({ where: { id: requestId } });
        if (!current || current.purgedAt) return;
        await tx.savedLocation.deleteMany({ where: { userId } });
        await tx.follow.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.notificationPreference.deleteMany({ where: { userId } });
        await tx.pushSubscription.deleteMany({ where: { userId } });
        await tx.userSession.deleteMany({ where: { userId } });
        await tx.authIdentity.deleteMany({ where: { userId } });
        await tx.lookup.deleteMany({ where: { userId } });
        await tx.correction.updateMany({ where: { userId }, data: { userId: null } });
        await tx.user.update({
          where: { id: userId },
          data: {
            email: deletedEmail(userId),
            displayName: DELETED_DISPLAY_NAME,
            status: 'DELETED',
          },
        });
        await tx.deletionRequest.update({ where: { id: requestId }, data: { purgedAt: now } });
      }),
    );
  }

  async snapshot(userId: string, requestId: string) {
    const user = await dbCall(() => this.db.user.findUnique({ where: { id: userId } }));
    const request = await dbCall(() => this.db.deletionRequest.findUnique({ where: { id: requestId } }));
    if (!user || !request) return null;
    const [savedLocations, follows, notifications, preferences, pushSubscriptions, sessions, identities, lookups, correction] =
      await Promise.all([
        this.db.savedLocation.count({ where: { userId } }),
        this.db.follow.count({ where: { userId } }),
        this.db.notification.count({ where: { userId } }),
        this.db.notificationPreference.count({ where: { userId } }),
        this.db.pushSubscription.count({ where: { userId } }),
        this.db.userSession.count({ where: { userId } }),
        this.db.authIdentity.count({ where: { userId } }),
        this.db.lookup.count({ where: { userId } }),
        this.db.correction.findFirst({ where: { userId }, select: { userId: true } }),
      ]);
    return {
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      purgedAt: request.purgedAt,
      savedLocations,
      follows,
      notifications,
      preferences,
      pushSubscriptions,
      sessions,
      identities,
      lookups,
      correctionUserId: correction?.userId ?? null,
    };
  }

  async deleteExpiredLookups(now: Date): Promise<number> {
    const result = await dbCall(() =>
      this.db.lookup.deleteMany({ where: { userId: null, expiresAt: { lt: now } } }),
    );
    return result.count;
  }

  async deleteExpiredSessions(cutoff: Date): Promise<number> {
    const [users, admins] = await dbCall(() =>
      Promise.all([
        this.db.userSession.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
        this.db.adminSession.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
      ]),
    );
    return users.count + admins.count;
  }

  async deleteOldStripeEvents(cutoff: Date): Promise<number> {
    const result = await dbCall(() => this.db.stripeEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } }));
    return result.count;
  }
}
