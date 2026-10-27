import { sha256Hex } from '../lib/crypto.js';
import { dbCall, type Db } from '../db/prisma.js';
import type { AdminAuthTokenPurpose, AdminRole, AdminStatus } from '../generated/prisma/enums.js';
import type { Tx } from './tx.js';
import type { AdminAuthStore, AdminLoginRecord, AdminSessionRecord, AdminTokenView } from './admin-auth.types.js';

const loginSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  passwordHash: true,
  failedAttempts: true,
  lockedUntil: true,
  updatedAt: true,
} as const;

const sessionSelect = {
  id: true,
  adminId: true,
  tokenHash: true,
  lastActivityAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  admin: { select: { role: true, status: true, email: true, name: true } },
} as const;

export class AdminAuthRepo implements AdminAuthStore {
  constructor(private readonly db: Db) {}

  private use(tx: Tx): Db {
    if (tx && typeof tx === 'object' && 'adminUser' in tx) return tx as Db;
    return this.db;
  }

  async findByEmail(email: string): Promise<AdminLoginRecord | null> {
    return dbCall(() => this.db.adminUser.findUnique({ where: { email }, select: loginSelect }));
  }

  async findById(id: string, tx?: Tx): Promise<AdminLoginRecord | null> {
    return dbCall(() => this.use(tx).adminUser.findUnique({ where: { id }, select: loginSelect }));
  }

  async applyFailure(id: string, failedAttempts: number, lockedUntil: Date | null, _now: Date): Promise<void> {
    await dbCall(() =>
      this.db.adminUser.update({
        where: { id },
        data: { failedAttempts, lockedUntil },
        select: { id: true },
      }),
    );
  }

