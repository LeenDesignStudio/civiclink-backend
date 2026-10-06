import type { FastifyReply } from 'fastify';
import { CODE_META, isAppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function sendAuthError(reply: FastifyReply, err: unknown, requestId: string): FastifyReply {
  if (isAppError(err)) {
    return reply.status(err.httpStatus).send({
      error: { code: err.code, message: err.clientMessage(), requestId },
    });
  }
  logger.error({ requestId }, 'auth request failed');
  return reply.status(500).send({
    error: { code: 'INTERNAL', message: CODE_META.INTERNAL.defaultMessage, requestId },
  });
}

export function redirectAuthError(
  reply: FastifyReply,
  webUrl: string,
  path: string,
  code: string,
): FastifyReply {
  const safe = /^[A-Z0-9_]+$/.test(code) ? code : 'OAUTH_FAILED';
  const url = new URL(path, webUrl);
  url.searchParams.set('error', safe);
  return reply.redirect(url.toString(), 302);
}

export function authFailureCode(err: unknown): string {
  return isAppError(err) ? err.code : 'OAUTH_FAILED';
}
