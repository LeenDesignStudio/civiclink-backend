import type { Clock } from '../../lib/clock.js';
import type { RandomSource } from '../../lib/random.js';
import type { ServiceContext } from '../../graphql/context.js';
import {
  AccountDeletedError,
  AccountPendingDeletionError,
  InternalError,
  isAppError,
  UpstreamError,
  NotPendingDeletionError,
  TermsVersionMismatchError,
  UnauthenticatedError,
  fromZod,
} from '../../lib/errors.js';
import { SessionService } from '../../auth/sessions.js';
import { stripAsciiControls } from '../../lib/text.js';
import type { RunTx, Tx } from '../../auth/tx.js';
import type { DeletionResult, MeDto, ProviderAssertion, ResidentRecord } from './residents.dto.js';
import {
  acceptTermsSchema,
  requestDeletionSchema,
  signOutSchema,
  updateProfileSchema,
} from './residents.inputs.js';
import type { NotificationPrefsHook } from './residents.prefs.js';
import type { ResidentsStore } from './residents.store.js';

export interface AccountBilling {
  cancelAtPeriodEnd(userId: string): Promise<void>;
}

export interface DeletionNotifier {
  enqueue(name: 'email.accountDeletion', payload: { id: string }, options: { singletonKey: string }): Promise<void>;
}

export interface ResidentsServiceDeps {
  store: ResidentsStore;
  sessions: SessionService;
  clock: Clock;
  random: RandomSource;
  prefs: NotificationPrefsHook;
  runTx: RunTx;
  purgeDays: number;
  billing?: AccountBilling;
  notifier?: DeletionNotifier;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function cleanName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = stripAsciiControls(value.trim());
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, 60);
}

function fallbackName(email: string): string {
  const local = stripAsciiControls(email.split('@')[0] ?? '').trim();
  if (local.length === 0) return 'Resident';
  return local.slice(0, 60);
}

export class ResidentsService {
  constructor(private readonly deps: ResidentsServiceDeps) {}

  async upsertFromProvider(input: ProviderAssertion): Promise<ResidentRecord> {
    const email = normalizeEmail(input.email);
    if (!email.includes('@') || email.length > 320) {
      throw new UnauthenticatedError();
    }
    const now = this.deps.clock.now();
    const name = cleanName(input.displayName);
    const existing = await this.deps.store.findIdentity(input.provider, input.providerSubject);
    if (existing) {
      if (existing.user.status === 'DELETED') throw new AccountDeletedError();
      return this.deps.runTx(async (tx) => {
        await this.deps.store.touchIdentity(tx, input.provider, input.providerSubject, email, input.emailVerified);
        await this.deps.store.touchLogin(tx, existing.user.id, now);
        if (name && existing.user.displayName === 'Resident') {
          await this.deps.store.updateDisplayName(tx, existing.user.id, name);
        }
        return this.requireUser(tx, existing.user.id);
      });
    }

    if (input.emailVerified) {
      const owner = await this.deps.store.findVerifiedEmailOwner(email);
      if (owner) {
        if (owner.status === 'DELETED') throw new AccountDeletedError();
        return this.deps.runTx(async (tx) => {
          await this.deps.store.insertIdentity(tx, {
            id: this.deps.random.uuid(),
            userId: owner.id,
            provider: input.provider,
            providerSubject: input.providerSubject,
            email,
            emailVerified: true,
          });
          await this.deps.store.touchLogin(tx, owner.id, now);
          if (name && owner.displayName === 'Resident') {
            await this.deps.store.updateDisplayName(tx, owner.id, name);
          }
          return this.requireUser(tx, owner.id);
        });
      }
    }

    return this.deps.runTx(async (tx) => {
      const created = await this.deps.store.createUser(tx, {
        id: this.deps.random.uuid(),
        email,
        displayName: name ?? fallbackName(email),
        provider: input.provider,
        createdAt: now,
      });
      await this.deps.store.insertIdentity(tx, {
        id: this.deps.random.uuid(),
        userId: created.id,
        provider: input.provider,
        providerSubject: input.providerSubject,
        email,
        emailVerified: input.emailVerified,
      });
      await this.deps.store.touchLogin(tx, created.id, now);
      return this.requireUser(tx, created.id);
    });
  }

  async termsAreCurrent(user: ResidentRecord): Promise<boolean> {
    const legal = await this.deps.store.currentLegal();
    if (!legal) return false;
    return user.termsVersion === legal.termsVersion && user.privacyVersion === legal.privacyVersion;
  }

  async me(ctx: ServiceContext): Promise<MeDto> {
    ctx.authz.require('self.profile:read');
    const userId = ctx.authz.requireResident();
    return this.toMe(await this.requireUser(undefined, userId));
  }

