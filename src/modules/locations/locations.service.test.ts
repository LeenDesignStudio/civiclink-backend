import { describe, expect, it } from 'vitest';
import { Authz } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { FakeClock } from '../../lib/clock.js';
import {
  LocationLabelTakenError,
  LookupNotFoundError,
  NotFoundError,
  SavedLocationLimitError,
} from '../../lib/errors.js';
import type { SavedLocationDto } from './locations.dto.js';
import type {
  LocationsRepo,
  LookupReader,
  LookupRecord,
  NewSavedLocation,
  SavedLocationGeometry,
  SavedLocationPatch,
  TxRunner,
} from './locations.ports.js';
import { LocationsService } from './locations.service.js';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * Production `withTx` (`src/db/prisma.ts`) uses PostgreSQL isolation Serializable, so the
 * count-and-insert critical section cannot run concurrently. This fake holds one shared lock
 * and runs overlapping callbacks one at a time — the same mutual exclusion, without a database.
 */
function lockingTx(): TxRunner {
  let tail: Promise<void> = Promise.resolve();
  return async (fn) => {
    const previous = tail;
    let release: () => void = () => undefined;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn(undefined);
    } finally {
      release();
    }
  };
}

interface Row extends SavedLocationDto {
  userId: string;
}

class MemoryLocations implements LocationsRepo {
  readonly rows: Row[] = [];
  private n = 0;

  listOwned(userId: string): Promise<SavedLocationDto[]> {
    return Promise.resolve(this.rows.filter((row) => row.userId === userId).map(strip));
  }

  findOwned(userId: string, id: string): Promise<SavedLocationDto | null> {
    const row = this.rows.find((item) => item.userId === userId && item.id === id);
    return Promise.resolve(row ? strip(row) : null);
  }

  findLabel(userId: string, label: 'HOME' | 'WORK'): Promise<SavedLocationDto | null> {
    const row = this.rows.find((item) => item.userId === userId && item.label === label);
    return Promise.resolve(row ? strip(row) : null);
  }

  async countOwned(userId: string): Promise<number> {
    await Promise.resolve();
    return this.rows.filter((row) => row.userId === userId).length;
  }

  clearDefault(userId: string): Promise<void> {
    for (const row of this.rows) {
      if (row.userId === userId) row.isDefault = false;
    }
    return Promise.resolve();
  }

  async insert(row: NewSavedLocation): Promise<SavedLocationDto> {
    await Promise.resolve();
    this.n += 1;
    const saved: Row = {
      id: `00000000-0000-4000-8000-${this.n.toString(16).padStart(12, '0')}`,
      userId: row.userId,
      label: row.label,
      customName: row.customName,
      displayAddress: row.displayAddress,
      normalizedAddress: row.normalizedAddress,
      geocodePrecision: row.geocodePrecision,
      isDefault: row.isDefault,
      jurisdictionIds: row.jurisdictionIds,
      confidence: row.confidence,
      resolvedAt: row.resolvedAt,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.n)),
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.n)),
    };
    this.rows.push(saved);
    return strip(saved);
  }

  updateOwned(userId: string, id: string, patch: SavedLocationPatch): Promise<SavedLocationDto | null> {
    const row = this.rows.find((item) => item.userId === userId && item.id === id);
    if (!row) return Promise.resolve(null);
    row.label = patch.label;
    row.customName = patch.customName;
    return Promise.resolve(strip(row));
  }

  markDefault(userId: string, id: string): Promise<SavedLocationDto | null> {
    const row = this.rows.find((item) => item.userId === userId && item.id === id);
    if (!row) return Promise.resolve(null);
    row.isDefault = true;
    return Promise.resolve(strip(row));
  }

  deleteOwned(userId: string, id: string): Promise<boolean> {
    const index = this.rows.findIndex((item) => item.userId === userId && item.id === id);
    if (index < 0) return Promise.resolve(false);
    this.rows.splice(index, 1);
    return Promise.resolve(true);
  }

  promoteNewest(userId: string): Promise<SavedLocationDto | null> {
    const owned = this.rows.filter((row) => row.userId === userId);
    const newest = owned.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))[0];
    if (!newest) return Promise.resolve(null);
    newest.isDefault = true;
    return Promise.resolve(strip(newest));
  }
}

