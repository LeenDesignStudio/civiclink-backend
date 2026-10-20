import { anonymousPrincipal, type Principal } from '../authz/authz.js';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';
import type { AdminPrincipal } from './admin-principal-cache.js';
import { COOKIE_ADMIN } from './cookies.js';

export interface AdminSessionLookup {
  resolveAdminPrincipal(token: string | undefined, now: Date): Promise<AdminPrincipal | null>;
}

/**
 * GraphQL otherwise runs as anonymous, so a successful Google redirect to /admin
 * is bounced back to login. The admin cookie is the session.
 */
export function createRequestPrincipal(deps: { adminAuth: AdminSessionLookup; clock?: Clock }) {
  const clock = deps.clock ?? systemClock;
  return async function resolvePrincipal(request: {
    cookies: Record<string, string | undefined>;
  }): Promise<Principal> {
    const admin = await deps.adminAuth.resolveAdminPrincipal(request.cookies[COOKIE_ADMIN], clock.now());
    if (!admin) return anonymousPrincipal;
    return { kind: 'admin', adminId: admin.adminId, role: admin.role, sessionId: admin.sessionId };
  };
}
