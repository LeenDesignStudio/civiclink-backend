import { describe, expect, it } from 'vitest';
import { Authz } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { FollowLimitError, NotFoundError } from '../../lib/errors.js';
import type { FollowDto, FollowHolder, FollowOffice } from './follows.dto.js';
import type { FollowPage, FollowsRepo, NewFollow, TxRunner } from './follows.ports.js';
import { FollowsService } from './follows.service.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OFFICE_A = '11111111-1111-4111-8111-111111111111';
const OFFICE_B = '22222222-2222-4222-8222-222222222222';
const OFFICE_RETIRED = '33333333-3333-4333-8333-333333333333';
const OFFICIAL = '44444444-4444-4444-8444-444444444444';
const STRANGER = '55555555-5555-4555-8555-555555555555';

const passthrough: TxRunner = (fn) => fn(undefined);

class MemoryFollows implements FollowsRepo {
  offices = new Map<string, FollowOffice & { status: 'ACTIVE' | 'RETIRED' }>();
  terms = new Set<string>();
  holders = new Map<string, FollowHolder>();
  rows: (FollowDto & { userId: string })[] = [];
  private n = 0;

  findActiveOffice(officeId: string): Promise<FollowOffice | null> {
    const office = this.offices.get(officeId);
    if (!office || office.status !== 'ACTIVE') return Promise.resolve(null);
    return Promise.resolve({
      id: office.id,
      name: office.name,
      level: office.level,
      lastUpdatedAt: office.lastUpdatedAt,
    });
  }

  officialHasTerm(officialId: string, officeId: string): Promise<boolean> {
    return Promise.resolve(this.terms.has(`${officialId}:${officeId}`));
  }

  findByUserOffice(userId: string, officeId: string): Promise<FollowDto | null> {
    const row = this.rows.find((item) => item.userId === userId && item.officeId === officeId);
    return Promise.resolve(row ? this.decorate(row) : null);
  }

  async countOwned(userId: string): Promise<number> {
    await Promise.resolve();
    return this.rows.filter((row) => row.userId === userId).length;
  }

  async insert(row: NewFollow): Promise<FollowDto> {
    await Promise.resolve();
    this.n += 1;
    const office = this.offices.get(row.officeId);
    const saved = {
      id: `00000000-0000-4000-8000-${this.n.toString(16).padStart(12, '0')}`,
      userId: row.userId,
      officeId: row.officeId,
      officialId: row.officialId,
      createdAt: new Date(Date.UTC(2026, 0, this.n)),
      office: {
        id: row.officeId,
        name: office?.name ?? '',
        level: office?.level ?? 'MUNICIPAL',
        lastUpdatedAt: office?.lastUpdatedAt ?? new Date(0),
      },
      holder: this.holders.get(row.officeId) ?? null,
    };
    this.rows.push(saved);
    return this.decorate(saved);
  }

  deleteByUserOffice(userId: string, officeId: string): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !(row.userId === userId && row.officeId === officeId));
    return Promise.resolve(this.rows.length !== before);
  }

  listOwned(userId: string, page: FollowPage): Promise<FollowDto[]> {
    const owned = this.rows
      .filter((row) => row.userId === userId)
      .filter((row) => {
        if (!page.after) return true;
        const time = row.createdAt.getTime() - page.after.createdAt.getTime();
        if (time < 0) return true;
        if (time > 0) return false;
        return row.id < page.after.id;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    return Promise.resolve(owned.slice(0, page.limit).map((row) => this.decorate(row)));
  }

  private decorate(row: FollowDto): FollowDto {
    return {
      id: row.id,
      officeId: row.officeId,
      officialId: row.officialId,
      createdAt: row.createdAt,
      office: row.office,
      holder: this.holders.get(row.officeId) ?? row.holder,
    };
  }
}

function resident(): ServiceContext {
  const principal = {
    kind: 'resident' as const,
    userId: USER,
    status: 'ACTIVE' as const,
    termsAccepted: true,
    sessionId: 'sess-1',
  };
  return { requestId: 'req-1', principal, authz: new Authz(principal), ipHash: 'ip-hash' };
}

function harness(maxFollows = 50) {
  const repo = new MemoryFollows();
  const updated = new Date('2026-03-01T00:00:00.000Z');
  repo.offices.set(OFFICE_A, { id: OFFICE_A, name: 'Mayor', level: 'MUNICIPAL', lastUpdatedAt: updated, status: 'ACTIVE' });
  repo.offices.set(OFFICE_B, { id: OFFICE_B, name: 'Council', level: 'MUNICIPAL', lastUpdatedAt: updated, status: 'ACTIVE' });
  repo.offices.set(OFFICE_RETIRED, {
    id: OFFICE_RETIRED,
    name: 'Old',
    level: 'COUNTY',
    lastUpdatedAt: updated,
    status: 'RETIRED',
  });
  repo.terms.add(`${OFFICIAL}:${OFFICE_A}`);
  repo.holders.set(OFFICE_A, { id: OFFICIAL, fullName: 'Ada Lovelace', displayName: 'Ada' });
  const svc = new FollowsService({
    repo,
    entitlements: { limits: () => Promise.resolve({ maxSavedLocations: 5, maxFollows }) },
    withTx: passthrough,
  });
  return { svc, repo };
}

describe('FollowsService', () => {
  it('follows an active office idempotently and rejects a missing office or official', async () => {
    const { svc, repo } = harness();
    const first = await svc.follow(resident(), { officeId: OFFICE_A, officialId: OFFICIAL });
    const second = await svc.follow(resident(), { officeId: OFFICE_A, officialId: OFFICIAL });
    expect(second.follow.id).toBe(first.follow.id);
    expect(repo.rows).toHaveLength(1);
    expect(first.follow.office.level).toBe('MUNICIPAL');
    expect(first.follow.holder?.displayName).toBe('Ada');
    await expect(svc.follow(resident(), { officeId: OFFICE_RETIRED })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.follow(resident(), { officeId: OFFICE_B, officialId: STRANGER })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(repo.rows).toHaveLength(1);
  });

  it('enforces the follow limit and unfollows idempotently', async () => {
    const { svc } = harness(1);
    await svc.follow(resident(), { officeId: OFFICE_A });
    await expect(svc.follow(resident(), { officeId: OFFICE_B })).rejects.toBeInstanceOf(FollowLimitError);
    await svc.unfollow(resident(), { officeId: OFFICE_A });
    await expect(svc.unfollow(resident(), { officeId: OFFICE_A })).resolves.toEqual({ officeId: OFFICE_A });
  });
});