function strip(row: Row): SavedLocationDto {
  return {
    id: row.id,
    label: row.label,
    customName: row.customName,
    displayAddress: row.displayAddress,
    normalizedAddress: row.normalizedAddress,
    geocodePrecision: row.geocodePrecision,
    isDefault: row.isDefault,
    jurisdictionIds: [...row.jurisdictionIds],
    confidence: row.confidence,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

class MemoryLookups implements LookupReader {
  constructor(private readonly rows: LookupRecord[]) {}

  findByToken(token: string): Promise<LookupRecord | null> {
    return Promise.resolve(this.rows.find((row) => row.token === token) ?? null);
  }
}

function resident(userId: string): ServiceContext {
  const principal = {
    kind: 'resident' as const,
    userId,
    status: 'ACTIVE' as const,
    termsAccepted: true,
    sessionId: 'sess-1',
  };
  return { requestId: 'req-1', principal, authz: new Authz(principal), ipHash: 'ip-hash' };
}

function lookup(token: string): LookupRecord {
  return {
    token,
    method: 'ADDRESS',
    displayLabel: `Normalized ${token}`,
    jurisdictionIds: ['00000000-0000-4000-8000-000000000099'],
    confidence: 'EXACT',
    expiresAt: null,
    hasPoint: true,
    hasArea: false,
    geocodePrecision: 'rooftop',
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
  };
}

function service(limit = 5) {
  const repo = new MemoryLocations();
  const geometry: SavedLocationGeometry & { calls: string[] } = {
    calls: [],
    copyPoint: (id, token) => {
      geometry.calls.push(`${id}:${token}`);
      return Promise.resolve();
    },
  };
  const svc = new LocationsService({
    repo,
    lookups: new MemoryLookups([lookup('home-token'), lookup('work-token'), lookup('other-token')]),
    geometry,
    entitlements: { limits: () => Promise.resolve({ maxSavedLocations: limit, maxFollows: 50 }) },
    withTx: lockingTx(),
    clock: new FakeClock(new Date('2026-10-06T12:00:00.000Z')),
  });
  return { svc, repo, geometry };
}

describe('LocationsService', () => {
  it('returns NOT_FOUND when another resident uses the id', async () => {
    const { svc } = service();
    const saved = await svc.saveLocation(resident(USER_A), { lookupToken: 'home-token', label: 'HOME' });
    await expect(
      svc.updateSavedLocation(resident(USER_B), { id: saved.savedLocation.id, customName: 'Nope' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.deleteSavedLocation(resident(USER_B), { id: saved.savedLocation.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects a second save past the plan limit and a duplicate Home label', async () => {
    const { svc } = service(1);
    await svc.saveLocation(resident(USER_A), { lookupToken: 'home-token', label: 'HOME' });
    await expect(
      svc.saveLocation(resident(USER_A), { lookupToken: 'work-token', label: 'WORK' }),
    ).rejects.toBeInstanceOf(SavedLocationLimitError);

    const room = service(5);
    await room.svc.saveLocation(resident(USER_A), { lookupToken: 'home-token', label: 'HOME' });
    await expect(
      room.svc.saveLocation(resident(USER_A), { lookupToken: 'work-token', label: 'HOME' }),
    ).rejects.toBeInstanceOf(LocationLabelTakenError);
  });

  it('promotes the most recent remaining location when the default is deleted', async () => {
    const { svc } = service();
    const home = await svc.saveLocation(resident(USER_A), { lookupToken: 'home-token', label: 'HOME' });
    const work = await svc.saveLocation(resident(USER_A), { lookupToken: 'work-token', label: 'WORK' });
    expect(home.savedLocation.isDefault).toBe(true);
    expect(work.savedLocation.isDefault).toBe(false);
    await svc.deleteSavedLocation(resident(USER_A), { id: home.savedLocation.id });
    const listed = await svc.savedLocations(resident(USER_A));
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(work.savedLocation.id);
    expect(listed[0]?.isDefault).toBe(true);
  });

  it('keeps parallel saves within the limit when withTx serializes them', async () => {
    const { svc, repo } = service(1);
    const results = await Promise.allSettled([
      svc.saveLocation(resident(USER_A), { lookupToken: 'home-token', label: 'HOME' }),
      svc.saveLocation(resident(USER_A), { lookupToken: 'work-token', label: 'WORK' }),
    ]);
    expect(repo.rows.filter((row) => row.userId === USER_A)).toHaveLength(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(repo.rows.length).toBeLessThanOrEqual(1);
  });

  it('requires a custom name for Other and rejects an expired lookup', async () => {
    const { svc } = service();
    await expect(svc.saveLocation(resident(USER_A), { lookupToken: 'other-token', label: 'OTHER' })).rejects.toMatchObject(
      { code: 'VALIDATION' },
    );
    const expired = new LocationsService({
      repo: new MemoryLocations(),
      lookups: new MemoryLookups([{ ...lookup('stale'), expiresAt: new Date('2020-01-01T00:00:00.000Z') }]),
      geometry: { copyPoint: () => Promise.resolve() },
      entitlements: { limits: () => Promise.resolve({ maxSavedLocations: 5, maxFollows: 50 }) },
      withTx: lockingTx(),
      clock: new FakeClock(new Date('2026-10-06T12:00:00.000Z')),
    });
    await expect(expired.saveLocation(resident(USER_A), { lookupToken: 'stale', label: 'HOME' })).rejects.toBeInstanceOf(
      LookupNotFoundError,
    );
  });
});
