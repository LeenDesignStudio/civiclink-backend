import { Prisma } from '../../generated/prisma/client.js';
import { dbCall, prisma, type Db } from '../../db/prisma.js';
import type { GovLevel } from '../civic/civic.dto.js';
import type { Confidence, LevelDetail, LookupMethod, SavedLookup } from './lookup.dto.js';
import { parseLevelDetail } from './lookup.dto.js';
import type { LookupContext } from './lookup.dto.js';

/** Persisted lookup. There is no raw query field — search text is never stored. */
export interface CreateLookupInput {
  token: string;
  userId: string | null;
  method: LookupMethod;
  displayLabel: string;
  zip: string | null;
  jurisdictionIds: string[];
  confidence: Confidence;
  partialLevels: GovLevel[];
  levelDetail: LevelDetail;
  latencyMs: number;
  expiresAt: Date | null;
}

export interface LookupStore {
  create(input: CreateLookupInput): Promise<SavedLookup>;
  findByToken(token: string): Promise<SavedLookup | null>;
}

const lookupSelect = {
  id: true,
  token: true,
  userId: true,
  method: true,
  displayLabel: true,
  zip: true,
  jurisdictionIds: true,
  confidence: true,
  partialLevels: true,
  levelDetail: true,
  latencyMs: true,
  expiresAt: true,
} as const;

function toJson(detail: LevelDetail): Prisma.InputJsonValue {
  return {
    levels: detail.levels.map((level) => ({
      level: level.level,
      confidence: level.confidence,
      members: level.members.map((member) => ({
        id: member.id,
        name: member.name,
        type: member.type,
      })),
    })),
  };
}

export class LookupRepo implements LookupStore {
  constructor(private readonly db: Db = prisma) {}

  create(input: CreateLookupInput): Promise<SavedLookup> {
    return dbCall(async () => {
      const row = await this.db.lookup.create({
        data: {
          token: input.token,
          userId: input.userId,
          method: input.method,
          displayLabel: input.displayLabel,
          zip: input.zip,
          jurisdictionIds: input.jurisdictionIds,
          confidence: input.confidence,
          partialLevels: input.partialLevels,
          levelDetail: toJson(input.levelDetail),
          latencyMs: input.latencyMs,
          expiresAt: input.expiresAt,
        },
        select: lookupSelect,
      });
      return mapLookup(row);
    });
  }

  findByToken(token: string): Promise<SavedLookup | null> {
    return dbCall(async () => {
      const row = await this.db.lookup.findUnique({ where: { token }, select: lookupSelect });
      return row ? mapLookup(row) : null;
    });
  }

  async findActive(token: string, now: Date): Promise<LookupContext | null> {
    const row = await this.findByToken(token);
    if (!row || (row.expiresAt && row.expiresAt.getTime() <= now.getTime())) return null;
    const detail = parseLevelDetail(row.levelDetail);
    if (!detail) return null;
    return {
      token: row.token,
      method: row.method,
      displayLabel: row.displayLabel,
      zip: row.zip,
      confidence: row.confidence,
      jurisdictionIds: row.jurisdictionIds,
      partialLevels: row.partialLevels,
      levels: detail.levels,
      expiresAt: row.expiresAt,
    };
  }
}

function mapLookup(row: {
  id: string;
  token: string;
  userId: string | null;
  method: LookupMethod;
  displayLabel: string;
  zip: string | null;
  jurisdictionIds: string[];
  confidence: Confidence;
  partialLevels: GovLevel[];
  levelDetail: Prisma.JsonValue;
  latencyMs: number;
  expiresAt: Date | null;
}): SavedLookup {
  return {
    id: row.id,
    token: row.token,
    userId: row.userId,
    method: row.method,
    displayLabel: row.displayLabel,
    zip: row.zip,
    jurisdictionIds: row.jurisdictionIds,
    confidence: row.confidence,
    partialLevels: row.partialLevels,
    levelDetail: row.levelDetail,
    latencyMs: row.latencyMs,
    expiresAt: row.expiresAt,
  };
}
