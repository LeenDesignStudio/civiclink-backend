import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

describe('logger redaction', () => {
  it('redacts email, token and cookie', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const log = createLogger({ destination: stream, level: 'info' });
    log.info({ email: 'person@example.com', token: 'secret-token', cookie: 'session=1' }, 'auth');
    await new Promise((resolve) => setImmediate(resolve));
    const body = lines.join('');
    expect(body).toContain('[Redacted]');
    expect(body).not.toContain('person@example.com');
    expect(body).not.toContain('secret-token');
    expect(body).not.toContain('session=1');
  });
});
