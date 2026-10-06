import { describe, expect, it } from 'vitest';
import { NotFoundError, UpstreamError } from '../../lib/errors.js';
import { isPermanent } from './index.js';

describe('isPermanent', () => {
  it('is true only for a non-retryable AppError', () => {
    expect(isPermanent(new NotFoundError())).toBe(true);
    expect(isPermanent(new UpstreamError())).toBe(false);
    expect(isPermanent(new Error('network'))).toBe(false);
  });
});
