import { stateFips } from './tiger.js';

export interface SeatInput {
  state: string | null;
  kind: 'sen' | 'rep' | 'upper' | 'lower' | null;
  district: string | null;
  senateClass: string | null;
  stateRank: string | null;
  personKey: string;
  start: string | null;
  end: string | null;
  email: string | null;
  photoUrl: string | null;
  website: string | null;
}

/** Fields carried on an official record so the loader can create the office and the term. */
export function seatFields(input: SeatInput): Record<string, string | null> {
  if (!input.state || !input.kind) return {};
  let fips: string;
  try {
    fips = stateFips(input.state);
  } catch {
    return {};
  }
  const termStart = isoDate(input.start);
  const termEnd = isoDate(input.end);
  const contactEmail = emailOrNull(input.email);
  const photoUrl = httpsOrNull(input.photoUrl);
  const website = httpsOrNull(input.website);
  const extras: Record<string, string | null> = {};
  if (termStart) extras.termStart = termStart;
  if (termEnd) extras.termEnd = termEnd;
  if (contactEmail) extras.contactEmail = contactEmail;
  if (photoUrl) extras.photoUrl = photoUrl;
  if (website) extras.website = website;

  if (input.kind === 'sen') {
    const seat = senateSeat(input.senateClass, input.stateRank, input.personKey);
    return {
      title: 'U.S. Senator',
      officeName: `United States Senator, ${seat.label}`,
      seatLabel: seat.label,
      officeKey: `seat:senate:${fips}:${seat.key}`,
      jurisdictionType: 'STATE',
      jurisdictionGeoid: fips,
      ...extras,
    };
  }

  const district = normalizeDistrict(input.district);
  if (!district) return {};
  if (input.kind === 'rep') {
    const geoid = `${fips}${padDistrict(district, 2)}`;
    return {
      title: 'U.S. Representative',
      officeName: 'United States Representative',
      seatLabel: district,
      officeKey: `seat:cd:${geoid}`,
      jurisdictionType: 'CONGRESSIONAL_DISTRICT',
      jurisdictionGeoid: geoid,
      ...extras,
    };
  }
  const geoid = `${fips}${padDistrict(district, 3)}`;
  const upper = input.kind === 'upper';
  return {
    title: upper ? 'State Senator' : 'State Representative',
    officeName: upper ? 'State Senator' : 'State Representative',
    seatLabel: district,
    officeKey: `seat:${upper ? 'sldu' : 'sldl'}:${geoid}`,
    jurisdictionType: upper ? 'STATE_SENATE_DISTRICT' : 'STATE_HOUSE_DISTRICT',
    jurisdictionGeoid: geoid,
    ...extras,
  };
}

export function chamberKind(value: string | null): SeatInput['kind'] {
  const text = value?.trim().toLowerCase() ?? '';
  if (text === 'sen' || text === 'senate') return 'sen';
  if (text === 'rep' || text === 'house') return 'rep';
  if (text === 'upper') return 'upper';
  if (text === 'lower' || text === 'legislature') return 'lower';
  return null;
}

function senateSeat(senateClass: string | null, stateRank: string | null, personKey: string): { label: string; key: string } {
  const klass = senateClass?.replace(/\D/g, '') ?? '';
  if (klass === '1' || klass === '2' || klass === '3') return { label: `Class ${klass}`, key: `class-${klass}` };
  const rank = stateRank?.trim().toLowerCase() ?? '';
  if (rank === 'senior' || rank === 'junior') {
    const label = rank === 'senior' ? 'Senior' : 'Junior';
    return { label, key: rank };
  }
  return { label: personKey, key: personKey };
}

function normalizeDistrict(value: string | null): string | null {
  const text = value?.trim() ?? '';
  if (!text) return null;
  if (/^at-?large$/i.test(text)) return '0';
  return text.toUpperCase();
}

/** Census GEOID district part: 2 digits for Congress, 3 for a state legislative district. A letter suffix keeps its place. */
export function padDistrict(district: string, width: number): string {
  const match = /^(\d+)([A-Z]*)$/.exec(district.toUpperCase());
  if (!match) return district.toUpperCase().slice(0, width);
  const digits = match[1] ?? '';
  const suffix = match[2] ?? '';
  const pad = Math.max(width - suffix.length, 1);
  return `${digits.padStart(pad, '0')}${suffix}`.slice(0, width);
}

function isoDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function emailOrNull(value: string | null): string | null {
  const text = value?.trim() ?? '';
  if (!text.includes('@') || text.length > 254) return null;
  return text;
}

function httpsOrNull(value: string | null): string | null {
  const text = value?.trim() ?? '';
  if (!text.startsWith('https://') || text.length > 2048) return null;
  return text;
}
