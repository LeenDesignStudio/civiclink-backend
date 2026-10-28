import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../lib/crypto.js';
import { FakeClock } from '../lib/clock.js';
import {
  AdminInvalidCredentialsError,
  AdminLockedError,
  AdminTokenExpiredError,
  SessionExpiredError,
  SessionRevokedError,
  ValidationError,
} from '../lib/errors.js';
import { FakeRandom } from '../lib/random.js';
import type { AdminRole, AdminStatus } from '../generated/prisma/enums.js';
import {
  ADMIN_IDLE_MS,
  ADMIN_INVITE_TTL_MS,
  ADMIN_LOCK_MS,
  ADMIN_RESET_TTL_MS,
  AdminAuthService,
} from './admin-auth.js';
import type { AdminAuthStore, AdminLoginRecord, AdminSessionRecord, AdminTokenView } from './admin-auth.types.js';
import { FakePasswordHasher } from './passwords.js';
import type { Tx } from './tx.js';

const PASSWORD = 'correct-horse-battery';
const T0 = new Date('2026-04-01T00:00:00.000Z');

class MemoryAdminAuth implements AdminAuthStore {
  admin: AdminLoginRecord | null = null;
  sessions: AdminSessionRecord[] = [];
  tokens: (AdminTokenView & { id: string; tokenHash: string })[] = [];

  findByEmail(email: string) {
    return Promise.resolve(this.admin?.email === email ? this.admin : null);
  }
  findById(id: string) {
    return Promise.resolve(this.admin?.id === id ? this.admin : null);
  }
  applyFailure(id: string, failedAttempts: number, lockedUntil: Date | null, now: Date) {
    if (this.admin?.id === id) {
      this.admin.failedAttempts = failedAttempts;
      this.admin.lockedUntil = lockedUntil;
      this.admin.updatedAt = now;
    }
    return Promise.resolve();
  }
  markLogin(id: string, now: Date) {
    if (!this.admin || this.admin.id !== id) throw new Error('missing');
    this.admin.failedAttempts = 0;
    this.admin.lockedUntil = null;
    this.admin.updatedAt = now;
    return Promise.resolve(this.admin);
  }
  setPassword(_tx: Tx, id: string, passwordHash: string, now: Date, activate: boolean) {
    if (!this.admin || this.admin.id !== id) throw new Error('missing');
    this.admin.passwordHash = passwordHash;
    this.admin.failedAttempts = 0;
    this.admin.lockedUntil = null;
    this.admin.updatedAt = now;
    if (activate) this.admin.status = 'ACTIVE';
    return Promise.resolve();
  }
  insertSession(input: Omit<AdminSessionRecord, 'revokedAt'>) {
    const session: AdminSessionRecord = { ...input, revokedAt: null };
    this.sessions.push(session);
    return Promise.resolve(session);
  }
  findSessionByHash(hash: string) {
    return Promise.resolve(this.sessionView(this.sessions.find((row) => row.tokenHash === hash)));
  }
  findSessionById(id: string) {
    return Promise.resolve(this.sessionView(this.sessions.find((row) => row.id === id)));
  }
  touchSession(id: string, now: Date) {
    const session = this.sessions.find((row) => row.id === id && !row.revokedAt);
    if (session) session.lastActivityAt = now;
    return Promise.resolve();
  }
  revokeSession(id: string, now: Date) {
    const session = this.sessions.find((row) => row.id === id && !row.revokedAt);
    if (session) session.revokedAt = now;
    return Promise.resolve();
  }
  revokeAllForAdmin(adminId: string, now: Date, exceptSessionId?: string) {
    for (const session of this.sessions) {
      if (session.adminId === adminId && !session.revokedAt && session.id !== exceptSessionId) {
        session.revokedAt = now;
      }
    }
    return Promise.resolve();
  }
  saveToken(input: {
    id: string;
    adminUserId: string;
    purpose: 'INVITE' | 'RESET';
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }) {
    for (const token of this.tokens) {
      if (token.adminId === input.adminUserId && token.purpose === input.purpose && !token.usedAt) {
        token.usedAt = input.now;
      }
    }
    this.tokens.push({
      id: input.id,
      tokenHash: input.tokenHash,
      purpose: input.purpose,
      expiresAt: input.expiresAt,
      usedAt: null,
      adminId: input.adminUserId,
      email: this.admin?.email ?? '',
      status: this.admin?.status ?? 'INVITED',
    });
    return Promise.resolve();
  }
  readToken(tokenHash: string) {
    const token = this.tokens.find((row) => row.tokenHash === tokenHash);
    if (!token || !this.admin) return Promise.resolve(null);
    return Promise.resolve({ ...token, email: this.admin.email, status: this.admin.status });
  }
  consumeToken(tokenHash: string, passwordHash: string, now: Date) {
    const token = this.tokens.find((row) => row.tokenHash === tokenHash);
    if (!token || !this.admin || token.usedAt || token.expiresAt.getTime() <= now.getTime()) {
      return Promise.resolve(null);
    }
    if (this.admin.status === 'DEACTIVATED') return Promise.resolve(null);
    if (token.purpose === 'RESET' && this.admin.status !== 'ACTIVE') return Promise.resolve(null);
    token.usedAt = now;
    this.admin.passwordHash = passwordHash;
    this.admin.failedAttempts = 0;
    this.admin.lockedUntil = null;
    this.admin.updatedAt = now;
    if (token.purpose === 'INVITE') this.admin.status = 'ACTIVE';
    for (const session of this.sessions) {
      if (session.adminId === this.admin.id && !session.revokedAt) session.revokedAt = now;
    }
    return Promise.resolve({ adminId: this.admin.id });
  }

