import { describe, expect, it } from 'vitest';
import { withoutNulls } from './relay.graphql.js';

describe('withoutNulls', () => {
  it('keeps Date values and drops nulls', () => {
    const when = new Date('2026-01-15T00:00:00.000Z');
    const result = withoutNulls({ lastUpdatedAt: when, termEnd: when, note: null, nested: { at: when } });
    expect(result).toEqual({ lastUpdatedAt: when, termEnd: when, nested: { at: when } });
    expect((result as { lastUpdatedAt: Date }).lastUpdatedAt).toBeInstanceOf(Date);
  });
});
