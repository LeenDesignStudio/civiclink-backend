import type { AdminAuthTokenPurpose, AdminRole, AdminStatus } from '../generated/prisma/enums.js';
import type { Tx } from './tx.js';
import type { AdminPrincipal } from './admin-principal-cache.js';

export interface AdminLoginRecord {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  status: AdminStatus;
  passwordHash: string | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  updatedAt: Date;
}

export interface AdminSessionRecord {
  id: string;
  adminId: string;
  tokenHash: string;
  lastActivityAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  role: AdminRole;
  status: AdminStatus;
  email: string;
  name: string | null;
}

export interface AdminTokenView {
  purpose: AdminAuthTokenPurpose;
  expiresAt: Date;
  usedAt: Date | null;
  adminId: string;
  email: string;
  status: AdminStatus;
}

export interface AdminAuthStore {
  findByEmail(email: string): Promise<AdminLoginRecord | null>;
  findById(id: string, tx?: Tx): Promise<AdminLoginRecord | null>;
  applyFailure(id: string, failedAttempts: number, lockedUntil: Date | null, now: Date): Promise<void>;
  markLogin(id: string, now: Date): Promise<AdminLoginRecord>;
  setPassword(tx: Tx, id: string, passwordHash: string, now: Date, activate: boolean): Promise<void>;
  insertSession(input: {
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
  }): Promise<AdminSessionRecord>;
  findSessionByHash(hash: string): Promise<AdminSessionRecord | null>;
  findSessionById(id: string): Promise<AdminSessionRecord | null>;
  touchSession(id: string, now: Date): Promise<void>;
  revokeSession(id: string, now: Date): Promise<void>;
  revokeAllForAdmin(adminId: string, now: Date, exceptSessionId?: string, tx?: Tx): Promise<void>;
  saveToken(input: {
    id: string;
    adminUserId: string;
    purpose: AdminAuthTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
  readToken(tokenHash: string): Promise<AdminTokenView | null>;
  consumeToken(
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<{ adminId: string } | null>;
}

export type { AdminPrincipal };