  async acceptTerms(ctx: ServiceContext, input: unknown): Promise<MeDto> {
    ctx.authz.require('self.profile:update');
    const userId = this.requireMutableResident(ctx);
    const parsed = acceptTermsSchema.safeParse(input);
    if (!parsed.success) throw fromZod(parsed.error);
    const legal = await this.deps.store.currentLegal();
    if (!legal) throw new InternalError();
    if (parsed.data.termsVersion !== legal.termsVersion || parsed.data.privacyVersion !== legal.privacyVersion) {
      throw new TermsVersionMismatchError();
    }
    const acceptedAt = this.deps.clock.now();
    const user = await this.deps.runTx(async (tx) =>
      this.deps.store.acceptTerms(tx, userId, { ...parsed.data, acceptedAt }),
    );
    if (!(await this.deps.store.hasNotificationPreferences(userId))) {
      await this.deps.prefs.ensureDefaults(userId);
    }
    return this.toMe(user);
  }

  async updateProfile(ctx: ServiceContext, input: unknown): Promise<MeDto> {
    ctx.authz.require('self.profile:update');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = updateProfileSchema.safeParse(input);
    if (!parsed.success) throw fromZod(parsed.error);
    const patch: { displayName?: string; marketingOptIn?: boolean } = {};
    if (parsed.data.displayName !== undefined) patch.displayName = parsed.data.displayName;
    if (parsed.data.marketingOptIn !== undefined) patch.marketingOptIn = parsed.data.marketingOptIn;
    const user = await this.deps.runTx(async (tx) => this.deps.store.updateProfile(tx, userId, patch));
    return this.toMe(user);
  }

  async signOut(ctx: ServiceContext, input: unknown): Promise<void> {
    ctx.authz.require('self.session:manage');
    const userId = ctx.authz.requireResident();
    const parsed = signOutSchema.safeParse(input ?? {});
    if (!parsed.success) throw fromZod(parsed.error);
    if (parsed.data.everywhere) {
      await this.deps.sessions.revokeAll(userId);
      return;
    }
    if (ctx.principal.kind !== 'resident') throw new UnauthenticatedError();
    await this.deps.sessions.revoke(ctx.principal.sessionId);
  }

  async requestAccountDeletion(ctx: ServiceContext, input: unknown): Promise<DeletionResult> {
    ctx.authz.require('self.account:delete');
    const userId = ctx.authz.requireResident({ active: true });
    const parsed = requestDeletionSchema.safeParse(input);
    if (!parsed.success) throw fromZod(parsed.error);
    const requestedAt = this.deps.clock.now();
    const purgeAfter = new Date(requestedAt.getTime() + this.deps.purgeDays * 24 * 60 * 60 * 1000);
    await this.deps.runTx(async (tx) => {
      await this.deps.store.markPendingDeletion(tx, userId);
      await this.deps.store.insertDeletion(tx, {
        userId,
        reason: parsed.data.reason ?? null,
        reasonText: parsed.data.reasonText ?? null,
        purgeAfter,
        requestedAt,
      });
      if (this.deps.notifier) {
        try {
          await this.deps.notifier.enqueue('email.accountDeletion', { id: userId }, { singletonKey: userId });
        } catch (error) {
          if (isAppError(error)) throw error;
          throw new UpstreamError(undefined, { cause: error });
        }
      }
    });
    await this.deps.sessions.revokeAll(userId);
    if (this.deps.billing) await this.deps.billing.cancelAtPeriodEnd(userId);
    return { status: 'PENDING_DELETION', purgeAfter };
  }

  async restoreAccount(ctx: ServiceContext): Promise<MeDto> {
    ctx.authz.require('self.account:delete');
    const userId = ctx.authz.requireResident();
    const current = await this.requireUser(undefined, userId);
    if (current.status !== 'PENDING_DELETION') throw new NotPendingDeletionError();
    const restoredAt = this.deps.clock.now();
    const user = await this.deps.runTx(async (tx) => this.deps.store.restore(tx, userId, restoredAt));
    return this.toMe(user);
  }

  private requireMutableResident(ctx: ServiceContext): string {
    const userId = ctx.authz.requireResident();
    if (ctx.principal.kind === 'resident' && ctx.principal.status === 'PENDING_DELETION') {
      throw new AccountPendingDeletionError();
    }
    if (ctx.principal.kind === 'resident' && ctx.principal.status === 'DELETED') {
      throw new AccountDeletedError();
    }
    return userId;
  }

  private async requireUser(tx: Tx, userId: string): Promise<ResidentRecord> {
    const user = await this.deps.store.getById(tx, userId);
    if (!user) throw new UnauthenticatedError();
    return user;
  }

  private async toMe(user: ResidentRecord): Promise<MeDto> {
    const legal = await this.deps.store.currentLegal();
    if (!legal) throw new InternalError();
    const termsAccepted =
      user.termsVersion === legal.termsVersion && user.privacyVersion === legal.privacyVersion;
    const [subscription, unreadCount, activeSessionCount] = await Promise.all([
      this.deps.store.subscriptionSummary(user.id),
      this.deps.store.unreadCount(user.id),
      this.deps.sessions.countActive(user.id),
    ]);
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      provider: user.provider,
      status: user.status,
      termsAccepted,
      currentTermsVersion: legal.termsVersion,
      currentPrivacyVersion: legal.privacyVersion,
      marketingOptIn: user.marketingOptIn,
      subscription,
      unreadCount,
      activeSessionCount,
    };
  }
}
