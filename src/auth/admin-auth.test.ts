import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../lib/crypto.js';
import { FakeClock } from '../lib/clock.js';
import { AdminLockedError, AdminNotAllowedError } from '../lib/errors.js';
import { FakeRandom } from '../lib/random.js';
import { AdminPrincipalCache } from './admin-principal-cache.js';
import { ADMIN_ABSOLUTE_MS, ADMIN_LOCK_MS, AdminAuthService } from './admin-auth.js';
import type { AdminAuthStore, AdminLoginRecord, AdminSessionRecord } from './admin-auth.types.js';

class MemoryAdminAuth implements AdminAuthStore {
  sessions: AdminSessionRecord[] = [];

  constructor(public admin: AdminLoginRecord | null) {}

  findByEmail(email: string) {
    return Promise.resolve(this.admin && this.admin.email === email ? this.admin : null);
  }

  applyFailure(_id: string, failedAttempts: number, lockedUntil: Date | null, now: Date) {
    if (!this.admin) return Promise.resolve();
    this.admin.failedAttempts = failedAttempts;
    this.admin.lockedUntil = lockedUntil;
    this.admin.updatedAt = now;
    return Promise.resolve();
  }

  markSuccess(_id: string, googleSubject: string, now: Date) {
    if (!this.admin) throw new Error('missing');
    this.admin.googleSubject = googleSubject;
    this.admin.status = 'ACTIVE';
    this.admin.failedAttempts = 0;
    this.admin.lockedUntil = null;
    this.admin.updatedAt = now;
    return Promise.resolve(this.admin);
  }

  insertSession(input: Omit<AdminSessionRecord, 'revokedAt'> & { revokedAt?: null }) {
    const row: AdminSessionRecord = { ...input, revokedAt: null };
    this.sessions.push(row);
    return Promise.resolve(row);
  }

  findSessionByHash(hash: string) {
    return Promise.resolve(this.sessions.find((row) => row.tokenHash === hash) ?? null);
  }

  touchSession(id: string, now: Date) {
    const row = this.sessions.find((item) => item.id === id);
    if (row) row.lastActivityAt = now;
    return Promise.resolve();
  }

  revokeSession(id: string, now: Date) {
    const row = this.sessions.find((item) => item.id === id);
    if (row && !row.revokedAt) row.revokedAt = now;
    return Promise.resolve();
  }

  revokeAllForAdmin(adminId: string, now: Date) {
    for (const row of this.sessions) {
      if (row.adminId === adminId && !row.revokedAt) row.revokedAt = now;
    }
    return Promise.resolve();
  }
}

function admin(overrides?: Partial<AdminLoginRecord>): AdminLoginRecord {
  return {
    id: 'admin-1',
    email: 'ada@qubalink.com',
    name: 'Ada',
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
    googleSubject: 'subject-1',
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AdminAuthService', () => {
  const t0 = new Date('2026-04-01T00:00:00.000Z');

  function setup(row: AdminLoginRecord | null = admin()) {
    const store = new MemoryAdminAuth(row);
    const clock = new FakeClock(t0);
    const service = new AdminAuthService({
      store,
      clock,
      random: new FakeRandom(),
      hostedDomain: 'qubalink.com',
    });
    return { store, clock, service };
  }

  const good = { email: 'ada@qubalink.com', emailVerified: true, subject: 'subject-1', hd: 'qubalink.com' };

  it('locks the account after five failures and keeps it locked', async () => {
    const { store, clock, service } = setup();
    const bad = { ...good, subject: 'other-subject' };
    for (let i = 0; i < 4; i += 1) {
      await expect(service.completeLogin(bad)).rejects.toBeInstanceOf(AdminNotAllowedError);
    }
    await expect(service.completeLogin(bad)).rejects.toBeInstanceOf(AdminLockedError);
    await expect(service.completeLogin(good)).rejects.toBeInstanceOf(AdminLockedError);
    clock.advance(ADMIN_LOCK_MS + 1000);
    const admin = store.admin;
    if (!admin) throw new Error('admin missing');
    admin.updatedAt = clock.now();
    const session = await service.completeLogin(good);
    expect(session.principal.adminId).toBe('admin-1');
    expect(store.admin?.failedAttempts).toBe(0);
  });

  it('rejects the wrong workspace domain', async () => {
    const { service } = setup();
    await expect(service.completeLogin({ ...good, hd: 'gmail.com' })).rejects.toBeInstanceOf(AdminNotAllowedError);
    await expect(service.completeLogin({ ...good, email: 'ada@gmail.com', hd: 'gmail.com' })).rejects.toBeInstanceOf(
      AdminNotAllowedError,
    );
  });

  it('activates an invited admin and binds the Google subject', async () => {
    const { store, service } = setup(admin({ status: 'INVITED', googleSubject: null }));
    const session = await service.completeLogin(good);
    expect(store.admin?.status).toBe('ACTIVE');
    expect(store.admin?.googleSubject).toBe('subject-1');
    expect(session.token.length).toBeGreaterThan(10);
  });

  it('treats an idle session as anonymous', async () => {
    const { service } = setup();
    const { token } = await service.completeLogin(good);
    expect(await service.resolveAdminPrincipal(token, t0)).toMatchObject({ adminId: 'admin-1' });
    const idle = new Date(t0.getTime() + 31 * 60 * 1000);
    expect(await service.resolveAdminPrincipal(token, idle)).toBeNull();
  });

  it('treats a session past the absolute lifetime as anonymous', async () => {
    const { store, service } = setup();
    const { token } = await service.completeLogin(good);
    const session = store.sessions[0];
    if (!session) throw new Error('missing session');
    session.lastActivityAt = new Date(t0.getTime() + ADMIN_ABSOLUTE_MS - 1000);
    const tooLate = new Date(t0.getTime() + ADMIN_ABSOLUTE_MS + 1000);
    expect(await service.resolveAdminPrincipal(token, tooLate)).toBeNull();
  });

  it('returns the role stored on the admin row', async () => {
    const { store, service } = setup();
    const { token } = await service.completeLogin(good);
    const session = store.sessions.find((row) => row.tokenHash === sha256Hex(token));
    if (!session) throw new Error('missing session');
    session.role = 'EDITOR';
    expect((await service.resolveAdminPrincipal(token, t0))?.role).toBe('EDITOR');
  });
});

describe('AdminPrincipalCache', () => {
  it('expires after 30 seconds and drops invalidated admins', () => {
    const cache = new AdminPrincipalCache();
    const now = new Date('2026-04-01T00:00:00.000Z');
    const principal = {
      adminId: 'admin-1',
      role: 'VIEWER' as const,
      sessionId: 'sess',
      email: 'ada@qubalink.com',
      name: 'Ada',
    };
    cache.set(principal.adminId, principal, now);
    expect(cache.get('admin-1', new Date(now.getTime() + 29_000))?.role).toBe('VIEWER');
    expect(cache.get('admin-1', new Date(now.getTime() + 30_000))).toBeUndefined();
    cache.set(principal.adminId, principal, now);
    cache.invalidate('admin-1');
    expect(cache.get('admin-1', now)).toBeUndefined();
  });
});
