import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { executePlan, formatCounts, parsePilotArgs, parseRunArgs, planForCollector, planForPilot } from './cli.js';
import { parsePageSourceFile, sourceCatalog } from './source-catalog.js';
import type { SourceRow } from './records.js';
import type { RunCounts } from './types.js';

function source(partial: Partial<SourceRow> & Pick<SourceRow, 'name' | 'collectorKey'>): SourceRow {
  return {
    id: partial.id ?? '11111111-1111-4111-8111-111111111111',
    publisher: 'Fixture',
    url: 'https://example.com/source',
    termsUrl: 'https://example.com/terms',
    method: 'BULK',
    schedule: 'WEEKLY',
    freshnessDays: 90,
    levels: ['COUNTY'],
    active: true,
    lastRunAt: null,
    config: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...partial,
  };
}

const counts: RunCounts = { skipped: false, added: 2, changed: 1, retired: 0, pending: 3, sha: 'abc' };

describe('pipeline cli', () => {
  it('parses run and pilot flags', () => {
    expect(parseRunArgs(['tiger.boundaries', '--state', 'MD', '--county', 'Montgomery', '--dry-run'])).toEqual({
      collectorKey: 'tiger.boundaries',
      state: 'MD',
      county: 'Montgomery',
      dryRun: true,
    });
    expect(parsePilotArgs(['--county', 'Montgomery', '--state', 'MD'])).toEqual({
      state: 'MD',
      county: 'Montgomery',
      dryRun: false,
    });
    expect(() => parsePilotArgs(['--state', 'MD'])).toThrow(/Usage/);
  });

  it('orders the pilot and then the matching directory sources', () => {
    const page = source({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Montgomery Council',
      collectorKey: 'page.directory',
      method: 'PAGE_COLLECTION',
      config: { state: 'MD', county: 'Montgomery' },
    });
    const other = source({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Other Council',
      collectorKey: 'page.directory',
      method: 'PAGE_COLLECTION',
      config: { state: 'MD', county: 'Howard' },
    });
    const sources = [
      page,
      other,
      source({ name: 'Open States people', collectorKey: 'openstates.people' }),
      source({ name: 'Census TIGER/Line', collectorKey: 'tiger.boundaries' }),
      source({ name: 'unitedstates/congress-legislators', collectorKey: 'congress.legislators' }),
    ];
    expect(planForPilot(sources, { state: 'MD', county: 'Montgomery' }).map((row) => row.collectorKey)).toEqual([
      'tiger.boundaries',
      'congress.legislators',
      'openstates.people',
      'page.directory',
    ]);
    expect(planForCollector(sources, { collectorKey: 'page.directory', state: 'MD', county: 'Montgomery' })).toEqual([page]);
  });

  it('prints counts and does not call the writer on a dry-run', async () => {
    const row = source({ name: 'Census TIGER/Line', collectorKey: 'tiger.boundaries' });
    const lines = await executePlan({
      plan: [row],
      scope: { state: 'MD', tigerYear: 2025 },
      dryRun: true,
      run: () => Promise.reject(new Error('wrote')),
      preview: () => Promise.resolve(counts),
    });
    expect(lines).toEqual([formatCounts('tiger.boundaries', counts, true)]);
    expect(lines[0]).toBe('dry-run tiger.boundaries added=2 changed=1 retired=0 pending=3 sha=abc');
  });
});

describe('source catalog', () => {
  it('upserts the three bulk sources for the configured TIGER year', () => {
    const rows = sourceCatalog(2025);
    expect(rows.map((row) => row.collectorKey)).toEqual(['tiger.boundaries', 'congress.legislators', 'openstates.people']);
    expect(rows[0]?.url).toBe('https://www2.census.gov/geo/tiger/TIGER2025/');
    expect(rows[0]?.config.tigerYear).toBe(2025);
    expect(rows[1]?.url).toContain('legislators-current.yaml');
    expect(rows[2]?.url).toBe('https://data.openstates.org/people/current/');
  });

  it('reads a page.directory JSON file', () => {
    const text = readFileSync(new URL('./fixtures/page-source.json', import.meta.url), 'utf8');
    const row = parsePageSourceFile(text, 'page-source.json');
    expect(row.collectorKey).toBe('page.directory');
    expect(row.config.state).toBe('MD');
    expect(row.config.county).toBe('Montgomery');
    expect(row.config.selectors?.name?.className).toBe('name');
    expect(row.config.officeId).toBe('22222222-2222-4222-8222-222222222222');
  });
});
