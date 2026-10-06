import type { ServiceContext } from '../../graphql/context.js';
import type { Clock } from '../../lib/clock.js';
import { BotCheckFailedError } from '../../lib/errors.js';
import { parseInput } from '../locations/locations.service.js';
import type { ContactMessageDto } from './contact.dto.js';
import { submitContactSchema } from './contact.inputs.js';
import type { ContactQueue, ContactRepo, TurnstileVerifier } from './contact.ports.js';

export interface ContactDeps {
  repo: ContactRepo;
  turnstile: TurnstileVerifier;
  queue: ContactQueue;
  clock: Clock;
}

export class ContactService {
  constructor(private readonly deps: ContactDeps) {}

  async submitContactMessage(ctx: ServiceContext, input: unknown): Promise<{ contactMessage: ContactMessageDto }> {
    ctx.authz.require('public.contact:create');
    const parsed = parseInput(submitContactSchema, input);
    const passed = await this.deps.turnstile.verify(parsed.turnstileToken, ctx.ipHash);
    if (!passed) throw new BotCheckFailedError();
    const stored = await this.deps.repo.insert({
      name: parsed.name,
      email: parsed.email,
      topic: parsed.topic,
      message: parsed.message,
      ipHash: ctx.ipHash,
      createdAt: this.deps.clock.now(),
    });
    await this.deps.queue.enqueue('email.contact', { contactMessageId: stored.id });
    return { contactMessage: { id: stored.id, topic: stored.topic, createdAt: stored.createdAt } };
  }
}
