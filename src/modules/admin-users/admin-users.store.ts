import type { Tx } from '../../auth/tx.js';
import type { AdminRole, AdminStatus } from '../../generated/prisma/enums.js';
import type { AdminUserDto } from './admin-users.dto.js';

export interface AdminUserRecord extends AdminUserDto {
  updatedAt: Date;
}

export interface AdminUserWrite {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  invitedBy: string;
  createdAt: Date;
}

export interface AdminUsersStore {
  findById(tx: Tx, id: string): Promise<AdminUserRecord | null>;
  findByEmail(email: string): Promise<AdminUserRecord | null>;
  countActiveSuperAdmins(tx: Tx): Promise<number>;
  insert(tx: Tx, input: AdminUserWrite): Promise<AdminUserRecord>;
  updateRole(tx: Tx, id: string, role: AdminRole): Promise<AdminUserRecord>;
  updateStatus(tx: Tx, id: string, status: AdminStatus): Promise<AdminUserRecord>;
  list(query: {
    role?: AdminRole;
    status?: AdminStatus;
    limit: number;
    cursor?: { createdAt: Date; id: string };
  }): Promise<{ rows: AdminUserRecord[]; total: number }>;
}
