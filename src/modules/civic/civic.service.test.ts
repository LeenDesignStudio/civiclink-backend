import { describe, expect, it } from 'vitest';
import { Authz, anonymousPrincipal } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { FakeClock } from '../../lib/clock.js';
import { ForbiddenError, NotFoundError, UnauthenticatedError, UpstreamError } from '../../lib/errors.js';
import type { AdminJurisdictionNode, AdminOfficeRecord, AdminOfficialRecord, AdminServiceRecord } from './civic.dto.js';
import type { LookupContext } from '../lookup/lookup.dto.js';
import type { OfficeRecord, OfficialRecord, OfficialTermLink } from './civic.dto.js';
import type { AdminCursor, CivicStore, OfficeAdminQuery, OfficialAdminQuery, ServiceAdminQuery } from './civic.repo.js';
import { CivicService, type LookupReader } from './civic.service.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-01T00:00:00.000Z');
const JURISDICTION_ID = '11111111-1111-4111-8111-111111111111';

function residentContext(): ServiceContext {
  const principal = {
    kind: 'resident' as const,
    userId: 'user-1',
    status: 'ACTIVE' as const,
    termsAccepted: true,
    sessionId: 'session-1',
  };
  return { requestId: 'req-1', principal, authz: new Authz(principal), ipHash: 'hash' };
}

function viewerContext(): ServiceContext {
  const principal = { kind: 'admin' as const, adminId: 'admin-1', role: 'VIEWER' as const, sessionId: 'session-1' };
  return { requestId: 'req-1', principal, authz: new Authz(principal), ipHash: 'hash' };
}

function context(): ServiceContext {
  return {
    requestId: 'req-1',
    principal: anonymousPrincipal,
    authz: new Authz(anonymousPrincipal),
    ipHash: 'hash',
  };
}

function office(overrides: Partial<OfficeRecord> = {}): OfficeRecord {
  const base: OfficeRecord = {
    id: 'office-1',
    slug: 'district-a',
    name: 'Representative',
    seatLabel: null,
    selectionMethod: 'ELECTED',
    displayOrder: 1,
    whyTemplate: null,
    phone: null,
    email: null,
    website: null,
    contactUrl: null,
    holderUnknown: false,
    status: 'ACTIVE',
    lastUpdatedAt: new Date(NOW.getTime() - 90 * DAY),
    freshnessOverride: 'NONE',
    source: { name: 'Clerk', url: 'https://example.test/source', freshnessDays: 90 },
    jurisdiction: {
      id: JURISDICTION_ID,
      name: 'District A',
      level: 'FEDERAL',
      type: 'CONGRESSIONAL_DISTRICT',
      districtCode: '1',
      state: 'DC',
    },
    addresses: [],
    currentTerm: null,
  };
  return { ...base, ...overrides };
}

function term(link: Partial<OfficialTermLink> = {}): OfficialTermLink {
  return {
    isCurrent: true,
    termEnd: null,
    office: {
      id: 'office-1',
      slug: 'district-a',
      name: 'Representative',
      status: 'ACTIVE',
      whyTemplate: null,
      jurisdiction: {
        id: JURISDICTION_ID,
        name: 'District A',
        level: 'FEDERAL',
        type: 'CONGRESSIONAL_DISTRICT',
        districtCode: '1',
        state: 'DC',
      },
    },
    ...link,
  };
}

function official(overrides: Partial<OfficialRecord> = {}): OfficialRecord {
  const base: OfficialRecord = {
    id: 'official-1',
    slug: 'ada-example',
    fullName: 'Ada Example',
    displayName: null,
    party: null,
    photoUrl: null,
    website: null,
    status: 'ACTIVE',
    lastUpdatedAt: NOW,
    freshnessOverride: 'NONE',
    source: { name: 'Clerk', url: 'https://example.test/source', freshnessDays: 90 },
    terms: [term()],
  };
  return { ...base, ...overrides };
}

function lookup(overrides: Partial<LookupContext> = {}): LookupContext {
  return {
    token: 'lookup-exact-0000000000',
    method: 'ZIP',
    displayLabel: '20001',
    zip: '20001',
    confidence: 'EXACT',
    jurisdictionIds: [JURISDICTION_ID],
    partialLevels: ['EDUCATION'],
    levels: [
      {
        level: 'FEDERAL',
        confidence: 'EXACT',
        members: [{ id: JURISDICTION_ID, name: 'District A', type: 'CONGRESSIONAL_DISTRICT' }],
      },
    ],
    expiresAt: null,
    ...overrides,
  };
}

