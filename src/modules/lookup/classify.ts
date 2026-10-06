import { ValidationError } from '../../lib/errors.js';

export const LOOKUP_METHODS = ['ADDRESS', 'ZIP', 'CITY_STATE', 'DEVICE'] as const;
export type ClassifiedMethod = (typeof LOOKUP_METHODS)[number];

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;
const CITY_STATE_PATTERN = /^(.+),\s*([A-Za-z]{2})$/;

export interface ClassifyInput {
  query?: string;
  lat?: number;
  lng?: number;
}

export function classifyLocation(input: ClassifyInput): ClassifiedMethod {
  if (typeof input.query === 'string' && CONTROL_CHARS.test(input.query)) {
    throw new ValidationError('Search text cannot include control characters.', [
      {
        path: 'input.query',
        code: 'custom',
        message: 'Search text cannot include control characters.',
      },
    ]);
  }
  const query = input.query?.trim() ?? '';
  const hasQuery = query.length > 0;
  const hasLat = input.lat !== undefined;
  const hasLng = input.lng !== undefined;
  if (hasLat !== hasLng) {
    throw new ValidationError('Latitude and longitude are both required.', [
      {
        path: 'input.lat',
        code: 'custom',
        message: 'Latitude and longitude are both required.',
      },
    ]);
  }
  const hasPoint = hasLat && hasLng;
  if (hasQuery === hasPoint) {
    throw new ValidationError('Provide a search or a map point, not both.', [
      {
        path: 'input.query',
        code: 'custom',
        message: 'Provide a search or a map point, not both.',
      },
    ]);
  }
  if (hasPoint) return 'DEVICE';
  if (ZIP_PATTERN.test(query)) return 'ZIP';
  const cityState = CITY_STATE_PATTERN.exec(query);
  const city = cityState?.[1]?.trim() ?? '';
  if (cityState && city.length > 0) return 'CITY_STATE';
  return 'ADDRESS';
}

export function parseCityState(query: string): { city: string; state: string } {
  const match = CITY_STATE_PATTERN.exec(query.trim());
  const city = match?.[1]?.trim() ?? '';
  const state = match?.[2]?.toUpperCase() ?? '';
  if (!match || city.length === 0) {
    throw new ValidationError('Enter a city and a two-letter state.', [
      { path: 'input.query', code: 'custom', message: 'Enter a city and a two-letter state.' },
    ]);
  }
  return { city, state };
}

export function normalizeZip(query: string): string {
  return query.trim().slice(0, 5);
}
