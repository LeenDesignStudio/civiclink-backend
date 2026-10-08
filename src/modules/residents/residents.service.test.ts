import { describe, expect, it } from 'vitest';
import { directTx } from '../../auth/tx.js';
import type { Tx } from '../../auth/tx.js';
import { SessionService } from '../../auth/sessions.js';
import type { NewSession, SessionStore, StoredSession } from '../../auth/sessions.types.js';
import { Authz } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { FakeClock } from '../../lib/clock.js';
import {
  AccountDeletedError,
  NotPendingDeletionError,
  TermsVersionMismatchError,
  UpstreamError,
} from '../../lib/errors.js';
import { FakeRandom } from '../../lib/random.js';
import type { AuthProvider, UserStatus } from '../../generated/prisma/enums.js';
import type { DeletionDraft, LegalVersions, ProviderAssertion, ResidentRecord } from './residents.dto.js';
import { defaultNotificationPreferences } from './residents.prefs.js';
import { ResidentsService, type AccountBilling, type DeletionNotifier } from './residents.service.js';
import type { NewIdentity, NewResident, ResidentsStore } from './residents.store.js';

class MemorySessions implements SessionStore {
  revokedUsers: string[] = [];
  revokedSessions: string[] = [];

  insert(session: NewSession): Promise<StoredSession> {
    return Promise.resolve({ ...session, rotatedAt: null, revokedAt: null });
  }
  findByHash(): Promise<StoredSession | null> {
    return Promise.resolve(null);
  }
  rotate(_previousId: string, _rotatedAt: Date, next: NewSession): Promise<StoredSession> {
    return Promise.resolve({ ...next, rotatedAt: null, revokedAt: null });
  }
  revokeFamily(): Promise<void> {
    return Promise.resolve();
  }
  revokeById(id: string): Promise<void> {
    this.revokedSessions.push(id);
    return Promise.resolve();
  }
  revokeAllForUser(userId: string): Promise<void> {
    this.revokedUsers.push(userId);
    return Promise.resolve();
  }
  countActive(): Promise<number> {
    return Promise.resolve(2);
  }
}

class MemoryResidents implements ResidentsStore {
  users = new Map<string, ResidentRecord>();
  identities: NewIdentity[] = [];
  deletions: DeletionDraft[] = [];
  restoredAt: Date | null = null;
  prefUsers = new Set<string>();
  legal: LegalVersions | null = { termsVersion: 'terms-2', privacyVersion: 'privacy-2' };

  findIdentity(provider: AuthProvider, providerSubject: string) {
    const identity = this.identities.find(
      (row) => row.provider === provider && row.providerSubject === providerSubject,
    );
    const user = identity ? this.users.get(identity.userId) : undefined;
    return Promise.resolve(user ? { user } : null);
  }

  findVerifiedEmailOwner(email: string) {
    const identity = this.identities.find((row) => row.email === email && row.emailVerified);
    const user = identity ? this.users.get(identity.userId) : undefined;
    return Promise.resolve(user ?? null);
  }

  createUser(_tx: Tx, input: NewResident) {
    const user: ResidentRecord = {
      id: input.id,
      email: input.email,
      displayName: input.displayName,
      status: 'ACTIVE',
      termsVersion: null,
      privacyVersion: null,
      acceptedAt: null,
      marketingOptIn: false,
      provider: input.provider,
      lastLoginAt: null,
      createdAt: input.createdAt,
    };
    this.users.set(user.id, user);
    return Promise.resolve(user);
  }

  insertIdentity(_tx: Tx, input: NewIdentity) {
    this.identities.push(input);
    return Promise.resolve();
  }

  touchIdentity(_tx: Tx, provider: AuthProvider, providerSubject: string, email: string, emailVerified: boolean) {
    const identity = this.identities.find(
      (row) => row.provider === provider && row.providerSubject === providerSubject,
    );
    if (identity) {
      identity.email = email;
      identity.emailVerified = emailVerified;
    }
    return Promise.resolve();
  }

