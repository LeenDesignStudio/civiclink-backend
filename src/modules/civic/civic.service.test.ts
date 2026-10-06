import { describe, expect, it } from 'vitest';
import { Authz, anonymousPrincipal } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { FakeClock } from '../../lib/clock.js';
import { NotFoundError } from '../../lib/errors.js';
import type { LookupContext } from '../lookup/lookup.dto.js';
import type { OfficeRecord, OfficialRecord, OfficialTermLink } from './civic.dto.js';
import type { CivicStore } from './civic.repo.js';
import { CivicService, type LookupReader } from './civic.service.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-01T00:00:00.000Z');
const JURISDICTION_ID = '11111111-1111-4111-8111-111111111111';

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
});
