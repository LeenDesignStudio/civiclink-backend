import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import {
  ConflictError,
  DatabaseUnavailableError,
  InternalError,
  NotFoundError,
  RelatedRecordMissingError,
  TimeoutError,
  TryAgainError,
  ValidationError,
  CODE_META,
  errorForConstraint,
  isAppError,
  type AppError,
} from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function createPrisma(connectionString = env.DATABASE_URL): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: env.DB_POOL_MAX });
  const client = new PrismaClient({
    adapter,
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });
  client.$on('warn', (event) => {
    logger.warn({ prisma: event.message }, 'prisma warn');
  });
  client.$on('error', (event) => {
    logger.error({ prisma: event.message }, 'prisma error');
  });
  return client;
}

export const prisma = createPrisma();

export type Db = PrismaClient | Prisma.TransactionClient;

export interface DbErrorInfo {
  prismaCode?: string;
  pgCode?: string;
  constraint?: string;
}

export function readDbError(err: unknown): DbErrorInfo {
  if (!err || typeof err !== 'object') return {};
  const record = err as {
    code?: unknown;
    constraint?: unknown;
    meta?: {
      constraint?: unknown;
      code?: unknown;
      driverAdapterError?: { cause?: { code?: unknown; constraint?: unknown; originalCode?: unknown } };
    };
  };
  const cause = record.meta?.driverAdapterError?.cause;
  const prismaCode = typeof record.code === 'string' && record.code.startsWith('P') ? record.code : undefined;
  const rawPg =
    (typeof cause?.originalCode === 'string' && cause.originalCode) ||
    (typeof cause?.code === 'string' && /^\d{5}$/.test(cause.code) ? cause.code : undefined) ||
    (typeof record.code === 'string' && /^\d{5}$/.test(record.code) ? record.code : undefined) ||
    (typeof record.meta?.code === 'string' && /^\d{5}$/.test(record.meta.code) ? record.meta.code : undefined);
  const constraint =
    (typeof record.meta?.constraint === 'string' && record.meta.constraint) ||
    (typeof cause?.constraint === 'string' && cause.constraint) ||
    (typeof record.constraint === 'string' && record.constraint) ||
    undefined;
  return {
    ...(prismaCode ? { prismaCode } : {}),
    ...(rawPg ? { pgCode: rawPg } : {}),
    ...(constraint ? { constraint } : {}),
  };
}

export function mapDbError(err: unknown): AppError {
  if (isAppError(err)) return err;
  const info = readDbError(err);
  const constrained = errorForConstraint(info.constraint);
  if (constrained) return constrained;
  if (info.prismaCode === 'P2002' || info.pgCode === '23505') return new ConflictError();
  if (info.prismaCode === 'P2025') return new NotFoundError();
  if (info.prismaCode === 'P2003' || info.pgCode === '23503') return new RelatedRecordMissingError({ cause: err });
  if (info.pgCode === '23514') {
    const details = info.constraint ? { constraint: info.constraint } : undefined;
    return new ValidationError('That value is not allowed.', [], {
      cause: err,
      ...(details ? { details } : {}),
    });
  }
  if (info.prismaCode === 'P2034' || info.pgCode === '40001' || info.pgCode === '40P01') return new TryAgainError();
  if (info.prismaCode === 'P1001' || info.prismaCode === 'P1002' || info.prismaCode === 'P1017') {
    return new DatabaseUnavailableError({ cause: err });
  }
  if (info.pgCode === '57014') return new TimeoutError({ cause: err });
  return new InternalError(CODE_META.INTERNAL.defaultMessage, { cause: err });
}

export function isSerializationError(err: unknown): boolean {
  const info = readDbError(err);
  return info.prismaCode === 'P2034' || info.pgCode === '40001' || info.pgCode === '40P01';
}

export async function withTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { isolation?: Prisma.TransactionIsolationLevel; client?: PrismaClient },
): Promise<T> {
  const client = options?.client ?? prisma;
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(fn, {
        isolationLevel: options?.isolation ?? Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    } catch (err) {
      last = err;
      if (!isSerializationError(err) || attempt === 2) throw mapDbError(err);
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 40 * (attempt + 1))));
    }
  }
  throw mapDbError(last);
}

export async function dbCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isAppError(err)) throw err;
    throw mapDbError(err);
  }
}
