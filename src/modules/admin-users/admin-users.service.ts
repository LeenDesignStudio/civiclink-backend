import type { ServiceContext } from '../../graphql/context.js';
import type { AdminPrincipalCache } from '../../auth/admin-principal-cache.js';
import type { RunTx, Tx } from '../../auth/tx.js';
import { ROLE_PERMISSIONS } from '../../authz/permissions.js';
import type { AdminRole, AdminStatus } from '../../generated/prisma/enums.js';
import {
  ConflictError,
  LastSuperAdminError,
  NotFoundError,
  SelfRoleChangeError,
  UnauthenticatedError,
  ValidationError,
  fromZod,
} from '../../lib/errors.js';
import type { Clock } from '../../lib/clock.js';
import type { RandomSource } from '../../lib/random.js';
import { buildConnection, clampFirst, decodeCursor } from '../../lib/pagination.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AdminMeDto, AdminUserDto } from './admin-users.dto.js';
import {
  adminUserListSchema,
  inviteAdminSchema,
  setAdminStatusSchema,
  updateAdminRoleSchema,
} from './admin-users.inputs.js';
import type { AdminUserRecord, AdminUsersStore } from './admin-users.store.js';

export interface AdminSessionControl {
  revokeSession(sessionId: string): Promise<void>;
  revokeAll(adminId: string): Promise<void>;
}

export interface AdminUsersServiceDeps {
  store: AdminUsersStore;
  audit: AuditService;
  sessions: AdminSessionControl;
  clock: Clock;
  random: RandomSource;
  runTx: RunTx;
  hostedDomain: string;
  cache?: AdminPrincipalCache;
}

function toDto(row: AdminUserRecord): AdminUserDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

export class AdminUsersService {
  constructor(private readonly deps: AdminUsersServiceDeps) {}

  async adminMe(ctx: ServiceContext): Promise<AdminMeDto> {
    ctx.authz.require('admin.dashboard:read');
    const { adminId } = ctx.authz.requireAdmin();
    const row = await this.deps.store.findById(undefined, adminId);
    if (!row || row.status !== 'ACTIVE') throw new UnauthenticatedError();
    return { ...toDto(row), permissions: [...ROLE_PERMISSIONS[row.role]] };
  }

  async adminSignOut(ctx: ServiceContext): Promise<void> {
    ctx.authz.require('admin.dashboard:read');
    const actor = ctx.authz.requireAdmin();
    if (ctx.principal.kind !== 'admin') throw new UnauthenticatedError();
    await this.deps.sessions.revokeSession(ctx.principal.sessionId);
    this.deps.cache?.invalidate(actor.adminId);
  }

  async adminUsers(ctx: ServiceContext, input: unknown) {
    ctx.authz.require('admin.users:read');
    ctx.authz.requireAdmin();
    const parsed = adminUserListSchema.safeParse(input ?? {});
    if (!parsed.success) throw fromZod(parsed.error);
    const first = clampFirst(parsed.data.first);
    let cursor: { createdAt: Date; id: string } | undefined;
    if (parsed.data.after) {
      const decoded = decodeCursor(parsed.data.after);
      if (!decoded) throw new ValidationError('That page cursor is not valid.');
      cursor = decoded;
    }
    const filter = parsed.data.filter ?? {};
    const page = await this.deps.store.list({
      limit: first + 1,
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(cursor ? { cursor } : {}),
    });
    const connection = buildConnection(page.rows.map(toDto), first, page.total);
    return { ...connection, totalCount: page.total };
  }

