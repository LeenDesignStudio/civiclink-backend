import { Prisma } from '../../generated/prisma/client.js';
import type { ActorType } from '../../generated/prisma/enums.js';
import { dbCall, type Db } from '../../db/prisma.js';
import type { Tx } from '../../auth/tx.js';
import type { AuditJson, ChangeLogDto, ChangeLogEntry } from './audit.dto.js';
import type { AuditStore, ChangeLogListQuery } from './audit.store.js';

function asJson(value: AuditJson | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function readJson(value: Prisma.JsonValue | null): AuditJson | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

export class AuditRepo implements AuditStore {
  constructor(private readonly db: Db) {}

  async insert(tx: Tx, entry: ChangeLogEntry): Promise<void> {
    const db = tx as Db;
    await dbCall(() =>
      db.changeLog.create({
        data: {
          actorType: entry.actorType,
          actorId: entry.actorId,
          entityType: entry.entityType,
          entityId: entry.entityId,
          action: entry.action,
          before: asJson(entry.before),
          after: asJson(entry.after),
          requestId: entry.requestId,
        },
        select: { id: true },
      }),
    );
  }

  async list(query: ChangeLogListQuery): Promise<{ rows: ChangeLogDto[]; total: number }> {
    const cursorWhere = query.cursor
      ? {
          OR: [
            { createdAt: { lt: query.cursor.createdAt } },
            { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
          ],
        }
      : {};
    const where = { entityType: query.entityType, entityId: query.entityId, ...cursorWhere };
    const [rows, total] = await dbCall(() =>
      Promise.all([
        this.db.changeLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit,
          select: {
            id: true,
            actorType: true,
            actorId: true,
            entityType: true,
            entityId: true,
            action: true,
            before: true,
            after: true,
            requestId: true,
            createdAt: true,
          },
        }),
        this.db.changeLog.count({ where: { entityType: query.entityType, entityId: query.entityId } }),
      ]),
    );
    return {
      total,
      rows: rows.map((row) => ({
        id: row.id,
        actorType: row.actorType as ActorType,
        actorId: row.actorId,
        entityType: row.entityType,
        entityId: row.entityId,
        action: row.action,
        before: readJson(row.before),
        after: readJson(row.after),
        requestId: row.requestId,
        createdAt: row.createdAt,
      })),
    };
  }
}
