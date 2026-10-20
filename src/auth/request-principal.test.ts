import { describe, expect, it } from 'vitest';
import { COOKIE_ADMIN } from './cookies.js';
import { createRequestPrincipal } from './request-principal.js';
import type { AdminPrincipal } from './admin-principal-cache.js';

const now = new Date('2026-10-20T12:00:00.000Z');
const principal: AdminPrincipal = {
  adminId: 'admin-1',
  role: 'SUPER_ADMIN',
  sessionId: 'session-1',
  email: 'admin@qubalink.com',
  name: 'Admin',
};

describe('createRequestPrincipal', () => {
  it('turns the admin session cookie into an admin principal', async () => {
    const resolve = createRequestPrincipal({
      clock: { now: () => now },
      adminAuth: {
        resolveAdminPrincipal: (token) => Promise.resolve(token === 'session-token' ? principal : null),
      },
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
    });
    await expect(resolve({ cookies: {} })).resolves.toEqual({ kind: 'anonymous' });
    await expect(resolve({ cookies: { [COOKIE_ADMIN]: 'nope' } })).resolves.toEqual({ kind: 'anonymous' });
  });
});
