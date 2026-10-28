import { describe, expect, it } from 'vitest';
import {
  boundaryStatus,
  formatDisplayId,
  freshnessLabel,
  needsValidation,
  parentLevelAllowed,
  parentRequired,
  refreshWrite,
  nestJurisdictions,
  sourceHealth,
} from './record-rules.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-28T00:00:00.000Z');

describe('record rules', () => {
  it('formats one sequence per prefix', () => {
    expect(formatDisplayId('JUR', 1)).toBe('JUR-0001');
    expect(formatDisplayId('OFF', 42)).toBe('OFF-0042');
    expect(formatDisplayId('PER', 10000)).toBe('PER-10000');
  });

  it('requires a parent except for federal and checks level order', () => {
    expect(parentRequired('FEDERAL')).toBe(false);
    expect(parentRequired('STATE')).toBe(true);
    expect(parentLevelAllowed('STATE', 'FEDERAL')).toBe(true);
    expect(parentLevelAllowed('COUNTY', 'STATE')).toBe(true);
    expect(parentLevelAllowed('MUNICIPAL', 'COUNTY')).toBe(true);
    expect(parentLevelAllowed('COUNTY', 'MUNICIPAL')).toBe(false);
    expect(parentLevelAllowed('EDUCATION', 'STATE')).toBe(true);
    expect(parentLevelAllowed('SPECIAL', 'COUNTY')).toBe(true);
    expect(parentLevelAllowed('SPECIAL', 'MUNICIPAL')).toBe(false);
    expect(parentLevelAllowed('STATE', 'STATE')).toBe(true);
  });

  it('calculates freshness from the source window unless forced', () => {
    expect(
      freshnessLabel({ lastUpdatedAt: NOW, outdatedAfterDays: 90, now: new Date(NOW.getTime() + 90 * DAY), override: 'NONE' }),
    ).toBe('CURRENT');
    expect(
      freshnessLabel({
        lastUpdatedAt: NOW,
        outdatedAfterDays: 90,
        now: new Date(NOW.getTime() + 90 * DAY + 1),
        override: 'NONE',
      }),
    ).toBe('MAY_BE_OUTDATED');
    expect(
      freshnessLabel({ lastUpdatedAt: new Date(0), outdatedAfterDays: 1, now: NOW, override: 'FORCE_CURRENT' }),
    ).toBe('CURRENT');
  });

  it('flags services that were not validated within 180 days', () => {
    expect(needsValidation(NOW, new Date(NOW.getTime() + 180 * DAY))).toBe(false);
    expect(needsValidation(NOW, new Date(NOW.getTime() + 180 * DAY + 1))).toBe(true);
  });

  it('reports boundary coverage and source health', () => {
    expect(boundaryStatus(true)).toBe('OK');
    expect(boundaryStatus(false)).toBe('MISSING');
    expect(
      sourceHealth({ status: 'PAUSED', lastRunFailed: false, lastSuccessAt: NOW, outdatedAfterDays: 30, now: NOW }),
    ).toBe('PAUSED');
    expect(
      sourceHealth({ status: 'ACTIVE', lastRunFailed: true, lastSuccessAt: NOW, outdatedAfterDays: 30, now: NOW }),
    ).toBe('FAILED');
    expect(
      sourceHealth({ status: 'ACTIVE', lastRunFailed: false, lastSuccessAt: null, outdatedAfterDays: 30, now: NOW }),
    ).toBe('OVERDUE');
    expect(
      sourceHealth({ status: 'ACTIVE', lastRunFailed: false, lastSuccessAt: NOW, outdatedAfterDays: 30, now: NOW }),
    ).toBe('HEALTHY');
  });

  it('does not overwrite an overridden field and flags a source change', () => {
    const existing = { overrideActive: true, name: 'Dallas', sourceId: 'a', sourceRecordUrl: 'old', lastUpdatedAt: NOW };
    const incoming = { name: 'Dallas County', sourceId: 'b', sourceRecordUrl: 'new', lastUpdatedAt: new Date(), extra: 1 };
    const result = refreshWrite(existing, incoming);
    expect(result.data).toEqual({ extra: 1 });
    expect(result.sourceChangedSinceOverride).toBe(true);
    expect(refreshWrite({ overrideActive: false, name: 'Dallas' }, incoming).data).toEqual(incoming);
  });

  it('nests jurisdictions and can return one subtree', () => {
    const rows = [
      row('nation', null),
      row('state', 'nation'),
      row('county', 'state'),
    ];
    expect(nestJurisdictions(rows, null)).toHaveLength(1);
    expect(nestJurisdictions(rows, null)[0]?.children[0]?.children[0]?.id).toBe('county');
    expect(nestJurisdictions(rows, 'state')).toHaveLength(1);
    expect(nestJurisdictions(rows, 'state')[0]?.id).toBe('state');
    expect(nestJurisdictions(rows, 'missing')).toEqual([]);
  });
});

function row(id: string, parentId: string | null) {
  return {
    id,
    parentId,
    name: id,
    displayId: `JUR-${id}`,
    level: 'STATE' as const,
    status: 'ACTIVE' as const,
    parentRetired: false,
  };
}
