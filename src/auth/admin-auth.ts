import type { Clock } from '../lib/clock.js';
import { sha256Hex } from '../lib/crypto.js';
import {
  AdminInvalidCredentialsError,
  AdminLockedError,
  AdminTokenExpiredError,
  NotFoundError,
  SessionExpiredError,
  SessionRevokedError,
  ValidationError,
} from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RandomSource } from '../lib/random.js';
import type { AdminPrincipalCache } from './admin-principal-cache.js';
import type { AdminAuthStore, AdminLoginRecord, AdminPrincipal, AdminTokenView } from './admin-auth.types.js';
import type { PasswordHasher } from './passwords.js';
import { passwordRejection } from './passwords.js';
import type { Tx } from './tx.js';

export const ADMIN_IDLE_MS = 30 * 60 * 1000;
export const ADMIN_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const ADMIN_LOCK_MS = 15 * 60 * 1000;
export const ADMIN_MAX_FAILURES = 5;
export const ADMIN_RESET_TTL_MS = 60 * 60 * 1000;
export const ADMIN_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_PASSWORD_MAX = 200;

export interface AdminAuthServiceDeps {
  store: AdminAuthStore;
  clock: Clock;
  random: RandomSource;
  passwords: PasswordHasher;
  webUrl: string;
  cache?: AdminPrincipalCache;
}

export interface AdminPasswordMail {
  adminUserId: string;
  purpose: 'INVITE' | 'RESET';
  url: string;
}

export class AdminAuthService {
  constructor(private readonly deps: AdminAuthServiceDeps) {}

  async login(
    input: { email: string; password: string },
    meta?: { userAgent?: string; ipHash?: string; requestId?: string },
  ): Promise<{ token: string; principal: AdminPrincipal }> {
    const now = this.deps.clock.now();
    const email = input.email.trim().toLowerCase();
    if (input.password.length > LOGIN_PASSWORD_MAX) {
      await this.deps.passwords.dummyVerify(input.password.slice(0, LOGIN_PASSWORD_MAX));
      throw new AdminInvalidCredentialsError();
    }
    const admin = await this.deps.store.findByEmail(email);
    if (!admin) {
      await this.deps.passwords.dummyVerify(input.password);
      throw new AdminInvalidCredentialsError();
    }
    if (admin.status === 'DEACTIVATED' || !admin.passwordHash) {
      await this.deps.passwords.dummyVerify(input.password);
      throw new AdminInvalidCredentialsError();
    }
    if (admin.lockedUntil && admin.lockedUntil.getTime() > now.getTime()) {
      throw new AdminLockedError(secondsUntil(admin.lockedUntil, now));
    }
    const matches = await this.deps.passwords.verify(admin.passwordHash, input.password);
    if (!matches) return this.fail(admin, now);
    const updated = await this.deps.store.markLogin(admin.id, now);
    return this.openSession(updated, now, meta);
  }

  async requestPasswordReset(email: string): Promise<AdminPasswordMail | null> {
    const admin = await this.deps.store.findByEmail(email.trim().toLowerCase());
    if (!admin || admin.status !== 'ACTIVE' || !admin.passwordHash) return null;
    return this.issueToken(admin.id, 'RESET', ADMIN_RESET_TTL_MS);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const now = this.deps.clock.now();
    const view = await this.deps.store.readToken(sha256Hex(token));
    if (!this.tokenUsable(view, now)) throw new AdminTokenExpiredError();
    const problem = passwordRejection(password, view.email);
    if (problem) {
      throw new ValidationError(problem, [{ path: 'password', code: 'invalid_password', message: problem }]);
    }
    const passwordHash = await this.deps.passwords.hash(password);
    const consumed = await this.deps.store.consumeToken(sha256Hex(token), passwordHash, now);
    if (!consumed) throw new AdminTokenExpiredError();
    this.deps.cache?.invalidate(consumed.adminId);
  }

  async issueInvite(adminId: string): Promise<string> {
    const admin = await this.deps.store.findById(adminId);
    if (!admin || admin.status === 'DEACTIVATED') throw new NotFoundError();
    const issued = await this.issueToken(adminId, 'INVITE', ADMIN_INVITE_TTL_MS);
    return issued.url;
  }

