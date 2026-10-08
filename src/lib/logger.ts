import { pino, type Logger, type LoggerOptions } from 'pino';
import { env } from '../config/env.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'token',
  '*.token',
  'refreshToken',
  '*.refreshToken',
  'idToken',
  '*.idToken',
  '*.code',
  'email',
  '*.email',
  'address',
  '*.address',
  'cookie',
  '*.cookie',
  'input.query',
  '*.input.query',
  'stripeSignature',
  '*.stripeSignature',
];

export interface RequestPrincipal {
  type: string;
  id?: string;
}

export function createLogger(options?: { level?: string; destination?: NodeJS.WritableStream }): Logger {
  const base: LoggerOptions = {
    level: options?.level ?? env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  if (env.APP_ENV === 'development' && !options?.destination) {
    return pino({
      ...base,
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } },
    });
  }
  return options?.destination ? pino(base, options.destination) : pino(base);
}

export const logger = createLogger();

export function withRequest(
  parent: Logger,
  requestId: string,
  principal?: RequestPrincipal,
): Logger {
  return parent.child({
    requestId,
    principalType: principal?.type ?? 'anonymous',
    ...(principal?.id ? { principalId: principal.id } : {}),
  });
}
