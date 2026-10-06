import { describe, expect, it } from 'vitest';
import { Authz, anonymousPrincipal, type Principal } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { FakeClock } from '../../lib/clock.js';
import {
  CandidateExpiredError,
  GeocoderUnavailableError,
  LocationNotFoundError,
  LocationOutsideUsError,
  LookupNotFoundError,
} from '../../lib/errors.js';
import { FakeRandom } from '../../lib/random.js';
import {
  county,
  districtA,
  districtB,
  municipality,
  pointInsideA,
  pointNearBorder,
  pointOutside,
  zcta,
  type GeoJsonPolygon,
} from '../../../test/fixtures/geo/squares.js';
import { FakeGeocoder } from '../../../test/fakes/geocoder.js';
import type { GovLevel, JurisdictionType, OfficeRecord, ServiceRecord } from '../civic/civic.dto.js';
import type { CivicReadPort } from '../civic/civic.service.js';
import { GoogleGeocoder, type Candidate, type GeocoderHttpResponse } from './clients/geocoder.js';
import type { AnalyticsEventProps, SavedLookup } from './lookup.dto.js';
import type { CreateLookupInput, LookupStore } from './lookup.repo.js';
import { LookupService, type SpatialPort } from './lookup.service.js';

type NoRawQuery = 'rawQuery' extends keyof CreateLookupInput ? never : true;
const noRawQuery: NoRawQuery = true;

const NOW = new Date('2026-06-01T00:00:00.000Z');
const SECRET = 'unit-test-link-signing-secret-32';
const METRES_PER_LAT = 111_320;

const IDS = {
  a: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  b: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  county: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  city: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  zcta: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  officeEarly: '11111111-1111-4111-8111-111111111111',
  officeLate: '22222222-2222-4222-8222-222222222222',
};

interface Feature {
  id: string;
  level: GovLevel;
  type: JurisdictionType;
  name: string;
  polygon: GeoJsonPolygon;
  zip?: string;
}

const FEATURES: Feature[] = [
  { id: IDS.a, level: 'FEDERAL', type: 'CONGRESSIONAL_DISTRICT', name: 'District A', polygon: districtA },
  { id: IDS.b, level: 'FEDERAL', type: 'CONGRESSIONAL_DISTRICT', name: 'District B', polygon: districtB },
  { id: IDS.county, level: 'COUNTY', type: 'COUNTY', name: 'Sample County', polygon: county },
  { id: IDS.city, level: 'MUNICIPAL', type: 'MUNICIPALITY', name: 'Sample City', polygon: municipality },
  { id: IDS.zcta, level: 'SPECIAL', type: 'ZCTA', name: 'ZCTA 20001', polygon: zcta, zip: '20001' },
];

function bounds(polygon: GeoJsonPolygon) {
  const ring = polygon.coordinates[0] ?? [];
  const lngs = ring.map((point) => point[0] ?? 0);
  const lats = ring.map((point) => point[1] ?? 0);
  return {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };
}

function contains(polygon: GeoJsonPolygon, lng: number, lat: number): boolean {
  const box = bounds(polygon);
  return lng >= box.minLng && lng <= box.maxLng && lat >= box.minLat && lat <= box.maxLat;
}

function intersectionArea(left: GeoJsonPolygon, right: GeoJsonPolygon): number {
  const a = bounds(left);
  const b = bounds(right);
  const width = Math.max(0, Math.min(a.maxLng, b.maxLng) - Math.max(a.minLng, b.minLng));
  const height = Math.max(0, Math.min(a.maxLat, b.maxLat) - Math.max(a.minLat, b.minLat));
  return width * height;
}

function area(polygon: GeoJsonPolygon): number {
  const box = bounds(polygon);
  return (box.maxLng - box.minLng) * (box.maxLat - box.minLat);
}

class MemorySpatial implements SpatialPort {
  readonly geoms: string[] = [];