  async changePassword(
    tx: Tx,
    adminId: string,
    sessionId: string,
    currentPassword: string,
    nextPassword: string,
  ): Promise<void> {
    const now = this.deps.clock.now();
    const admin = await this.deps.store.findById(adminId, tx);
    if (!admin || admin.status !== 'ACTIVE' || !admin.passwordHash) throw new AdminInvalidCredentialsError();
    if (currentPassword.length > LOGIN_PASSWORD_MAX) throw new AdminInvalidCredentialsError();
    const matches = await this.deps.passwords.verify(admin.passwordHash, currentPassword);
    if (!matches) throw new AdminInvalidCredentialsError();
    const problem = passwordRejection(nextPassword, admin.email);
    if (problem) {
      throw new ValidationError(problem, [{ path: 'newPassword', code: 'invalid_password', message: problem }]);
    }
    const passwordHash = await this.deps.passwords.hash(nextPassword);
    await this.deps.store.setPassword(tx, admin.id, passwordHash, now, false);
    await this.deps.store.revokeAllForAdmin(admin.id, now, sessionId, tx);
    this.deps.cache?.invalidate(admin.id);
  }

  async resolveAdminPrincipal(token: string | undefined, now: Date): Promise<AdminPrincipal | null> {
    if (!token) return null;
    const session = await this.deps.store.findSessionByHash(sha256Hex(token));
    if (!session) return null;
    if (session.revokedAt || session.status !== 'ACTIVE') throw new SessionRevokedError();
    const idle = session.lastActivityAt.getTime() + ADMIN_IDLE_MS;
    const absolute = session.createdAt.getTime() + ADMIN_ABSOLUTE_MS;
    if (now.getTime() >= idle || now.getTime() >= absolute || now.getTime() >= session.expiresAt.getTime()) {
      await this.deps.store.revokeSession(session.id, now);
      throw new SessionExpiredError();
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

  async sessionDeadline(sessionId: string): Promise<Date | null> {
    const session = await this.deps.store.findSessionById(sessionId);
    if (!session || session.revokedAt || session.status !== 'ACTIVE') return null;
    return new Date(
      Math.min(
        session.lastActivityAt.getTime() + ADMIN_IDLE_MS,
        session.createdAt.getTime() + ADMIN_ABSOLUTE_MS,
        session.expiresAt.getTime(),
      ),
    );
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.deps.store.revokeSession(sessionId, this.deps.clock.now());
  }

  async revokeAll(adminId: string): Promise<void> {
    await this.deps.store.revokeAllForAdmin(adminId, this.deps.clock.now());
    this.deps.cache?.invalidate(adminId);
  }

  private async issueToken(
    adminId: string,
    purpose: 'INVITE' | 'RESET',
    ttlMs: number,
  ): Promise<AdminPasswordMail> {
    const now = this.deps.clock.now();
    const token = this.deps.random.token(32);
    await this.deps.store.saveToken({
      id: this.deps.random.uuid(),
      adminUserId: adminId,
      purpose,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(now.getTime() + ttlMs),
      now,
    });
    return { adminUserId: adminId, purpose, url: passwordLink(this.deps.webUrl, token, purpose) };
  }

  private tokenUsable(view: AdminTokenView | null, now: Date): view is AdminTokenView {
    if (!view || view.usedAt || view.expiresAt.getTime() <= now.getTime()) return false;
    if (view.status === 'DEACTIVATED') return false;
    if (view.purpose === 'RESET' && view.status !== 'ACTIVE') return false;
    return true;
  }

  private async openSession(
    admin: AdminLoginRecord,
    now: Date,
    meta?: { userAgent?: string; ipHash?: string; requestId?: string },
  ): Promise<{ token: string; principal: AdminPrincipal }> {
    const token = this.deps.random.token(32);
    const session = await this.deps.store.insertSession({
      id: this.deps.random.uuid(),
      adminId: admin.id,
      tokenHash: sha256Hex(token),
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + ADMIN_ABSOLUTE_MS),
      createdAt: now,
      userAgent: meta?.userAgent ?? null,
      ipHash: meta?.ipHash ?? null,
      role: admin.role,
      status: admin.status,
      email: admin.email,
      name: admin.name,
    });
    logger.info({ requestId: meta?.requestId, principalId: admin.id }, 'admin sign-in');
    return {
      token,
      principal: {
        adminId: admin.id,
        role: admin.role,
        sessionId: session.id,
        email: admin.email,
        name: admin.name,
      },
    };
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
    if (lockedUntil) throw new AdminLockedError(Math.ceil(ADMIN_LOCK_MS / 1000));
    throw new AdminInvalidCredentialsError();
  }
}

export function passwordLink(webUrl: string, token: string, purpose: 'INVITE' | 'RESET'): string {
  const url = new URL('/admin/update-password', webUrl);
  url.searchParams.set('token', token);
  if (purpose === 'INVITE') url.searchParams.set('invite', '1');
  return url.toString();
}

function secondsUntil(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
}
