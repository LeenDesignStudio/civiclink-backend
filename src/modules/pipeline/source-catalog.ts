import { z } from 'zod';
import type { SourceConfig } from './types.js';
import { DEFAULT_TIGER_YEAR } from './tiger.js';

const LEVELS = ['FEDERAL', 'STATE', 'COUNTY', 'MUNICIPAL', 'EDUCATION', 'SPECIAL'] as const;

export interface SourceSeed {
  name: string;
  publisher: string;
  url: string;
  termsUrl: string;
  method: 'BULK' | 'PAGE_COLLECTION';
  schedule: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ON_DEMAND';
  freshnessDays: number;
  levels: (typeof LEVELS)[number][];
  collectorKey: string;
  config: SourceConfig;
}

const https = z.url().refine((value) => value.startsWith('https://'), 'Use an https URL.');
const selectorSchema = z
  .object({
    tag: z.string().trim().min(1).max(40),
    className: z.string().trim().min(1).max(80).optional(),
    attr: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

const pageFileSchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    publisher: z.string().trim().min(2).max(150),
    url: https,
    termsUrl: https,
    method: z.literal('PAGE_COLLECTION'),
    schedule: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ON_DEMAND']),
    freshnessDays: z.number().int().min(1).max(3650),
    levels: z.array(z.enum(LEVELS)).min(1).max(6),
    collectorKey: z.literal('page.directory'),
    config: z
      .object({
        state: z.string().trim().length(2),
        county: z.string().trim().min(1).max(80),
        pageUrl: https,
        jurisdictionGeoid: z.string().trim().min(1).max(40),
        officeId: z.uuid().optional(),
        item: selectorSchema.optional(),
        selectors: z
          .object({
            name: selectorSchema,
            title: selectorSchema.optional(),
            phone: selectorSchema.optional(),
            email: selectorSchema.optional(),
            address: selectorSchema.optional(),
          })
          .strict(),
        allowedHosts: z.array(z.string().trim().min(1).max(253)).max(20).optional(),
      })
      .strict(),
  })
  .strict();

export function sourceCatalog(tigerYear = DEFAULT_TIGER_YEAR): SourceSeed[] {
  return [
    {
      name: 'Census TIGER/Line',
      publisher: 'U.S. Census Bureau',
      url: `https://www2.census.gov/geo/tiger/TIGER${tigerYear}/`,
      termsUrl: 'https://www.census.gov/programs-surveys/geography/guidance/tiger-data-products-guide.html',
      method: 'BULK',
      schedule: 'QUARTERLY',
      freshnessDays: 90,
      levels: ['FEDERAL', 'STATE', 'COUNTY', 'MUNICIPAL', 'EDUCATION', 'SPECIAL'],
      collectorKey: 'tiger.boundaries',
      config: { tigerYear },
    },
    {
      name: 'unitedstates/congress-legislators',
      publisher: 'unitedstates',
      url: 'https://unitedstates.github.io/congress-legislators/legislators-current.yaml',
      termsUrl: 'https://github.com/unitedstates/congress-legislators/blob/main/LICENSE',
      method: 'BULK',
      schedule: 'WEEKLY',
      freshnessDays: 90,
      levels: ['FEDERAL'],
      collectorKey: 'congress.legislators',
      config: {},
    },
    {
      name: 'Open States people',
      publisher: 'Open States',
      url: 'https://data.openstates.org/people/current/',
      termsUrl: 'https://openstates.org/about/',
      method: 'BULK',
      schedule: 'WEEKLY',
      freshnessDays: 90,
      levels: ['STATE'],
      collectorKey: 'openstates.people',
      config: {},
    },
  ];
}

export function parsePageSourceFile(text: string, filename: string): SourceSeed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Invalid page source file: ${filename}`);
  }
  const result = pageFileSchema.safeParse(parsed);
  if (!result.success) throw new Error(`Invalid page source file: ${filename}`);
  const row = result.data;
  const config: SourceConfig = {
    state: row.config.state.toUpperCase(),
    county: row.config.county,
    pageUrl: row.config.pageUrl,
    jurisdictionGeoid: row.config.jurisdictionGeoid,
    selectors: {
      name: selectorFrom(row.config.selectors.name),
      ...(row.config.selectors.title ? { title: selectorFrom(row.config.selectors.title) } : {}),
      ...(row.config.selectors.phone ? { phone: selectorFrom(row.config.selectors.phone) } : {}),
      ...(row.config.selectors.email ? { email: selectorFrom(row.config.selectors.email) } : {}),
      ...(row.config.selectors.address ? { address: selectorFrom(row.config.selectors.address) } : {}),
    },
  };
  if (row.config.officeId) config.officeId = row.config.officeId;
  if (row.config.item) config.item = selectorFrom(row.config.item);
  if (row.config.allowedHosts) config.allowedHosts = row.config.allowedHosts;
  return {
    name: row.name,
    publisher: row.publisher,
    url: row.url,
    termsUrl: row.termsUrl,
    method: row.method,
    schedule: row.schedule,
    freshnessDays: row.freshnessDays,
    levels: row.levels,
    collectorKey: row.collectorKey,
    config,
  };
}

function selectorFrom(value: { tag: string; className?: string | undefined; attr?: string | undefined }): {
  tag: string;
  className?: string;
  attr?: string;
} {
  const selector: { tag: string; className?: string; attr?: string } = { tag: value.tag };
  if (value.className) selector.className = value.className;
  if (value.attr) selector.attr = value.attr;
  return selector;
}
