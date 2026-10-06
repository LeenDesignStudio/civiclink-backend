import type { AdminRole, AdminStatus } from '../generated/prisma/enums.js';
import type { AdminPrincipal } from './admin-principal-cache.js';

export interface AdminLoginRecord {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  status: AdminStatus;
  googleSubject: string | null;
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

export interface AdminAuthStore {
  findByEmail(email: string): Promise<AdminLoginRecord | null>;
  applyFailure(id: string, failedAttempts: number, lockedUntil: Date | null, now: Date): Promise<void>;
  markSuccess(id: string, googleSubject: string, now: Date): Promise<AdminLoginRecord>;
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
  touchSession(id: string, now: Date): Promise<void>;
  revokeSession(id: string, now: Date): Promise<void>;
  revokeAllForAdmin(adminId: string, now: Date): Promise<void>;
}

export type { AdminPrincipal };
