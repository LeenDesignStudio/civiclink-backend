import { describe, expect, it } from 'vitest';
import { maskError, requestAls } from './errors.js';

describe('maskError', () => {
  it('hides unknown errors and keeps the request id', () => {
    const masked = requestAls.run({ requestId: 'req-12345678' }, () => maskError(new Error('sql exploded')));
    expect(masked.message).not.toContain('sql exploded');
    expect(masked.extensions.code).toBe('INTERNAL');
    expect(masked.extensions.requestId).toBe('req-12345678');
    expect(JSON.stringify(masked)).not.toContain('stack');
  });
});
