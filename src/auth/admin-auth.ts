import type { Clock } from '../lib/clock.js';
import { sha256Hex } from '../lib/crypto.js';
import { AdminLockedError, AdminNotAllowedError, OauthFailedError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RandomSource } from '../lib/random.js';
import type { AdminPrincipalCache } from './admin-principal-cache.js';
import type { AdminAuthStore, AdminLoginRecord, AdminPrincipal } from './admin-auth.types.js';

export const ADMIN_IDLE_MS = 30 * 60 * 1000;
export const ADMIN_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const ADMIN_LOCK_MS = 15 * 60 * 1000;
export const ADMIN_MAX_FAILURES = 5;

export interface AdminLoginIdentity {
  email: string;
  emailVerified: boolean;
  subject: string;
  hd?: string;
}

export interface AdminAuthServiceDeps {
  store: AdminAuthStore;
  clock: Clock;
  random: RandomSource;
  hostedDomain: string;
  cache?: AdminPrincipalCache;
}

export class AdminAuthService {
  constructor(private readonly deps: AdminAuthServiceDeps) {}

  async completeLogin(
    identity: AdminLoginIdentity,
    meta?: { userAgent?: string; ipHash?: string; requestId?: string },
  ): Promise<{ token: string; principal: AdminPrincipal }> {
    const now = this.deps.clock.now();
    const email = identity.email.trim().toLowerCase();
    const admin = await this.deps.store.findByEmail(email);
    if (admin?.lockedUntil && admin.lockedUntil.getTime() > now.getTime()) {
      throw new AdminLockedError();
    }
    const hd = identity.hd?.trim().toLowerCase();
    const domainOk = hd === this.deps.hostedDomain.trim().toLowerCase();
    if (!identity.emailVerified || !domainOk) {
      if (admin) return this.fail(admin, now);
      throw new AdminNotAllowedError();
    }
    if (!admin) throw new AdminNotAllowedError();
    if (admin.status === 'DEACTIVATED') return this.fail(admin, now);
    if (admin.googleSubject && admin.googleSubject !== identity.subject) return this.fail(admin, now);
    if (!identity.subject) throw new OauthFailedError({ details: { reason: 'sub' } });

    const updated = await this.deps.store.markSuccess(admin.id, identity.subject, now);
    const token = this.deps.random.token(32);
    const session = await this.deps.store.insertSession({
      id: this.deps.random.uuid(),
      adminId: updated.id,
      tokenHash: sha256Hex(token),
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + ADMIN_ABSOLUTE_MS),
      createdAt: now,
      userAgent: meta?.userAgent ?? null,
      ipHash: meta?.ipHash ?? null,
      role: updated.role,
      status: updated.status,
      email: updated.email,
      name: updated.name,
    });
    logger.info({ requestId: meta?.requestId, principalId: updated.id }, 'admin sign-in');
    return {
      token,
      principal: {
        adminId: updated.id,
        role: updated.role,
        sessionId: session.id,
        email: updated.email,
        name: updated.name,
      },
    };
  }

  async resolveAdminPrincipal(token: string | undefined, now: Date): Promise<AdminPrincipal | null> {
    if (!token) return null;
    const session = await this.deps.store.findSessionByHash(sha256Hex(token));
    if (!session || session.revokedAt) return null;
    if (session.status !== 'ACTIVE') return null;
    const idle = session.lastActivityAt.getTime() + ADMIN_IDLE_MS;
    const absolute = session.createdAt.getTime() + ADMIN_ABSOLUTE_MS;
    if (now.getTime() >= idle || now.getTime() >= absolute || now.getTime() >= session.expiresAt.getTime()) {
      await this.deps.store.revokeSession(session.id, now);
      return null;
    }
    await this.deps.store.touchSession(session.id, now);
    return {
      adminId: session.adminId,
      role: session.role,
      sessionId: session.id,
      email: session.email,
      name: session.name,
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.deps.store.revokeSession(sessionId, this.deps.clock.now());
  }

  async revokeAll(adminId: string): Promise<void> {
    await this.deps.store.revokeAllForAdmin(adminId, this.deps.clock.now());
    this.deps.cache?.invalidate(adminId);
  }

  private async fail(admin: AdminLoginRecord, now: Date): Promise<never> {
    let base = admin.failedAttempts;
    const windowStart = now.getTime() - ADMIN_LOCK_MS;
    const lockExpired = admin.lockedUntil !== null && admin.lockedUntil.getTime() <= now.getTime();
    if (lockExpired || admin.updatedAt.getTime() < windowStart) base = 0;
    const attempts = base + 1;
    const lockedUntil = attempts >= ADMIN_MAX_FAILURES ? new Date(now.getTime() + ADMIN_LOCK_MS) : null;
    await this.deps.store.applyFailure(admin.id, attempts, lockedUntil, now);
    logger.warn({ principalId: admin.id, locked: lockedUntil !== null }, 'admin sign-in rejected');
    if (lockedUntil) throw new AdminLockedError();
    throw new AdminNotAllowedError();
  }
}