  async markLogin(id: string, now: Date): Promise<AdminLoginRecord> {
    return dbCall(() =>
      this.db.adminUser.update({
        where: { id },
        data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: now },
        select: loginSelect,
      }),
    );
  }

  async setPassword(tx: Tx, id: string, passwordHash: string, now: Date, activate: boolean): Promise<void> {
    await dbCall(() =>
      this.use(tx).adminUser.update({
        where: { id },
        data: {
          passwordHash,
          passwordUpdatedAt: now,
          failedAttempts: 0,
          lockedUntil: null,
          ...(activate ? { status: 'ACTIVE' as const } : {}),
        },
        select: { id: true },
      }),
    );
  }

  async insertSession(input: {
    id: string;
    adminId: string;
    tokenHash: string;
    lastActivityAt: Date;
    expiresAt: Date;
    createdAt: Date;
    userAgent: string | null;
    ipHash: string | null;
    role: AdminRole;
    status: AdminStatus;
    email: string;
    name: string | null;
  }): Promise<AdminSessionRecord> {
    await dbCall(() =>
      this.db.adminSession.create({
        data: {
          id: input.id,
          adminId: input.adminId,
          tokenHash: input.tokenHash,
          lastActivityAt: input.lastActivityAt,
          expiresAt: input.expiresAt,
          createdAt: input.createdAt,
          userAgent: input.userAgent,
          ipHash: input.ipHash,
        },
        select: { id: true },
      }),
    );
    return {
      id: input.id,
      adminId: input.adminId,
      tokenHash: input.tokenHash,
      lastActivityAt: input.lastActivityAt,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: input.createdAt,
      role: input.role,
      status: input.status,
      email: input.email,
      name: input.name,
    };
  }

  async findSessionByHash(hash: string): Promise<AdminSessionRecord | null> {
    const row = await dbCall(() => this.db.adminSession.findUnique({ where: { tokenHash: hash }, select: sessionSelect }));
    return row ? toSession(row) : null;
  }

  async findSessionById(id: string): Promise<AdminSessionRecord | null> {
    const row = await dbCall(() => this.db.adminSession.findUnique({ where: { id }, select: sessionSelect }));
    return row ? toSession(row) : null;
  }

  async touchSession(id: string, now: Date): Promise<void> {
    await dbCall(() =>
      this.db.adminSession.updateMany({
        where: { id, revokedAt: null },
        data: { lastActivityAt: now },
      }),
    );
  }

  async revokeSession(id: string, now: Date): Promise<void> {
    await dbCall(() =>
      this.db.adminSession.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: now },
      }),
    );
  }

  async revokeAllForAdmin(adminId: string, now: Date, exceptSessionId?: string, tx?: Tx): Promise<void> {
    await dbCall(() =>
      this.use(tx).adminSession.updateMany({
        where: {
          adminId,
          revokedAt: null,
          ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
        },
        data: { revokedAt: now },
      }),
    );
  }

  async saveToken(input: {
    id: string;
    adminUserId: string;
    purpose: AdminAuthTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void> {
    await dbCall(() =>
      this.db.$transaction(async (tx) => {
        await tx.adminAuthToken.updateMany({
          where: { adminUserId: input.adminUserId, purpose: input.purpose, usedAt: null },
          data: { usedAt: input.now },
        });
        await tx.adminAuthToken.create({
          data: {
            id: input.id,
            adminUserId: input.adminUserId,
            purpose: input.purpose,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
            createdAt: input.now,
          },
          select: { id: true },
        });
      }),
    );
  }

  async readToken(tokenHash: string): Promise<AdminTokenView | null> {
    const row = await dbCall(() =>
      this.db.adminAuthToken.findUnique({
        where: { tokenHash },
        select: {
          purpose: true,
          expiresAt: true,
          usedAt: true,
          adminUserId: true,
          admin: { select: { email: true, status: true } },
        },
      }),
    );
    if (!row) return null;
    return {
      purpose: row.purpose,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      adminId: row.adminUserId,
      email: row.admin.email,
      status: row.admin.status,
    };
  }

  async consumeToken(tokenHash: string, passwordHash: string, now: Date): Promise<{ adminId: string } | null> {
    return dbCall(() =>
      this.db.$transaction(async (tx) => {
        const token = await tx.adminAuthToken.findUnique({
          where: { tokenHash },
          select: {
            id: true,
            purpose: true,
            expiresAt: true,
            usedAt: true,
            adminUserId: true,
            admin: { select: { status: true } },
          },
        });
        if (!token || token.usedAt || token.expiresAt.getTime() <= now.getTime()) return null;
        if (token.admin.status === 'DEACTIVATED') return null;
        if (token.purpose === 'RESET' && token.admin.status !== 'ACTIVE') return null;
        const marked = await tx.adminAuthToken.updateMany({
          where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (marked.count !== 1) return null;
        await tx.adminUser.update({
          where: { id: token.adminUserId },
          data: {
            passwordHash,
            passwordUpdatedAt: now,
            failedAttempts: 0,
            lockedUntil: null,
            ...(token.purpose === 'INVITE' ? { status: 'ACTIVE' as const } : {}),
          },
          select: { id: true },
        });
        await tx.adminSession.updateMany({
          where: { adminId: token.adminUserId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { adminId: token.adminUserId };
      }),
    );
  }

  async findForPasswordMail(id: string): Promise<{ email: string; status: AdminStatus } | null> {
    return dbCall(() => this.db.adminUser.findUnique({ where: { id }, select: { email: true, status: true } }));
  }
}

function toSession(row: {
  id: string;
  adminId: string;
  tokenHash: string;
  lastActivityAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  admin: { role: AdminRole; status: AdminStatus; email: string; name: string | null };
}): AdminSessionRecord {
  return {
    id: row.id,
    adminId: row.adminId,
    tokenHash: row.tokenHash,
    lastActivityAt: row.lastActivityAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    role: row.admin.role,
    status: row.admin.status,
    email: row.admin.email,
    name: row.admin.name,
  };
}

export function hashAdminToken(token: string): string {
  return sha256Hex(token);
}
