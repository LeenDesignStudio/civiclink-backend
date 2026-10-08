import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { GraphQLError } from 'graphql';
import { UnauthenticatedError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { maskError, requestAls } from './errors.js';

function capture(): { lines: string[]; log: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      if (typeof chunk === 'string') lines.push(chunk);
      else if (Buffer.isBuffer(chunk)) lines.push(chunk.toString());
      else lines.push('');
      cb();
    },
  });
  return { lines, log: createLogger({ destination: stream, level: 'info' }) };
}

describe('maskError', () => {
  it('hides unknown errors and keeps the request id', () => {
    const masked = requestAls.run({ requestId: 'req-12345678' }, () => maskError(new Error('sql exploded')));
    expect(masked.message).not.toContain('sql exploded');
    expect(masked.extensions.code).toBe('INTERNAL');
    expect(masked.extensions.requestId).toBe('req-12345678');
    expect(JSON.stringify(masked)).not.toContain('stack');
  });

  it('logs an expected client error with code, operation and requestId and no stack', () => {
    const { lines, log } = capture();
    requestAls.run({ requestId: 'req-expected', operation: 'me', log }, () => {
      maskError(new UnauthenticatedError());
    });
    const body = lines.join('');
    expect(body).toContain('"level":30');
    expect(body).toContain('"code":"UNAUTHENTICATED"');
    expect(body).toContain('"operation":"me"');
    expect(body).toContain('"requestId":"req-expected"');
    expect(body).not.toContain('stack');
    expect(body).not.toContain('Please sign in');
  });

  it('logs an unknown error at error level with a stack', () => {
    const { lines, log } = capture();
    const masked = requestAls.run({ requestId: 'req-unknown', operation: 'health', log }, () =>
      maskError(new Error('sql exploded')),
    );
    const body = lines.join('');
    expect(masked.extensions.code).toBe('INTERNAL');
    expect(body).toContain('"level":50');
    expect(body).toContain('"code":"INTERNAL"');
    expect(body).toContain('"operation":"health"');
    expect(body).toContain('stack');
    expect(masked.message).not.toContain('sql exploded');
  });

  it('logs a syntax error as BAD_REQUEST without a stack', () => {
    const { lines, log } = capture();
    requestAls.run({ requestId: 'req-syntax', operation: 'unknown', log }, () => {
      maskError(new GraphQLError('Syntax Error: Document contains more than 2000 tokens.'));
    });
    const body = lines.join('');
    expect(body).toContain('"level":30');
    expect(body).toContain('"code":"BAD_REQUEST"');
    expect(body).not.toContain('stack');
  });
});
