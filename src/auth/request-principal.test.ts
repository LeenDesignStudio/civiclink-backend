import { describe, expect, it } from 'vitest';
import type { UserStatus } from '../generated/prisma/enums.js';
import { SessionExpiredError } from '../lib/errors.js';
import type { AdminPrincipal } from './admin-principal-cache.js';
import { COOKIE_ACCESS, COOKIE_ADMIN } from './cookies.js';
import { createRequestPrincipal, type ResidentAccessLookup } from './request-principal.js';
import { signAccessToken } from './tokens.js';

const now = new Date('2026-10-20T12:00:00.000Z');
const principal: AdminPrincipal = {
  adminId: 'admin-1',
  role: 'SUPER_ADMIN',
  sessionId: 'session-1',
  email: 'admin@qubalink.com',
  name: 'Admin',
};

function residents(state: { status: UserStatus; termsAccepted: boolean } | null, live = true): ResidentAccessLookup {
  return {
    isAccessSession: () => Promise.resolve(live),
    accessState: () => Promise.resolve(state),
  };
}

describe('createRequestPrincipal', () => {
  it('turns the admin session cookie into an admin principal', async () => {
    const resolve = createRequestPrincipal({
      clock: { now: () => now },
      adminAuth: {
        resolveAdminPrincipal: (token) => Promise.resolve(token === 'session-token' ? principal : null),
      },
      residents: residents(null),
    });
    await expect(resolve({ cookies: { [COOKIE_ADMIN]: 'session-token' } })).resolves.toEqual({
      kind: 'admin',
      adminId: 'admin-1',
      role: 'SUPER_ADMIN',
      sessionId: 'session-1',
    });
  });

  it('stays anonymous when the cookie is missing or unknown', async () => {
    const resolve = createRequestPrincipal({
      clock: { now: () => now },
      adminAuth: { resolveAdminPrincipal: () => Promise.resolve(null) },
      residents: residents(null),
    });
    await expect(resolve({ cookies: {} })).resolves.toEqual({ kind: 'anonymous' });
    await expect(resolve({ cookies: { [COOKIE_ADMIN]: 'nope' } })).resolves.toEqual({ kind: 'anonymous' });
  });

  it('turns a live resident access cookie into a resident principal', async () => {
    const token = await signAccessToken(
      { sub: 'user-1', typ: 'resident', sid: 'sess-1', ver: 1 },
      { now },
    );
    const resolve = createRequestPrincipal({
      clock: { now: () => now },
      adminAuth: { resolveAdminPrincipal: () => Promise.resolve(null) },
      residents: residents({ status: 'ACTIVE', termsAccepted: false }),
    });
    await expect(resolve({ cookies: { [COOKIE_ACCESS]: token } })).resolves.toEqual({
      kind: 'resident',
      userId: 'user-1',
      sessionId: 'sess-1',
      status: 'ACTIVE',
      termsAccepted: false,
    });
  });

  it('stays anonymous when the session row is no longer current', async () => {
    const token = await signAccessToken(
      { sub: 'user-1', typ: 'resident', sid: 'sess-1', ver: 1 },
      { now },
    );
    const resolve = createRequestPrincipal({
      clock: { now: () => now },
      adminAuth: { resolveAdminPrincipal: () => Promise.resolve(null) },
      residents: residents({ status: 'ACTIVE', termsAccepted: false }, false),
    });
    await expect(resolve({ cookies: { [COOKIE_ACCESS]: token } })).resolves.toEqual({ kind: 'anonymous' });
  });

  it('throws when the access cookie is expired so the browser can refresh it', async () => {
    const issued = new Date(now.getTime() - 16 * 60 * 1000);
    const token = await signAccessToken(
      { sub: 'user-1', typ: 'resident', sid: 'sess-1', ver: 1 },
      { now: issued },
    );
    const resolve = createRequestPrincipal({
      clock: { now: () => now },
      adminAuth: { resolveAdminPrincipal: () => Promise.resolve(null) },
      residents: residents({ status: 'ACTIVE', termsAccepted: true }),
    });
    await expect(resolve({ cookies: { [COOKIE_ACCESS]: token } })).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
