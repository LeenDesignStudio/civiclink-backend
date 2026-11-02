import { describe, expect, it } from 'vitest';
import {
  ageDays,
  alertReason,
  coverageSummary,
  fullyCovered,
  pendingReason,
  recentActionLabel,
  searchPattern,
} from './admin-read.rules.js';

const NOW = new Date('2026-06-10T12:00:00.000Z');

describe('admin read rules', () => {
  it('counts whole days and never a negative age', () => {
    expect(ageDays(new Date('2026-06-04T12:00:00.000Z'), NOW)).toBe(6);
    expect(ageDays(new Date('2026-06-10T18:00:00.000Z'), NOW)).toBe(0);
  });

  it('escapes search wildcards', () => {
    expect(searchPattern('a%b_c\\d')).toBe('%a\\%b\\_c\\\\d%');
  });

  it('writes the pilot coverage sentence', () => {
    expect(coverageSummary(8, 10)).toBe('8 of 10 pilot jurisdictions fully covered');
    expect(fullyCovered(true, 1)).toBe(true);
    expect(fullyCovered(true, 0)).toBe(false);
    expect(fullyCovered(false, 3)).toBe(false);
  });

  it('names attention reasons', () => {
    expect(pendingReason('SUBMITTED', 6)).toBe('Pending 6 days');
    expect(pendingReason('IN_REVIEW', 1)).toBe('In review 1 day');
    expect(alertReason(12)).toBe('12 deliveries failed');
    expect(alertReason(1)).toBe('1 delivery failed');
  });

  it('maps change-log actions onto the dashboard words', () => {
    expect(recentActionLabel('CREATE')).toBe('Created');
    expect(recentActionLabel('RESTORE')).toBe('Reactivated');
    expect(recentActionLabel('APPLY')).toBe('Correction applied');
    expect(recentActionLabel('NOTE')).toBeNull();
  });
});
