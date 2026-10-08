import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { fromZod, ValidationError } from '../../lib/errors.js';
import {
  FRESHNESS_OVERRIDES,
  GOV_LEVELS,
  JURISDICTION_TYPES,
  RECORD_STATUSES,
  SELECTION_METHODS,
  TERM_STATUSES,
  type FreshnessOverride,
  type GovLevel,
  type JurisdictionType,
  type SelectionMethod,
  type TermStatus,
} from './civic.dto.js';

const CONTROL = /[\u0000-\u001F\u007F]/;

function noControl(value: string): boolean {
  return !CONTROL.test(value);
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw fromZod(parsed.error);
  return parsed.data;
}

function httpUrl(max = 2048) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Enter a valid http(s) URL.');
}

function httpsUrl(max = 2048) {
  return httpUrl(max).refine((value) => value.startsWith('https://'), 'Enter an https URL.');
}

export function normalizePhone(value: string, path: string): string {
  const phone = parsePhoneNumberFromString(value, 'US');
  if (!phone?.isValid()) {
    throw new ValidationError('Enter a valid phone number.', [
      { path, code: 'custom', message: 'Enter a valid phone number.' },
    ]);
  }
  return phone.number;
}

const optionalPhone = z
  .string()
  .trim()
  .max(20)
  .nullish()
  .transform((value, ctx) => {
    if (value === undefined || value === null || value === '') return null;
    const phone = parsePhoneNumberFromString(value, 'US');
    if (!phone?.isValid()) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number.' });
      return z.NEVER;
    }
    return phone.number;
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(noControl, 'Text cannot include control characters.')
    .nullish()
    .transform((value) => (value ? value : null));

const requiredText = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine(noControl, 'Text cannot include control characters.');

const optionalUrl = httpUrl().nullish().transform((value) => value ?? null);
const optionalHttps = httpsUrl().nullish().transform((value) => value ?? null);

const freshnessFields = {
  freshnessOverride: z.enum(FRESHNESS_OVERRIDES).default('NONE'),
  freshnessNote: optionalText(500),
};

function requireFreshnessNote(
  value: { freshnessOverride: FreshnessOverride; freshnessNote: string | null },
  ctx: z.RefinementCtx,
): void {
  if (value.freshnessOverride !== 'NONE' && !value.freshnessNote) {
    ctx.addIssue({
      code: 'custom',
      path: ['freshnessNote'],
      message: 'Add a note when overriding freshness.',
    });
  }
}

export const officeQuerySchema = z
  .object({
    slug: requiredText(1, 160),
    lookupToken: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

export interface OfficeQuery {
  slug: string;
  lookupToken?: string;
}

export function parseOfficeQuery(input: unknown): OfficeQuery {
  const value = parse(officeQuerySchema, input);
  const query: OfficeQuery = { slug: value.slug };
  if (value.lookupToken !== undefined) query.lookupToken = value.lookupToken;
  return query;
}

export const officialQuerySchema = officeQuerySchema;
export const parseOfficialQuery = parseOfficeQuery;

export const servicesQuerySchema = z
  .object({
    lookupToken: z.string().trim().min(1).max(32).optional(),
    jurisdictionId: z.uuid().optional(),
    officeId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    first: z.number().int().min(1).max(100).optional(),
    after: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const selected = [value.lookupToken, value.jurisdictionId, value.officeId].filter(
      (item) => item !== undefined,
    );
    if (selected.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['lookupToken'],
        message: 'Provide a lookup, a jurisdiction, or an office.',
      });
    }
  });

export interface ServicesQuery {
  lookupToken?: string;
  jurisdictionId?: string;
  officeId?: string;
  categoryId?: string;
  first?: number;
  after?: string;
}

export function parseServicesQuery(input: unknown): ServicesQuery {
  const value = parse(servicesQuerySchema, input);
  const query: ServicesQuery = {};
  if (value.lookupToken !== undefined) query.lookupToken = value.lookupToken;
  if (value.jurisdictionId !== undefined) query.jurisdictionId = value.jurisdictionId;
  if (value.officeId !== undefined) query.officeId = value.officeId;
  if (value.categoryId !== undefined) query.categoryId = value.categoryId;
  if (value.first !== undefined) query.first = value.first;
  if (value.after !== undefined) query.after = value.after;
  return query;
}

const addressSchema = z
  .object({
    label: requiredText(1, 60),
    street: requiredText(1, 200),
    city: requiredText(1, 100),
    state: z.string().trim().regex(/^[A-Za-z]{2}$/, 'Use a two-letter state.'),
    zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, 'Enter a ZIP code.'),
    phone: optionalPhone,
    hours: optionalText(200),
  })
  .strict();

