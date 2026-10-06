import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';
import { sha256Hex } from '../lib/crypto.js';
import {
  AccountDeletedError,
  AccountPendingDeletionError,
  SessionExpiredError,
  SessionRevokedError,
} from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { RandomSource } from '../lib/random.js';
import { systemRandom } from '../lib/random.js';
import type { UserStatus } from '../generated/prisma/enums.js';
import { REFRESH_TTL_MS, type NewSession, type SessionStore } from './sessions.types.js';

export interface IssuedSession {
  refreshToken: string;
  sessionId: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
}

export interface SessionServiceDeps {
  store: SessionStore;
  clock?: Clock;
  random?: RandomSource;
}

export class SessionService {
  private readonly clock: Clock;
  private readonly random: RandomSource;

  constructor(private readonly deps: SessionServiceDeps) {
    this.clock = deps.clock ?? systemClock;
    this.random = deps.random ?? systemRandom;
  }

  async create(input: {
    userId: string;
    userStatus?: UserStatus;
    userAgent?: string;
    ipHash?: string;
  }): Promise<IssuedSession> {
    const now = this.clock.now();
    const refreshToken = this.random.token(32);
    const session = await this.deps.store.insert({
      id: this.random.uuid(),
      userId: input.userId,
      refreshTokenHash: sha256Hex(refreshToken),
      familyId: this.random.uuid(),
      expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
      userAgent: input.userAgent ?? null,
      ipHash: input.ipHash ?? null,
      createdAt: now,
      userStatus: input.userStatus ?? 'ACTIVE',
    });
    return this.issued(refreshToken, session);
  }

  async rotate(refreshToken: string): Promise<IssuedSession> {
    const now = this.clock.now();
    const current = await this.deps.store.findByHash(sha256Hex(refreshToken));
    if (!current) throw new SessionExpiredError();
    if (current.rotatedAt) {
      await this.deps.store.revokeFamily(current.familyId, now);
      logger.warn({ familyId: current.familyId }, 'refresh token reuse revoked session family');
      throw new SessionRevokedError();
    }
    if (current.revokedAt) throw new SessionRevokedError();
    if (current.expiresAt.getTime() <= now.getTime()) throw new SessionExpiredError();
    if (current.userStatus === 'DELETED' || current.userStatus === 'PENDING_DELETION') {
      await this.deps.store.revokeAllForUser(current.userId, now);
      if (current.userStatus === 'DELETED') throw new AccountDeletedError();
      throw new AccountPendingDeletionError();
    }
    const nextToken = this.random.token(32);
    const next: NewSession = {
      id: this.random.uuid(),
      userId: current.userId,
      refreshTokenHash: sha256Hex(nextToken),
      familyId: current.familyId,
      expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
      userAgent: current.userAgent,
      ipHash: current.ipHash,
      createdAt: now,
      userStatus: current.userStatus,
    };
    const created = await this.deps.store.rotate(current.id, now, next);
    return this.issued(nextToken, created);
  }

  async revoke(sessionId: string): Promise<void> {
    await this.deps.store.revokeById(sessionId, this.clock.now());
  }

  async revokeAll(userId: string): Promise<void> {
    await this.deps.store.revokeAllForUser(userId, this.clock.now());
  }

  async countActive(userId: string): Promise<number> {
    return this.deps.store.countActive(userId, this.clock.now());
  }

  private issued(
    refreshToken: string,
    session: { id: string; familyId: string; userId: string; expiresAt: Date },
  ): IssuedSession {
    return {
      refreshToken,
      sessionId: session.id,
      familyId: session.familyId,
      userId: session.userId,
      expiresAt: session.expiresAt,
    };
  }
}
