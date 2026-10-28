import { describe, expect, it } from 'vitest';
import { directTx, type Tx } from '../../auth/tx.js';
import { AdminPrincipalCache } from '../../auth/admin-principal-cache.js';
import { Authz } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { FakeClock } from '../../lib/clock.js';
import { LastSuperAdminError, SelfRoleChangeError, ValidationError } from '../../lib/errors.js';
import { FakeRandom } from '../../lib/random.js';
import type { AdminRole, AdminStatus } from '../../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { ChangeLogEntry } from '../audit/audit.dto.js';
import type { AuditStore } from '../audit/audit.store.js';
import {
  AdminUsersService,
  type AdminAccountAuth,
  type AdminSessionControl,
  type AdminUserMailJob,
} from './admin-users.service.js';
import type { AdminUserRecord, AdminUserWrite, AdminUsersStore } from './admin-users.store.js';

class MemoryAudit implements AuditStore {
  entries: ChangeLogEntry[] = [];
  insert(_tx: unknown, entry: ChangeLogEntry) {
    this.entries.push(entry);
    return Promise.resolve();
  }
  list() {
    return Promise.resolve({ rows: [], total: 0 });
  }
}

class MemoryAdmins implements AdminUsersStore {
  rows: AdminUserRecord[] = [];