export interface OfficeAddressInput {
  label: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
  hours: string | null;
}

export const upsertJurisdictionSchema = z
  .object({
    id: z.uuid().optional(),
    name: requiredText(2, 150),
    level: z.enum(GOV_LEVELS),
    type: z.enum(JURISDICTION_TYPES),
    subtype: optionalText(80),
    parentId: z.uuid().nullish().transform((value) => value ?? null),
    districtCode: optionalText(40),
    geoid: optionalText(40),
    state: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/, 'Use a two-letter state code.')
      .nullish()
      .transform((value) => value ?? null),
    website: optionalUrl,
    sourceId: z.uuid(),
    sourceRecordUrl: optionalUrl,
    lastUpdatedAt: z.union([z.date(), z.string().refine((value) => !Number.isNaN(Date.parse(value)))]).transform(
      (value) => (value instanceof Date ? value : new Date(value)),
    ),
    ...freshnessFields,
  })
  .strict()
  .superRefine(requireFreshnessNote);

export interface UpsertJurisdictionInput {
  id?: string;
  name: string;
  level: GovLevel;
  type: JurisdictionType;
  subtype: string | null;
  parentId: string | null;
  districtCode: string | null;
  geoid: string | null;
  state: string | null;
  website: string | null;
  sourceId: string;
  sourceRecordUrl: string | null;
  lastUpdatedAt: Date;
  freshnessOverride: FreshnessOverride;
  freshnessNote: string | null;
}

export function parseUpsertJurisdiction(input: unknown): UpsertJurisdictionInput {
  const value = parse(upsertJurisdictionSchema, input);
  const result: UpsertJurisdictionInput = {
    name: value.name,
    level: value.level,
    type: value.type,
    subtype: value.subtype,
    parentId: value.parentId,
    districtCode: value.districtCode,
    geoid: value.geoid,
    state: value.state,
    website: value.website,
    sourceId: value.sourceId,
    sourceRecordUrl: value.sourceRecordUrl,
    lastUpdatedAt: value.lastUpdatedAt,
    freshnessOverride: value.freshnessOverride,
    freshnessNote: value.freshnessNote,
  };
  if (value.id !== undefined) result.id = value.id;
  return result;
}

export const retireJurisdictionSchema = z
  .object({
    id: z.uuid(),
    retireActiveOffices: z.boolean().optional(),
  })
  .strict();

export function parseRetireJurisdiction(input: unknown): { id: string; retireActiveOffices: boolean } {
  const value = parse(retireJurisdictionSchema, input);
  return { id: value.id, retireActiveOffices: value.retireActiveOffices ?? false };
}

export const idSchema = z.object({ id: z.uuid() }).strict();

export function parseId(input: unknown): string {
  return parse(idSchema, input).id;
}

export const upsertOfficeSchema = z
  .object({
    id: z.uuid().optional(),
    jurisdictionId: z.uuid(),
    name: requiredText(2, 150),
    seatLabel: optionalText(60),
    selectionMethod: z.enum(SELECTION_METHODS),
    displayOrder: z.number().int().min(0).max(10_000).default(100),
    whyTemplate: optionalText(300),
    phone: optionalPhone,
    email: z.email().max(254).nullish().transform((value) => value?.toLowerCase() ?? null),
    website: optionalUrl,
    contactUrl: optionalUrl,
    addresses: z.array(addressSchema).max(5).default([]),
    holderUnknown: z.boolean().default(false),
    sourceId: z.uuid(),
    sourceRecordUrl: optionalUrl,
    lastUpdatedAt: z.union([z.date(), z.string().refine((value) => !Number.isNaN(Date.parse(value)))]).transform(
      (value) => (value instanceof Date ? value : new Date(value)),
    ),
    ...freshnessFields,
    notifyFollowers: z.boolean().optional(),
  })
  .strict()
  .superRefine(requireFreshnessNote);

export interface UpsertOfficeInput {
  id?: string;
  jurisdictionId: string;
  name: string;
  seatLabel: string | null;
  selectionMethod: SelectionMethod;
  displayOrder: number;
  whyTemplate: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  contactUrl: string | null;
  addresses: OfficeAddressInput[];
  holderUnknown: boolean;
  sourceId: string;
  sourceRecordUrl: string | null;
  lastUpdatedAt: Date;
  freshnessOverride: FreshnessOverride;
  freshnessNote: string | null;
  notifyFollowers: boolean;
}

