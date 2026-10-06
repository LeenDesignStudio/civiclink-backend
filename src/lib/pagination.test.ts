import { describe, expect, it } from 'vitest';
import { buildConnection, clampFirst, decodeCursor, encodeCursor } from './pagination.js';

describe('pagination', () => {
  it('round-trips cursors and clamps first', () => {
    const createdAt = new Date('2026-04-01T12:00:00.000Z');
    const cursor = encodeCursor(createdAt, 'id-1');
    expect(decodeCursor(cursor)).toEqual({ createdAt, id: 'id-1' });
    expect(clampFirst(undefined)).toBe(20);
    expect(clampFirst(500)).toBe(100);
    expect(clampFirst(0)).toBe(1);
  });

  it('builds a relay page', () => {
    const rows = [1, 2, 3].map((n) => ({
      id: `id-${n}`,
      createdAt: new Date(`2026-01-0${n}T00:00:00.000Z`),
    }));
    const page = buildConnection(rows, 2, 3);
    expect(page.edges).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);
    expect(page.totalCount).toBe(3);
    const decoded = decodeCursor(page.pageInfo.endCursor ?? '');
    expect(decoded?.id).toBe('id-2');
  });
});