function harness(rows: { offices?: OfficeRecord[]; officials?: OfficialRecord[]; lookups?: LookupContext[] }) {
  const lookups = new Map((rows.lookups ?? []).map((row) => [row.token, row]));
  const reader: LookupReader = {
    findActive: (token) => Promise.resolve(lookups.get(token) ?? null),
  };
  const repo = {
    findOfficeBySlug: (slug: string) => Promise.resolve(rows.offices?.find((row) => row.slug === slug) ?? null),
    findOfficialBySlug: (slug: string) => Promise.resolve(rows.officials?.find((row) => row.slug === slug) ?? null),
  } as CivicStore;
  return new CivicService({ repo, lookups: reader, clock: new FakeClock(NOW) });
}

describe('CivicService public reads', () => {
  it('marks freshness CURRENT through the source window and outdated one millisecond later', async () => {
    const service = harness({
      offices: [
        office({ slug: 'on-time' }),
        office({ slug: 'late', lastUpdatedAt: new Date(NOW.getTime() - 90 * DAY - 1) }),
        office({
          slug: 'forced-current',
          freshnessOverride: 'FORCE_CURRENT',
          lastUpdatedAt: new Date(NOW.getTime() - 400 * DAY),
        }),
        office({ slug: 'forced-outdated', freshnessOverride: 'FORCE_OUTDATED', lastUpdatedAt: NOW }),
      ],
    });
    const ctx = context();
    await expect(service.getOffice(ctx, { slug: 'on-time' })).resolves.toMatchObject({ freshness: 'CURRENT' });
    await expect(service.getOffice(ctx, { slug: 'late' })).resolves.toMatchObject({ freshness: 'MAY_BE_OUTDATED' });
    await expect(service.getOffice(ctx, { slug: 'forced-current' })).resolves.toMatchObject({ freshness: 'CURRENT' });
    await expect(service.getOffice(ctx, { slug: 'forced-outdated' })).resolves.toMatchObject({
      freshness: 'MAY_BE_OUTDATED',
    });
  });

  it('distinguishes a vacant office from an unknown holder and a current holder', async () => {
    const service = harness({
      offices: [
        office({ slug: 'vacant' }),
        office({ slug: 'unknown', holderUnknown: true }),
        office({
          slug: 'held',
          holderUnknown: true,
          currentTerm: {
            status: 'ELECTED',
            official: {
              id: 'official-1',
              slug: 'ada-example',
              fullName: 'Ada Example',
              displayName: 'Ada',
              party: 'Independent',
              photoUrl: null,
              status: 'ACTIVE',
            },
          },
        }),
      ],
    });
    const ctx = context();
    const vacant = await service.getOffice(ctx, { slug: 'vacant' });
    expect(vacant.vacant).toBe(true);
    expect(vacant.holderUnknown).toBe(false);
    expect(vacant.currentHolder).toBeNull();

    const unknown = await service.getOffice(ctx, { slug: 'unknown' });
    expect(unknown.vacant).toBe(false);
    expect(unknown.holderUnknown).toBe(true);
    expect(unknown.currentHolder).toBeNull();

    const held = await service.getOffice(ctx, { slug: 'held' });
    expect(held.vacant).toBe(false);
    expect(held.holderUnknown).toBe(false);
    expect(held.currentHolder).toMatchObject({ fullName: 'Ada Example' });
    expect(held).not.toHaveProperty('sourceRecordUrl');
    expect(held).not.toHaveProperty('freshnessNote');
  });

  it('hides retired offices from the public read', async () => {
    const service = harness({ offices: [office({ status: 'RETIRED' })] });
    await expect(service.getOffice(context(), { slug: 'district-a' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('redirects a retired official and an official with no current term on an active office', async () => {
    const service = harness({
      officials: [
        official({ slug: 'retired', status: 'RETIRED' }),
        official({ slug: 'former', terms: [term({ isCurrent: false })] }),
        official({ slug: 'current' }),
      ],
    });
    const ctx = context();
    await expect(service.getOfficial(ctx, { slug: 'retired' })).resolves.toMatchObject({
      redirectOfficeSlug: 'district-a',
    });
    await expect(service.getOfficial(ctx, { slug: 'former' })).resolves.toMatchObject({
      redirectOfficeSlug: 'district-a',
    });
    await expect(service.getOfficial(ctx, { slug: 'current' })).resolves.toMatchObject({
      redirectOfficeSlug: null,
    });
  });

  it('renders whyItApplies from the office template, the default template, and a MULTIPLE overlap', async () => {
    const saved = lookup();
    const multiple = lookup({
      token: 'lookup-multi-0000000000',
      confidence: 'MULTIPLE',
      jurisdictionIds: [JURISDICTION_ID, '22222222-2222-4222-8222-222222222222'],
      levels: [
        {
          level: 'FEDERAL',
          confidence: 'MULTIPLE',
          members: [
            { id: JURISDICTION_ID, name: 'District A', type: 'CONGRESSIONAL_DISTRICT' },
            { id: '22222222-2222-4222-8222-222222222222', name: 'District B', type: 'CONGRESSIONAL_DISTRICT' },
          ],
        },
      ],
    });
    const service = harness({
      offices: [
        office({ slug: 'custom', whyTemplate: 'This {office} covers {jurisdiction} in district {district}.' }),
        office({ slug: 'default' }),
        office({ slug: 'overlap' }),
        office({ slug: 'elsewhere', jurisdiction: { ...office().jurisdiction, id: '33333333-3333-4333-8333-333333333333' } }),
      ],
      lookups: [saved, multiple],
    });
    const ctx = context();
    const custom = await service.getOffice(ctx, { slug: 'custom', lookupToken: saved.token });
    expect(custom.whyItApplies).toBe('This Representative covers District A in district 1.');

    const fallback = await service.getOffice(ctx, { slug: 'default', lookupToken: saved.token });
    expect(fallback.whyItApplies).toBe('Representative represents District A, district 1.');

    const overlap = await service.getOffice(ctx, { slug: 'overlap', lookupToken: multiple.token });
    expect(overlap.whyItApplies).toBe('Your ZIP code overlaps District A and District B.');

    const withoutToken = await service.getOffice(ctx, { slug: 'default' });
    expect(withoutToken.whyItApplies).toBeNull();

    const missing = await service.getOffice(ctx, { slug: 'elsewhere', lookupToken: saved.token });
    expect(missing.whyItApplies).toBeNull();
  });

  it('lists admin jurisdictions for a viewer and rejects an anonymous caller', async () => {
    const node: AdminJurisdictionNode = {
      id: JURISDICTION_ID,
      name: 'Dallas',
      level: 'MUNICIPAL',
      type: 'MUNICIPALITY',
      subtype: null,
      parentId: null,
      districtCode: null,
      geoid: null,
      state: 'TX',
      boundaryVintage: null,
      website: null,
      sourceId: '22222222-2222-4222-8222-222222222222',
      sourceRecordUrl: null,
      lastUpdatedAt: NOW,
      freshnessOverride: 'NONE',
      freshnessNote: null,
      status: 'ACTIVE',
      createdAt: NOW,
      hasBoundary: false,
    };
    const store = {
      listAdminJurisdictions: () => Promise.resolve({ rows: [{ ...node, sourceRecordUrl: 'https://example.test/dallas' }], totalCount: 4 }),
      findJurisdiction: () => Promise.resolve({ ...node, sourceRecordUrl: 'https://example.test/dallas' }),
    } as unknown as CivicStore;
    const service = new CivicService({
      repo: store,
      lookups: { findActive: () => Promise.resolve(null) },
      clock: new FakeClock(NOW),
    });
    expect(() => service.adminJurisdictions(context(), {})).toThrow(UnauthenticatedError);
    expect(() => service.adminJurisdictions(residentContext(), {})).toThrow(ForbiddenError);
    await expect(service.adminJurisdiction(residentContext(), JURISDICTION_ID)).rejects.toBeInstanceOf(ForbiddenError);
    const page = await service.adminJurisdictions(viewerContext(), { filter: { q: 'Dallas' }, sort: 'NAME' });
    expect(page.totalCount).toBe(4);
    expect(page.edges[0]?.node.name).toBe('Dallas');
    expect(page.edges[0]?.node.hasBoundary).toBe(false);
    expect(page.edges[0]?.node.sourceRecordUrl).toBe('https://example.test/dallas');
    const one = await service.adminJurisdiction(viewerContext(), JURISDICTION_ID);
    expect(one.sourceRecordUrl).toBe('https://example.test/dallas');
  });

  it('lists admin offices with a name cursor and rejects a resident', async () => {
    const calls: OfficeAdminQuery[] = [];
    const row: AdminOfficeRecord & { createdAt: Date } = {
      id: 'office-1',
      slug: 'clerk',
      jurisdictionId: JURISDICTION_ID,
      name: 'Clerk',
      seatLabel: null,
      selectionMethod: 'ELECTED',
      displayOrder: 0,
      whyTemplate: null,
      phone: null,
      email: null,
      website: null,
      contactUrl: null,
      holderUnknown: false,
      sourceId: '22222222-2222-4222-8222-222222222222',
      sourceRecordUrl: null,
      lastUpdatedAt: NOW,
      freshnessOverride: 'NONE',
      freshnessNote: null,
      status: 'ACTIVE',
      followerCount: 2,
      addresses: [],
      createdAt: NOW,
    };
    const store = {
      listAdminOffices: (query: OfficeAdminQuery) => {
        calls.push(query);
        return Promise.resolve({ rows: [row], totalCount: 3 });
      },
    } as unknown as CivicStore;
    const service = new CivicService({
      repo: store,
      lookups: { findActive: () => Promise.resolve(null) },
      clock: new FakeClock(NOW),
    });
    expect(() => service.adminOffices(residentContext(), {})).toThrow(ForbiddenError);
    const page = await service.adminOffices(viewerContext(), { filter: { q: 'Clerk' }, sort: 'NAME' });
    expect(page.totalCount).toBe(3);
    expect(page.edges[0]?.node.followerCount).toBe(2);
    await service.adminOffices(viewerContext(), { sort: 'NAME', after: page.pageInfo.endCursor ?? '' });
    expect(calls[0]?.q).toBe('Clerk');
    expect(calls[1]?.after).toEqual({ kind: 'name', name: 'Clerk', id: 'office-1' } satisfies AdminCursor);
  });

  it('returns official terms and rejects a resident', async () => {
    const calls: OfficialAdminQuery[] = [];
    const official: AdminOfficialRecord & { createdAt: Date } = {
      id: 'official-1',
      slug: 'ada',
      fullName: 'Ada Lovelace',
      displayName: null,
      party: null,
      photoUrl: null,
      website: null,
      sourceId: '22222222-2222-4222-8222-222222222222',
      sourceRecordUrl: null,
      lastUpdatedAt: NOW,
      freshnessOverride: 'NONE',
      freshnessNote: null,
      status: 'ACTIVE',
      createdAt: NOW,
      terms: [
        {
          id: 'term-1',
          officeId: 'office-1',
          status: 'ELECTED',
          termStart: NOW,
          termEnd: null,
          isCurrent: true,
          office: { id: 'office-1', slug: 'mayor', name: 'Mayor', status: 'ACTIVE' },
        },
      ],
    };
    const store = {
      listAdminOfficials: (query: OfficialAdminQuery) => {
        calls.push(query);
        return Promise.resolve({ rows: [official], totalCount: 1 });
      },
      findAdminOfficial: () => Promise.resolve(official),
    } as unknown as CivicStore;
    const service = new CivicService({
      repo: store,
      lookups: { findActive: () => Promise.resolve(null) },
      clock: new FakeClock(NOW),
    });
    expect(() => service.adminOfficials(residentContext(), {})).toThrow(ForbiddenError);
    await expect(service.adminOfficial(residentContext(), official.id)).rejects.toBeInstanceOf(ForbiddenError);
    const page = await service.adminOfficials(viewerContext(), { filter: { q: 'Ada' }, sort: 'NAME' });
    expect(page.totalCount).toBe(1);
    expect(page.edges[0]?.node.terms[0]?.office.name).toBe('Mayor');
    const one = await service.adminOfficial(viewerContext(), official.id);
    expect(one.terms[0]?.isCurrent).toBe(true);
    expect(calls[0]?.q).toBe('Ada');
    expect(calls[0]?.sort).toBe('NAME');
  });

  it('returns service links and rejects a resident', async () => {
    const calls: ServiceAdminQuery[] = [];
    const serviceRow: AdminServiceRecord & { createdAt: Date } = {
      id: 'service-1',
      title: 'Trash pickup',
      categoryId: '33333333-3333-4333-8333-333333333333',
      description: 'Weekly collection for households in the city.',
      url: null,
      phoneContact: null,
      lastValidatedAt: NOW,
      sourceId: '22222222-2222-4222-8222-222222222222',
      status: 'ACTIVE',
      createdAt: NOW,
      links: [{ id: 'link-1', jurisdictionId: JURISDICTION_ID, officeId: null }],
      jurisdictionIds: [JURISDICTION_ID],
      officeIds: [],
    };
    const store = {
      listAdminServices: (query: ServiceAdminQuery) => {
        calls.push(query);
        return Promise.resolve({ rows: [serviceRow], totalCount: 2 });
      },
      findAdminService: () => Promise.resolve(serviceRow),
    } as unknown as CivicStore;
    const service = new CivicService({
      repo: store,
      lookups: { findActive: () => Promise.resolve(null) },
      clock: new FakeClock(NOW),
    });
    expect(() => service.adminServices(residentContext(), {})).toThrow(ForbiddenError);
    await expect(service.adminService(residentContext(), serviceRow.id)).rejects.toBeInstanceOf(ForbiddenError);
    const page = await service.adminServices(viewerContext(), { filter: { linkBroken: false }, sort: 'NEWEST' });
    expect(page.totalCount).toBe(2);
    expect(page.edges[0]?.node.links[0]?.jurisdictionId).toBe(JURISDICTION_ID);
    const one = await service.adminService(viewerContext(), serviceRow.id);
    expect(one.links).toHaveLength(1);
    expect(calls[0]?.linkBroken).toBe(false);
  });

  it('returns the office with the term and rolls back when fan-out cannot be queued', async () => {
    const officeId = '11111111-1111-4111-8111-111111111111';
    const officialId = '22222222-2222-4222-8222-222222222222';
    const office = { id: officeId, name: 'Mayor' };
    const official = { id: officialId, fullName: 'Ada Lovelace', displayName: null };
    const term = {
      id: '33333333-3333-4333-8333-333333333333',
      officeId,
      officialId,
      status: 'ELECTED' as const,
      termStart: null,
      termEnd: null,
      isCurrent: true,
    };
    const jobs: Array<{ name: string; key?: string }> = [];
    let committed = false;
    const store = {
      transaction: async (fn: (inner: CivicStore, tx: unknown) => Promise<unknown>) => {
        const result = await fn(store, {});
        committed = true;
        return result;
      },
      findAdminOffice: () => Promise.resolve(office),
      findAdminOfficial: () => Promise.resolve(official),
      endCurrentTerm: () => Promise.resolve(null),
      setHolderUnknown: () => Promise.resolve(),
      createTerm: () => Promise.resolve(term),
    } as unknown as CivicStore;
    const input = {
      officeId,
      officialId,
      status: 'ELECTED',
      makeCurrent: true,
      notifyFollowers: true,
    };
    const editor = new Authz({ kind: 'admin', adminId: 'admin-1', role: 'EDITOR', sessionId: 'session-1' });
    const editorCtx = {
      requestId: 'req-1',
      principal: { kind: 'admin' as const, adminId: 'admin-1', role: 'EDITOR' as const, sessionId: 'session-1' },
      authz: editor,
      ipHash: 'hash',
    };
    const service = new CivicService({
      repo: store,
      lookups: { findActive: () => Promise.resolve(null) },
      clock: new FakeClock(NOW),
      enqueue: (name, _payload, key) => {
        jobs.push({ name, ...(key ? { key } : {}) });
        return Promise.resolve();
      },
    });
    await expect(service.setOfficeTerm(viewerContext(), input)).rejects.toBeInstanceOf(ForbiddenError);
    const result = await service.setOfficeTerm(editorCtx, input);
    expect(result.term.id).toBe(term.id);
    expect(result.office.name).toBe('Mayor');
    expect(jobs).toEqual([{ name: 'notify.fanout', key: officeId }]);
    expect(committed).toBe(true);

    committed = false;
    const failing = new CivicService({
      repo: store,
      lookups: { findActive: () => Promise.resolve(null) },
      clock: new FakeClock(NOW),
      enqueue: () => Promise.reject(new Error('queue down')),
    });
    await expect(failing.setOfficeTerm(editorCtx, input)).rejects.toBeInstanceOf(UpstreamError);
    expect(committed).toBe(false);
  });
});