export function parseUpsertOffice(input: unknown): UpsertOfficeInput {
  const value = parse(upsertOfficeSchema, input);
  const result: UpsertOfficeInput = {
    jurisdictionId: value.jurisdictionId,
    name: value.name,
    seatLabel: value.seatLabel,
    selectionMethod: value.selectionMethod,
    displayOrder: value.displayOrder,
    whyTemplate: value.whyTemplate,
    phone: value.phone,
    email: value.email,
    website: value.website,
    contactUrl: value.contactUrl,
    addresses: value.addresses.map((address) => ({
      ...address,
      state: address.state.toUpperCase(),
    })),
    holderUnknown: value.holderUnknown,
    sourceId: value.sourceId,
    sourceRecordUrl: value.sourceRecordUrl,
    lastUpdatedAt: value.lastUpdatedAt,
    freshnessOverride: value.freshnessOverride,
    freshnessNote: value.freshnessNote,
    notifyFollowers: value.notifyFollowers ?? false,
  };
  if (value.id !== undefined) result.id = value.id;
  return result;
}

export const upsertOfficialSchema = z
  .object({
    id: z.uuid().optional(),
    fullName: requiredText(2, 120),
    displayName: optionalText(120),
    party: optionalText(60),
    photoUrl: optionalHttps,
    website: optionalUrl,
    sourceId: z.uuid(),
    sourceRecordUrl: optionalUrl,
    lastUpdatedAt: z.union([z.date(), z.string().refine((value) => !Number.isNaN(Date.parse(value)))]).transform(
      (value) => (value instanceof Date ? value : new Date(value)),
    ),
    ...freshnessFields,
    notifyFollowers: z.boolean().optional(),
  })
  .strict()
  .superRefine(requireFreshnessNote);

export interface UpsertOfficialInput {
  id?: string;
  fullName: string;
  displayName: string | null;
  party: string | null;
  photoUrl: string | null;
  website: string | null;
  sourceId: string;
  sourceRecordUrl: string | null;
  lastUpdatedAt: Date;
  freshnessOverride: FreshnessOverride;
  freshnessNote: string | null;
  notifyFollowers: boolean;
}

export function parseUpsertOfficial(input: unknown): UpsertOfficialInput {
  const value = parse(upsertOfficialSchema, input);
  const result: UpsertOfficialInput = {
    fullName: value.fullName,
    displayName: value.displayName,
    party: value.party,
    photoUrl: value.photoUrl,
    website: value.website,
    sourceId: value.sourceId,
    sourceRecordUrl: value.sourceRecordUrl,
    lastUpdatedAt: value.lastUpdatedAt,
    freshnessOverride: value.freshnessOverride,
    freshnessNote: value.freshnessNote,
    notifyFollowers: value.notifyFollowers ?? false,
  };
  if (value.id !== undefined) result.id = value.id;
  return result;
}

const optionalDate = z
  .union([z.date(), z.string().refine((value) => !Number.isNaN(Date.parse(value)))])
  .nullish()
  .transform((value) => {
    if (value === undefined || value === null) return null;
    return value instanceof Date ? value : new Date(value);
  });

export const setOfficeTermSchema = z
  .object({
    officeId: z.uuid(),
    officialId: z.uuid(),
    status: z.enum(TERM_STATUSES),
    termStart: optionalDate,
    termEnd: optionalDate,
    makeCurrent: z.boolean(),
    notifyFollowers: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.termStart && value.termEnd && value.termEnd.getTime() < value.termStart.getTime()) {
      ctx.addIssue({
        code: 'custom',
        path: ['termEnd'],
        message: 'Term end is before the start.',
      });
    }
  });

export interface SetOfficeTermInput {
  officeId: string;
  officialId: string;
  status: TermStatus;
  termStart: Date | null;
  termEnd: Date | null;
  makeCurrent: boolean;
  notifyFollowers: boolean;
}

export function parseSetOfficeTerm(input: unknown): SetOfficeTermInput {
  const value = parse(setOfficeTermSchema, input);
  return {
    officeId: value.officeId,
    officialId: value.officialId,
    status: value.status,
    termStart: value.termStart,
    termEnd: value.termEnd,
    makeCurrent: value.makeCurrent,
    notifyFollowers: value.notifyFollowers ?? false,
  };
}

export const endOfficeTermSchema = z
  .object({
    termId: z.uuid(),
    termEnd: optionalDate,
  })
  .strict();

export function parseEndOfficeTerm(input: unknown): { termId: string; termEnd: Date | null } {
  const value = parse(endOfficeTermSchema, input);
  return { termId: value.termId, termEnd: value.termEnd };
}

