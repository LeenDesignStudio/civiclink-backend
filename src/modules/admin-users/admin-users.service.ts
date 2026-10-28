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
import type { AdminMeDto, AdminUserDto, AdminUserTiles } from './admin-users.dto.js';
import {
  adminUserIdSchema,
  adminUserListSchema,
  changeMyPasswordSchema,
  inviteAdminSchema,
  setAdminStatusSchema,
  updateAdminRoleSchema,
  updateAdminUserSchema,
  updateMyProfileSchema,
} from './admin-users.inputs.js';
import type { AdminUserRecord, AdminUsersStore } from './admin-users.store.js';

export interface AdminSessionControl {
  revokeSession(sessionId: string): Promise<void>;
  revokeAll(adminId: string): Promise<void>;
}

export interface AdminAccountAuth {
  sessionDeadline(sessionId: string): Promise<Date | null>;
  changePassword(
    tx: Tx,
    adminId: string,
    sessionId: string,
    currentPassword: string,
    nextPassword: string,
  ): Promise<void>;
}

export interface AdminUserMailJob {
  adminUserId: string;
  purpose: 'INVITE' | 'RESET';
  url: string;
}

export interface AdminUserMail {
  issueInvite(adminId: string): Promise<string>;
  requestPasswordReset(email: string): Promise<AdminUserMailJob | null>;
  enqueue(job: AdminUserMailJob): Promise<void>;
}

export interface AdminUsersServiceDeps {
  store: AdminUsersStore;
  audit: AuditService;
  sessions: AdminSessionControl;
  auth: AdminAccountAuth;
  mail: AdminUserMail;
  clock: Clock;
  random: RandomSource;
  runTx: RunTx;
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
    createdByName: row.createdByName,
  };
}

export class AdminUsersService {
  constructor(private readonly deps: AdminUsersServiceDeps) {}

  async adminMe(ctx: ServiceContext): Promise<AdminMeDto> {
    ctx.authz.require('admin.dashboard:read');
    const { adminId } = ctx.authz.requireAdmin();
    if (ctx.principal.kind !== 'admin') throw new UnauthenticatedError();
    const row = await this.deps.store.findById(undefined, adminId);
    if (!row || row.status !== 'ACTIVE') throw new UnauthenticatedError();
    const sessionExpiresAt = await this.deps.auth.sessionDeadline(ctx.principal.sessionId);
    if (!sessionExpiresAt) throw new UnauthenticatedError();
    return { ...toDto(row), permissions: [...ROLE_PERMISSIONS[row.role]], sessionExpiresAt };
  }

  async myAdminProfile(ctx: ServiceContext): Promise<AdminMeDto> {
    return this.adminMe(ctx);
  }