  touchLogin(_tx: Tx, userId: string, at: Date) {
    const user = this.users.get(userId);
    if (user) user.lastLoginAt = at;
    return Promise.resolve();
  }

  updateDisplayName(_tx: Tx, userId: string, displayName: string) {
    const user = this.users.get(userId);
    if (user) user.displayName = displayName;
    return Promise.resolve();
  }

  getById(_tx: Tx, userId: string) {
    return Promise.resolve(this.users.get(userId) ?? null);
  }

  currentLegal() {
    return Promise.resolve(this.legal);
  }

  acceptTerms(
    _tx: Tx,
    userId: string,
    input: { termsVersion: string; privacyVersion: string; displayName: string; marketingOptIn: boolean; acceptedAt: Date },
  ) {
    const user = this.users.get(userId);
    if (!user) throw new Error('missing');
    user.termsVersion = input.termsVersion;
    user.privacyVersion = input.privacyVersion;
    user.displayName = input.displayName;
    user.marketingOptIn = input.marketingOptIn;
    user.acceptedAt = input.acceptedAt;
    return Promise.resolve(user);
  }

  updateProfile(_tx: Tx, userId: string, patch: { displayName?: string; marketingOptIn?: boolean }) {
    const user = this.users.get(userId);
    if (!user) throw new Error('missing');
    if (patch.displayName !== undefined) user.displayName = patch.displayName;
    if (patch.marketingOptIn !== undefined) user.marketingOptIn = patch.marketingOptIn;
    return Promise.resolve(user);
  }

  hasNotificationPreferences(userId: string) {
    return Promise.resolve(this.prefUsers.has(userId));
  }

  markPendingDeletion(_tx: Tx, userId: string) {
    const user = this.users.get(userId);
    if (user) user.status = 'PENDING_DELETION';
    return Promise.resolve();
  }

  insertDeletion(_tx: Tx, draft: DeletionDraft) {
    this.deletions.push(draft);
    return Promise.resolve();
  }

  restore(_tx: Tx, userId: string, restoredAt: Date) {
    const user = this.users.get(userId);
    if (!user) throw new Error('missing');
    user.status = 'ACTIVE';
    this.restoredAt = restoredAt;
    return Promise.resolve(user);
  }

  subscriptionSummary() {
    return Promise.resolve(null);
  }

  unreadCount() {
    return Promise.resolve(0);
  }
}

function ctx(userId: string, status: UserStatus = 'ACTIVE', termsAccepted = true): ServiceContext {
  const principal = { kind: 'resident' as const, userId, status, termsAccepted, sessionId: 'sess-1' };
  return { requestId: 'req-1', principal, authz: new Authz(principal), ipHash: 'ip' };
}

