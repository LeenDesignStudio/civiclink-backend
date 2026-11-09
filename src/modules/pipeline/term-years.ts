/** A published start or end, or null when the source did not give a full date. */
export interface DatedTerm {
  key: string;
  officeKey: string;
  start: string | null;
  end: string | null;
}

export interface HistoryTerm {
  officeKey: string;
  officeName: string;
  jurisdictionType: string;
  jurisdictionGeoid: string;
  seatLabel: string | null;
  start: string | null;
  end: string | null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Year of a YYYY-MM-DD date. Any other shape is unpublished, not guessed. */
export function yearOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1700 || year > 2200) return null;
  return year;
}

export function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && yearOf(value) !== null ? value : null;
}

function nextDay(iso: string): string {
  const match = ISO_DATE.exec(iso);
  if (!match) return iso;
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  utc.setUTCDate(utc.getUTCDate() + 1);
  return utc.toISOString().slice(0, 10);
}

/**
 * Year the person first took this office in the current continuous run.
 * A later term continues the run when it starts on or before the day after the previous end.
 * A missing start date does not start a run and stays null.
 */
export function electedYearByTerm(terms: DatedTerm[]): Map<string, number | null> {
  const result = new Map<string, number | null>();
  const byOffice = new Map<string, DatedTerm[]>();
  for (const term of terms) {
    const group = byOffice.get(term.officeKey) ?? [];
    group.push(term);
    byOffice.set(term.officeKey, group);
  }
  for (const group of byOffice.values()) {
    for (const term of group) {
      if (!term.start) result.set(term.key, null);
    }
    const known = group
      .filter((term): term is DatedTerm & { start: string } => term.start !== null)
      .sort((left, right) => left.start.localeCompare(right.start) || left.key.localeCompare(right.key));
    let runStart: string | null = null;
    let previousEnd: string | null = null;
    for (const term of known) {
      const continues =
        runStart !== null && previousEnd !== null && term.start <= nextDay(previousEnd);
      if (!continues) runStart = term.start;
      result.set(term.key, yearOf(runStart));
      previousEnd = term.end ?? '9999-12-31';
    }
  }
  return result;
}

/** Earliest year of any office whose start date was published. */
export function firstElectedYear(starts: Array<string | null | undefined>): number | null {
  let earliest: number | null = null;
  for (const start of starts) {
    const year = yearOf(start);
    if (year === null) continue;
    if (earliest === null || year < earliest) earliest = year;
  }
  return earliest;
}

export function parseTermHistory(raw: string | null | undefined): HistoryTerm[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const terms: HistoryTerm[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.officeKey !== 'string' || row.officeKey.length === 0) continue;
    terms.push({
      officeKey: row.officeKey,
      officeName: typeof row.officeName === 'string' && row.officeName.length > 0 ? row.officeName : 'Office',
      jurisdictionType: typeof row.jurisdictionType === 'string' ? row.jurisdictionType : '',
      jurisdictionGeoid: typeof row.jurisdictionGeoid === 'string' ? row.jurisdictionGeoid : '',
      seatLabel: typeof row.seatLabel === 'string' ? row.seatLabel : null,
      start: isoOrNull(row.start),
      end: isoOrNull(row.end),
    });
  }
  return terms;
}

export function historyJson(terms: HistoryTerm[]): string | null {
  if (terms.length === 0) return null;
  return JSON.stringify(terms);
}
