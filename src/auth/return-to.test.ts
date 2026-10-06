import { describe, expect, it } from 'vitest';
import { ValidationError } from '../lib/errors.js';
import { assertReturnTo, parseIntent, residentReturnUrl } from './return-to.js';

describe('returnTo', () => {
  it('allows listed relative paths and rejects open redirects', () => {
    expect(assertReturnTo('/me')).toBe('/me');
    expect(assertReturnTo('/card/abc')).toBe('/card/abc');
    expect(assertReturnTo('/pricing?plan=plus')).toBe('/pricing?plan=plus');
    expect(parseIntent('FOLLOW')).toBe('FOLLOW');
    expect(residentReturnUrl('http://localhost:3000', '/me', { intent: 'SIGN_IN' })).toBe(
      'http://localhost:3000/me?intent=SIGN_IN&welcome=1',
    );

    for (const bad of ['https://evil.test', '//evil.test', '/media', '/card/../../etc', 'me', '/\\\\evil']) {
      expect(() => assertReturnTo(bad)).toThrow(ValidationError);
    }
    expect(() => parseIntent('HACK')).toThrow(ValidationError);
  });
});