  async inviteAdmin(ctx: ServiceContext, input: unknown): Promise<AdminUserDto> {
    ctx.authz.require('admin.users:manage');
    const actor = ctx.authz.requireAdmin();
    const parsed = inviteAdminSchema.safeParse(input);
    if (!parsed.success) throw fromZod(parsed.error);
    const email = workspaceEmail(parsed.data.email, this.deps.hostedDomain);
    const existing = await this.deps.store.findByEmail(email);
    if (existing) throw new ConflictError('That admin already exists.');
    const name = parsed.data.name && parsed.data.name.length > 0 ? parsed.data.name : null;
    const now = this.deps.clock.now();
    const created = await this.deps.runTx(async (tx) => {
      const row = await this.deps.store.insert(tx, {
        id: this.deps.random.uuid(),
        email,
        name,
        role: parsed.data.role,
        invitedBy: actor.adminId,
        createdAt: now,
      });
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: actor.adminId,
        entityType: 'admin_user',
        entityId: row.id,
        action: 'admin.invited',
        before: null,
        after: { email: row.email, role: row.role, status: row.status },
        requestId: ctx.requestId,
      });
      return row;
    });
    return toDto(created);
  }

  async updateAdminRole(ctx: ServiceContext, input: unknown): Promise<AdminUserDto> {
    ctx.authz.require('admin.users:manage');
    const actor = ctx.authz.requireAdmin();
    const parsed = updateAdminRoleSchema.safeParse(input);
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.path[0] === 'adminId')) throw new NotFoundError();
      throw fromZod(parsed.error);
    }
    if (parsed.data.adminId === actor.adminId) throw new SelfRoleChangeError();
    const updated = await this.deps.runTx(async (tx) => {
      const target = await this.deps.store.findById(tx, parsed.data.adminId);
      if (!target) throw new NotFoundError();
      await this.guardLastSuper(tx, target, parsed.data.role, target.status);
      const row = await this.deps.store.updateRole(tx, target.id, parsed.data.role);
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: actor.adminId,
        entityType: 'admin_user',
        entityId: row.id,
        action: 'admin.role_changed',
        before: { role: target.role },
        after: { role: row.role },
        requestId: ctx.requestId,
      });
      return row;
    });
    this.deps.cache?.invalidate(updated.id);
    return toDto(updated);
  }

  async setAdminStatus(ctx: ServiceContext, input: unknown): Promise<AdminUserDto> {
    ctx.authz.require('admin.users:manage');
    const actor = ctx.authz.requireAdmin();
    const parsed = setAdminStatusSchema.safeParse(input);
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.path[0] === 'adminId')) throw new NotFoundError();
      throw fromZod(parsed.error);
    }
    if (parsed.data.adminId === actor.adminId) throw new SelfRoleChangeError();
    const updated = await this.deps.runTx(async (tx) => {
      const target = await this.deps.store.findById(tx, parsed.data.adminId);
      if (!target) throw new NotFoundError();
      await this.guardLastSuper(tx, target, target.role, parsed.data.status);
      const row = await this.deps.store.updateStatus(tx, target.id, parsed.data.status);
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: actor.adminId,
        entityType: 'admin_user',
        entityId: row.id,
        action: parsed.data.status === 'DEACTIVATED' ? 'admin.deactivated' : 'admin.reactivated',
        before: { status: target.status },
        after: { status: row.status },
        requestId: ctx.requestId,
      });
      return row;
    });
    if (parsed.data.status === 'DEACTIVATED') await this.deps.sessions.revokeAll(updated.id);
    this.deps.cache?.invalidate(updated.id);
    return toDto(updated);
  }

  private async guardLastSuper(
    tx: Tx,
    target: AdminUserRecord,
    nextRole: AdminRole,
    nextStatus: AdminStatus,
  ): Promise<void> {
    const removing =
      target.role === 'SUPER_ADMIN' &&
      target.status === 'ACTIVE' &&
      (nextRole !== 'SUPER_ADMIN' || nextStatus !== 'ACTIVE');
    if (!removing) return;
    const count = await this.deps.store.countActiveSuperAdmins(tx);
    if (count <= 1) throw new LastSuperAdminError();
  }
}

function workspaceEmail(email: string, hostedDomain: string): string {
  const normalized = email.trim().toLowerCase();
  const suffix = `@${hostedDomain.trim().toLowerCase()}`;
  if (!normalized.endsWith(suffix) || normalized.length <= suffix.length) {
    throw new ValidationError('Use your workspace email.', [
      { path: 'input.email', code: 'invalid_domain', message: 'Use your workspace email.' },
    ]);
  }
  return normalized;
}
