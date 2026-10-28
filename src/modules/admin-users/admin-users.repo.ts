import type { AdminRole, AdminStatus } from '../../generated/prisma/enums.js';
import { dbCall, type Db } from '../../db/prisma.js';
import type { Tx } from '../../auth/tx.js';
import type { AdminUserRecord, AdminUserWrite, AdminUsersStore } from './admin-users.store.js';

const select = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  invitedBy: true,
} as const;

type AdminRow = {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  status: AdminStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  invitedBy: string | null;
};

export class AdminUsersRepo implements AdminUsersStore {
  constructor(private readonly db: Db) {}

  private use(tx: Tx): Db {
    if (tx && typeof tx === 'object' && 'adminUser' in tx) return tx as Db;
    return this.db;
  }

  async findById(tx: Tx, id: string): Promise<AdminUserRecord | null> {
    const db = this.use(tx);
    const row = await dbCall(() => db.adminUser.findUnique({ where: { id }, select }));
    return this.present(db, row);
  }

  async findByEmail(email: string): Promise<AdminUserRecord | null> {
    const row = await dbCall(() => this.db.adminUser.findUnique({ where: { email }, select }));
    return this.present(this.db, row);
  }

  async countActiveSuperAdmins(tx: Tx): Promise<number> {
    return dbCall(() =>
      this.use(tx).adminUser.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } }),
    );
  }

  async counts() {
    const [total, superAdmins, staff, invited] = await dbCall(() =>
      Promise.all([
        this.db.adminUser.count(),
        this.db.adminUser.count({ where: { role: 'SUPER_ADMIN' } }),
        this.db.adminUser.count({ where: { role: 'ADMIN_STAFF' } }),
        this.db.adminUser.count({ where: { status: 'INVITED' } }),
      ]),
    );
    return { total, superAdmins, staff, invited };
  }

  async insert(tx: Tx, input: AdminUserWrite): Promise<AdminUserRecord> {
    const db = this.use(tx);
    const row = await dbCall(() =>
      db.adminUser.create({
        data: {
          id: input.id,
          email: input.email,
          name: input.name,
          role: input.role,
          status: 'INVITED',
          invitedBy: input.invitedBy,
          invitedAt: input.invitedAt,
          createdAt: input.createdAt,
        },
        select,
      }),
    );
    return this.presentOne(db, row);
  }

  async updateName(tx: Tx, id: string, name: string): Promise<AdminUserRecord> {
    const db = this.use(tx);
    const row = await dbCall(() => db.adminUser.update({ where: { id }, data: { name }, select }));
    return this.presentOne(db, row);
  }

  async updateRole(tx: Tx, id: string, role: AdminRole): Promise<AdminUserRecord> {
    const db = this.use(tx);
    const row = await dbCall(() => db.adminUser.update({ where: { id }, data: { role }, select }));
    return this.presentOne(db, row);
  }

  async updateStatus(tx: Tx, id: string, status: AdminStatus): Promise<AdminUserRecord> {
    const db = this.use(tx);
    const row = await dbCall(() => db.adminUser.update({ where: { id }, data: { status }, select }));
    return this.presentOne(db, row);
  }

  async list(query: {
    role?: AdminRole;
    status?: AdminStatus;
    limit: number;
    cursor?: { createdAt: Date; id: string };
  }): Promise<{ rows: AdminUserRecord[]; total: number }> {
    const where = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const cursorWhere = query.cursor
      ? {
          OR: [
            { createdAt: { lt: query.cursor.createdAt } },
            { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
          ],
        }
      : {};
    const [rows, total] = await dbCall(() =>
      Promise.all([
        this.db.adminUser.findMany({
          where: { ...where, ...cursorWhere },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit,
          select,
        }),
        this.db.adminUser.count({ where }),
      ]),
    );
    const names = await this.namesFor(this.db, rows.map((row) => row.invitedBy));
    return { rows: rows.map((row) => this.withCreator(row, names)), total };
  }

  private async present(db: Db, row: AdminRow | null): Promise<AdminUserRecord | null> {
    if (!row) return null;
    return this.presentOne(db, row);
  }

  private async presentOne(db: Db, row: AdminRow): Promise<AdminUserRecord> {
    const names = await this.namesFor(db, [row.invitedBy]);
    return this.withCreator(row, names);
  }

  private async namesFor(db: Db, ids: Array<string | null>): Promise<Map<string, string | null>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    if (unique.length === 0) return new Map();
    const found = await dbCall(() =>
      db.adminUser.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
    );
    return new Map(found.map((row) => [row.id, row.name]));
  }

  private withCreator(row: AdminRow, names: Map<string, string | null>): AdminUserRecord {
    return {
      ...row,
      createdByName: row.invitedBy ? (names.get(row.invitedBy) ?? null) : null,
    };
  }
}
