import { z } from 'zod';
import { fromZod, ValidationError } from '../../lib/errors.js';
import { hasAsciiControls } from '../../lib/text.js';
import { LOOKUP_METHODS, type LookupMethod } from './lookup.dto.js';

const absent = (value: unknown) => (value === null || value === '' ? undefined : value);

const optionalQuery = z.preprocess(
  absent,
  z
    .string()
    .trim()
    .min(3)
    .max(200)
    .refine((value) => !hasAsciiControls(value), 'Search text cannot include control characters.')
    .optional(),
);

const optionalLat = z.preprocess(absent, z.number().min(-90).max(90).optional());
const optionalLng = z.preprocess(absent, z.number().min(-180).max(180).optional());

export const resolveLocationSchema = z
  .object({
    query: optionalQuery,
    lat: optionalLat,
    lng: optionalLng,
    method: z.preprocess(absent, z.enum(LOOKUP_METHODS).optional()),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasQuery = value.query !== undefined;
    const hasLat = value.lat !== undefined;
    const hasLng = value.lng !== undefined;
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: 'custom',
        path: ['lat'],
        message: 'Latitude and longitude are both required.',
      });
    }
    if (hasQuery === (hasLat && hasLng)) {
      ctx.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'Provide a search or a map point, not both.',
      });
    }
  });

export interface ResolveLocationInput {
  query?: string;
  lat?: number;
  lng?: number;
  method?: LookupMethod;
}

export function parseResolveLocation(input: unknown): ResolveLocationInput {
  if (input && typeof input === 'object' && 'query' in input) {
    const query = input.query;
    if (typeof query === 'string' && hasAsciiControls(query)) {
      throw new ValidationError('Search text cannot include control characters.', [
        {
          path: 'input.query',
          code: 'custom',
          message: 'Search text cannot include control characters.',
        },
      ]);
    }
  }
  const parsed = resolveLocationSchema.safeParse(input);
  if (!parsed.success) throw fromZod(parsed.error);
  const value = parsed.data;
  const result: ResolveLocationInput = {};
  if (value.query !== undefined) result.query = value.query;
  if (value.lat !== undefined) result.lat = value.lat;
  if (value.lng !== undefined) result.lng = value.lng;
  if (value.method !== undefined) result.method = value.method;
  return result;
}

export const confirmCandidateSchema = z
  .object({
    candidateToken: z.string().trim().min(10).max(4_000),
  })
  .strict();

export function parseConfirmCandidate(input: unknown): { candidateToken: string } {
  const parsed = confirmCandidateSchema.safeParse(input);
  if (!parsed.success) throw fromZod(parsed.error);
  return parsed.data;
}

export const reverseGeocodeSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();

export function parseReverseGeocode(input: unknown): { lat: number; lng: number } {
  const parsed = reverseGeocodeSchema.safeParse(input);
  if (!parsed.success) throw fromZod(parsed.error);
  return parsed.data;
}

export const civicCardSchema = z
  .object({
    token: z.string().trim().min(1).max(32),
  })
  .strict();

export function parseCivicCardToken(input: unknown): string {
  const parsed = civicCardSchema.safeParse(input);
  if (!parsed.success) throw fromZod(parsed.error);
  return parsed.data.token;
}