describe('ResidentsService', () => {
  const now = new Date('2026-04-01T00:00:00.000Z');

  function setup() {
    const store = new MemoryResidents();
    const sessions = new MemorySessions();
    const ensured: string[] = [];
    const cancelled: string[] = [];
    const mailed: Array<{ name: string; id: string; singletonKey: string }> = [];
    const billing: AccountBilling = {
      cancelAtPeriodEnd: (userId) => {
        cancelled.push(userId);
        return Promise.resolve();
      },
    };
    const notifier: DeletionNotifier = {
      enqueue: (name, payload, options) => {
        mailed.push({ name, id: payload.id, singletonKey: options.singletonKey });
        return Promise.resolve();
      },
    };
    const service = new ResidentsService({
      store,
      sessions: new SessionService({ store: sessions, clock: new FakeClock(now), random: new FakeRandom() }),
      clock: new FakeClock(now),
      random: new FakeRandom(),
      prefs: {
        ensureDefaults: (userId) => {
          ensured.push(userId);
          return Promise.resolve();
        },
      },
      runTx: directTx,
      purgeDays: 30,
      billing,
      notifier,
    });
    return { store, sessions, service, ensured, cancelled, mailed };
  }

  async function seed(store: MemoryResidents, input: Partial<ResidentRecord> & { providerSubject: string; emailVerified: boolean }) {
    const user = await store.createUser(undefined, {
      id: input.id ?? 'user-1',
      email: input.email ?? 'ada@example.com',
      displayName: input.displayName ?? 'Ada',
      provider: input.provider ?? 'GOOGLE',
      createdAt: now,
    });
    user.status = input.status ?? 'ACTIVE';
    user.termsVersion = input.termsVersion ?? null;
    user.privacyVersion = input.privacyVersion ?? null;
    await store.insertIdentity(undefined, {
      id: `id-${input.providerSubject}`,
      userId: user.id,
      provider: user.provider,
      providerSubject: input.providerSubject,
      email: user.email,
      emailVerified: input.emailVerified,
    });
    return user;
  }

  it('does not link a provider when the email is unverified on either side', async () => {
    const { store, service } = setup();
    await seed(store, { providerSubject: 'google-1', emailVerified: false, email: 'ada@example.com' });
    const created = await service.upsertFromProvider({
      provider: 'APPLE',
      providerSubject: 'apple-1',
      email: 'ada@example.com',
      emailVerified: true,
    });
    expect(created.id).not.toBe('user-1');
    expect(store.users.size).toBe(2);

    const fresh = setup();
    await seed(fresh.store, { providerSubject: 'google-1', emailVerified: true, email: 'ada@example.com' });
    const separate = await fresh.service.upsertFromProvider({
      provider: 'APPLE',
      providerSubject: 'apple-2',
      email: 'ada@example.com',
      emailVerified: false,
    });
    expect(separate.id).not.toBe('user-1');
  });

  it('links a provider when both sides have a verified email', async () => {
    const { store, service } = setup();
    await seed(store, { providerSubject: 'google-1', emailVerified: true });
    const linked = await service.upsertFromProvider({
      provider: 'APPLE',
      providerSubject: 'apple-1',
      email: 'Ada@Example.com',
      emailVerified: true,
    });
    expect(linked.id).toBe('user-1');
    expect(store.identities).toHaveLength(2);
  });

  it('blocks a deleted account and still signs in a pending one', async () => {
    const { store, service } = setup();
    await seed(store, { providerSubject: 'google-1', emailVerified: true, status: 'DELETED' });
    const attempt: ProviderAssertion = {
      provider: 'GOOGLE',
      providerSubject: 'google-1',
      email: 'ada@example.com',
      emailVerified: true,
    };
    await expect(service.upsertFromProvider(attempt)).rejects.toBeInstanceOf(AccountDeletedError);

    store.users.get('user-1')!.status = 'PENDING_DELETION';
    const pending = await service.upsertFromProvider(attempt);
    expect(pending.status).toBe('PENDING_DELETION');
  });

  it('keeps an Apple name when a later login omits it', async () => {
    const { service } = setup();
    const first = await service.upsertFromProvider({
      provider: 'APPLE',
      providerSubject: 'apple-1',
      email: 'ada@privaterelay.appleid.com',
      emailVerified: true,
      displayName: 'Ada Lovelace',
    });
    expect(first.displayName).toBe('Ada Lovelace');
    const second = await service.upsertFromProvider({
      provider: 'APPLE',
      providerSubject: 'apple-1',
      email: 'ada@privaterelay.appleid.com',
      emailVerified: true,
    });
    expect(second.displayName).toBe('Ada Lovelace');
  });

  it('rejects a terms version mismatch and creates default preferences on accept', async () => {
    const { store, service, ensured } = setup();
    await seed(store, { providerSubject: 'google-1', emailVerified: true });
    const input = { termsVersion: 'terms-1', privacyVersion: 'privacy-2', displayName: 'Ada Lovelace', marketingOptIn: true };
    await expect(service.acceptTerms(ctx('user-1', 'ACTIVE', false), input)).rejects.toBeInstanceOf(
      TermsVersionMismatchError,
    );
    expect(ensured).toHaveLength(0);
    const me = await service.acceptTerms(ctx('user-1', 'ACTIVE', false), { ...input, termsVersion: 'terms-2' });
    expect(me.termsAccepted).toBe(true);
    expect(ensured).toEqual(['user-1']);
    expect(defaultNotificationPreferences()).toEqual([
      { category: 'ALERTS', channel: 'IN_APP', enabled: true },
      { category: 'ALERTS', channel: 'EMAIL', enabled: true },
      { category: 'ALERTS', channel: 'PUSH', enabled: false },
      { category: 'UPDATES', channel: 'IN_APP', enabled: true },
      { category: 'UPDATES', channel: 'EMAIL', enabled: false },
      { category: 'UPDATES', channel: 'PUSH', enabled: false },
    ]);
  });

  it('schedules purge, revokes sessions, and cancels billing on deletion', async () => {
    const { store, sessions, service, cancelled, mailed } = setup();
    await seed(store, {
      providerSubject: 'google-1',
      emailVerified: true,
      termsVersion: 'terms-2',
      privacyVersion: 'privacy-2',
    });
    const result = await service.requestAccountDeletion(ctx('user-1'), {
      confirm: 'DELETE',
      reason: 'PRIVACY',
    });
    expect(result.status).toBe('PENDING_DELETION');
    expect(result.purgeAfter.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(store.users.get('user-1')?.status).toBe('PENDING_DELETION');
    expect(sessions.revokedUsers).toEqual(['user-1']);
    expect(cancelled).toEqual(['user-1']);
    expect(mailed).toEqual([{ name: 'email.accountDeletion', id: 'user-1', singletonKey: 'user-1' }]);
  });

  it('rolls the deletion back when the confirmation job cannot be queued', async () => {
    const { store, sessions } = setup();
    const service = new ResidentsService({
      store,
      sessions: new SessionService({ store: sessions, clock: new FakeClock(now), random: new FakeRandom() }),
      clock: new FakeClock(now),
      random: new FakeRandom(),
      prefs: { ensureDefaults: () => Promise.resolve() },
      runTx: async (fn) => {
        const user = store.users.get('user-1');
        const status = user?.status;
        const deletions = store.deletions.length;
        try {
          return await fn(undefined);
        } catch (error) {
          if (user && status) user.status = status;
          store.deletions.length = deletions;
          throw error;
        }
      },
      purgeDays: 30,
      notifier: { enqueue: () => Promise.reject(new Error('queue down')) },
    });
    await seed(store, { providerSubject: 'google-1', emailVerified: true, termsVersion: 'terms-2', privacyVersion: 'privacy-2' });
    await expect(service.requestAccountDeletion(ctx('user-1'), { confirm: 'DELETE' })).rejects.toBeInstanceOf(UpstreamError);
    expect(store.users.get('user-1')?.status).toBe('ACTIVE');
    expect(store.deletions).toHaveLength(0);
  });

  it('restores a pending account and rejects any other status', async () => {
    const { store, service } = setup();
    await seed(store, { providerSubject: 'google-1', emailVerified: true, status: 'PENDING_DELETION' });
    const restored = await service.restoreAccount(ctx('user-1', 'PENDING_DELETION'));
    expect(restored.status).toBe('ACTIVE');
    expect(store.restoredAt).toEqual(now);
    await expect(service.restoreAccount(ctx('user-1', 'ACTIVE'))).rejects.toBeInstanceOf(NotPendingDeletionError);
  });

  it('updates the profile and signs out everywhere', async () => {
    const { store, sessions, service } = setup();
    await seed(store, {
      providerSubject: 'google-1',
      emailVerified: true,
      termsVersion: 'terms-2',
      privacyVersion: 'privacy-2',
    });
    const me = await service.updateProfile(ctx('user-1'), { displayName: 'Ada L', marketingOptIn: true });
    expect(me.displayName).toBe('Ada L');
    expect(me.marketingOptIn).toBe(true);
    await service.signOut(ctx('user-1'), { everywhere: true });
    expect(sessions.revokedUsers).toEqual(['user-1']);
    await service.signOut(ctx('user-1'), {});
    expect(sessions.revokedSessions).toEqual(['sess-1']);
  });
});