  jurisdictionsContainingPoint(lng: number, lat: number) {
    return Promise.resolve(
      FEATURES.filter((feature) => contains(feature.polygon, lng, lat)).map((feature) => ({
        id: feature.id,
        level: feature.level,
        type: feature.type,
        name: feature.name,
      })),
    );
  }

  jurisdictionsIntersectingArea(areaJurisdictionId: string, minShare = 0.01) {
    const areaFeature = FEATURES.find((feature) => feature.id === areaJurisdictionId);
    if (!areaFeature) return Promise.resolve([]);
    const hits = FEATURES.filter((feature) => feature.id !== areaJurisdictionId)
      .map((feature) => ({
        id: feature.id,
        level: feature.level,
        type: feature.type,
        share: intersectionArea(areaFeature.polygon, feature.polygon) / area(areaFeature.polygon),
      }))
      .filter((hit) => hit.share >= minShare);
    return Promise.resolve(hits);
  }

  nearBoundary(jurisdictionId: string, lng: number, lat: number, meters = 50) {
    const feature = FEATURES.find((item) => item.id === jurisdictionId);
    if (!feature) return Promise.resolve(false);
    const metresPerLng = METRES_PER_LAT * Math.cos((lat * Math.PI) / 180);
    const near = FEATURES.some((other) => {
      if (other.id === feature.id || other.type !== feature.type) return false;
      const box = bounds(other.polygon);
      const closestLng = Math.min(Math.max(lng, box.minLng), box.maxLng);
      const closestLat = Math.min(Math.max(lat, box.minLat), box.maxLat);
      const dx = (lng - closestLng) * metresPerLng;
      const dy = (lat - closestLat) * METRES_PER_LAT;
      return Math.hypot(dx, dy) <= meters;
    });
    return Promise.resolve(near);
  }

  zctaByZip(zip: string) {
    return Promise.resolve(FEATURES.find((feature) => feature.zip === zip)?.id);
  }

  placeByNameState() {
    return Promise.resolve(undefined);
  }

  setLookupGeom(_id: string, geojson: string) {
    this.geoms.push(geojson);
    return Promise.resolve(1);
  }
}

function office(id: string, name: string, displayOrder: number): OfficeRecord {
  return {
    id,
    slug: name.toLowerCase().replace(/ /g, '-'),
    name,
    seatLabel: null,
    selectionMethod: 'ELECTED',
    displayOrder,
    whyTemplate: null,
    phone: null,
    email: null,
    website: null,
    contactUrl: null,
    holderUnknown: false,
    status: 'ACTIVE',
    lastUpdatedAt: NOW,
    freshnessOverride: 'NONE',
    source: { name: 'Clerk', url: 'https://example.test/source', freshnessDays: 90 },
    jurisdiction: {
      id: IDS.a,
      name: 'District A',
      level: 'FEDERAL',
      type: 'CONGRESSIONAL_DISTRICT',
      districtCode: '1',
      state: 'DC',
    },
    addresses: [],
    currentTerm: null,
  };
}

function serviceRow(index: number): ServiceRecord {
  return {
    id: `service-${index}`,
    title: `Service ${index}`,
    description: 'Help',
    url: 'https://example.test/help',
    phoneContact: null,
    category: { id: 'cat-1', name: 'Help', sortOrder: 1 },
    createdAt: NOW,
    status: 'ACTIVE',
  };
}

class MemoryLookups implements LookupStore {
  readonly created: CreateLookupInput[] = [];
  readonly rows: SavedLookup[] = [];

