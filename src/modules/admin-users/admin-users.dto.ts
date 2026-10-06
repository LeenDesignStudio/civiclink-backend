import type { AdminRole, AdminStatus } from '../../generated/prisma/enums.js';
import type { Permission } from '../../authz/permissions.js';

export interface AdminUserDto {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  status: AdminStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AdminMeDto extends AdminUserDto {
  permissions: Permission[];
}
