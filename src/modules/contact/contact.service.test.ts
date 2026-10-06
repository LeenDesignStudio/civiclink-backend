import { describe, expect, it } from 'vitest';
import { Authz } from '../../authz/authz.js';
import type { ServiceContext } from '../../graphql/context.js';
import { FakeClock } from '../../lib/clock.js';
import { BotCheckFailedError, ValidationError } from '../../lib/errors.js';
import { FakeTurnstile } from '../../../test/fakes/turnstile.js';
import type { StoredContactMessage } from './contact.dto.js';
import type { ContactQueue, ContactRepo, NewContactMessage } from './contact.ports.js';
import { ContactService } from './contact.service.js';

class MemoryContact implements ContactRepo {
  readonly rows: StoredContactMessage[] = [];

  insert(row: NewContactMessage): Promise<StoredContactMessage> {
    const stored: StoredContactMessage = {
      id: '00000000-0000-4000-8000-000000000001',
      ...row,
    };
    this.rows.push(stored);
    return Promise.resolve(stored);
  }
}

describe('ContactService', () => {
  it('stores only the ip hash and enqueues the inbox email', async () => {
    const repo = new MemoryContact();
    const turnstile = new FakeTurnstile();
    const jobs: { name: string; payload: { contactMessageId: string } }[] = [];
    const queue: ContactQueue = {
      enqueue: (name, payload) => {
        jobs.push({ name, payload });
        return Promise.resolve();
      },
    };
    const principal = { kind: 'anonymous' as const };
    const ctx: ServiceContext = {
      requestId: 'req-1',
      principal,
      authz: new Authz(principal),
      ipHash: 'hashed-ip',
    };
    const svc = new ContactService({
      repo,
      turnstile,
      queue,
      clock: new FakeClock(new Date('2026-10-06T12:00:00.000Z')),
    });
    const result = await svc.submitContactMessage(ctx, {
      name: 'Ada Lovelace',
      email: 'Ada@Example.com',
      topic: 'GENERAL',
      message: 'The council page looks out of date.',
      consent: true,
      turnstileToken: 'ok-token',
    });
    expect(result.contactMessage.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(repo.rows[0]?.ipHash).toBe('hashed-ip');
    expect(repo.rows[0]?.email).toBe('ada@example.com');
    expect(repo.rows[0] && 'ip' in repo.rows[0]).toBe(false);
    expect(turnstile.seen).toEqual([{ token: 'ok-token', ipHash: 'hashed-ip' }]);
    expect(jobs).toEqual([{ name: 'email.contact', payload: { contactMessageId: result.contactMessage.id } }]);
  });

  it('rejects a failed bot check and invalid input', async () => {
    const repo = new MemoryContact();
    const svc = new ContactService({
      repo,
      turnstile: new FakeTurnstile(),
      queue: { enqueue: () => Promise.resolve() },
      clock: new FakeClock(new Date('2026-10-06T12:00:00.000Z')),
    });
    const principal = { kind: 'anonymous' as const };
    const ctx: ServiceContext = {
      requestId: 'req-1',
      principal,
      authz: new Authz(principal),
      ipHash: 'hashed-ip',
    };
    const input = {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      topic: 'GENERAL',
      message: 'The council page looks out of date.',
      consent: true,
      turnstileToken: 'fail',
    };
    await expect(svc.submitContactMessage(ctx, input)).rejects.toBeInstanceOf(BotCheckFailedError);
    expect(repo.rows).toHaveLength(0);
    await expect(svc.submitContactMessage(ctx, { ...input, name: 'A', turnstileToken: 'ok' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
