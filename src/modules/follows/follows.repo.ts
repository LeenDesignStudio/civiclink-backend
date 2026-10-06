import { dbCall, type Db } from '../../db/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import type { FollowDto, FollowHolder, GovLevel } from './follows.dto.js';
import type { FollowPage, FollowsRepo as FollowsStore, NewFollow } from './follows.ports.js';

function bind(db: Db, tx: unknown): Db {
  if (typeof tx === 'object' && tx !== null && '$queryRaw' in tx) return tx as Db;
  return db;
}

type OfficeRow = {
  id: string;
  name: string;
  lastUpdatedAt: Date;
  jurisdiction: { level: GovLevel };
  terms: { official: FollowHolder }[];
};

function officeOf(row: OfficeRow): FollowDto['office'] {
  return {
    id: row.id,
    name: row.name,
    level: row.jurisdiction.level,
    lastUpdatedAt: row.lastUpdatedAt,
  };
}

function holderOf(row: OfficeRow): FollowHolder | null {
  return row.terms[0]?.official ?? null;
}

const officeInclude = {
  jurisdiction: { select: { level: true } },
  terms: {
    where: { isCurrent: true },
    take: 1,
    select: { official: { select: { id: true, fullName: true, displayName: true } } },
  },
} as const;

export class FollowsRepo implements FollowsStore {
  constructor(private readonly db: Db) {}

  async findActiveOffice(officeId: string): Promise<FollowDto['office'] | null> {
    const row = await dbCall(() =>
      this.db.office.findFirst({
        where: { id: officeId, status: 'ACTIVE' },
        select: { id: true, name: true, lastUpdatedAt: true, ...officeInclude },
      }),
    );
    return row ? officeOf(row) : null;
  }

  async officialHasTerm(officialId: string, officeId: string): Promise<boolean> {
    const term = await dbCall(() =>
      this.db.officeTerm.findFirst({ where: { officialId, officeId }, select: { id: true } }),
    );
    return term !== null;
  }

  async findByUserOffice(userId: string, officeId: string, tx?: unknown): Promise<FollowDto | null> {
    const row = await dbCall(() =>
      bind(this.db, tx).follow.findFirst({
        where: { userId, officeId },
        select: {
          id: true,
          officeId: true,
          officialId: true,
          createdAt: true,
          office: { select: { id: true, name: true, lastUpdatedAt: true, ...officeInclude } },
        },
      }),
    );
    if (!row) return null;
    return {
      id: row.id,
      officeId: row.officeId,
      officialId: row.officialId,
      createdAt: row.createdAt,
      office: officeOf(row.office),
      holder: holderOf(row.office),
    };
  }

  async countOwned(userId: string, tx?: unknown): Promise<number> {
    return dbCall(() => bind(this.db, tx).follow.count({ where: { userId } }));
  }

  async insert(row: NewFollow, tx?: unknown): Promise<FollowDto> {
    const db = bind(this.db, tx);
    const created = await dbCall(() =>
      db.follow.create({
        data: { userId: row.userId, officeId: row.officeId, officialId: row.officialId },
        select: { id: true, officeId: true, officialId: true, createdAt: true },
      }),
    );
    const office = await dbCall(() =>
      db.office.findFirst({
        where: { id: created.officeId },
        select: { id: true, name: true, lastUpdatedAt: true, ...officeInclude },
      }),
    );
    if (!office) throw new NotFoundError();
    return {
      id: created.id,
      officeId: created.officeId,
      officialId: created.officialId,
      createdAt: created.createdAt,
      office: officeOf(office),
      holder: holderOf(office),
    };
  }

  async deleteByUserOffice(userId: string, officeId: string): Promise<boolean> {
    const result = await dbCall(() => this.db.follow.deleteMany({ where: { userId, officeId } }));
    return result.count > 0;
  }

  async listOwned(userId: string, page: FollowPage): Promise<FollowDto[]> {
    const rows = await dbCall(() =>
      this.db.follow.findMany({
        where: {
          userId,
          ...(page.after
            ? {
                OR: [
                  { createdAt: { lt: page.after.createdAt } },
                  { createdAt: page.after.createdAt, id: { lt: page.after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: page.limit,
        select: {
          id: true,
          officeId: true,
          officialId: true,
          createdAt: true,
          office: { select: { id: true, name: true, lastUpdatedAt: true, ...officeInclude } },
        },
      }),
    );
    return rows.map((row) => ({
      id: row.id,
      officeId: row.officeId,
      officialId: row.officialId,
      createdAt: row.createdAt,
      office: officeOf(row.office),
      holder: holderOf(row.office),
    }));
  }
}
