import type { AdminRole, UserStatus } from '../generated/prisma/enums.js';
import {
  AccountDeletedError,
  AccountPendingDeletionError,
  ForbiddenError,
  TermsRequiredError,
  UnauthenticatedError,
} from '../lib/errors.js';
import { PUBLIC_PERMISSIONS, ROLE_PERMISSIONS, type Permission } from './permissions.js';

export type Principal =
  | { kind: 'anonymous' }
  | {
      kind: 'resident';
      userId: string;
      status: UserStatus;
      termsAccepted: boolean;
      sessionId: string;
    }
  | { kind: 'admin'; adminId: string; role: AdminRole; sessionId: string }
  | { kind: 'system'; job: string };

export const anonymousPrincipal: Principal = { kind: 'anonymous' };

export function systemPrincipal(job: string): Principal {
  return { kind: 'system', job };
}

export class Authz {
  constructor(readonly principal: Principal) {}

  can(permission: Permission): boolean {
    if ((PUBLIC_PERMISSIONS as readonly string[]).includes(permission)) return true;
    switch (this.principal.kind) {
      case 'anonymous':
        return false;
      case 'resident':
        return ROLE_PERMISSIONS.Resident.includes(permission);
      case 'admin':
        return ROLE_PERMISSIONS[this.principal.role].includes(permission);
      case 'system':
        return ROLE_PERMISSIONS.System.includes(permission);
      default:
        return false;
    }
  }

  require(permission: Permission): void {
    if (this.can(permission)) return;
    if (this.principal.kind === 'anonymous') throw new UnauthenticatedError();
    throw new ForbiddenError();
  }

  requireResident(options?: { active?: boolean }): string {
    if (this.principal.kind !== 'resident') throw new UnauthenticatedError();
    if (options?.active) {
      if (this.principal.status === 'PENDING_DELETION') throw new AccountPendingDeletionError();
      if (this.principal.status === 'DELETED') throw new AccountDeletedError();
      if (!this.principal.termsAccepted) throw new TermsRequiredError();
    }
    return this.principal.userId;
  }

  requireAdmin(): { adminId: string; role: AdminRole } {
    if (this.principal.kind === 'anonymous') throw new UnauthenticatedError();
    if (this.principal.kind !== 'admin') throw new ForbiddenError();
    return { adminId: this.principal.adminId, role: this.principal.role };
  }

  requireSystem(): string {
    if (this.principal.kind !== 'system') throw new ForbiddenError();
    return this.principal.job;
  }
}