  create(input: CreateLookupInput): Promise<SavedLookup> {
    this.created.push(input);
    const row: SavedLookup = {
      id: `lookup-${this.rows.length + 1}`,
      token: input.token,
      userId: input.userId,
      method: input.method,
      displayLabel: input.displayLabel,
      zip: input.zip,
      jurisdictionIds: input.jurisdictionIds,
      confidence: input.confidence,
      partialLevels: input.partialLevels,
      levelDetail: input.levelDetail,
      latencyMs: input.latencyMs,
      expiresAt: input.expiresAt,
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findByToken(token: string): Promise<SavedLookup | null> {
    return Promise.resolve(this.rows.find((row) => row.token === token) ?? null);
  }
}

function candidate(point: { coordinates: [number, number] }, extras: Partial<Candidate> = {}): Candidate {
  const [lng, lat] = point.coordinates;
  const row: Candidate = {
    displayLabel: extras.displayLabel ?? 'Geocoded place',
    lat,
    lng,
    country: extras.country ?? 'US',
    precision: extras.precision ?? 'ROOFTOP',
  };
  if (extras.zip) row.zip = extras.zip;
  if (extras.city) row.city = extras.city;
  if (extras.state) row.state = extras.state;
  return row;
}

function anonymous(): ServiceContext {
  return {
    requestId: 'req-1',
    principal: anonymousPrincipal,
    authz: new Authz(anonymousPrincipal),
    ipHash: 'hash',
  };
}

function resident(): ServiceContext {
  const principal: Principal = {
    kind: 'resident',
    userId: 'user-1',
    status: 'ACTIVE',
    termsAccepted: true,
    sessionId: 'session-1',
  };
  return { requestId: 'req-2', principal, authz: new Authz(principal), ipHash: 'hash' };
}

function world() {
  const repo = new MemoryLookups();
  const spatial = new MemorySpatial();
  const geocoder = new FakeGeocoder();
  const events: Array<{ name: string; props: AnalyticsEventProps }> = [];
  const offices = [office(IDS.officeLate, 'Later Office', 2), office(IDS.officeEarly, 'Earlier Office', 1)];
  const civic: CivicReadPort = {
    jurisdictionBriefs: (ids) =>
      Promise.resolve(
        FEATURES.filter((feature) => ids.includes(feature.id)).map((feature) => ({
          id: feature.id,
          name: feature.name,
          level: feature.level,
          type: feature.type,
        })),
      ),
    officesForJurisdictions: (ids) =>
      Promise.resolve(offices.filter((row) => ids.includes(row.jurisdiction.id))),
    servicesForLinks: () => Promise.resolve([1, 2, 3, 4, 5, 6].map(serviceRow)),
  };
  const service = new LookupService({
    repo,
    spatial,
    geocoder,
    civic,
    follows: (_userId, officeId) => officeId === IDS.officeEarly,
    analytics: { track: (name, props) => events.push({ name, props }) },
    clock: new FakeClock(NOW),
    random: new FakeRandom(),
    signingSecret: SECRET,
    anonTtlDays: 30,
  });
  return { service, repo, spatial, geocoder, events, clock: new FakeClock(NOW) };
}

describe('LookupService', () => {
  it('resolves a rooftop point inside district A as EXACT and a point 20m from the border as LIKELY', async () => {
    expect(noRawQuery).toBe(true);
    const scene = world();
    const inside = candidate(pointInsideA, { displayLabel: 'Inside A', zip: '20001' });
    const near = candidate(pointNearBorder, { displayLabel: 'Near border', zip: '20001' });
    const approximate = candidate(pointInsideA, { displayLabel: 'Approximate', precision: 'APPROXIMATE', zip: '20001' });
    const geocoder = new FakeGeocoder([[inside], [near], [approximate]]);
    const rebuilt = rebuild(scene, geocoder);

    const exact = await rebuilt.service.resolveLocation(anonymous(), { query: '1600 Pennsylvania Avenue NW' });
    expect(exact).toMatchObject({ status: 'RESOLVED', confidence: 'EXACT' });
    expect(rebuilt.repo.created[0]?.displayLabel).toBe('Inside A');
    expect(rebuilt.repo.created[0]?.token).toHaveLength(22);
    expect(rebuilt.repo.created[0]?.userId).toBeNull();
    expect(rebuilt.repo.created[0]?.expiresAt?.toISOString()).toBe(new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString());
    expect(rebuilt.repo.created[0]).not.toHaveProperty('rawQuery');
    expect(rebuilt.repo.created[0]?.partialLevels).toContain('EDUCATION');
    expect(rebuilt.spatial.geoms[0]).toContain('"type":"Point"');

    const likely = await rebuilt.service.resolveLocation(anonymous(), { query: 'Near the line' });
    expect(likely.confidence).toBe('LIKELY');

    const coarse = await rebuilt.service.resolveLocation(anonymous(), { query: 'Rough place' });
    expect(coarse.confidence).toBe('LIKELY');
  });

  it('marks a ZIP that overlaps two districts of the same type as MULTIPLE and leaves an empty level partial', async () => {
    const scene = world();
    const geocoder = new FakeGeocoder([
      [candidate(pointInsideA, { displayLabel: 'Washington, DC 20001', zip: '20001' })],
    ]);
    const rebuilt = rebuild(scene, geocoder);
    const result = await rebuilt.service.resolveLocation(anonymous(), { query: '20001' });
    expect(result.confidence).toBe('MULTIPLE');
    expect(rebuilt.repo.created[0]?.partialLevels).toContain('EDUCATION');
    expect(rebuilt.repo.created[0]?.displayLabel).toBe('Washington, DC 20001');
    expect(rebuilt.spatial.geoms).toHaveLength(0);
    const card = await rebuilt.service.civicCard(anonymous(), { token: result.token });
    const federal = card.levels.find((level) => level.level === 'FEDERAL');
    expect(federal?.notice).toBe('Your ZIP code overlaps District A and District B.');
  });

  it('builds a civic card in fixed level order with coverage, a five-service preview, and follow state', async () => {
    const scene = world();
    const geocoder = new FakeGeocoder([[candidate(pointInsideA, { displayLabel: 'Inside A', zip: '20001' })]]);
    const rebuilt = rebuild(scene, geocoder);
    const resolved = await rebuilt.service.resolveLocation(resident(), { query: '1600 Pennsylvania Avenue NW' });
    expect(rebuilt.repo.created[0]?.userId).toBe('user-1');
    expect(rebuilt.repo.created[0]?.expiresAt).toBeNull();

    const card = await rebuilt.service.civicCard(resident(), { token: resolved.token });
    expect(card.levels.map((level) => level.level)).toEqual([
      'FEDERAL',
      'STATE',
      'COUNTY',
      'MUNICIPAL',
      'EDUCATION',
      'SPECIAL',
    ]);
    expect(card.levels.find((level) => level.level === 'FEDERAL')).toMatchObject({ coverage: 'COVERED' });
    expect(card.levels.find((level) => level.level === 'EDUCATION')).toMatchObject({ coverage: 'NONE' });
    expect(card.levels.find((level) => level.level === 'COUNTY')).toMatchObject({ coverage: 'PARTIAL' });
    expect(card.levels.find((level) => level.level === 'FEDERAL')?.offices.map((row) => row.name)).toEqual([
      'Earlier Office',
      'Later Office',
    ]);
    expect(card.levels.find((level) => level.level === 'FEDERAL')?.offices[0]?.isFollowed).toBe(true);
    expect(card.servicesPreview).toHaveLength(5);

    const anon = await rebuilt.service.civicCard(anonymous(), { token: resolved.token });
    expect(anon.levels.find((level) => level.level === 'FEDERAL')?.offices[0]?.isFollowed).toBeNull();
  });

  it('rejects missing places, places outside the US, timeouts, and unknown or expired cards', async () => {
    const scene = world();
    const geocoder = new FakeGeocoder([
      [candidate(pointOutside, { displayLabel: 'Outside' })],
      [],
      [candidate(pointInsideA, { displayLabel: 'Paris', country: 'FR' })],
      'timeout',
    ]);
    const rebuilt = rebuild(scene, geocoder);
    await expect(rebuilt.service.resolveLocation(anonymous(), { query: 'Nowhere Road' })).rejects.toBeInstanceOf(
      LocationNotFoundError,
    );
    await expect(rebuilt.service.resolveLocation(anonymous(), { query: 'Empty Road' })).rejects.toBeInstanceOf(
      LocationNotFoundError,
    );
    await expect(rebuilt.service.resolveLocation(anonymous(), { query: 'Paris France' })).rejects.toBeInstanceOf(
      LocationOutsideUsError,
    );
    await expect(rebuilt.service.resolveLocation(anonymous(), { query: 'Slow Road' })).rejects.toBeInstanceOf(
      GeocoderUnavailableError,
    );
    await expect(rebuilt.service.civicCard(anonymous(), { token: 'missing-token' })).rejects.toBeInstanceOf(
      LookupNotFoundError,
    );

    const saved = await rebuilt.repo.create({
      token: 'expired-token-00000000',
      userId: null,
      method: 'ADDRESS',
      displayLabel: 'Old',
      zip: null,
      jurisdictionIds: [],
      confidence: 'EXACT',
      partialLevels: [],
      levelDetail: { levels: [] },
      latencyMs: 1,
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    await expect(rebuilt.service.civicCard(anonymous(), { token: saved.token })).rejects.toBeInstanceOf(
      LookupNotFoundError,
    );
  });

  it('asks the resident to confirm several candidates and rejects an expired candidate token', async () => {
    const scene = world();
    const geocoder = new FakeGeocoder([
      [
        candidate(pointInsideA, { displayLabel: 'First match', zip: '20001' }),
        candidate(pointInsideA, { displayLabel: 'Second match', zip: '20001' }),
      ],
    ]);
    const clock = new FakeClock(NOW);
    const rebuilt = rebuild(scene, geocoder, clock);
    const pending = await rebuilt.service.resolveLocation(anonymous(), { query: 'Ambiguous Ave' });
    expect(pending.status).toBe('NEEDS_CONFIRMATION');
    expect(pending.candidates).toHaveLength(2);
    expect(rebuilt.repo.created).toHaveLength(0);
    const token = pending.candidates[0]?.candidateToken ?? '';
    const confirmed = await rebuilt.service.confirmLocationCandidate(anonymous(), { candidateToken: token });
    expect(confirmed).toMatchObject({ status: 'RESOLVED', confidence: 'EXACT' });
    clock.advance(11 * 60 * 1000);
    await expect(
      rebuilt.service.confirmLocationCandidate(anonymous(), { candidateToken: token }),
    ).rejects.toBeInstanceOf(CandidateExpiredError);
  });

  it('records lookup analytics without the address, email, token, or raw query', async () => {
    const scene = world();
    const geocoder = new FakeGeocoder([[candidate(pointInsideA, { displayLabel: 'Inside A', zip: '20001' })]]);
    const rebuilt = rebuild(scene, geocoder);
    await rebuilt.service.resolveLocation(anonymous(), { query: '1600 Pennsylvania Avenue NW' });
    const names = rebuilt.events.map((event) => event.name);
    expect(names).toContain('lookup_started');
    expect(names).toContain('lookup_completed');
    const allowed = new Set(['method', 'confidence', 'latencyMs', 'zip', 'countyId']);
    for (const event of rebuilt.events) {
      for (const key of Object.keys(event.props)) expect(allowed.has(key)).toBe(true);
      const encoded = JSON.stringify(event.props);
      expect(encoded).not.toContain('1600 Pennsylvania');
      expect(encoded).not.toContain('@');
    }
    const completed = rebuilt.events.find((event) => event.name === 'lookup_completed');
    expect(completed?.props).toMatchObject({ method: 'ADDRESS', confidence: 'EXACT', zip: '20001', countyId: IDS.county });
  });
});

function rebuild(
  scene: ReturnType<typeof world>,
  geocoder: FakeGeocoder,
  clock: FakeClock = new FakeClock(NOW),
) {
  const service = new LookupService({
    repo: scene.repo,
    spatial: scene.spatial,
    geocoder,
    civic: {
      jurisdictionBriefs: (ids) =>
        Promise.resolve(
          FEATURES.filter((feature) => ids.includes(feature.id)).map((feature) => ({
            id: feature.id,
            name: feature.name,
            level: feature.level,
            type: feature.type,
          })),
        ),
      officesForJurisdictions: (ids) =>
        Promise.resolve(
          [office(IDS.officeLate, 'Later Office', 2), office(IDS.officeEarly, 'Earlier Office', 1)].filter((row) =>
            ids.includes(row.jurisdiction.id),
          ),
        ),
      servicesForLinks: () => Promise.resolve([1, 2, 3, 4, 5, 6].map(serviceRow)),
    },
    follows: (_userId, officeId) => officeId === IDS.officeEarly,
    analytics: { track: (name, props) => scene.events.push({ name, props }) },
    clock,
    random: new FakeRandom(),
    signingSecret: SECRET,
    anonTtlDays: 30,
  });
  return { ...scene, service, clock };
}

describe('GoogleGeocoder', () => {
  it('requests US results, maps rooftop precision, and opens the breaker after repeated failures', async () => {
    const urls: string[] = [];
    const ok = {
      status: 'OK',
      results: [
        {
          formatted_address: '1 Main St',
          geometry: { location: { lat: 38.895, lng: -77.035 }, location_type: 'ROOFTOP' },
          address_components: [
            { long_name: 'United States', short_name: 'US', types: ['country', 'political'] },
            { long_name: '20001', short_name: '20001', types: ['postal_code'] },
          ],
        },
      ],
    };
    const fetch = (url: string): Promise<GeocoderHttpResponse> => {
      urls.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(ok),
        headers: { get: () => null },
      });
    };
    const geocoder = new GoogleGeocoder({
      apiKey: 'test-key',
      fetch,
      clock: new FakeClock(NOW),
      random: new FakeRandom(),
      sleep: () => Promise.resolve(),
    });
    const [hit] = await geocoder.geocode('1 Main St');
    expect(hit).toMatchObject({ precision: 'ROOFTOP', country: 'US', zip: '20001' });
    const called = new URL(urls[0] ?? '');
    expect(called.searchParams.get('components')).toBe('country:US');

    let attempts = 0;
    const failing = new GoogleGeocoder({
      apiKey: 'test-key',
      fetch: () => {
        attempts += 1;
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({}),
          headers: { get: () => null },
        });
      },
      clock: new FakeClock(NOW),
      random: new FakeRandom(),
      sleep: () => Promise.resolve(),
    });
    for (let i = 0; i < 5; i += 1) {
      await expect(failing.geocode('bad')).rejects.toBeInstanceOf(GeocoderUnavailableError);
    }
    expect(attempts).toBe(5);
    await expect(failing.geocode('bad')).rejects.toBeInstanceOf(GeocoderUnavailableError);
    expect(attempts).toBe(5);
  });

  it('turns a geocoder timeout into GeocoderUnavailableError', async () => {
    let attempts = 0;
    const geocoder = new GoogleGeocoder({
      apiKey: 'test-key',
      fetch: () => {
        attempts += 1;
        const error = new Error('timed out');
        error.name = 'TimeoutError';
        return Promise.reject(error);
      },
      clock: new FakeClock(NOW),
      random: new FakeRandom(),
      sleep: () => Promise.resolve(),
    });
    await expect(geocoder.geocode('slow')).rejects.toBeInstanceOf(GeocoderUnavailableError);
    expect(attempts).toBe(3);
  });
});
