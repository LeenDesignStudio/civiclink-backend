import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { env } from '../src/config/env.js';
import {
  buildCivicWorkbook,
  exportFileName,
  parseExportArgs,
  sheetRowCounts,
  type CivicExport,
  type ExportJurisdiction,
  type ExportOffice,
  type ExportOfficial,
  type ExportSource,
  type ExportTerm,
} from '../src/modules/export/civic-workbook.js';

const args = parseExportArgs(process.argv.slice(2));
const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: 2,
    options: '-c default_transaction_read_only=on',
  }),
});

try {
  const data = await loadExport(db, args.state, args.pilotOnly);
  const book = buildCivicWorkbook(data);
  const directory = path.resolve('exports');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, exportFileName(data.generatedAt));
  await book.xlsx.writeFile(file);
  process.stdout.write(`${file}\n`);
  for (const row of sheetRowCounts(book)) process.stdout.write(`${row.sheet}\t${row.rows}\n`);
} catch (err: unknown) {
  process.stderr.write(`${safeMessage(err)}\n`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}

async function loadExport(client: PrismaClient, state: string | undefined, pilotOnly: boolean): Promise<CivicExport> {
  const filtered = Boolean(state || pilotOnly);
  const jurisdictionRows = await client.jurisdiction.findMany({
    where: {
      ...(state ? { state } : {}),
      ...(pilotOnly ? { isPilot: true } : {}),
    },
    include: { source: { select: { name: true } }, parent: { select: { name: true } } },
    orderBy: [{ displayId: 'asc' }],
  });
  const flags = await client.$queryRaw<Array<{ id: string; has_boundary: boolean }>>`
    SELECT id::text AS id, (boundary IS NOT NULL AND NOT ST_IsEmpty(boundary)) AS has_boundary
    FROM jurisdictions
  `;
  const boundary = new Map(flags.map((row) => [row.id, row.has_boundary === true]));
  const jurisdictions: ExportJurisdiction[] = jurisdictionRows.map((row) => ({
    id: row.id,
    displayId: row.displayId,
    name: row.name,
    aliases: row.aliases,
    description: row.description,
    isPilot: row.isPilot,
    parentRetired: row.parentRetired,
    level: row.level,
    type: row.type,
    subtype: row.subtype,
    parentId: row.parentId,
    parentName: row.parent?.name ?? null,
    districtCode: row.districtCode,
    geoid: row.geoid,
    state: row.state,
    hasBoundary: boundary.get(row.id) ?? false,
    boundaryVintage: row.boundaryVintage,
    website: row.website,
    sourceId: row.sourceId,
    sourceName: row.source.name,
    sourceRecordUrl: row.sourceRecordUrl,
    lastUpdatedAt: row.lastUpdatedAt,
    freshnessOverride: row.freshnessOverride,
    freshnessNote: row.freshnessNote,
    overrideActive: row.overrideActive,
    overrideReason: row.overrideReason,
    overriddenBy: row.overriddenBy,
    overriddenAt: row.overriddenAt,
    sourceChangedSinceOverride: row.sourceChangedSinceOverride,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
  const jurisdictionIds = jurisdictions.map((row) => row.id);
  const names = new Map(jurisdictions.map((row) => [row.id, row.name]));
  const officeWhere = filtered ? { jurisdictionId: { in: jurisdictionIds } } : {};
  const officeRows =
    filtered && jurisdictionIds.length === 0
      ? []
      : await client.office.findMany({
          where: officeWhere,
          include: {
            source: { select: { name: true, url: true, freshnessDays: true } },
            addresses: { orderBy: { sortOrder: 'asc' } },
          },
          orderBy: [{ displayId: 'asc' }],
        });
  const offices: ExportOffice[] = officeRows.map((row) => ({
    id: row.id,
    displayId: row.displayId,
    slug: row.slug,
    jurisdictionId: row.jurisdictionId,
    jurisdictionName: names.get(row.jurisdictionId) ?? null,
    name: row.name,
    seatLabel: row.seatLabel,
    selectionMethod: row.selectionMethod,
    officeType: row.officeType,
    parentRetired: row.parentRetired,
    displayOrder: row.displayOrder,
    whyTemplate: row.whyTemplate,
    phone: row.phone,
    email: row.email,
    website: row.website,
    contactUrl: row.contactUrl,
    holderUnknown: row.holderUnknown,
    sourceId: row.sourceId,
    sourceName: row.source.name,
    sourceUrl: row.source.url,
    sourceFreshnessDays: row.source.freshnessDays,
    sourceRecordUrl: row.sourceRecordUrl,
    lastUpdatedAt: row.lastUpdatedAt,
    freshnessOverride: row.freshnessOverride,
    freshnessNote: row.freshnessNote,
    overrideActive: row.overrideActive,
    overrideReason: row.overrideReason,
    overriddenBy: row.overriddenBy,
    overriddenAt: row.overriddenAt,
    sourceChangedSinceOverride: row.sourceChangedSinceOverride,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    addresses: row.addresses.map((address) => ({
      label: address.label,
      street: address.street,
      city: address.city,
      state: address.state,
      zip: address.zip,
      phone: address.phone,
      hours: address.hours,
      sortOrder: address.sortOrder,
    })),
  }));
  const officialRows =
    filtered && jurisdictionIds.length === 0
      ? []
      : await client.official.findMany({
          where: filtered ? { terms: { some: { office: { jurisdictionId: { in: jurisdictionIds } } } } } : {},
          include: { source: { select: { name: true } } },
          orderBy: [{ displayId: 'asc' }],
        });
  const officials: ExportOfficial[] = officialRows.map((row) => ({
    id: row.id,
    displayId: row.displayId,
    slug: row.slug,
    fullName: row.fullName,
    displayName: row.displayName,
    party: row.party,
    photoUrl: row.photoUrl,
    website: row.website,
    externalIds: row.externalIds,
    useOfficeAddress: row.useOfficeAddress,
    sourceId: row.sourceId,
    sourceName: row.source.name,
    sourceRecordUrl: row.sourceRecordUrl,
    lastUpdatedAt: row.lastUpdatedAt,
    freshnessOverride: row.freshnessOverride,
    freshnessNote: row.freshnessNote,
    overrideActive: row.overrideActive,
    overrideReason: row.overrideReason,
    overriddenBy: row.overriddenBy,
    overriddenAt: row.overriddenAt,
    sourceChangedSinceOverride: row.sourceChangedSinceOverride,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
  const termRows =
    filtered && jurisdictionIds.length === 0
      ? []
      : await client.officeTerm.findMany({
          where: filtered ? { office: { jurisdictionId: { in: jurisdictionIds } } } : {},
          include: {
            office: { select: { name: true, displayId: true } },
            official: { select: { fullName: true, displayId: true } },
          },
          orderBy: [{ officeId: 'asc' }, { isCurrent: 'desc' }],
        });
  const terms: ExportTerm[] = termRows.map((row) => ({
    id: row.id,
    officeId: row.officeId,
    officeName: row.office.name,
    officeDisplayId: row.office.displayId,
    officialId: row.officialId,
    officialName: row.official.fullName,
    officialDisplayId: row.official.displayId,
    status: row.status,
    termStart: row.termStart,
    termEnd: row.termEnd,
    isCurrent: row.isCurrent,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
  const sourceIds = new Set<string>([
    ...jurisdictions.map((row) => row.sourceId),
    ...offices.map((row) => row.sourceId),
    ...officials.map((row) => row.sourceId),
  ]);
  const sourceRows = await client.source.findMany({
    where: filtered ? { id: { in: [...sourceIds] } } : {},
    orderBy: [{ displayId: 'asc' }],
  });
  const sources: ExportSource[] = sourceRows.map((row) => ({
    id: row.id,
    displayId: row.displayId,
    name: row.name,
    publisher: row.publisher,
    url: row.url,
    termsUrl: row.termsUrl,
    method: row.method,
    kind: row.kind,
    schedule: row.schedule,
    freshnessDays: row.freshnessDays,
    notes: row.notes,
    recordStatus: row.recordStatus,
    lastSuccessAt: row.lastSuccessAt,
    lastAttemptAt: row.lastAttemptAt,
    levels: row.levels,
    collectorKey: row.collectorKey,
    config: row.config,
    active: row.active,
    lastRunAt: row.lastRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
  return {
    generatedAt: new Date(),
    state: state ?? null,
    pilotOnly,
    jurisdictions,
    offices,
    officials,
    terms,
    sources,
  };
}

function safeMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Export failed.';
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://…');
}
