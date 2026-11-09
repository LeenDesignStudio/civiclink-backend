import { createRequire } from 'node:module';
import type { Workbook as WorkbookType, Worksheet } from 'exceljs';
import { computeFreshness, renderWhyItApplies } from '../civic/civic.service.js';
import { GOV_LEVELS, type GovLevel, type JurisdictionType } from '../civic/civic.dto.js';
import type { FreshnessOverride } from '../civic/civic.dto.js';
import { reviewEmail } from '../pipeline/contacts.js';

const excel = createRequire(import.meta.url)('exceljs') as {
  Workbook: new () => WorkbookType;
  stream: {
    xlsx: {
      WorkbookWriter: new (options: { filename: string; useSharedStrings: boolean; useStyles: boolean }) => StreamBook;
    };
  };
};
const { Workbook } = excel;

interface StreamSheet {
  columns: Array<{ width: number }>;
  addRow(values: Array<string | number>): { font?: { bold?: boolean }; commit(): void };
  commit(): void;
}

interface StreamBook {
  creator: string;
  created: Date;
  addWorksheet(
    name: string,
    options?: { views?: Worksheet['views']; autoFilter?: Worksheet['autoFilter'] },
  ): StreamSheet;
  commit(): Promise<void>;
}

const VACANT = 'VACANT';
const CLIP = 32_000;

export interface ExportAddress {
  label: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
  hours: string | null;
  sortOrder: number;
}

export interface ExportJurisdiction {
  id: string;
  displayId: string;
  name: string;
  aliases: string[];
  description: string | null;
  isPilot: boolean;
  parentRetired: boolean;
  level: GovLevel;
  type: JurisdictionType;
  subtype: string | null;
  parentId: string | null;
  parentName: string | null;
  districtCode: string | null;
  geoid: string | null;
  state: string | null;
  hasBoundary: boolean;
  boundaryVintage: string | null;
  website: string | null;
  sourceId: string;
  sourceName: string;
  sourceRecordUrl: string | null;
  lastUpdatedAt: Date | null;
  freshnessOverride: FreshnessOverride;
  freshnessNote: string | null;
  overrideActive: boolean;
  overrideReason: string | null;
  overriddenBy: string | null;
  overriddenAt: Date | null;
  sourceChangedSinceOverride: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExportOffice {
  id: string;
  displayId: string;
  slug: string;
  jurisdictionId: string | null;
  jurisdictionName: string | null;
  name: string;
  seatLabel: string | null;
  selectionMethod: string;
  officeType: string;
  parentRetired: boolean;
  displayOrder: number;
  whyTemplate: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  contactUrl: string | null;
  holderUnknown: boolean;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  sourceFreshnessDays: number;
  sourceRecordUrl: string | null;
  lastUpdatedAt: Date | null;
  freshnessOverride: FreshnessOverride;
  freshnessNote: string | null;
  overrideActive: boolean;
  overrideReason: string | null;
  overriddenBy: string | null;
  overriddenAt: Date | null;
  sourceChangedSinceOverride: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  addresses: ExportAddress[];
}

export interface ExportOfficial {
  id: string;
  displayId: string;
  slug: string;
  fullName: string;
  displayName: string | null;
  party: string | null;
  photoUrl: string | null;
  website: string | null;
  externalIds: unknown;
  useOfficeAddress: boolean;
  sourceId: string;
  sourceName: string;
  sourceRecordUrl: string | null;
  lastUpdatedAt: Date | null;
  freshnessOverride: FreshnessOverride;
  freshnessNote: string | null;
  overrideActive: boolean;
  overrideReason: string | null;
  overriddenBy: string | null;
  overriddenAt: Date | null;
  sourceChangedSinceOverride: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExportTerm {
  id: string;
  officeId: string;
  officeName: string;
  officeDisplayId: string;
  officialId: string;
  officialName: string;
  officialDisplayId: string;
  status: string;
  termStart: Date | null;
  termEnd: Date | null;
  isCurrent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExportSource {
  id: string;
  displayId: string;
  name: string;
  publisher: string;
  url: string;
  termsUrl: string;
  method: string;
  kind: string;
  schedule: string;
  freshnessDays: number;
  notes: string | null;
  recordStatus: string;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  levels: string[];
  collectorKey: string | null;
  config: unknown;
  active: boolean;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CivicExport {
  generatedAt: Date;
  state: string | null;
  pilotOnly: boolean;
  jurisdictions: ExportJurisdiction[];
  offices: ExportOffice[];
  officials: ExportOfficial[];
  terms: ExportTerm[];
  sources: ExportSource[];
}

export interface ExportArgs {
  state?: string;
  pilotOnly: boolean;
}

const CARD_HEADERS = [
  'jurisdiction displayId',
  'jurisdiction name',
  'level',
  'parent name',
  'district/seat ID',
  'office displayId',
  'office name',
  'office type',
  'official displayId',
  'official name',
  'official title',
  'term start',
  'term end',
  'phone',
  'email',
  'website',
  'contact page',
  'office address',
  'source name',
  'source URL',
  'last updated',
  'freshness',
  'why it applies',
  'status',
] as const;

const COVERAGE_FIELDS = [
  'official name',
  'title',
  'office',
  'jurisdiction',
  'district',
  'phone',
  'email',
  'website/contact page',
  'office address',
  'source',
  'last updated',
  'freshness',
  'why it applies',
] as const;

export function parseExportArgs(argv: string[]): ExportArgs {
  let state: string | undefined;
  let pilotOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--pilot-only') {
      pilotOnly = true;
      continue;
    }
    if (flag === '--state') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--') || !/^[A-Za-z]{2}$/.test(value)) {
        throw new Error('Usage: pnpm data:export [--state MD] [--pilot-only]');
      }
      state = value.toUpperCase();
      index += 1;
      continue;
    }
    throw new Error('Usage: pnpm data:export [--state MD] [--pilot-only]');
  }
  return { pilotOnly, ...(state ? { state } : {}) };
}