  findById(_tx: Tx, id: string) {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }
  findByEmail(email: string) {
    return Promise.resolve(this.rows.find((row) => row.email === email) ?? null);
  }
  countActiveSuperAdmins() {
    return Promise.resolve(this.rows.filter((row) => row.role === 'SUPER_ADMIN' && row.status === 'ACTIVE').length);
  }
  counts() {
    return Promise.resolve({
      total: this.rows.length,
      superAdmins: this.rows.filter((row) => row.role === 'SUPER_ADMIN').length,
      staff: this.rows.filter((row) => row.role === 'ADMIN_STAFF').length,
      invited: this.rows.filter((row) => row.status === 'INVITED').length,
    });
  }
  insert(_tx: Tx, input: AdminUserWrite) {
    const inviter = this.rows.find((row) => row.id === input.invitedBy);
    const row: AdminUserRecord = {
      id: input.id,
      email: input.email,
      name: input.name,
      role: input.role,
      status: 'INVITED',
      lastLoginAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      invitedBy: input.invitedBy,
      createdByName: inviter?.name ?? null,
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }
  updateName(_tx: Tx, id: string, name: string) {
    const row = this.rows.find((item) => item.id === id);
    if (!row) throw new Error('missing');
    row.name = name;
    return Promise.resolve(row);
  }
  updateRole(_tx: Tx, id: string, role: AdminRole) {
    const row = this.rows.find((item) => item.id === id);
    if (!row) throw new Error('missing');
    row.role = role;
    return Promise.resolve(row);
  }
  updateStatus(_tx: Tx, id: string, status: AdminStatus) {
    const row = this.rows.find((item) => item.id === id);
    if (!row) throw new Error('missing');
    row.status = status;
    return Promise.resolve(row);
  }
  list() {
    return Promise.resolve({ rows: this.rows, total: this.rows.length });
  }
}

const ACTOR = '00000000-0000-4000-8000-000000000001';
const TARGET = '00000000-0000-4000-8000-000000000002';
const OTHER = '00000000-0000-4000-8000-000000000003';

function adminCtx(adminId = ACTOR): ServiceContext {
  const principal = { kind: 'admin' as const, adminId, role: 'SUPER_ADMIN' as const, sessionId: 'sess-1' };
  return { requestId: 'req-1', principal, authz: new Authz(principal), ipHash: 'ip' };
}

function row(partial: Partial<AdminUserRecord> & Pick<AdminUserRecord, 'id' | 'role' | 'status'>): AdminUserRecord {
  return {
    email: `${partial.id}@qubalink.com`,
    name: 'Admin',
    lastLoginAt: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    invitedBy: null,
    createdByName: null,
    ...partial,
  };
}

describe('AdminUsersService', () => {
  function setup(rows: AdminUserRecord[]) {
    const store = new MemoryAdmins();
    store.rows = rows;
    const auditStore = new MemoryAudit();
    const revoked: string[] = [];
    const sessions: AdminSessionControl = {
      revokeSession: () => Promise.resolve(),
      revokeAll: (adminId) => {
        revoked.push(adminId);
        return Promise.resolve();
      },
    };
    const cache = new AdminPrincipalCache();
    const auth: AdminAccountAuth = {
      sessionDeadline: () => Promise.resolve(new Date('2026-04-01T00:30:00.000Z')),
      changePassword: () => Promise.resolve(),
    };
    const mailJobs: AdminUserMailJob[] = [];
    const withPassword = new Set<string>();
    const service = new AdminUsersService({
      store,
      audit: new AuditService(auditStore),
      sessions,
      auth,
      mail: {
        issueInvite: (adminId) => Promise.resolve(`https://civic.example/admin/update-password?token=invite-${adminId}&invite=1`),
        requestPasswordReset: (email) => {
          const found = store.rows.find((row) => row.email === email);
          if (!found || found.status !== 'ACTIVE' || !withPassword.has(found.id)) return Promise.resolve(null);
          return Promise.resolve({
            adminUserId: found.id,
            purpose: 'RESET',
            url: `https://civic.example/admin/update-password?token=reset-${found.id}`,
          });
        },
        enqueue: (job) => {
          mailJobs.push(job);
          return Promise.resolve();
        },
      },
      clock: new FakeClock(new Date('2026-04-01T00:00:00.000Z')),
      random: new FakeRandom(),
      runTx: directTx,
      cache,
    });
    return { store, auditStore, revoked, cache, service, mailJobs, withPassword };
  }

  it('invites any unique email and queues the invite', async () => {
    const { service, mailJobs, auditStore } = setup([row({ id: ACTOR, role: 'SUPER_ADMIN', status: 'ACTIVE', name: 'Ada' })]);
    const created = await service.inviteAdmin(adminCtx(), { email: 'ada@gmail.com', name: 'Ada', role: 'ADMIN_STAFF' });
    expect(created.email).toBe('ada@gmail.com');
    expect(created.status).toBe('INVITED');
    expect(created.createdByName).toBe('Ada');
    expect(mailJobs).toHaveLength(1);
    expect(mailJobs[0]?.purpose).toBe('INVITE');
    expect(JSON.stringify(auditStore.entries)).not.toContain('invite-');
  });

  it('invites a staff admin and writes an audit row', async () => {
    const { store, auditStore, service } = setup([]);
    const created = await service.inviteAdmin(adminCtx(), { email: 'New@qubalink.com', name: 'New', role: 'ADMIN_STAFF' });
    expect(created.status).toBe('INVITED');
    expect(created.email).toBe('new@qubalink.com');
    expect(store.rows).toHaveLength(1);
    expect(auditStore.entries[0]).toMatchObject({ action: 'admin.invited', actorId: ACTOR, actorType: 'ADMIN' });
  });

  it('refuses a self role change', async () => {
    const { service } = setup([row({ id: ACTOR, role: 'SUPER_ADMIN', status: 'ACTIVE' })]);
    await expect(
      service.updateAdminRole(adminCtx(ACTOR), { adminId: ACTOR, role: 'ADMIN_STAFF' }),
    ).rejects.toBeInstanceOf(SelfRoleChangeError);
    await expect(
      service.updateAdminUser(adminCtx(ACTOR), { adminId: ACTOR, role: 'ADMIN_STAFF' }),
    ).rejects.toBeInstanceOf(SelfRoleChangeError);
    await expect(
      service.setAdminStatus(adminCtx(ACTOR), { adminId: ACTOR, status: 'DEACTIVATED' }),
    ).rejects.toBeInstanceOf(SelfRoleChangeError);
  });

  it('refuses to demote or deactivate the last super admin', async () => {
    const { service } = setup([row({ id: TARGET, role: 'SUPER_ADMIN', status: 'ACTIVE' })]);
    await expect(
      service.updateAdminRole(adminCtx(ACTOR), { adminId: TARGET, role: 'ADMIN_STAFF' }),
    ).rejects.toBeInstanceOf(LastSuperAdminError);
    await expect(
      service.updateAdminUser(adminCtx(ACTOR), { adminId: TARGET, name: 'Still Super', role: 'ADMIN_STAFF' }),
    ).rejects.toBeInstanceOf(LastSuperAdminError);
    await expect(
      service.setAdminStatus(adminCtx(ACTOR), { adminId: TARGET, status: 'DEACTIVATED' }),
    ).rejects.toBeInstanceOf(LastSuperAdminError);
  });

  it('revokes sessions when an admin is deactivated', async () => {
    const { revoked, auditStore, service } = setup([
      row({ id: ACTOR, role: 'SUPER_ADMIN', status: 'ACTIVE' }),
      row({ id: OTHER, role: 'SUPER_ADMIN', status: 'ACTIVE' }),
    ]);
    const updated = await service.setAdminStatus(adminCtx(ACTOR), { adminId: OTHER, status: 'DEACTIVATED' });
    expect(updated.status).toBe('DEACTIVATED');
    expect(revoked).toEqual([OTHER]);
    expect(auditStore.entries[0]?.action).toBe('admin.deactivated');
  });

  it('returns the session deadline on adminMe and records a profile rename', async () => {
    const { auditStore, service } = setup([row({ id: ACTOR, role: 'SUPER_ADMIN', status: 'ACTIVE', name: 'Ada' })]);
    const me = await service.adminMe(adminCtx());
    expect(me.sessionExpiresAt.toISOString()).toBe('2026-04-01T00:30:00.000Z');
    const updated = await service.updateMyProfile(adminCtx(), { name: 'Ada Lovelace' });
    expect(updated.name).toBe('Ada Lovelace');
    expect(auditStore.entries[0]).toMatchObject({
      action: 'admin.profile_updated',
      before: { name: 'Ada' },
      after: { name: 'Ada Lovelace' },
    });
  });

  it('records a password change without the password', async () => {
    const { auditStore, service } = setup([row({ id: ACTOR, role: 'SUPER_ADMIN', status: 'ACTIVE' })]);
    await service.changeMyPassword(adminCtx(), {
      currentPassword: 'current-password-1',
      newPassword: 'next-password-long',
    });
    const entry = auditStore.entries[0];
    expect(entry?.action).toBe('admin.password_changed');
    expect(JSON.stringify(entry)).not.toContain('current-password-1');
    expect(JSON.stringify(entry)).not.toContain('next-password-long');
  });

  it('updates a name and role, resends an invite, and sends a reset', async () => {
    const invited = row({ id: TARGET, role: 'ADMIN_STAFF', status: 'INVITED', name: 'New' });
    const active = row({ id: OTHER, role: 'ADMIN_STAFF', status: 'ACTIVE', name: 'Active', email: 'active@qubalink.com' });
    const { service, mailJobs, auditStore, withPassword } = setup([
      row({ id: ACTOR, role: 'SUPER_ADMIN', status: 'ACTIVE', name: 'Ada' }),
      invited,
      active,
    ]);
    withPassword.add(OTHER);
    const renamed = await service.updateAdminUser(adminCtx(ACTOR), { adminId: TARGET, name: 'Newer' });
    expect(renamed.name).toBe('Newer');
    expect(auditStore.entries.at(-1)?.action).toBe('admin.user_updated');
    const resent = await service.resendInvite(adminCtx(ACTOR), { adminId: TARGET });
    expect(resent.status).toBe('INVITED');
    expect(mailJobs.some((job) => job.purpose === 'INVITE' && job.adminUserId === TARGET)).toBe(true);
    expect(JSON.stringify(auditStore.entries)).not.toContain('invite-');
    await service.sendPasswordReset(adminCtx(ACTOR), { adminId: OTHER });
    expect(mailJobs.some((job) => job.purpose === 'RESET' && job.adminUserId === OTHER)).toBe(true);
    expect(JSON.stringify(auditStore.entries)).not.toContain('reset-');
    await expect(service.resendInvite(adminCtx(ACTOR), { adminId: OTHER })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.sendPasswordReset(adminCtx(ACTOR), { adminId: TARGET })).rejects.toBeInstanceOf(ValidationError);
  });

  it('reactivates an admin and counts tiles', async () => {
    const { service, revoked } = setup([
      row({ id: ACTOR, role: 'SUPER_ADMIN', status: 'ACTIVE' }),
      row({ id: OTHER, role: 'ADMIN_STAFF', status: 'DEACTIVATED' }),
      row({ id: TARGET, role: 'ADMIN_STAFF', status: 'INVITED' }),
    ]);
    const restored = await service.setAdminStatus(adminCtx(ACTOR), { adminId: OTHER, status: 'ACTIVE' });
    expect(restored.status).toBe('ACTIVE');
    expect(revoked).toEqual([]);
    const tiles = await service.adminUserTiles(adminCtx());
    expect(tiles).toEqual({ total: 3, superAdmins: 1, staff: 2, invited: 1 });
  });
});
