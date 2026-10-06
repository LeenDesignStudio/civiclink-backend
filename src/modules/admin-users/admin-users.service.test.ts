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
import { AdminUsersService, type AdminSessionControl } from './admin-users.service.js';
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
  insert(_tx: Tx, input: AdminUserWrite) {
    const row: AdminUserRecord = {
      id: input.id,
      email: input.email,
      name: input.name,
      role: input.role,
      status: 'INVITED',
      lastLoginAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.rows.push(row);
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
    const service = new AdminUsersService({
      store,
      audit: new AuditService(auditStore),
      sessions,
      clock: new FakeClock(new Date('2026-04-01T00:00:00.000Z')),
      random: new FakeRandom(),
      runTx: directTx,
      hostedDomain: 'qubalink.com',
      cache,
    });
    return { store, auditStore, revoked, cache, service };
  }

  it('rejects an invite outside the workspace domain', async () => {
    const { service } = setup([]);
    await expect(
      service.inviteAdmin(adminCtx(), { email: 'ada@gmail.com', role: 'VIEWER' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('invites a workspace admin and writes an audit row', async () => {
    const { store, auditStore, service } = setup([]);
    const created = await service.inviteAdmin(adminCtx(), { email: 'New@qubalink.com', name: 'New', role: 'EDITOR' });
    expect(created.status).toBe('INVITED');
    expect(created.email).toBe('new@qubalink.com');
    expect(store.rows).toHaveLength(1);
    expect(auditStore.entries[0]).toMatchObject({ action: 'admin.invited', actorId: ACTOR, actorType: 'ADMIN' });
  });

  it('refuses a self role change', async () => {
    const { service } = setup([row({ id: ACTOR, role: 'SUPER_ADMIN', status: 'ACTIVE' })]);
    await expect(
      service.updateAdminRole(adminCtx(ACTOR), { adminId: ACTOR, role: 'EDITOR' }),
    ).rejects.toBeInstanceOf(SelfRoleChangeError);
  });

  it('refuses to demote or deactivate the last super admin', async () => {
    const { service } = setup([row({ id: TARGET, role: 'SUPER_ADMIN', status: 'ACTIVE' })]);
    await expect(
      service.updateAdminRole(adminCtx(ACTOR), { adminId: TARGET, role: 'EDITOR' }),
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
});
