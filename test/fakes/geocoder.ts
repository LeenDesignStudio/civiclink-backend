import { GeocoderUnavailableError } from '../../src/lib/errors.js';
import type { Candidate, Geocoder } from '../../src/modules/lookup/clients/geocoder.js';

export type ScriptedCandidates = Candidate[] | 'timeout';

/** In-memory geocoder. A `'timeout'` script entry, or `mode: 'timeout'`, fails like an open timeout. */
export class FakeGeocoder implements Geocoder {
  mode: 'ok' | 'timeout' = 'ok';
  readonly geocodeCalls: string[] = [];
  readonly reverseCalls: Array<{ lat: number; lng: number }> = [];

  constructor(
    private readonly geocodeScript: ScriptedCandidates[] = [],
    private readonly reverseScript: ScriptedCandidates[] = [],
  ) {}

  geocode(query: string): Promise<Candidate[]> {
    this.geocodeCalls.push(query);
    return this.take(this.geocodeScript);
  }

  reverse(lat: number, lng: number): Promise<Candidate[]> {
    this.reverseCalls.push({ lat, lng });
    return this.take(this.reverseScript);
  }

  private take(script: ScriptedCandidates[]): Promise<Candidate[]> {
    if (this.mode === 'timeout') return Promise.reject(new GeocoderUnavailableError());
    const next = script.shift();
    if (next === undefined) return Promise.resolve([]);
    if (next === 'timeout') return Promise.reject(new GeocoderUnavailableError());
    return Promise.resolve(next);
  }
}
