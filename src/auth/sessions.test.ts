import { describe, expect, it } from 'vitest';
import { FakeClock } from '../lib/clock.js';
import { AccountDeletedError, AccountPendingDeletionError, SessionRevokedError } from '../lib/errors.js';
import { FakeRandom } from '../lib/random.js';
import { sha256Hex } from '../lib/crypto.js';
import type { UserStatus } from '../generated/prisma/enums.js';
import { SessionService } from './sessions.js';
import type { NewSession, SessionStore, StoredSession } from './sessions.types.js';

class MemorySessions implements SessionStore {
  rows: StoredSession[] = [];

  insert(session: NewSession): Promise<StoredSession> {
    const row: StoredSession = { ...session, rotatedAt: null, revokedAt: null };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findByHash(hash: string): Promise<StoredSession | null> {
    return Promise.resolve(this.rows.find((row) => row.refreshTokenHash === hash) ?? null);
  }

  rotate(previousId: string, rotatedAt: Date, next: NewSession): Promise<StoredSession> {
    const previous = this.rows.find((row) => row.id === previousId);
    if (previous) previous.rotatedAt = rotatedAt;
    return this.insert(next);
  }

  revokeFamily(familyId: string, at: Date): Promise<void> {
    for (const row of this.rows) {
      if (row.familyId === familyId) row.revokedAt = at;
    }
    return Promise.resolve();
  }

  revokeById(id: string, at: Date): Promise<void> {
    const row = this.rows.find((item) => item.id === id);
    if (row) row.revokedAt = at;
    return Promise.resolve();
  }

  revokeAllForUser(userId: string, at: Date): Promise<void> {
    for (const row of this.rows) {
      if (row.userId === userId) row.revokedAt = at;
    }
    return Promise.resolve();
  }

  countActive(userId: string, now: Date): Promise<number> {
    return Promise.resolve(
      this.rows.filter(
        (row) => row.userId === userId && !row.revokedAt && !row.rotatedAt && row.expiresAt.getTime() > now.getTime(),
      ).length,
    );
  }

  setStatus(userId: string, status: UserStatus): void {
    for (const row of this.rows) {
      if (row.userId === userId) row.userStatus = status;
    }
  }
}

describe('resident sessions', () => {
  const clock = new FakeClock(new Date('2026-04-01T00:00:00.000Z'));

  function setup() {
    const store = new MemorySessions();
    const sessions = new SessionService({ store, clock, random: new FakeRandom() });
    return { store, sessions };
  }

  it('rotates a refresh token inside the same family', async () => {
    const { store, sessions } = setup();
    const created = await sessions.create({ userId: 'user-1' });
    const next = await sessions.rotate(created.refreshToken);
    expect(next.familyId).toBe(created.familyId);
    expect(next.refreshToken).not.toBe(created.refreshToken);
    const previous = store.rows.find((row) => row.refreshTokenHash === sha256Hex(created.refreshToken));
    expect(previous?.rotatedAt).toEqual(clock.now());
    expect(previous?.revokedAt).toBeNull();
  });

  it('revokes the family when a rotated token is reused', async () => {
    const { store, sessions } = setup();
    const created = await sessions.create({ userId: 'user-1' });
    await sessions.rotate(created.refreshToken);
    await expect(sessions.rotate(created.refreshToken)).rejects.toBeInstanceOf(SessionRevokedError);
    expect(store.rows.every((row) => row.revokedAt)).toBe(true);
  });

  it('blocks refresh for a deleted user and revokes sessions', async () => {
    const { store, sessions } = setup();
    const created = await sessions.create({ userId: 'user-1' });
    store.setStatus('user-1', 'DELETED');
    await expect(sessions.rotate(created.refreshToken)).rejects.toBeInstanceOf(AccountDeletedError);
    expect(store.rows.every((row) => row.revokedAt)).toBe(true);
  });

  it('blocks refresh while deletion is pending', async () => {
    const { sessions, store } = setup();
    const created = await sessions.create({ userId: 'user-1' });
    store.setStatus('user-1', 'PENDING_DELETION');
    await expect(sessions.rotate(created.refreshToken)).rejects.toBeInstanceOf(AccountPendingDeletionError);
  });
});
