export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface Connection<T> {
  edges: { cursor: string; node: T }[];
  pageInfo: PageInfo;
  totalCount?: number;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | undefined {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.indexOf('|');
    if (sep <= 0) return undefined;
    const createdAt = new Date(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (Number.isNaN(createdAt.getTime()) || id.length === 0) return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}

export function clampFirst(first: number | null | undefined, max = 100, fallback = 20): number {
  if (first === null || first === undefined || !Number.isFinite(first)) return fallback;
  const whole = Math.floor(first);
  if (whole < 1) return 1;
  return Math.min(whole, max);
}

export function buildConnection<T extends { createdAt: Date; id: string }>(
  rows: T[],
  first: number,
  totalCount?: number,
): Connection<T> {
  const hasNextPage = rows.length > first;
  const page = hasNextPage ? rows.slice(0, first) : rows;
  const last = page[page.length - 1];
  const connection: Connection<T> = {
    edges: page.map((node) => ({ cursor: encodeCursor(node.createdAt, node.id), node })),
    pageInfo: {
      hasNextPage,
      endCursor: last ? encodeCursor(last.createdAt, last.id) : null,
    },
  };
  if (totalCount !== undefined) connection.totalCount = totalCount;
  return connection;
}