  private sessionView(session: AdminSessionRecord | undefined): AdminSessionRecord | null {
    if (!session || !this.admin) return null;
    return { ...session, role: this.admin.role, status: this.admin.status, email: this.admin.email, name: this.admin.name };
  }
}

function admin(partial: Partial<AdminLoginRecord> = {}): AdminLoginRecord {
  return {
    id: 'admin-1',
    email: 'ada@qubalink.com',
    name: 'Ada',
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
    passwordHash: `fake:${PASSWORD}`,
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: T0,
    ...partial,
  };
}

function linkToken(url: string | undefined): string {
  if (!url) throw new Error('expected a password link');
  return new URL(url).searchParams.get('token') ?? '';
}

function setup(row: AdminLoginRecord | null = admin()) {
  const store = new MemoryAdminAuth();
  store.admin = row;
  const clock = new FakeClock(T0);
  const service = new AdminAuthService({
    store,
    clock,
    random: new FakeRandom(),
    passwords: new FakePasswordHasher(),
    webUrl: 'https://civic.example',
  });
  return { store, clock, service };
}

describe('admin password login', () => {
  it('uses one error for an unknown email, a wrong password, a deactivated account, and an account with no password', async () => {
    const unknown = setup(null);
    await expect(unknown.service.login({ email: 'missing@qubalink.com', password: PASSWORD })).rejects.toBeInstanceOf(
      AdminInvalidCredentialsError,
    );

    const wrong = setup();
    await expect(wrong.service.login({ email: 'ada@qubalink.com', password: 'not-the-password' })).rejects.toBeInstanceOf(
      AdminInvalidCredentialsError,
    );
    expect(wrong.store.admin?.failedAttempts).toBe(1);

    const deactivated = setup(admin({ status: 'DEACTIVATED', lockedUntil: new Date(T0.getTime() + 60_000) }));
    await expect(deactivated.service.login({ email: 'ada@qubalink.com', password: PASSWORD })).rejects.toBeInstanceOf(
      AdminInvalidCredentialsError,
    );
    expect(deactivated.store.admin?.failedAttempts).toBe(0);

    const invited = setup(admin({ status: 'INVITED', passwordHash: null, failedAttempts: 2 }));
    await expect(invited.service.login({ email: 'ada@qubalink.com', password: PASSWORD })).rejects.toBeInstanceOf(
      AdminInvalidCredentialsError,
    );
    expect(invited.store.admin?.failedAttempts).toBe(2);
  });

  it('locks the account for 15 minutes on the fifth failure and reports the remaining time', async () => {
    const { service, store, clock } = setup();
    for (let i = 0; i < 4; i += 1) {
      await expect(service.login({ email: 'ada@qubalink.com', password: 'not-the-password' })).rejects.toBeInstanceOf(
        AdminInvalidCredentialsError,
      );
    }
    await expect(service.login({ email: 'ada@qubalink.com', password: 'not-the-password' })).rejects.toMatchObject({
      code: 'ADMIN_LOCKED',
      retryAfterSeconds: 900,
    });
    expect(store.admin?.lockedUntil?.toISOString()).toBe(new Date(T0.getTime() + ADMIN_LOCK_MS).toISOString());
    clock.advance(60_000);
    await expect(service.login({ email: 'ada@qubalink.com', password: PASSWORD })).rejects.toBeInstanceOf(AdminLockedError);
  });

  it('treats an over-long password as invalid credentials', async () => {
    const { service, store } = setup();
    await expect(
      service.login({ email: 'ada@qubalink.com', password: 'x'.repeat(201) }),
    ).rejects.toBeInstanceOf(AdminInvalidCredentialsError);
    expect(store.admin?.failedAttempts).toBe(0);
  });

  it('opens a session and clears the failure counter', async () => {
    const { service, store } = setup(admin({ failedAttempts: 3 }));
    const session = await service.login({ email: 'Ada@QubaLink.com', password: PASSWORD });
    expect(session.principal.adminId).toBe('admin-1');
    expect(session.token.length).toBeGreaterThan(10);
    expect(store.admin?.failedAttempts).toBe(0);
    expect(store.sessions).toHaveLength(1);
  });

  it('throws SESSION_EXPIRED after idle and SESSION_REVOKED after revoke', async () => {
    const { service, clock } = setup();
    const { token } = await service.login({ email: 'ada@qubalink.com', password: PASSWORD });
    expect(await service.resolveAdminPrincipal(token, T0)).toMatchObject({ adminId: 'admin-1' });
    await expect(service.resolveAdminPrincipal(token, new Date(T0.getTime() + ADMIN_IDLE_MS))).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    const again = await service.login({ email: 'ada@qubalink.com', password: PASSWORD });
    const current = await service.resolveAdminPrincipal(again.token, clock.now());
    if (!current) throw new Error('expected a session');
    await service.revokeSession(current.sessionId);
    await expect(service.resolveAdminPrincipal(again.token, clock.now())).rejects.toBeInstanceOf(SessionRevokedError);
    expect(await service.resolveAdminPrincipal(undefined, clock.now())).toBeNull();
  });

  it('reads the current role and reports the session deadline', async () => {
    const { service, store } = setup(admin({ role: 'ADMIN_STAFF' as AdminRole }));
    const { token } = await service.login({ email: 'ada@qubalink.com', password: PASSWORD });
    if (!store.admin) throw new Error('missing admin');
    store.admin.role = 'SUPER_ADMIN';
    expect((await service.resolveAdminPrincipal(token, T0))?.role).toBe('SUPER_ADMIN');
    const sessionId = store.sessions[0]?.id ?? '';
    const deadline = await service.sessionDeadline(sessionId);
    expect(deadline?.toISOString()).toBe(new Date(T0.getTime() + ADMIN_IDLE_MS).toISOString());
  });
});

