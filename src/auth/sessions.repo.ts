import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { UserStatus } from '../generated/prisma/enums.js';
import { dbCall, withTx, type Db } from '../db/prisma.js';
import type { NewSession, SessionStore, StoredSession } from './sessions.types.js';

const sessionSelect = {
  id: true,
  userId: true,
  refreshTokenHash: true,
  familyId: true,
  expiresAt: true,
  rotatedAt: true,
  revokedAt: true,
  userAgent: true,
  ipHash: true,
  createdAt: true,
  user: { select: { status: true } },
} satisfies Prisma.UserSessionSelect;

type SessionRow = Prisma.UserSessionGetPayload<{ select: typeof sessionSelect }>;

function mapSession(row: SessionRow, status?: UserStatus): StoredSession {
  return {
    id: row.id,
    userId: row.userId,
    refreshTokenHash: row.refreshTokenHash,
    familyId: row.familyId,
    expiresAt: row.expiresAt,
    rotatedAt: row.rotatedAt,
    revokedAt: row.revokedAt,
    userStatus: status ?? row.user.status,
    userAgent: row.userAgent,
    ipHash: row.ipHash,
    createdAt: row.createdAt,
  };
}

export class SessionRepo implements SessionStore {
  constructor(private readonly db: Db) {}

  async insert(session: NewSession): Promise<StoredSession> {
    const row = await dbCall(() =>
      this.db.userSession.create({
        data: {
          id: session.id,
          userId: session.userId,
          refreshTokenHash: session.refreshTokenHash,
          familyId: session.familyId,
          expiresAt: session.expiresAt,
          userAgent: session.userAgent,
          ipHash: session.ipHash,
          createdAt: session.createdAt,
        },
        select: sessionSelect,
      }),
    );
    return mapSession(row, session.userStatus);
  }

  async findByHash(hash: string): Promise<StoredSession | null> {
    const row = await dbCall(() =>
      this.db.userSession.findUnique({ where: { refreshTokenHash: hash }, select: sessionSelect }),
    );
    return row ? mapSession(row) : null;
  }

  async rotate(previousId: string, rotatedAt: Date, next: NewSession): Promise<StoredSession> {
    const write = async (tx: Db): Promise<StoredSession> => {
      await tx.userSession.update({ where: { id: previousId }, data: { rotatedAt } });
      const row = await tx.userSession.create({
        data: {
          id: next.id,
          userId: next.userId,
          refreshTokenHash: next.refreshTokenHash,
          familyId: next.familyId,
          expiresAt: next.expiresAt,
          userAgent: next.userAgent,
          ipHash: next.ipHash,
          createdAt: next.createdAt,
        },
        select: sessionSelect,
      });
      return mapSession(row, next.userStatus);
    };
    if ('$transaction' in this.db) {
      return withTx(write, { client: this.db as PrismaClient });
    }
    return dbCall(() => write(this.db));
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await dbCall(() =>
      this.db.userSession.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: at },
      }),
    );
  }

  async revokeById(id: string, at: Date): Promise<void> {
    await dbCall(async () => {
      await this.db.userSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at } });
    });
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await dbCall(() =>
      this.db.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: at },
      }),
    );
  }

  async countActive(userId: string, now: Date): Promise<number> {
    return dbCall(() =>
      this.db.userSession.count({
        where: { userId, revokedAt: null, rotatedAt: null, expiresAt: { gt: now } },
      }),
    );
  }
}
