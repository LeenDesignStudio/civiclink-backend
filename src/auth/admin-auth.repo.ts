import { sha256Hex } from '../lib/crypto.js';
import { dbCall, type Db } from '../db/prisma.js';
import type { AdminRole, AdminStatus } from '../generated/prisma/enums.js';
import type { AdminAuthStore, AdminLoginRecord, AdminSessionRecord } from './admin-auth.types.js';

export class AdminAuthRepo implements AdminAuthStore {
  constructor(private readonly db: Db) {}

  async findByEmail(email: string): Promise<AdminLoginRecord | null> {
    const row = await dbCall(() =>
      this.db.adminUser.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          googleSubject: true,
          failedAttempts: true,
          lockedUntil: true,
          updatedAt: true,
        },
      }),
    );
    return row;
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

  async markSuccess(id: string, googleSubject: string, now: Date): Promise<AdminLoginRecord> {
    return dbCall(() =>
      this.db.adminUser.update({
        where: { id },
        data: {
          googleSubject,
          status: 'ACTIVE',
          failedAttempts: 0,
          lockedUntil: null,
          lastLoginAt: now,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          googleSubject: true,
          failedAttempts: true,
          lockedUntil: true,
          updatedAt: true,
        },
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
    const row = await dbCall(() =>
      this.db.adminSession.findUnique({
        where: { tokenHash: hash },
        select: {
          id: true,
          adminId: true,
          tokenHash: true,
          lastActivityAt: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
          admin: {
            select: { role: true, status: true, email: true, name: true },
          },
        },
      }),
    );
    if (!row) return null;
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

  async revokeAllForAdmin(adminId: string, now: Date): Promise<void> {
    await dbCall(() =>
      this.db.adminSession.updateMany({
        where: { adminId, revokedAt: null },
        data: { revokedAt: now },
      }),
    );
  }
}

export function hashAdminToken(token: string): string {
  return sha256Hex(token);
}