describe('admin password tokens', () => {
  it('emails a reset only for an active account that has a password', async () => {
    const active = setup();
    const mail = await active.service.requestPasswordReset('ada@qubalink.com');
    expect(mail?.purpose).toBe('RESET');
    expect(mail?.url).toContain('/admin/update-password?token=');
    expect(mail?.url).not.toContain('invite=1');

    const invited = setup(admin({ status: 'INVITED' as AdminStatus, passwordHash: null }));
    expect(await invited.service.requestPasswordReset('ada@qubalink.com')).toBeNull();
    const missing = setup(null);
    expect(await missing.service.requestPasswordReset('ada@qubalink.com')).toBeNull();
  });

  it('rejects an expired token and a reused token, and revokes sessions', async () => {
    const { service, store, clock } = setup();
    const { token: sessionToken } = await service.login({ email: 'ada@qubalink.com', password: PASSWORD });
    const mail = await service.requestPasswordReset('ada@qubalink.com');
    const raw = linkToken(mail?.url);
    clock.advance(ADMIN_RESET_TTL_MS);
    await expect(service.resetPassword(raw, 'a-brand-new-password')).rejects.toBeInstanceOf(AdminTokenExpiredError);
    clock.advance(-ADMIN_RESET_TTL_MS);
    await service.resetPassword(raw, 'a-brand-new-password');
    expect(store.admin?.passwordHash).toBe('fake:a-brand-new-password');
    expect(store.sessions[0]?.revokedAt).not.toBeNull();
    await expect(service.resolveAdminPrincipal(sessionToken, clock.now())).rejects.toBeInstanceOf(SessionRevokedError);
    await expect(service.resetPassword(raw, 'another-brand-new-password')).rejects.toBeInstanceOf(AdminTokenExpiredError);
  });

  it('replaces an unused reset token so the older link cannot be used', async () => {
    const { service } = setup();
    const first = await service.requestPasswordReset('ada@qubalink.com');
    const second = await service.requestPasswordReset('ada@qubalink.com');
    const oldToken = linkToken(first?.url);
    const newToken = linkToken(second?.url);
    await expect(service.resetPassword(oldToken, 'a-brand-new-password')).rejects.toBeInstanceOf(AdminTokenExpiredError);
    await service.resetPassword(newToken, 'a-brand-new-password');
  });

  it('activates an invite and refuses a common password without using the token', async () => {
    const { service, store } = setup(admin({ status: 'INVITED', passwordHash: null }));
    const url = await service.issueInvite('admin-1');
    expect(url).toContain('invite=1');
    const raw = new URL(url).searchParams.get('token') ?? '';
    await expect(service.resetPassword(raw, 'password1234')).rejects.toBeInstanceOf(ValidationError);
    expect(store.tokens[0]?.usedAt).toBeNull();
    expect(store.admin?.status).toBe('INVITED');
    await service.resetPassword(raw, 'a-brand-new-password');
    expect(store.admin?.status).toBe('ACTIVE');
    const issuedAt = T0.getTime();
    expect(store.tokens[0]?.expiresAt.getTime()).toBe(issuedAt + ADMIN_INVITE_TTL_MS);
  });

  it('keeps the current session when the password changes and revokes the others', async () => {
    const { service, store } = setup();
    const first = await service.login({ email: 'ada@qubalink.com', password: PASSWORD });
    const second = await service.login({ email: 'ada@qubalink.com', password: PASSWORD });
    const current = await service.resolveAdminPrincipal(second.token, T0);
    if (!current) throw new Error('expected a session');
    const keep = current.sessionId;
    await service.changePassword(undefined, 'admin-1', keep, PASSWORD, 'a-brand-new-password');
    expect(store.sessions.find((row) => row.id === keep)?.revokedAt).toBeNull();
    expect(store.sessions.filter((row) => row.revokedAt)).toHaveLength(1);
    expect(sha256Hex(first.token)).not.toBe(sha256Hex(second.token));
    await expect(service.resolveAdminPrincipal(first.token, T0)).rejects.toBeInstanceOf(SessionRevokedError);
    await expect(service.changePassword(undefined, 'admin-1', keep, 'wrong-password', 'yet-another-password')).rejects.toBeInstanceOf(
      AdminInvalidCredentialsError,
    );
  });
});
