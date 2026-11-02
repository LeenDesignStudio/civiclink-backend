import { freshnessLabel, type FreshnessForce, type FreshnessName } from '../civic/record-rules.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function ageDays(since: Date, now: Date): number {
  const elapsed = now.getTime() - since.getTime();
  if (elapsed <= 0) return 0;
  return Math.floor(elapsed / DAY_MS);
}

/** Escape ILIKE wildcards so the search text is matched literally. */
export function searchPattern(query: string): string {
  const escaped = query.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

export function coverageSummary(covered: number, total: number): string {
  return `${covered} of ${total} pilot jurisdictions fully covered`;
}

export function pendingReason(status: 'SUBMITTED' | 'IN_REVIEW', days: number): string {
  const noun = status === 'IN_REVIEW' ? 'In review' : 'Pending';
  const unit = days === 1 ? 'day' : 'days';
  return `${noun} ${days} ${unit}`;
}

export function alertReason(failed: number): string {
  if (failed === 1) return '1 delivery failed';
  return `${failed} deliveries failed`;
}

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Created',
  UPDATE: 'Edited',
  RETIRE: 'Retired',
  RESTORE: 'Reactivated',
  APPLY: 'Correction applied',
  'source.add': 'Created',
  'source.change': 'Edited',
  'source.upsert': 'Edited',
};

const TYPE_LABELS: Record<string, string> = {
  JURISDICTION: 'Jurisdiction',
  OFFICE: 'Office',
  OFFICIAL: 'Official',
  SERVICE: 'Service',
  source: 'Source',
  SOURCE: 'Source',
  CORRECTION: 'Correction',
  Correction: 'Correction',
};

export function recentActionLabel(action: string): string | null {
  return ACTION_LABELS[action] ?? null;
}

export function recentTypeLabel(entityType: string): string {
  return TYPE_LABELS[entityType] ?? entityType;
}

export function pilotFreshness(input: {
  lastUpdatedAt: Date;
  outdatedAfterDays: number;
  now: Date;
  override: FreshnessForce;
}): FreshnessName {
  return freshnessLabel(input);
}

export function fullyCovered(hasBoundary: boolean, officeCount: number): boolean {
  return hasBoundary && officeCount > 0;
}
