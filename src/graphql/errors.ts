import { GraphQLError, type GraphQLErrorExtensions } from 'graphql';
import { AsyncLocalStorage } from 'node:async_hooks';
import { CODE_META, isAppError, type FieldError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const requestAls = new AsyncLocalStorage<{ requestId: string }>();

export function maskError(error: unknown): GraphQLError {
  const requestId = requestAls.getStore()?.requestId ?? 'unknown';
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
    if (!original.expose) {
      logger[original.logLevel]({ requestId, code: original.code, err: original }, 'masked error');
    } else if (original.logLevel !== 'info') {
      logger[original.logLevel]({ requestId, code: original.code }, original.clientMessage());
    }
    return new GraphQLError(original.clientMessage(), { extensions });
  }
  if (original instanceof GraphQLError) {
    const code = original.extensions.code;
    if (code === 'GRAPHQL_VALIDATION_FAILED' || code === 'BAD_REQUEST' || original.message.includes('Syntax')) {
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
  logger.error({ requestId, err: original }, 'unhandled graphql error');
  return new GraphQLError(CODE_META.INTERNAL.defaultMessage, {
    extensions: { code: 'INTERNAL', requestId },
  });
}

function unwrap(error: unknown): unknown {
  if (isAppError(error)) return error;
  if (error instanceof Error && error.cause !== undefined) return unwrap(error.cause);
  return error;
}
