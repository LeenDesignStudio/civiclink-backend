import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { congressCollector, openStatesCollector, openStatesUrl, parseSimpleYaml } from './collectors.js';
import type { SourceRow } from './records.js';

const yaml = readFileSync(new URL('./fixtures/legislators.yaml', import.meta.url), 'utf8');
const csv = readFileSync(new URL('./fixtures/openstates.csv', import.meta.url), 'utf8');

function source(partial: Partial<SourceRow>): SourceRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'People',
    publisher: 'Fixture',
    url: 'https://example.com/people',
    termsUrl: 'https://example.com/terms',
    method: 'BULK',
    schedule: 'WEEKLY',
    freshnessDays: 90,
    levels: ['FEDERAL'],
    collectorKey: 'congress.legislators',
    active: true,
    lastRunAt: null,
    config: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...partial,
  };
}

describe('congress and open states fixtures', () => {
  it('parses nested legislator YAML and keeps the pilot state', async () => {
    const parsed = parseSimpleYaml(yaml);
    expect(parsed).toHaveLength(2);
    const snap = await congressCollector.fetch({
      source: source({ config: { state: 'MD' }, url: 'https://example.com/legislators.yaml' }),
      maxBytes: 100_000,
      fetch: {
        get: () => Promise.resolve({ status: 200, body: new TextEncoder().encode(yaml), contentType: 'text/yaml' }),
      },
    });
    const records = congressCollector.normalise(snap);
    expect(records).toHaveLength(1);
    expect(records[0]?.fields.fullName).toBe('Jane Smith');
    expect(records[0]?.fields.state).toBe('MD');
    expect(records[0]?.fields.title).toBe('U.S. Senator');
    expect(records[0]?.fields.jurisdictionType).toBe('STATE');
    expect(records[0]?.fields.jurisdictionGeoid).toBe('24');
    expect(records[0]?.fields.officeKey).toBe('seat:senate:24:S000001');
    expect(records[0]?.matchKey).toBe('bioguide:S000001');
  });

  it('places a representative on the Census congressional district', async () => {
    const yaml = `---
- id:
    bioguide: R000008
  name:
    official_full: Rita House
  terms:
  - type: rep
    state: MD
    district: 8
    party: Democratic
    start: '2025-01-03'
    url: https://house.example.gov/rita
    phone: 202-225-0008
    address: 101 Independence Ave Washington DC 20515
    contact_form: https://house.example.gov/contact
`;
    const snap = await congressCollector.fetch({
      source: source({ config: { state: 'MD' }, url: 'https://example.com/legislators.yaml' }),
      maxBytes: 100_000,
      fetch: {
        get: () => Promise.resolve({ status: 200, body: new TextEncoder().encode(yaml), contentType: 'text/yaml' }),
      },
    });
    const row = congressCollector.normalise(snap)[0];
    expect(row?.fields.officeName).toBe('United States Representative');
    expect(row?.fields.jurisdictionType).toBe('CONGRESSIONAL_DISTRICT');
    expect(row?.fields.jurisdictionGeoid).toBe('2408');
    expect(row?.fields.officeKey).toBe('seat:cd:2408');
    expect(row?.fields.seatLabel).toBe('8');
    expect(row?.fields.termStart).toBe('2025-01-03');
    expect(row?.fields.website).toBe('https://house.example.gov/rita');
    expect(row?.fields.phone).toBe('202-225-0008');
    expect(row?.fields.address).toBe('101 Independence Ave Washington DC 20515');
    expect(row?.fields.contactUrl).toBe('https://house.example.gov/contact');
  });

  it('reads the Open States CSV for the requested state', async () => {
    expect(openStatesUrl({ state: 'MD' }, 'https://data.openstates.org/people/current/')).toBe(
      'https://data.openstates.org/people/current/md.csv',
    );
    const snap = await openStatesCollector.fetch({
      source: source({
        collectorKey: 'openstates.people',
        url: 'https://data.openstates.org/people/current/',
        config: { state: 'MD' },
      }),
      maxBytes: 100_000,
      fetch: {
        get: (url) => {
          expect(url).toBe('https://data.openstates.org/people/current/md.csv');
          return Promise.resolve({ status: 200, body: new TextEncoder().encode(csv), contentType: 'text/csv' });
        },
      },
    });
    const records = openStatesCollector.normalise(snap);
    expect(records.map((row) => row.fields.fullName)).toEqual(['Jane Smith']);
    expect(records[0]?.matchKey).toBe('openstates:ocd-person/md-1');
  });

  it('keeps a state CSV that has current_party and no state column', async () => {
    const body = 'id,name,current_party\nocd-person/md-2,Ada Lovelace,Democratic\n';
    const snap = await openStatesCollector.fetch({
      source: source({
        collectorKey: 'openstates.people',
        url: 'https://data.openstates.org/people/current/',
        config: { state: 'MD' },
      }),
      maxBytes: 100_000,
      fetch: {
        get: () => Promise.resolve({ status: 200, body: new TextEncoder().encode(body), contentType: 'text/csv' }),
      },
    });
    const records = openStatesCollector.normalise(snap);
    expect(records).toEqual([
      {
        matchKey: 'openstates:ocd-person/md-2',
        entityType: 'OFFICIAL',
        fields: { fullName: 'Ada Lovelace', party: 'Democratic', state: 'MD' },
      },
    ]);
  });

  it('places a state senator on the Census upper district and keeps an email', async () => {
    const body =
      'id,name,current_party,current_chamber,current_district,email,image\nocd-person/md-14,Ada Lovelace,Democratic,upper,14,ada@senate.md.gov,https://example.gov/ada.jpg\n';
    const snap = await openStatesCollector.fetch({
      source: source({
        collectorKey: 'openstates.people',
        url: 'https://data.openstates.org/people/current/',
        config: { state: 'MD' },
      }),
      maxBytes: 100_000,
      fetch: {
        get: () => Promise.resolve({ status: 200, body: new TextEncoder().encode(body), contentType: 'text/csv' }),
      },
    });
    const row = openStatesCollector.normalise(snap)[0];
    expect(row?.fields.title).toBe('State Senator');
    expect(row?.fields.jurisdictionType).toBe('STATE_SENATE_DISTRICT');
    expect(row?.fields.jurisdictionGeoid).toBe('24014');
    expect(row?.fields.officeKey).toBe('seat:sldu:24014');
    expect(row?.fields.contactEmail).toBe('ada@senate.md.gov');
    expect(row?.fields.photoUrl).toBe('https://example.gov/ada.jpg');
  });

  it('keeps a quoted address in its column and holds an email that does not match the name', async () => {
    const body =
      'id,name,current_chamber,current_district,capitol_address,email\n' +
      'ocd-person/md-14,Aaron Aylward,upper,14,"100 State Circle, Annapolis, MD 21401",tim.czmowski@example.gov\n';
    const snap = await openStatesCollector.fetch({
      source: source({
        collectorKey: 'openstates.people',
        url: 'https://data.openstates.org/people/current/',
        config: { state: 'MD' },
      }),
      maxBytes: 100_000,
      fetch: {
        get: () => Promise.resolve({ status: 200, body: new TextEncoder().encode(body), contentType: 'text/csv' }),
      },
    });
    const row = openStatesCollector.normalise(snap)[0];
    expect(row?.fields.capitolAddress).toBe('100 State Circle, Annapolis, MD 21401');
    expect(row?.fields.contactEmail).toBeUndefined();
    expect(row?.fields.emailReview).toBe('tim.czmowski@example.gov');
    expect(row?.fields.jurisdictionGeoid).toBe('24014');
  });
});