export function exportFileName(now: Date): string {
  return `civic-data-${now.toISOString().slice(0, 10)}.xlsx`;
}

export function buildCivicWorkbook(data: CivicExport): WorkbookType {
  const book = new Workbook();
  book.creator = 'CivicLink';
  book.created = data.generatedAt;
  const cards = civicCardRows(data);
  addTable(book, 'README', ['Topic', 'Notes'], readmeRows(data));
  addTable(book, 'Civic_Card_Rows', CARD_HEADERS, cards);
  addTable(book, 'Jurisdictions', JURISDICTION_HEADERS, data.jurisdictions.map(jurisdictionRow));
  addTable(book, 'Offices', OFFICE_HEADERS, data.offices.map(officeRow));
  addTable(book, 'Officials', OFFICIAL_HEADERS, data.officials.map(officialRow));
  addTable(book, 'Terms', TERM_HEADERS, data.terms.map(termRow));
  addTable(book, 'Sources', SOURCE_HEADERS, data.sources.map(sourceRow));
  addTable(book, 'Field_Coverage', ['scope', 'group', 'field', 'total', 'filled', 'filled %'], coverageRows(data, cards));
  addTable(book, 'Problems', ['type', 'record ID', 'name', 'detail'], problemRows(data));
  return book;
}

export function sheetRowCounts(book: WorkbookType): Array<{ sheet: string; rows: number }> {
  return book.worksheets.map((sheet) => ({ sheet: sheet.name, rows: Math.max(sheet.rowCount - 1, 0) }));
}

