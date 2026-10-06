import type { Clock } from './clock.js';
import type { RandomSource } from './random.js';
import { systemClock } from './clock.js';
import { systemRandom } from './random.js';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  capDelayMs?: number;
  clock?: Clock;
  random?: RandomSource;
  sleep?: (ms: number) => Promise<void>;
  isRetryable: (error: unknown) => boolean;
  retryAfterMs?: (error: unknown) => number | undefined;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const base = options.baseDelayMs ?? 100;
  const cap = options.capDelayMs ?? 2_000;
  const random = options.random ?? systemRandom;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= options.maxRetries || !options.isRetryable(error)) throw error;
      const retryAfter = options.retryAfterMs?.(error);
      const exponential = Math.min(cap, base * 2 ** attempt);
      const jittered = Math.floor(random.float() * exponential);
      const delay = retryAfter !== undefined ? retryAfter : jittered;
      await sleep(delay);
      attempt += 1;
    }
  }
}

export type BreakerState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private failures = 0;
  private state: BreakerState = 'closed';
  private openedAt = 0;
  readonly threshold: number;
  readonly cooldownMs: number;

  constructor(
    private readonly clock: Clock = systemClock,
    options?: { threshold?: number; cooldownMs?: number },
  ) {
    this.threshold = options?.threshold ?? 5;
    this.cooldownMs = options?.cooldownMs ?? 30_000;
  }

  currentState(): BreakerState {
    if (this.state === 'open' && this.clock.now().getTime() - this.openedAt >= this.cooldownMs) {
      this.state = 'half-open';
    }
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.currentState();
    if (state === 'open') {
      throw new Error('circuit open');
    }
    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'closed';
      return result;
    } catch (error) {
      this.failures += 1;
      if (state === 'half-open' || this.failures >= this.threshold) {
        this.state = 'open';
        this.openedAt = this.clock.now().getTime();
      }
      throw error;
    }
  }
}
