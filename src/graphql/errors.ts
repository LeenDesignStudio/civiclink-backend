import { GraphQLError, type GraphQLErrorExtensions } from 'graphql';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';
import { CODE_META, isAppError, type FieldError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const requestAls = new AsyncLocalStorage<{
  requestId: string;
  operation?: string;
  log?: Logger;
}>();

export function maskError(error: unknown): GraphQLError {
  const store = requestAls.getStore();
  const requestId = store?.requestId ?? 'unknown';
  const operation = store?.operation ?? 'unknown';
  const log = store?.log ?? logger;
  const original = unwrap(error);
  if (isAppError(original)) {
    const extensions: GraphQLErrorExtensions = {
      code: original.code,
      requestId,
    };
    if (original.expose && original instanceof Error && 'fieldErrors' in original) {
      const fieldErrors = (original as { fieldErrors?: FieldError[] }).fieldErrors;
      if (fieldErrors && fieldErrors.length > 0) extensions.fieldErrors = fieldErrors;
    }
    if (original.expose && 'retryAfterSeconds' in original) {
      const retryAfterSeconds = (original as { retryAfterSeconds?: number }).retryAfterSeconds;
      if (typeof retryAfterSeconds === 'number') extensions.retryAfterSeconds = retryAfterSeconds;
    }
    if (original.expose) {
      log[original.logLevel]({ requestId, operation, code: original.code }, 'graphql request rejected');
    } else {
      log.error({ requestId, operation, code: original.code, err: original }, 'graphql request failed');
    }
    return new GraphQLError(original.clientMessage(), { extensions });
  }
  if (original instanceof GraphQLError) {
    const code = original.extensions.code;
    if (code === 'GRAPHQL_VALIDATION_FAILED' || code === 'BAD_REQUEST' || original.message.includes('Syntax')) {
      log.info({ requestId, operation, code: 'BAD_REQUEST' }, 'graphql request rejected');
      return new GraphQLError(CODE_META.BAD_REQUEST.defaultMessage, {
        extensions: { code: 'BAD_REQUEST', requestId },
      });
    }
    if (typeof code === 'string') {
      return new GraphQLError(original.message, {
        extensions: { ...original.extensions, requestId },
      });
    }
  }
  log.error({ requestId, operation, code: 'INTERNAL', err: original }, 'unhandled graphql error');
  return new GraphQLError(CODE_META.INTERNAL.defaultMessage, {
    extensions: { code: 'INTERNAL', requestId },
  });
}

function unwrap(error: unknown): unknown {
  if (isAppError(error)) return error;
  if (error instanceof Error && error.cause !== undefined) return unwrap(error.cause);
  return error;
}
