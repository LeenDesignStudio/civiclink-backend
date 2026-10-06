import { z } from 'zod';
import type { ActorType } from '../../generated/prisma/enums.js';
import type { ServiceContext } from '../../graphql/context.js';
import { ValidationError, fromZod } from '../../lib/errors.js';
import { NotFoundError } from '../../lib/errors.js';
import { buildConnection, clampFirst, decodeCursor } from '../../lib/pagination.js';
import type { Tx } from '../../auth/tx.js';
import type { AuditJson, ChangeLogDto, ChangeLogEntry, ChangeLogPage } from './audit.dto.js';
import type { AuditStore } from './audit.store.js';

const SECRET_KEYS = new Set([
  'password',
  'token',
  'refreshToken',
  'idToken',
  'code',
  'secret',
  'cookie',
  'authorization',
  'clientSecret',
]);

const listSchema = z
  .object({
    entityType: z.string().trim().min(1).max(60),
    entityId: z.uuid(),
    first: z.number().int().min(1).max(100).nullish(),
    after: z.string().min(1).max(500).nullish(),
  })
  .strict();

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Keep only changed, non-secret fields. */
export function projectChanged(
  before: AuditJson | null,
  after: AuditJson | null,
): { before: AuditJson | null; after: AuditJson | null } {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const nextBefore: AuditJson = {};
  const nextAfter: AuditJson = {};
  for (const key of keys) {
    if (SECRET_KEYS.has(key)) continue;
    const left = before?.[key] ?? null;
    const right = after?.[key] ?? null;
    const inBefore = before !== null && Object.prototype.hasOwnProperty.call(before, key);
    const inAfter = after !== null && Object.prototype.hasOwnProperty.call(after, key);
    if (inBefore && inAfter && jsonEqual(left, right)) continue;
    if (inBefore) nextBefore[key] = left;
    if (inAfter) nextAfter[key] = right;
  }
  return {
    before: Object.keys(nextBefore).length > 0 ? nextBefore : null,
    after: Object.keys(nextAfter).length > 0 ? nextAfter : null,
  };
}

export class AuditService {
  constructor(private readonly store: AuditStore) {}

  async record(tx: Tx, entry: ChangeLogEntry): Promise<void> {
    const actorId = entry.actorType === 'RESIDENT' ? null : entry.actorId;
    if (entry.actorType !== 'RESIDENT' && !actorId) {
      throw new ValidationError('actorId is required.');
    }
    const projected = projectChanged(entry.before, entry.after);
    const requestId = entry.requestId ? entry.requestId.slice(0, 64) : null;
    await this.store.insert(tx, {
      actorType: entry.actorType,
      actorId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      before: projected.before,
      after: projected.after,
      requestId,
    });
  }

  async list(ctx: ServiceContext, input: unknown): Promise<ChangeLogPage> {
    ctx.authz.require('admin.changelog:read');
    const parsed = listSchema.safeParse(input);
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.path[0] === 'entityId')) throw new NotFoundError();
      throw fromZod(parsed.error);
    }
    const first = clampFirst(parsed.data.first);
    let cursor: { createdAt: Date; id: string } | undefined;
    if (parsed.data.after) {
      const decoded = decodeCursor(parsed.data.after);
      if (!decoded) throw new ValidationError('That page cursor is not valid.');
      cursor = decoded;
    }
    const page = await this.store.list({
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      limit: first + 1,
      ...(cursor ? { cursor } : {}),
    });
    const connection = buildConnection<ChangeLogDto>(page.rows, first, page.total);
    return { ...connection, totalCount: page.total };
  }
}

export type { ActorType };