/** Writes one sheet at a time so the workbook is not held in memory. */
export async function writeCivicWorkbook(
  data: CivicExport,
  filename: string,
): Promise<Array<{ sheet: string; rows: number }>> {
  const book = new excel.stream.xlsx.WorkbookWriter({ filename, useSharedStrings: false, useStyles: true });
  book.creator = 'CivicLink';
  book.created = data.generatedAt;
  const cards = civicCardRows(data);
  const counts = [
    await writeSheet(book, 'README', ['Topic', 'Notes'], readmeRows(data)),
    await writeSheet(book, 'Civic_Card_Rows', CARD_HEADERS, cards),
    await writeSheet(book, 'Jurisdictions', JURISDICTION_HEADERS, data.jurisdictions.map(jurisdictionRow)),
    await writeSheet(book, 'Offices', OFFICE_HEADERS, data.offices.map(officeRow)),
    await writeSheet(book, 'Officials', OFFICIAL_HEADERS, data.officials.map(officialRow)),
    await writeSheet(book, 'Terms', TERM_HEADERS, data.terms.map(termRow)),
    await writeSheet(book, 'Sources', SOURCE_HEADERS, data.sources.map(sourceRow)),
    await writeSheet(book, 'Field_Coverage', ['scope', 'group', 'field', 'total', 'filled', 'filled %'], coverageRows(data, cards)),
    await writeSheet(book, 'Problems', ['type', 'record ID', 'name', 'detail'], problemRows(data)),
  ];
  await book.commit();
  return counts;
}

async function writeSheet(
  book: StreamBook,
  name: string,
  headers: readonly string[],
  rows: Array<Array<string | number>>,
): Promise<{ sheet: string; rows: number }> {
  const sheet = book.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
    autoFilter: {
      from: { row: 1, column: 1 },
      to: { row: Math.max(rows.length + 1, 1), column: headers.length },
    },
  });
  sheet.columns = headers.map((header, index) => ({
    width: name === 'README' && index === 1 ? 120 : Math.min(48, Math.max(12, header.length + 2)),
  }));
  const header = sheet.addRow([...headers]);
  header.font = { bold: true };
  header.commit();
  for (const row of rows) sheet.addRow(row).commit();
  sheet.commit();
  return { sheet: name, rows: rows.length };
}

function readmeRows(data: CivicExport): string[][] {
  const scope = data.pilotOnly
    ? `This file is limited to pilot jurisdictions${data.state ? ` in ${data.state}` : ''}.`
    : data.state
      ? `This file is limited to ${data.state}.`
      : 'This file includes every loaded jurisdiction.';
  return [
    [
      'How records link',
      'A Jurisdiction is the place. An Office is a seat in that place (office.jurisdictionId). A Term is one person holding that seat (term.officeId and term.officialId); the row with isCurrent is the holder the Civic Card shows. An Official is the person. Every jurisdiction, office, and official also points at a Source through sourceId. The boundary polygon itself is not in this file; the Jurisdictions sheet says whether a boundary is present.',
    ],
    [
      'ID prefixes',
      'JUR- is a jurisdiction display ID. OFF- is an office. PER- is an official (the person). SRC- is a source. The UUID columns are the database keys those display IDs point at.',
    ],
    [
      'README',
      'This sheet. One paragraph for each sheet, plus how the records connect and what the display ID prefixes mean.',
    ],
    [
      'Civic_Card_Rows',
      'One row per office, joined the way a resident Civic Card shows that office: place, parent, district or seat, office, current official, term dates, phone, email, website, contact page, office address, source, last updated, freshness, why it applies, and status. An office with no current term has VACANT in the official columns. Why it applies is the office template, or the default sentence for that kind of place, filled as it would be for an exact match on that place.',
    ],
    [
      'Jurisdictions',
      'Every column of the jurisdictions table. parentId is paired with the parent name. sourceId is paired with the source name. boundary is present or missing.',
    ],
    [
      'Offices',
      'Every column of the offices table. jurisdictionId is paired with the jurisdiction name. sourceId is paired with the source name. Addresses from office_addresses are joined into one column.',
    ],
    [
      'Officials',
      'Every column of the officials table. sourceId is paired with the source name. Title is stored as display name. This sheet has no resident account, follow, or notification fields.',
    ],
    [
      'Terms',
      'Every column of the office terms table. officeId is paired with the office name and display ID. officialId is paired with the official name and display ID. isCurrent marks the holder.',
    ],
    [
      'Sources',
      'Every column of the sources table, including the collector key and config. Source runs are not included.',
    ],
    [
      'Field_Coverage',
      'For each field the Civic Card must show (SOW A7): total offices, how many have that field filled, and the filled percent. The same counts are repeated by government level and by source. An empty official name, title, phone, email, website and contact page, address, district, or why-it-applies sentence counts as not filled. Vacant offices count as missing the person fields.',
    ],
    [
      'Problems',
      'One row per problem: an office with no jurisdiction; an official with no current term; a jurisdiction with no offices; an office whose jurisdiction has no boundary; an email that does not match the person and is not an office mailbox; two officials with the same name in the same state; a record with no source or no last-updated time.',
    ],
    ['Scope', `${scope} Flags are --state and --pilot-only. The export does not change the database.`],
  ];
}

