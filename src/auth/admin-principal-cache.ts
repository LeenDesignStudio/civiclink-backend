import type { AdminRole } from '../generated/prisma/enums.js';

export interface AdminPrincipal {
  adminId: string;
  role: AdminRole;
  sessionId: string;
  email: string;
  name: string | null;
}

/** Role cache for request context. Session expiry is never cached. */
export class AdminPrincipalCache {
  private readonly entries = new Map<string, { principal: AdminPrincipal; expiresAt: number }>();

  constructor(private readonly ttlMs = 30_000) {}

  get(adminId: string, now: Date): AdminPrincipal | undefined {
    const hit = this.entries.get(adminId);
    if (!hit) return undefined;
    if (hit.expiresAt <= now.getTime()) {
      this.entries.delete(adminId);
      return undefined;
    }
    return hit.principal;
  }

  set(adminId: string, principal: AdminPrincipal, now: Date): void {
    this.entries.set(adminId, { principal, expiresAt: now.getTime() + this.ttlMs });
  }

  invalidate(adminId: string): void {
    this.entries.delete(adminId);
  }
}
