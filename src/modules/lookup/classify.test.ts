import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../lib/errors.js';
import { classifyLocation, normalizeZip, parseCityState } from './classify.js';

describe('classifyLocation', () => {
  it('classifies ZIP codes, city and state, and addresses', () => {
    expect(classifyLocation({ query: '20001' })).toBe('ZIP');
    expect(classifyLocation({ query: ' 20001-1234 ' })).toBe('ZIP');
    expect(classifyLocation({ query: '1234' })).toBe('ADDRESS');
    expect(classifyLocation({ query: 'Austin, TX' })).toBe('CITY_STATE');
    expect(classifyLocation({ query: 'Winston-Salem, nc' })).toBe('CITY_STATE');
    expect(classifyLocation({ query: 'Austin, Texas' })).toBe('ADDRESS');
    expect(classifyLocation({ query: '1600 Pennsylvania Ave NW' })).toBe('ADDRESS');
  });

  it('classifies a map point with no query as DEVICE', () => {
    expect(classifyLocation({ lat: 38.895, lng: -77.03 })).toBe('DEVICE');
  });

  it('rejects control characters', () => {
    expect(() => classifyLocation({ query: '20001\n' })).toThrow(ValidationError);
    expect(() => classifyLocation({ query: 'Main\u0000St' })).toThrow(ValidationError);
  });

  it('requires exactly one of query or lat and lng', () => {
    expect(() => classifyLocation({})).toThrow(ValidationError);
    expect(() => classifyLocation({ query: '20001', lat: 1, lng: 2 })).toThrow(ValidationError);
    expect(() => classifyLocation({ lat: 1 })).toThrow(ValidationError);
    expect(() => classifyLocation({ query: '   ' })).toThrow(ValidationError);
  });

  it('parses city and state and normalizes ZIP codes', () => {
    expect(parseCityState('Austin, tx')).toEqual({ city: 'Austin', state: 'TX' });
    expect(normalizeZip('20001-1234')).toBe('20001');
  });
});
