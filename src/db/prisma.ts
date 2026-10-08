import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import {
  CODE_META,
  ConflictError,
  DatabaseUnavailableError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  RelatedRecordMissingError,
  TimeoutError,
  TryAgainError,
  ValidationError,
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

function quotedConstraint(message: unknown): string | undefined {
  if (typeof message !== 'string') return undefined;
  return /constraint "([^"]+)"/.exec(message)?.[1];
}

/** Prisma's pg adapter reports a unique index as `{ index: name }`, not a string. */
function constraintFrom(value: unknown, depth = 0): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (!value || typeof value !== 'object' || depth > 4) return undefined;
  const record = value as {
    index?: unknown;
    constraint?: unknown;
    cause?: unknown;
    originalMessage?: unknown;
    message?: unknown;
  };
  if (typeof record.index === 'string' && record.index.length > 0) return record.index;
  const named = quotedConstraint(record.originalMessage) ?? quotedConstraint(record.message);
  if (named) return named;
  const nested = constraintFrom(record.constraint, depth + 1);
  if (nested) return nested;
  return constraintFrom(record.cause, depth + 1);
}

export function readDbError(err: unknown): DbErrorInfo {
  if (!err || typeof err !== 'object') return {};
  const record = err as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
    meta?: {
      constraint?: unknown;
      code?: unknown;
      driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } };
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
    constraintFrom(record.meta?.constraint) ??
    constraintFrom(cause) ??
    constraintFrom(record.constraint) ??
    quotedConstraint(record.message);
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
  if (info.pgCode === '42501') return new ForbiddenError();
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