interface CardValues {
  officialName: string;
  title: string;
  officeName: string;
  jurisdictionName: string;
  district: string;
  phone: string;
  email: string;
  website: string;
  contact: string;
  address: string;
  sourceName: string;
  updated: string;
  freshness: string;
  why: string;
  level: string;
}

function civicCardRows(data: CivicExport): string[][] {
  const places = new Map(data.jurisdictions.map((row) => [row.id, row]));
  const current = currentTermByOffice(data.terms);
  const officials = new Map(data.officials.map((row) => [row.id, row]));
  return data.offices.map((office) => {
    const place = office.jurisdictionId ? places.get(office.jurisdictionId) : undefined;
    const term = current.get(office.id);
    const person = term ? officials.get(term.officialId) : undefined;
    const values = cardValues(data.generatedAt, office, place, term, person);
    const vacant = !person;
    return [
      place?.displayId ?? '',
      values.jurisdictionName,
      values.level,
      place?.parentName ?? '',
      values.district,
      office.displayId,
      values.officeName,
      office.officeType,
      vacant ? VACANT : person.displayId,
      vacant ? VACANT : values.officialName,
      vacant ? VACANT : values.title,
      term ? day(term.termStart) : '',
      term ? day(term.termEnd) : '',
      values.phone,
      values.email,
      values.website,
      values.contact,
      values.address,
      values.sourceName,
      office.sourceUrl,
      values.updated,
      values.freshness,
      values.why,
      office.status,
    ];
  });
}

function cardValues(
  now: Date,
  office: ExportOffice,
  place: ExportJurisdiction | undefined,
  term: ExportTerm | undefined,
  person: ExportOfficial | undefined,
): CardValues {
  const district = text(place?.districtCode) || text(office.seatLabel);
  const why = place
    ? (renderWhyItApplies({
        officeName: office.name,
        whyTemplate: office.whyTemplate,
        jurisdictionId: place.id,
        jurisdictionName: place.name,
        jurisdictionType: place.type,
        jurisdictionLevel: place.level,
        districtCode: place.districtCode,
        lookup: {
          token: 'export',
          method: 'ADDRESS',
          displayLabel: place.name,
          zip: null,
          confidence: 'EXACT',
          jurisdictionIds: [place.id],
          partialLevels: [],
          levels: [
            {
              level: place.level,
              confidence: 'EXACT',
              members: [{ id: place.id, name: place.name, type: place.type }],
            },
          ],
          expiresAt: null,
        },
      }) ?? '')
    : '';
  const freshness =
    office.lastUpdatedAt && office.sourceFreshnessDays > 0
      ? computeFreshness(office.freshnessOverride, office.lastUpdatedAt, office.sourceFreshnessDays, now)
      : '';
  return {
    officialName: text(person?.fullName),
    title: text(person?.displayName),
    officeName: text(office.name),
    jurisdictionName: text(place?.name),
    district,
    phone: text(office.phone),
    email: text(office.email),
    website: text(office.website),
    contact: text(office.contactUrl),
    address: formatAddress(office.addresses),
    sourceName: text(office.sourceName),
    updated: stamp(office.lastUpdatedAt),
    freshness,
    why,
    level: place?.level ?? '',
  };
}

