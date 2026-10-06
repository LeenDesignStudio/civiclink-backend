import { describe, expect, it } from 'vitest';
import { Authz, systemPrincipal } from '../authz/authz.js';
import type { ServiceContext } from '../graphql/context.js';
import { FakeClock } from '../lib/clock.js';
import { deletedEmail, DELETED_DISPLAY_NAME, RetentionService, type PurgeSnapshot, type RetentionStore } from './retention.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

class MemoryRetention implements RetentionStore {
  requestPurgedAt: Date | null = null;
  already = false;
  snap: PurgeSnapshot = {
    email: 'resident@example.com',
    displayName: 'Ada',
    status: 'PENDING_DELETION',
    purgedAt: null,
    savedLocations: 1,
    follows: 2,
    notifications: 3,
    preferences: 4,
    pushSubscriptions: 1,
    sessions: 1,
    identities: 1,
    lookups: 2,
    correctionUserId: USER,
  };

  dueDeletions(): Promise<{ requestId: string; userId: string; purgedAt: Date | null }[]> {
    if (this.already) return Promise.resolve([{ requestId: REQUEST, userId: USER, purgedAt: new Date() }]);
    return Promise.resolve([{ requestId: REQUEST, userId: USER, purgedAt: this.requestPurgedAt }]);
  }

  purgeUser(_userId: string, _requestId: string, now: Date): Promise<void> {
    if (this.requestPurgedAt) return Promise.resolve();
    this.snap = {
      email: deletedEmail(USER),
      displayName: DELETED_DISPLAY_NAME,
      status: 'DELETED',
      purgedAt: now,
      savedLocations: 0,
      follows: 0,
      notifications: 0,
      preferences: 0,
      pushSubscriptions: 0,
      sessions: 0,
      identities: 0,
      lookups: 0,
      correctionUserId: null,
    };
    this.requestPurgedAt = now;
    return Promise.resolve();
  }

  snapshot(): Promise<PurgeSnapshot | null> {
    return Promise.resolve(this.snap);
  }

  deleteExpiredLookups(): Promise<number> {
    return Promise.resolve(1);
  }

  deleteExpiredSessions(): Promise<number> {
    return Promise.resolve(1);
  }

  deleteOldStripeEvents(): Promise<number> {
    return Promise.resolve(1);
  }
}

function system(): ServiceContext {
  const principal = systemPrincipal('accounts.purge');
  return { requestId: 'req', principal, authz: new Authz(principal), ipHash: 'ip' };
}

describe('accounts.purge', () => {
  it('deletes resident-owned rows, de-identifies the user, and skips an already purged request', async () => {
    const store = new MemoryRetention();
    const service = new RetentionService(store, new FakeClock(new Date('2026-04-01T00:00:00Z')));
    const first = await service.purge(system());
    expect(first.purged).toBe(1);
    const snap = await store.snapshot();
    expect(snap?.email).toBe(`deleted+${USER}@invalid`);
    expect(snap?.displayName).toBe('Deleted user');
    expect(snap?.status).toBe('DELETED');
    expect(snap?.savedLocations).toBe(0);
    expect(snap?.follows).toBe(0);
    expect(snap?.notifications).toBe(0);
    expect(snap?.correctionUserId).toBeNull();
    store.already = true;
    const second = await service.purge(system());
    expect(second.purged).toBe(0);
  });
});
