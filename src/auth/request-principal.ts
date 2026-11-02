import { anonymousPrincipal, type Principal } from '../authz/authz.js';
import type { UserStatus } from '../generated/prisma/enums.js';
import type { Clock } from '../lib/clock.js';
import { systemClock } from '../lib/clock.js';
import { SessionExpiredError } from '../lib/errors.js';
import type { AdminPrincipal } from './admin-principal-cache.js';
import { COOKIE_ACCESS, COOKIE_ADMIN } from './cookies.js';
import { verifyAccessToken } from './tokens.js';

export interface AdminSessionLookup {
  resolveAdminPrincipal(token: string | undefined, now: Date): Promise<AdminPrincipal | null>;
}

export interface ResidentAccessLookup {
  isAccessSession(sessionId: string, userId: string): Promise<boolean>;
  accessState(userId: string): Promise<{ status: UserStatus; termsAccepted: boolean } | null>;
}

/**
 * An admin session cookie wins. Otherwise the resident access cookie becomes the principal.
 * A missing or unusable cookie stays anonymous. An expired access token throws so the
 * browser can refresh it instead of looking logged out.
 */
export function createRequestPrincipal(deps: {
  adminAuth: AdminSessionLookup;
  residents: ResidentAccessLookup;
  clock?: Clock;
}) {
  const clock = deps.clock ?? systemClock;
  return async function resolvePrincipal(request: {
    cookies: Record<string, string | undefined>;
  }): Promise<Principal> {
    const admin = await deps.adminAuth.resolveAdminPrincipal(request.cookies[COOKIE_ADMIN], clock.now());
    if (admin) return { kind: 'admin', adminId: admin.adminId, role: admin.role, sessionId: admin.sessionId };
    const access = request.cookies[COOKIE_ACCESS];
    if (!access) return anonymousPrincipal;
    let claims;
    try {
      claims = await verifyAccessToken(access, { now: clock.now() });
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      return anonymousPrincipal;
    }
    const live = await deps.residents.isAccessSession(claims.sid, claims.sub);
    if (!live) return anonymousPrincipal;
    const state = await deps.residents.accessState(claims.sub);
    if (!state) return anonymousPrincipal;
    return {
      kind: 'resident',
      userId: claims.sub,
      sessionId: claims.sid,
      status: state.status,
      termsAccepted: state.termsAccepted,
    };
  };
}
