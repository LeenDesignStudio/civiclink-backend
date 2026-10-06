import { Prisma } from '../../generated/prisma/client.js';
import type { AuthProvider } from '../../generated/prisma/enums.js';
import { dbCall, type Db } from '../../db/prisma.js';
import type { Tx } from '../../auth/tx.js';
import { defaultNotificationPreferences } from './residents.prefs.js';
import type { DeletionDraft, LegalVersions, ResidentRecord, SubscriptionSummary } from './residents.dto.js';
import type { NewIdentity, NewResident, ResidentsStore } from './residents.store.js';

const userSelect = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  termsVersion: true,
  privacyVersion: true,
  acceptedAt: true,
  marketingOptIn: true,
  lastLoginAt: true,
  createdAt: true,
  identities: {
    select: { provider: true },
    orderBy: { createdAt: 'asc' as const },
    take: 1,
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function mapUser(row: UserRow, providerFallback?: AuthProvider): ResidentRecord {
  const provider = row.identities[0]?.provider ?? providerFallback ?? 'GOOGLE';
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    termsVersion: row.termsVersion,
    privacyVersion: row.privacyVersion,
    acceptedAt: row.acceptedAt,
    marketingOptIn: row.marketingOptIn,
    provider,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

export class ResidentsRepo implements ResidentsStore {
  constructor(private readonly db: Db) {}

  private use(tx: Tx): Db {
    if (tx && typeof tx === 'object' && 'user' in tx) return tx as Db;
    return this.db;
  }

  async findIdentity(provider: AuthProvider, providerSubject: string) {
    const row = await dbCall(() =>
      this.db.authIdentity.findUnique({
        where: { provider_providerSubject: { provider, providerSubject } },
        select: { user: { select: userSelect } },
      }),
    );
    return row ? { user: mapUser(row.user) } : null;
  }

  async findVerifiedEmailOwner(email: string): Promise<ResidentRecord | null> {
    const row = await dbCall(() =>
      this.db.authIdentity.findFirst({
        where: { email, emailVerified: true },
        orderBy: { createdAt: 'asc' },
        select: { user: { select: userSelect } },
      }),
    );
    return row ? mapUser(row.user) : null;
  }

  async createUser(tx: Tx, input: NewResident): Promise<ResidentRecord> {
    const row = await dbCall(() =>
      this.use(tx).user.create({
        data: {
          id: input.id,
          email: input.email,
          displayName: input.displayName,
          createdAt: input.createdAt,
        },
        select: userSelect,
      }),
    );
    return mapUser(row, input.provider);
  }

  async insertIdentity(tx: Tx, input: NewIdentity): Promise<void> {
    await dbCall(() =>
      this.use(tx).authIdentity.create({
        data: {
          id: input.id,
          userId: input.userId,
          provider: input.provider,
          providerSubject: input.providerSubject,
          email: input.email,
          emailVerified: input.emailVerified,
        },
        select: { id: true },
      }),
    );
  }

  async touchIdentity(
    tx: Tx,
    provider: AuthProvider,
    providerSubject: string,
    email: string,
    emailVerified: boolean,
  ): Promise<void> {
    await dbCall(() =>
      this.use(tx).authIdentity.update({
        where: { provider_providerSubject: { provider, providerSubject } },
        data: { email, emailVerified },
        select: { id: true },
      }),
    );
  }

  async touchLogin(tx: Tx, userId: string, at: Date): Promise<void> {
    await dbCall(() =>
      this.use(tx).user.update({
        where: { id: userId },
        data: { lastLoginAt: at },
        select: { id: true },
      }),
    );
  }

  async updateDisplayName(tx: Tx, userId: string, displayName: string): Promise<void> {
    await dbCall(() =>
      this.use(tx).user.update({
        where: { id: userId },
        data: { displayName },
        select: { id: true },
      }),
    );
  }

  async getById(tx: Tx, userId: string): Promise<ResidentRecord | null> {
    const row = await dbCall(() => this.use(tx).user.findUnique({ where: { id: userId }, select: userSelect }));
    return row ? mapUser(row) : null;
  }

  async currentLegal(): Promise<LegalVersions | null> {
    const docs = await dbCall(() =>
      this.db.legalDocument.findMany({
        where: { current: true, kind: { in: ['TERMS', 'PRIVACY'] } },
        select: { kind: true, version: true },
      }),
    );
    const terms = docs.find((doc) => doc.kind === 'TERMS');
    const privacy = docs.find((doc) => doc.kind === 'PRIVACY');
    if (!terms || !privacy) return null;
    return { termsVersion: terms.version, privacyVersion: privacy.version };
  }

  async acceptTerms(tx: Tx, inputUser: string, input: {
    termsVersion: string;
    privacyVersion: string;
    displayName: string;
    marketingOptIn: boolean;
    acceptedAt: Date;
  }): Promise<ResidentRecord> {
    const row = await dbCall(() =>
      this.use(tx).user.update({
        where: { id: inputUser },
        data: {
          termsVersion: input.termsVersion,
          privacyVersion: input.privacyVersion,
          displayName: input.displayName,
          marketingOptIn: input.marketingOptIn,
          acceptedAt: input.acceptedAt,
        },
        select: userSelect,
      }),
    );
    return mapUser(row);
  }

  async updateProfile(
    tx: Tx,
    userId: string,
    patch: { displayName?: string; marketingOptIn?: boolean },
  ): Promise<ResidentRecord> {
    const data: { displayName?: string; marketingOptIn?: boolean } = {};
    if (patch.displayName !== undefined) data.displayName = patch.displayName;
    if (patch.marketingOptIn !== undefined) data.marketingOptIn = patch.marketingOptIn;
    const row = await dbCall(() =>
      this.use(tx).user.update({ where: { id: userId }, data, select: userSelect }),
    );
    return mapUser(row);
  }

  async hasNotificationPreferences(userId: string): Promise<boolean> {
    const count = await dbCall(() => this.db.notificationPreference.count({ where: { userId } }));
    return count > 0;
  }

  async markPendingDeletion(tx: Tx, userId: string): Promise<void> {
    await dbCall(() =>
      this.use(tx).user.update({
        where: { id: userId },
        data: { status: 'PENDING_DELETION' },
        select: { id: true },
      }),
    );
  }

  async insertDeletion(tx: Tx, draft: DeletionDraft): Promise<void> {
    await dbCall(() =>
      this.use(tx).deletionRequest.create({
        data: {
          userId: draft.userId,
          reason: draft.reason,
          reasonText: draft.reasonText,
          purgeAfter: draft.purgeAfter,
          requestedAt: draft.requestedAt,
        },
        select: { id: true },
      }),
    );
  }

  async restore(tx: Tx, userId: string, restoredAt: Date): Promise<ResidentRecord> {
    const db = this.use(tx);
    const row = await dbCall(async () => {
      await db.deletionRequest.updateMany({
        where: { userId, restoredAt: null, purgedAt: null },
        data: { restoredAt },
      });
      return db.user.update({
        where: { id: userId },
        data: { status: 'ACTIVE' },
        select: userSelect,
      });
    });
    return mapUser(row);
  }

  async subscriptionSummary(userId: string): Promise<SubscriptionSummary | null> {
    const rows = await dbCall(() =>
      this.db.subscription.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          status: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          plan: { select: { name: true } },
        },
      }),
    );
    const row =
      rows.find((item) => item.status === 'ACTIVE' || item.status === 'TRIALING' || item.status === 'PAST_DUE') ??
      rows[0];
    if (!row) return null;
    return {
      status: row.status,
      planName: row.plan?.name ?? null,
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return dbCall(() =>
      this.db.notification.count({ where: { userId, readAt: null, deletedAt: null } }),
    );
  }
}

export function ensureNotificationDefaults(db: Db): { ensureDefaults(userId: string): Promise<void> } {
  return {
    async ensureDefaults(userId: string): Promise<void> {
      await dbCall(async () => {
        const count = await db.notificationPreference.count({ where: { userId } });
        if (count > 0) return;
        await db.notificationPreference.createMany({
          data: defaultNotificationPreferences().map((row) => ({ userId, ...row })),
        });
      });
    },
  };
}
