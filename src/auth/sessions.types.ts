import type { UserStatus } from '../generated/prisma/enums.js';

export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface StoredSession {
  id: string;
  userId: string;
  refreshTokenHash: string;
  familyId: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  userStatus: UserStatus;
  userAgent: string | null;
  ipHash: string | null;
  createdAt: Date;
}

export interface NewSession {
  id: string;
  userId: string;
  refreshTokenHash: string;
  familyId: string;
  expiresAt: Date;
  userAgent: string | null;
  ipHash: string | null;
  createdAt: Date;
  userStatus: UserStatus;
}

export interface SessionStore {
  insert(session: NewSession): Promise<StoredSession>;
  findByHash(hash: string): Promise<StoredSession | null>;
  rotate(previousId: string, rotatedAt: Date, next: NewSession): Promise<StoredSession>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeById(id: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
  countActive(userId: string, now: Date): Promise<number>;
}