function coverageRows(data: CivicExport, cards: string[][]): Array<Array<string | number>> {
  const prepared = data.offices.map((office, index) => ({
    level: cards[index]?.[2] ?? '',
    source: text(cards[index]?.[18]) || '(no source)',
    card: cards[index] ?? [],
  }));
  const groups: Array<{ scope: string; group: string; rows: string[][] }> = [
    { scope: 'ALL', group: '', rows: prepared.map((row) => row.card) },
  ];
  for (const level of GOV_LEVELS) {
    groups.push({
      scope: 'LEVEL',
      group: level,
      rows: prepared.filter((row) => row.level === level).map((row) => row.card),
    });
  }
  const sourceNames = [...new Set(prepared.map((row) => row.source))].sort();
  for (const name of sourceNames) {
    groups.push({
      scope: 'SOURCE',
      group: name,
      rows: prepared.filter((row) => row.source === name).map((row) => row.card),
    });
  }
  const out: Array<Array<string | number>> = [];
  for (const group of groups) {
    for (const field of COVERAGE_FIELDS) {
      const filled = group.rows.filter((row) => fieldFilled(field, row)).length;
      out.push([group.scope, group.group, field, group.rows.length, filled, percent(filled, group.rows.length)]);
    }
  }
  return out;
}

function fieldFilled(field: (typeof COVERAGE_FIELDS)[number], row: string[]): boolean {
  const at = (index: number) => filled(row[index] ?? '');
  if (field === 'official name') return at(9);
  if (field === 'title') return at(10);
  if (field === 'office') return at(6);
  if (field === 'jurisdiction') return at(1);
  if (field === 'district') return at(4);
  if (field === 'phone') return at(13);
  if (field === 'email') return at(14);
  if (field === 'website/contact page') return at(15) || at(16);
  if (field === 'office address') return at(17);
  if (field === 'source') return at(18);
  if (field === 'last updated') return at(20);
  if (field === 'freshness') return at(21);
  return at(22);
}

function filled(value: string): boolean {
  return value.length > 0 && value !== VACANT;
}