  async updateMyProfile(ctx: ServiceContext, input: unknown): Promise<AdminUserDto> {
    ctx.authz.require('admin.dashboard:read');
    const actor = ctx.authz.requireAdmin();
    const parsed = updateMyProfileSchema.safeParse(input);
    if (!parsed.success) throw fromZod(parsed.error);
    const updated = await this.deps.runTx(async (tx) => {
      const row = await this.deps.store.findById(tx, actor.adminId);
      if (!row || row.status !== 'ACTIVE') throw new UnauthenticatedError();
      const previousName = row.name;
      const next = await this.deps.store.updateName(tx, row.id, parsed.data.name);
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: actor.adminId,
        entityType: 'admin_user',
        entityId: row.id,
        action: 'admin.profile_updated',
        before: { name: previousName },
        after: { name: next.name },
        requestId: ctx.requestId,
      });
      return next;
    });
    return toDto(updated);
  }

  async changeMyPassword(ctx: ServiceContext, input: unknown): Promise<void> {
    ctx.authz.require('admin.dashboard:read');
    const actor = ctx.authz.requireAdmin();
    if (ctx.principal.kind !== 'admin') throw new UnauthenticatedError();
    const parsed = changeMyPasswordSchema.safeParse(input);
    if (!parsed.success) throw fromZod(parsed.error);
    const sessionId = ctx.principal.sessionId;
    await this.deps.runTx(async (tx) => {
      await this.deps.auth.changePassword(
        tx,
        actor.adminId,
        sessionId,
        parsed.data.currentPassword,
        parsed.data.newPassword,
      );
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: actor.adminId,
        entityType: 'admin_user',
        entityId: actor.adminId,
        action: 'admin.password_changed',
        before: null,
        after: { changed: true },
        requestId: ctx.requestId,
      });
    });
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

  async adminUserTiles(ctx: ServiceContext): Promise<AdminUserTiles> {
    ctx.authz.require('admin.users:read');
    ctx.authz.requireAdmin();
    return this.deps.store.counts();
  }

  async inviteAdmin(ctx: ServiceContext, input: unknown): Promise<AdminUserDto> {
    ctx.authz.require('admin.users:manage');
    const actor = ctx.authz.requireAdmin();
    const parsed = inviteAdminSchema.safeParse(input);
    if (!parsed.success) throw fromZod(parsed.error);
    const email = parsed.data.email.trim().toLowerCase();
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
        invitedAt: now,
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
    const url = await this.deps.mail.issueInvite(created.id);
    await this.deps.mail.enqueue({ adminUserId: created.id, purpose: 'INVITE', url });
    return toDto(created);
  }

  async updateAdminUser(ctx: ServiceContext, input: unknown): Promise<AdminUserDto> {
    ctx.authz.require('admin.users:manage');
    const actor = ctx.authz.requireAdmin();
    const parsed = updateAdminUserSchema.safeParse(input);
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.path[0] === 'adminId')) throw new NotFoundError();
      throw fromZod(parsed.error);
    }
    if (parsed.data.role !== undefined && parsed.data.adminId === actor.adminId) throw new SelfRoleChangeError();
    const updated = await this.deps.runTx(async (tx) => {
      const target = await this.deps.store.findById(tx, parsed.data.adminId);
      if (!target) throw new NotFoundError();
      const nextRole = parsed.data.role ?? target.role;
      await this.guardLastSuper(tx, target, nextRole, target.status);
      let row = target;
      if (parsed.data.name !== undefined && parsed.data.name !== target.name) {
        row = await this.deps.store.updateName(tx, target.id, parsed.data.name);
      }
      if (parsed.data.role !== undefined && parsed.data.role !== target.role) {
        row = await this.deps.store.updateRole(tx, row.id, parsed.data.role);
      }
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: actor.adminId,
        entityType: 'admin_user',
        entityId: row.id,
        action: 'admin.user_updated',
        before: { name: target.name, role: target.role },
        after: { name: row.name, role: row.role },
        requestId: ctx.requestId,
      });
      return row;
    });
    this.deps.cache?.invalidate(updated.id);
    return toDto(updated);
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

  async resendInvite(ctx: ServiceContext, input: unknown): Promise<AdminUserDto> {
    ctx.authz.require('admin.users:manage');
    const actor = ctx.authz.requireAdmin();
    const parsed = adminUserIdSchema.safeParse(input);
    if (!parsed.success) throw new NotFoundError();
    const target = await this.deps.store.findById(undefined, parsed.data.adminId);
    if (!target) throw new NotFoundError();
    if (target.status !== 'INVITED') throw new ValidationError('Resend is only for an invite that has not been accepted.');
    const url = await this.deps.mail.issueInvite(target.id);
    await this.deps.mail.enqueue({ adminUserId: target.id, purpose: 'INVITE', url });
    await this.deps.runTx(async (tx) => {
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: actor.adminId,
        entityType: 'admin_user',
        entityId: target.id,
        action: 'admin.invite_resent',
        before: null,
        after: { status: target.status },
        requestId: ctx.requestId,
      });
    });
    return toDto(target);
  }

  async sendPasswordReset(ctx: ServiceContext, input: unknown): Promise<void> {
    ctx.authz.require('admin.users:manage');
    const actor = ctx.authz.requireAdmin();
    const parsed = adminUserIdSchema.safeParse(input);
    if (!parsed.success) throw new NotFoundError();
    const target = await this.deps.store.findById(undefined, parsed.data.adminId);
    if (!target) throw new NotFoundError();
    if (target.status !== 'ACTIVE') throw new ValidationError('Activate this admin before sending a password reset.');
    const issued = await this.deps.mail.requestPasswordReset(target.email);
    if (!issued) throw new ValidationError('This admin cannot reset a password yet.');
    await this.deps.mail.enqueue(issued);
    await this.deps.runTx(async (tx) => {
      await this.deps.audit.record(tx, {
        actorType: 'ADMIN',
        actorId: actor.adminId,
        entityType: 'admin_user',
        entityId: target.id,
        action: 'admin.password_reset_sent',
        before: null,
        after: { sent: true },
        requestId: ctx.requestId,
      });
    });
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
