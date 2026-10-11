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
    expect(records[0]?.matchKey).toBe('bioguide:S000001');
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
});