function problemRows(data: CivicExport): string[][] {
  const rows: string[][] = [];
  const places = new Map(data.jurisdictions.map((row) => [row.id, row]));
  const officeIds = new Set(data.offices.map((row) => row.jurisdictionId).filter((id): id is string => Boolean(id)));
  const current = currentTermByOffice(data.terms);
  const officials = new Map(data.officials.map((row) => [row.id, row]));
  const currentOfficialIds = new Set(
    data.terms.filter((term) => term.isCurrent).map((term) => term.officialId),
  );

  for (const office of data.offices) {
    const place = office.jurisdictionId ? places.get(office.jurisdictionId) : undefined;
    if (!place) {
      rows.push(['Office has no jurisdiction', office.displayId, office.name, 'This office has no jurisdiction row.']);
    } else if (!place.hasBoundary) {
      rows.push([
        'Office jurisdiction has no boundary',
        office.displayId,
        office.name,
        `${place.displayId} ${place.name} has no boundary polygon.`,
      ]);
    }
    const term = current.get(office.id);
    const person = term ? officials.get(term.officialId) : undefined;
    const reviewed = reviewEmail(office.email, person?.fullName || office.name);
    if (reviewed.review) {
      rows.push([
        'Email does not match the person or office',
        office.displayId,
        person?.fullName || office.name,
        `${reviewed.review} does not match the name and is not an office mailbox.`,
      ]);
    }
    if (!text(office.sourceName) || !office.lastUpdatedAt) {
      rows.push([
        'Record has no source or last updated',
        office.displayId,
        office.name,
        missingProvenance(office.sourceName, office.lastUpdatedAt),
      ]);
    }
  }

  for (const place of data.jurisdictions) {
    if (!officeIds.has(place.id)) {
      rows.push(['Jurisdiction has no offices', place.displayId, place.name, 'No office points at this jurisdiction.']);
    }
    if (!text(place.sourceName) || !place.lastUpdatedAt) {
      rows.push([
        'Record has no source or last updated',
        place.displayId,
        place.name,
        missingProvenance(place.sourceName, place.lastUpdatedAt),
      ]);
    }
  }

  for (const person of data.officials) {
    if (!currentOfficialIds.has(person.id)) {
      rows.push(['Official has no current term', person.displayId, person.fullName, 'No term for this person is current.']);
    }
    if (!text(person.sourceName) || !person.lastUpdatedAt) {
      rows.push([
        'Record has no source or last updated',
        person.displayId,
        person.fullName,
        missingProvenance(person.sourceName, person.lastUpdatedAt),
      ]);
    }
  }

  const officeById = new Map(data.offices.map((row) => [row.id, row]));
  const statesByOfficial = new Map<string, Set<string>>();
  for (const term of data.terms) {
    if (!term.isCurrent) continue;
    const office = officeById.get(term.officeId);
    const place = office?.jurisdictionId ? places.get(office.jurisdictionId) : undefined;
    const state = text(place?.state).toUpperCase();
    if (!state) continue;
    const states = statesByOfficial.get(term.officialId) ?? new Set<string>();
    states.add(state);
    statesByOfficial.set(term.officialId, states);
  }
  const byNameState = new Map<string, ExportOfficial[]>();
  for (const person of data.officials) {
    const states = statesByOfficial.get(person.id);
    if (!states) continue;
    const name = person.fullName.trim().toLowerCase().replace(/\s+/g, ' ');
    for (const state of states) {
      const key = `${name}|${state}`;
      const list = byNameState.get(key) ?? [];
      list.push(person);
      byNameState.set(key, list);
    }
  }
  for (const [key, people] of byNameState) {
    const unique = [...new Map(people.map((person) => [person.id, person])).values()];
    if (unique.length < 2) continue;
    const state = key.split('|')[1] ?? '';
    for (const person of unique) {
      const others = unique.filter((row) => row.id !== person.id).map((row) => row.displayId);
      rows.push([
        'Duplicate official',
        person.displayId,
        person.fullName,
        `Same name in ${state} as ${others.join(', ')}.`,
      ]);
    }
  }

  return rows.sort((left, right) => left[0]!.localeCompare(right[0]!) || left[1]!.localeCompare(right[1]!));
}

function missingProvenance(sourceName: string, updated: Date | null): string {
  const missing = [text(sourceName) ? '' : 'source', updated ? '' : 'last updated'].filter((part) => part.length > 0);
  return `Missing ${missing.join(' and ')}.`;
}

function currentTermByOffice(terms: ExportTerm[]): Map<string, ExportTerm> {
  const map = new Map<string, ExportTerm>();
  for (const term of terms) {
    if (term.isCurrent) map.set(term.officeId, term);
  }
  return map;
}

const JURISDICTION_HEADERS = [
  'id',
  'displayId',
  'name',
  'aliases',
  'description',
  'isPilot',
  'parentRetired',
  'level',
  'type',
  'subtype',
  'parentId',
  'parentName',
  'districtCode',
  'geoid',
  'state',
  'boundary',
  'boundaryVintage',
  'website',
  'sourceId',
  'sourceName',
  'sourceRecordUrl',
  'lastUpdatedAt',
  'freshnessOverride',
  'freshnessNote',
  'overrideActive',
  'overrideReason',
  'overriddenBy',
  'overriddenAt',
  'sourceChangedSinceOverride',
  'status',
  'createdAt',
  'updatedAt',
] as const;

