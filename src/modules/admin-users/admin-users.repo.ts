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
} as const;

export class AdminUsersRepo implements AdminUsersStore {
  constructor(private readonly db: Db) {}

  private use(tx: Tx): Db {
    if (tx && typeof tx === 'object' && 'adminUser' in tx) return tx as Db;
    return this.db;
  }

  async findById(tx: Tx, id: string): Promise<AdminUserRecord | null> {
    return dbCall(() => this.use(tx).adminUser.findUnique({ where: { id }, select }));
  }

  async findByEmail(email: string): Promise<AdminUserRecord | null> {
    return dbCall(() => this.db.adminUser.findUnique({ where: { email }, select }));
  }

  async countActiveSuperAdmins(tx: Tx): Promise<number> {
    return dbCall(() =>
      this.use(tx).adminUser.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } }),
    );
  }

  async insert(tx: Tx, input: AdminUserWrite): Promise<AdminUserRecord> {
    return dbCall(() =>
      this.use(tx).adminUser.create({
        data: {
          id: input.id,
          email: input.email,
          name: input.name,
          role: input.role,
          status: 'INVITED',
          invitedBy: input.invitedBy,
          createdAt: input.createdAt,
        },
        select,
      }),
    );
  }

  async updateRole(tx: Tx, id: string, role: AdminRole): Promise<AdminUserRecord> {
    return dbCall(() => this.use(tx).adminUser.update({ where: { id }, data: { role }, select }));
  }

  async updateStatus(tx: Tx, id: string, status: AdminStatus): Promise<AdminUserRecord> {
    return dbCall(() => this.use(tx).adminUser.update({ where: { id }, data: { status }, select }));
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
    return { rows, total };
  }
}