export const upsertServiceSchema = z
  .object({
    id: z.uuid().optional(),
    title: requiredText(3, 120),
    categoryId: z.uuid(),
    description: requiredText(20, 400),
    url: optionalHttps,
    phoneContact: optionalText(120),
    jurisdictionIds: z.array(z.uuid()).max(50).default([]),
    officeIds: z.array(z.uuid()).max(50).default([]),
    lastValidatedAt: z.union([z.date(), z.string().refine((value) => !Number.isNaN(Date.parse(value)))]).transform(
      (value) => (value instanceof Date ? value : new Date(value)),
    ),
    sourceId: z.uuid(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.url && !value.phoneContact) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'Add a website or a phone contact.',
      });
    }
    if (value.jurisdictionIds.length + value.officeIds.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['jurisdictionIds'],
        message: 'Link the service to a jurisdiction or an office.',
      });
    }
  });

export interface UpsertServiceInput {
  id?: string;
  title: string;
  categoryId: string;
  description: string;
  url: string | null;
  phoneContact: string | null;
  jurisdictionIds: string[];
  officeIds: string[];
  lastValidatedAt: Date;
  sourceId: string;
}

export function parseUpsertService(input: unknown): UpsertServiceInput {
  const value = parse(upsertServiceSchema, input);
  const result: UpsertServiceInput = {
    title: value.title,
    categoryId: value.categoryId,
    description: value.description,
    url: value.url,
    phoneContact: value.phoneContact,
    jurisdictionIds: value.jurisdictionIds,
    officeIds: value.officeIds,
    lastValidatedAt: value.lastValidatedAt,
    sourceId: value.sourceId,
  };
  if (value.id !== undefined) result.id = value.id;
  return result;
}

export const upsertServiceCategorySchema = z
  .object({
    id: z.uuid().optional(),
    name: requiredText(2, 60),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    active: z.boolean().default(true),
  })
  .strict();

export interface UpsertServiceCategoryInput {
  id?: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

const recordStatus = z.enum(RECORD_STATUSES);
const freshness = z.enum(['CURRENT', 'MAY_BE_OUTDATED'] as const);

const adminSort = z.enum(['NEWEST', 'NAME']);
const searchText = z.string().trim().min(1).max(100);

export const adminJurisdictionListSchema = z
  .object({
    filter: z
      .object({
        level: z.enum(GOV_LEVELS).optional(),
        type: z.enum(JURISDICTION_TYPES).optional(),
        state: z.string().regex(/^[A-Z]{2}$/).optional(),
        status: recordStatus.optional(),
        freshness: freshness.optional(),
        q: searchText.optional(),
      })
      .strict()
      .optional(),
    sort: adminSort.default('NEWEST'),
    first: z.number().int().min(1).max(100).default(20),
    after: z.string().optional(),
  })
  .strict();

export const adminOfficeListSchema = z
  .object({
    filter: z
      .object({
        level: z.enum(GOV_LEVELS).optional(),
        jurisdictionId: z.uuid().optional(),
        vacantOnly: z.boolean().optional(),
        staleOnly: z.boolean().optional(),
        status: recordStatus.optional(),
        q: searchText.optional(),
      })
      .strict()
      .optional(),
    sort: adminSort.default('NEWEST'),
    first: z.number().int().min(1).max(100).default(20),
    after: z.string().optional(),
  })
  .strict();

export const adminOfficialListSchema = z
  .object({
    filter: z
      .object({
        status: recordStatus.optional(),
        officeId: z.uuid().optional(),
        q: searchText.optional(),
      })
      .strict()
      .optional(),
    sort: adminSort.default('NEWEST'),
    first: z.number().int().min(1).max(100).default(20),
    after: z.string().optional(),
  })
  .strict();

export const adminServiceListSchema = z
  .object({
    filter: z
      .object({
        categoryId: z.uuid().optional(),
        status: recordStatus.optional(),
        linkBroken: z.boolean().optional(),
        q: searchText.optional(),
      })
      .strict()
      .optional(),
    sort: adminSort.default('NEWEST'),
    first: z.number().int().min(1).max(100).default(20),
    after: z.string().optional(),
  })
  .strict();

export function parseUpsertServiceCategory(input: unknown): UpsertServiceCategoryInput {
  const value = parse(upsertServiceCategorySchema, input);
  const result: UpsertServiceCategoryInput = {
    name: value.name,
    sortOrder: value.sortOrder,
    active: value.active,
  };
  if (value.id !== undefined) result.id = value.id;
  return result;
}