function jurisdictionRow(row: ExportJurisdiction): string[] {
  return [
    row.id,
    row.displayId,
    row.name,
    row.aliases.join('; '),
    text(row.description),
    yesNo(row.isPilot),
    yesNo(row.parentRetired),
    row.level,
    row.type,
    text(row.subtype),
    text(row.parentId),
    text(row.parentName),
    text(row.districtCode),
    text(row.geoid),
    text(row.state),
    row.hasBoundary ? 'present' : 'missing',
    text(row.boundaryVintage),
    text(row.website),
    row.sourceId,
    text(row.sourceName),
    text(row.sourceRecordUrl),
    stamp(row.lastUpdatedAt),
    row.freshnessOverride,
    text(row.freshnessNote),
    yesNo(row.overrideActive),
    text(row.overrideReason),
    text(row.overriddenBy),
    stamp(row.overriddenAt),
    yesNo(row.sourceChangedSinceOverride),
    row.status,
    stamp(row.createdAt),
    stamp(row.updatedAt),
  ];
}

const OFFICE_HEADERS = [
  'id',
  'displayId',
  'slug',
  'jurisdictionId',
  'jurisdictionName',
  'name',
  'seatLabel',
  'selectionMethod',
  'officeType',
  'parentRetired',
  'displayOrder',
  'whyTemplate',
  'phone',
  'email',
  'website',
  'contactUrl',
  'holderUnknown',
  'sourceId',
  'sourceName',
  'sourceRecordUrl',
  'lastUpdatedAt',
  'freshnessOverride',
  'freshnessNote',
  'overrideActive',
  'overrideReason',
  'overriddenBy',
  'overriddenAt',
  'sourceChangedSinceOverride',
  'status',
  'createdAt',
  'updatedAt',
  'addresses',
] as const;

function officeRow(row: ExportOffice): Array<string | number> {
  return [
    row.id,
    row.displayId,
    row.slug,
    text(row.jurisdictionId),
    text(row.jurisdictionName),
    row.name,
    text(row.seatLabel),
    row.selectionMethod,
    row.officeType,
    yesNo(row.parentRetired),
    row.displayOrder,
    text(row.whyTemplate),
    text(row.phone),
    text(row.email),
    text(row.website),
    text(row.contactUrl),
    yesNo(row.holderUnknown),
    row.sourceId,
    text(row.sourceName),
    text(row.sourceRecordUrl),
    stamp(row.lastUpdatedAt),
    row.freshnessOverride,
    text(row.freshnessNote),
    yesNo(row.overrideActive),
    text(row.overrideReason),
    text(row.overriddenBy),
    stamp(row.overriddenAt),
    yesNo(row.sourceChangedSinceOverride),
    row.status,
    stamp(row.createdAt),
    stamp(row.updatedAt),
    formatAddress(row.addresses),
  ];
}

const OFFICIAL_HEADERS = [
  'id',
  'displayId',
  'slug',
  'fullName',
  'displayName',
  'party',
  'photoUrl',
  'website',
  'externalIds',
  'useOfficeAddress',
  'sourceId',
  'sourceName',
  'sourceRecordUrl',
  'lastUpdatedAt',
  'freshnessOverride',
  'freshnessNote',
  'overrideActive',
  'overrideReason',
  'overriddenBy',
  'overriddenAt',
  'sourceChangedSinceOverride',
  'status',
  'createdAt',
  'updatedAt',
] as const;

