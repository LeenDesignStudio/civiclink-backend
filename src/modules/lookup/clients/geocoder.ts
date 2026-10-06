import { z } from 'zod';
import type { Clock } from '../../../lib/clock.js';
import { systemClock } from '../../../lib/clock.js';
import { GeocoderUnavailableError } from '../../../lib/errors.js';
import type { RandomSource } from '../../../lib/random.js';
import { systemRandom } from '../../../lib/random.js';
import { CircuitBreaker, withRetry } from '../../../lib/retry.js';

export const PRECISIONS = ['ROOFTOP', 'RANGE_INTERPOLATED', 'GEOMETRIC_CENTER', 'APPROXIMATE'] as const;
export type Precision = (typeof PRECISIONS)[number];

export interface Candidate {
  displayLabel: string;
  lat: number;
  lng: number;
  country: string;
  precision: Precision;
  zip?: string;
  city?: string;
  state?: string;
}

export interface Geocoder {
  geocode(query: string): Promise<Candidate[]>;
  reverse(lat: number, lng: number): Promise<Candidate[]>;
}

export interface GeocoderHttpResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers: { get(name: string): string | null };
}

export type GeocoderFetch = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<GeocoderHttpResponse>;

export interface GoogleGeocoderDeps {
  apiKey: string;
  fetch: GeocoderFetch;
  clock?: Clock;
  random?: RandomSource;
  sleep?: (ms: number) => Promise<void>;
  breaker?: CircuitBreaker;
}

const componentSchema = z.object({
  long_name: z.string(),
  short_name: z.string(),
  types: z.array(z.string()),
});

const googleSchema = z.object({
  status: z.string(),
  results: z
    .array(
      z.object({
        formatted_address: z.string(),
        geometry: z.object({
          location: z.object({
            lat: z.number(),
            lng: z.number(),
          }),
          location_type: z.string(),
        }),
        address_components: z.array(componentSchema).optional(),
      }),
    )
    .optional(),
});

class GeocodeRequestError extends Error {
  readonly retryAfterMs?: number;

  constructor(
    readonly retryable: boolean,
    retryAfterMs?: number,
  ) {
    super('geocode request failed');
    this.name = 'GeocodeRequestError';
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

function mapPrecision(locationType: string): Precision {
  if ((PRECISIONS as readonly string[]).includes(locationType)) return locationType as Precision;
  return 'APPROXIMATE';
}

function component(
  components: z.infer<typeof componentSchema>[] | undefined,
  type: string,
): z.infer<typeof componentSchema> | undefined {
  return components?.find((entry) => entry.types.includes(type));
}

type GoogleResult = NonNullable<z.infer<typeof googleSchema>['results']>[number];

function mapResult(result: GoogleResult): Candidate {
  const components = result.address_components;
  const country = (component(components, 'country')?.short_name ?? 'US').toUpperCase();
  const candidate: Candidate = {
    displayLabel: result.formatted_address,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    country,
    precision: mapPrecision(result.geometry.location_type),
  };
  const zip = component(components, 'postal_code')?.short_name;
  const city =
    component(components, 'locality')?.long_name ??
    component(components, 'postal_town')?.long_name ??
    component(components, 'sublocality')?.long_name;
  const state = component(components, 'administrative_area_level_1')?.short_name;
  if (zip) candidate.zip = zip;
  if (city) candidate.city = city;
  if (state) candidate.state = state;
  return candidate;
}

function headerRetryAfter(header: string | null, now: Date): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(header);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, when - now.getTime());
}

export class GoogleGeocoder implements Geocoder {
  private readonly clock: Clock;
  private readonly random: RandomSource;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly breaker: CircuitBreaker;

  constructor(private readonly deps: GoogleGeocoderDeps) {
    this.clock = deps.clock ?? systemClock;
    this.random = deps.random ?? systemRandom;
    this.sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.breaker =
      deps.breaker ?? new CircuitBreaker(this.clock, { threshold: 5, cooldownMs: 30_000 });
  }

  geocode(query: string): Promise<Candidate[]> {
    return this.call(() => this.request(this.endpoint({ address: query })));
  }

  reverse(lat: number, lng: number): Promise<Candidate[]> {
    return this.call(() => this.request(this.endpoint({ latlng: `${lat},${lng}` })));
  }

  private endpoint(params: { address?: string; latlng?: string }): string {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('components', 'country:US');
    url.searchParams.set('key', this.deps.apiKey);
    if (params.address !== undefined) url.searchParams.set('address', params.address);
    if (params.latlng !== undefined) url.searchParams.set('latlng', params.latlng);
    return url.toString();
  }

  private async call(fn: () => Promise<Candidate[]>): Promise<Candidate[]> {
    try {
      return await this.breaker.exec(() =>
        withRetry(fn, {
          maxRetries: 2,
          clock: this.clock,
          random: this.random,
          sleep: this.sleep,
          isRetryable: (error) => error instanceof GeocodeRequestError && error.retryable,
          retryAfterMs: (error) => (error instanceof GeocodeRequestError ? error.retryAfterMs : undefined),
        }),
      );
    } catch (err) {
      if (err instanceof GeocoderUnavailableError) throw err;
      throw new GeocoderUnavailableError({ cause: err });
    }
  }

  private async request(url: string): Promise<Candidate[]> {
    let response: GeocoderHttpResponse;
    try {
      response = await this.deps.fetch(url, { signal: AbortSignal.timeout(4_000) });
    } catch {
      throw new GeocodeRequestError(true);
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = headerRetryAfter(response.headers.get('retry-after'), this.clock.now());
      if (retryAfter === undefined) throw new GeocodeRequestError(true);
      throw new GeocodeRequestError(true, retryAfter);
    }
    if (!response.ok) throw new GeocodeRequestError(false);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new GeocodeRequestError(false);
    }
    const parsed = googleSchema.safeParse(body);
    if (!parsed.success) throw new GeocodeRequestError(false);
    if (parsed.data.status === 'ZERO_RESULTS') return [];
    if (parsed.data.status === 'OVER_QUERY_LIMIT' || parsed.data.status === 'UNKNOWN_ERROR') {
      throw new GeocodeRequestError(true);
    }
    if (parsed.data.status !== 'OK') throw new GeocodeRequestError(false);
    return (parsed.data.results ?? []).map((result) => mapResult(result));
  }
}
