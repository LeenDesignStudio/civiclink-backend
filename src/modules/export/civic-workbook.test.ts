import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Workbook } from 'exceljs';
import {
  buildCivicWorkbook,
  exportFileName,
  parseExportArgs,
  sheetRowCounts,
  writeCivicWorkbook,
  type CivicExport,
  type ExportJurisdiction,
  type ExportOffice,
  type ExportOfficial,
  type ExportSource,
  type ExportTerm,
} from './civic-workbook.js';

const NOW = new Date('2026-11-09T12:00:00.000Z');
const SOURCE = '11111111-1111-4111-8111-111111111111';
const PLACE = '22222222-2222-4222-8222-222222222222';
const EMPTY = '33333333-3333-4333-8333-333333333333';
const OFFICE = '44444444-4444-4444-8444-444444444444';
const VACANT_OFFICE = '55555555-5555-4555-8555-555555555555';
const SECOND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NONE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PERSON = '66666666-6666-4666-8666-666666666666';
const OTHER = '77777777-7777-4777-8777-777777777777';
const ORPHAN = '88888888-8888-4888-8888-888888888888';

function place(overrides: Partial<ExportJurisdiction> = {}): ExportJurisdiction {
  return {
    id: PLACE,
    displayId: 'JUR-00000001',
    name: 'Montgomery',
    aliases: [],
    description: null,
    isPilot: true,
    parentRetired: false,
    level: 'COUNTY',
    type: 'COUNTY',
    subtype: null,
    parentId: null,
    parentName: 'Maryland',
    districtCode: null,
    geoid: '24031',
    state: 'MD',
    hasBoundary: true,
    boundaryVintage: 'TIGER2025',
    website: null,
    sourceId: SOURCE,
    sourceName: 'Census',
    sourceRecordUrl: null,
    lastUpdatedAt: NOW,
    freshnessOverride: 'NONE',
    freshnessNote: null,
    overrideActive: false,
    overrideReason: null,
    overriddenBy: null,
    overriddenAt: null,
    sourceChangedSinceOverride: false,
    status: 'ACTIVE',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function office(overrides: Partial<ExportOffice> = {}): ExportOffice {
  return {
    id: OFFICE,
    displayId: 'OFF-00000001',
    slug: 'county-executive',
    jurisdictionId: PLACE,
    jurisdictionName: 'Montgomery',
    name: 'County Executive',
    seatLabel: null,
    selectionMethod: 'ELECTED',
    officeType: 'ELECTED',
    parentRetired: false,
    displayOrder: 1,
    whyTemplate: null,
    phone: '2407770000',
    email: 'info@montgomerycountymd.gov',
    website: 'https://example.gov/executive',
    contactUrl: null,
    holderUnknown: false,
    sourceId: SOURCE,
    sourceName: 'Census',
    sourceUrl: 'https://example.gov/source',
    sourceFreshnessDays: 90,
    sourceRecordUrl: null,
    lastUpdatedAt: NOW,
    freshnessOverride: 'NONE',
    freshnessNote: null,
    overrideActive: false,
    overrideReason: null,
    overriddenBy: null,
    overriddenAt: null,
    sourceChangedSinceOverride: false,
    status: 'ACTIVE',
    createdAt: NOW,
    updatedAt: NOW,
    addresses: [
      {
        label: 'Office',
        street: '101 Monroe St',
        city: 'Rockville',
        state: 'MD',
        zip: '20850',
        phone: null,
        hours: null,
        sortOrder: 0,
      },
    ],
    ...overrides,
  };
}

function person(overrides: Partial<ExportOfficial> = {}): ExportOfficial {
  return {
    id: PERSON,
    displayId: 'PER-00000001',
    slug: 'ada-example',
    fullName: 'Ada Example',
    displayName: 'County Executive',
    party: null,
    photoUrl: null,
    website: null,
    externalIds: {},
    useOfficeAddress: true,
    sourceId: SOURCE,
    sourceName: 'Census',
    sourceRecordUrl: null,
    lastUpdatedAt: NOW,
    freshnessOverride: 'NONE',
    freshnessNote: null,
    overrideActive: false,
    overrideReason: null,
    overriddenBy: null,
    overriddenAt: null,
    sourceChangedSinceOverride: false,
    status: 'ACTIVE',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function term(overrides: Partial<ExportTerm> = {}): ExportTerm {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    officeId: OFFICE,
    officeName: 'County Executive',
    officeDisplayId: 'OFF-00000001',
    officialId: PERSON,
    officialName: 'Ada Example',
    officialDisplayId: 'PER-00000001',
    status: 'ELECTED',
    termStart: new Date('2022-12-05T00:00:00.000Z'),
    termEnd: null,
    isCurrent: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function source(): ExportSource {
  return {
    id: SOURCE,
    displayId: 'SRC-00000001',
    name: 'Census',
    publisher: 'U.S. Census Bureau',
    url: 'https://example.gov/source',
    termsUrl: 'https://example.gov/terms',
    method: 'BULK',
    kind: 'BULK',
    schedule: 'QUARTERLY',
    freshnessDays: 90,
    notes: null,
    recordStatus: 'ACTIVE',
    lastSuccessAt: NOW,
    lastAttemptAt: NOW,
    levels: ['COUNTY'],
    collectorKey: 'tiger.boundaries',
    config: { state: 'MD' },
    active: true,
    lastRunAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function sample(): CivicExport {
  return {
    generatedAt: NOW,
    state: 'MD',
    pilotOnly: true,
    jurisdictions: [
      place(),
      place({ id: EMPTY, displayId: 'JUR-00000002', name: 'Empty Place', hasBoundary: false, geoid: '24999' }),
      place({ id: NONE, displayId: 'JUR-00000003', name: 'No Offices', geoid: '24000' }),
    ],
    offices: [
      office(),
      office({
        id: SECOND,
        displayId: 'OFF-00000003',
        slug: 'second-seat',
        name: 'County Council At Large',
        phone: null,
      }),
      office({
        id: VACANT_OFFICE,
        displayId: 'OFF-00000002',
        slug: 'vacant-seat',
        name: 'County Council',
        phone: null,
        email: 'tim.czmowski@example.gov',
        website: null,
        contactUrl: null,
        addresses: [],
        jurisdictionId: EMPTY,
        jurisdictionName: 'Empty Place',
      }),
    ],
    officials: [
      person(),
      person({ id: OTHER, displayId: 'PER-00000002', slug: 'ada-other', fullName: 'Ada Example' }),
      person({ id: ORPHAN, displayId: 'PER-00000003', slug: 'bob-old', fullName: 'Bob Old', displayName: null }),
    ],
    terms: [
      term(),
      term({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        officeId: SECOND,
        officeName: 'County Council At Large',
        officeDisplayId: 'OFF-00000003',
        officialId: OTHER,
        officialName: 'Ada Example',
        officialDisplayId: 'PER-00000002',
        isCurrent: true,
      }),
    ],
    sources: [source()],
  };
}

describe('civic workbook export', () => {
  it('parses the developer flags', () => {
    expect(parseExportArgs([])).toEqual({ pilotOnly: false });
    expect(parseExportArgs(['--state', 'md', '--pilot-only'])).toEqual({ state: 'MD', pilotOnly: true });
    expect(exportFileName(NOW)).toBe('civic-data-2026-11-09.xlsx');
    expect(() => parseExportArgs(['--county', 'Montgomery'])).toThrow(/Usage/);
  });

  it('builds the nine sheets with a vacant card row, coverage, and problems', () => {
    const book = buildCivicWorkbook(sample());
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
      'README',
      'Civic_Card_Rows',
      'Jurisdictions',
      'Offices',
      'Officials',
      'Terms',
      'Sources',
      'Field_Coverage',
      'Problems',
    ]);
    for (const sheet of book.worksheets) {
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(sheet.autoFilter).toBeTruthy();
      expect(sheet.getColumn(1).width).toBeGreaterThan(0);
    }
    const cards = book.getWorksheet('Civic_Card_Rows');
    expect(cards?.getRow(2).getCell(6).value).toBe('OFF-00000001');
    expect(cards?.getRow(2).getCell(10).value).toBe('Ada Example');
    expect(cards?.getRow(2).getCell(18).value).toBe('Office: 101 Monroe St, Rockville, MD 20850');
    expect(String(cards?.getRow(2).getCell(23).value)).toContain('County Executive serves Montgomery');
    expect(cards?.getRow(4).getCell(9).value).toBe('VACANT');
    expect(cards?.getRow(4).getCell(10).value).toBe('VACANT');
    expect(cards?.getRow(4).getCell(11).value).toBe('VACANT');

    const offices = book.getWorksheet('Offices');
    expect(offices?.getRow(1).getCell(4).value).toBe('jurisdictionId');
    expect(offices?.getRow(1).getCell(5).value).toBe('jurisdictionName');
    expect(offices?.getRow(2).getCell(5).value).toBe('Montgomery');

    const coverage = book.getWorksheet('Field_Coverage');
    let phoneTotal = 0;
    let phoneFilled = 0;
    let phonePercent = 0;
    if (coverage) {
      for (let row = 2; row <= coverage.rowCount; row += 1) {
        const line = coverage.getRow(row);
        if (line.getCell(1).value === 'ALL' && line.getCell(3).value === 'phone') {
          phoneTotal = Number(line.getCell(4).value);
          phoneFilled = Number(line.getCell(5).value);
          phonePercent = Number(line.getCell(6).value);
        }
      }
    }
    expect(phoneTotal).toBe(3);
    expect(phoneFilled).toBe(1);
    expect(phonePercent).toBe(33.3);

    const problems = book.getWorksheet('Problems');
    const kinds = problems
      ? Array.from({ length: Math.max(problems.rowCount - 1, 0) }, (_item, index) => problems.getRow(index + 2).getCell(1).value)
      : [];
    expect(kinds).toContain('Official has no current term');
    expect(kinds).toContain('Jurisdiction has no offices');
    expect(kinds).toContain('Office jurisdiction has no boundary');
    expect(kinds).toContain('Email does not match the person or office');
    expect(kinds).toContain('Duplicate official');
    expect(sheetRowCounts(book).find((row) => row.sheet === 'Civic_Card_Rows')?.rows).toBe(3);
    expect(book.worksheets.some((sheet) => /user|follow|notification/i.test(sheet.name))).toBe(false);
  });

  it('streams the workbook without keeping every cell in memory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'civic-export-'));
    const file = path.join(dir, 'civic.xlsx');
    const counts = await writeCivicWorkbook(sample(), file);
    expect(counts.find((row) => row.sheet === 'Civic_Card_Rows')?.rows).toBe(3);
    const { Workbook } = createRequire(import.meta.url)('exceljs') as { Workbook: new () => Workbook };
    const book = new Workbook();
    await book.xlsx.readFile(file);
    expect(book.getWorksheet('Civic_Card_Rows')?.getRow(4).getCell(10).value).toBe('VACANT');
    expect(book.getWorksheet('README')?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    await rm(dir, { recursive: true, force: true });
  });
});