function officialRow(row: ExportOfficial): string[] {
  return [
    row.id,
    row.displayId,
    row.slug,
    row.fullName,
    text(row.displayName),
    text(row.party),
    text(row.photoUrl),
    text(row.website),
    jsonText(row.externalIds),
    yesNo(row.useOfficeAddress),
    row.sourceId,
    text(row.sourceName),
    text(row.sourceRecordUrl),
    stamp(row.lastUpdatedAt),
    row.freshnessOverride,
    text(row.freshnessNote),
    yesNo(row.overrideActive),
    text(row.overrideReason),
    text(row.overriddenBy),
    stamp(row.overriddenAt),
    yesNo(row.sourceChangedSinceOverride),
    row.status,
    stamp(row.createdAt),
    stamp(row.updatedAt),
  ];
}

const TERM_HEADERS = [
  'id',
  'officeId',
  'officeName',
  'officeDisplayId',
  'officialId',
  'officialName',
  'officialDisplayId',
  'status',
  'termStart',
  'termEnd',
  'isCurrent',
  'createdAt',
  'updatedAt',
] as const;

function termRow(row: ExportTerm): string[] {
  return [
    row.id,
    row.officeId,
    row.officeName,
    row.officeDisplayId,
    row.officialId,
    row.officialName,
    row.officialDisplayId,
    row.status,
    day(row.termStart),
    day(row.termEnd),
    yesNo(row.isCurrent),
    stamp(row.createdAt),
    stamp(row.updatedAt),
  ];
}

const SOURCE_HEADERS = [
  'id',
  'displayId',
  'name',
  'publisher',
  'url',
  'termsUrl',
  'method',
  'kind',
  'schedule',
  'freshnessDays',
  'notes',
  'recordStatus',
  'lastSuccessAt',
  'lastAttemptAt',
  'levels',
  'collectorKey',
  'config',
  'active',
  'lastRunAt',
  'createdAt',
  'updatedAt',
] as const;

function sourceRow(row: ExportSource): Array<string | number> {
  return [
    row.id,
    row.displayId,
    row.name,
    row.publisher,
    row.url,
    row.termsUrl,
    row.method,
    row.kind,
    row.schedule,
    row.freshnessDays,
    text(row.notes),
    row.recordStatus,
    stamp(row.lastSuccessAt),
    stamp(row.lastAttemptAt),
    row.levels.join(', '),
    text(row.collectorKey),
    jsonText(row.config),
    yesNo(row.active),
    stamp(row.lastRunAt),
    stamp(row.createdAt),
    stamp(row.updatedAt),
  ];
}

function addTable(
  book: WorkbookType,
  name: string,
  headers: readonly string[],
  rows: Array<Array<string | number>>,
): void {
  const sheet = book.addWorksheet(name);
  sheet.addRow([...headers]);
  for (const row of rows) sheet.addRow(row);
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(sheet.rowCount, 1), column: headers.length },
  };
  sizeColumns(sheet, headers.length);
  if (name === 'README') {
    sheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
    sheet.getColumn(2).width = 120;
  }
}

function sizeColumns(sheet: Worksheet, count: number): void {
  for (let column = 1; column <= count; column += 1) {
    let width = 12;
    sheet.getColumn(column).eachCell({ includeEmpty: false }, (cell) => {
      const length = String(cell.value ?? '').length;
      if (length + 2 > width) width = length + 2;
    });
    sheet.getColumn(column).width = Math.min(width, 48);
  }
}

function formatAddress(addresses: ExportAddress[]): string {
  return [...addresses]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label))
    .map((row) => `${row.label}: ${row.street}, ${row.city}, ${row.state} ${row.zip}`)
    .join(' | ');
}

function text(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function day(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

function stamp(value: Date | null): string {
  return value ? value.toISOString() : '';
}

function jsonText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return clip(value);
  return clip(JSON.stringify(value));
}

function clip(value: string): string {
  return value.length > CLIP ? `${value.slice(0, CLIP)}…` : value;
}

function percent(filled: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((filled / total) * 1000) / 10;
}
