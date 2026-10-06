import { describe, expect, it } from 'vitest';
import { FakeClock } from './clock.js';
import { FakeRandom } from './random.js';
import { CircuitBreaker, withRetry } from './retry.js';

describe('retry and circuit breaker', () => {
  it('retries retryable failures with jitter and honours Retry-After', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          const error = new Error('upstream') as Error & { retryAfterMs?: number };
          if (calls === 1) error.retryAfterMs = 25;
          throw error;
        }
        return 'ok';
      },
      {
        maxRetries: 3,
        baseDelayMs: 100,
        random: new FakeRandom([0.5]),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        isRetryable: () => true,
        retryAfterMs: (error) =>
          error instanceof Error && 'retryAfterMs' in error
            ? (error as Error & { retryAfterMs?: number }).retryAfterMs
            : undefined,
      },
    );
    expect(result).toBe('ok');
    expect(sleeps[0]).toBe(25);
    expect(sleeps[1]).toBe(100);
  });

  it('opens after five failures and closes after cooldown', async () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00Z'));
    const breaker = new CircuitBreaker(clock, { threshold: 5, cooldownMs: 30_000 });
    const fail = async () => {
      throw new Error('down');
    };
    for (let i = 0; i < 5; i += 1) {
      await expect(breaker.exec(fail)).rejects.toThrow('down');
    }
    expect(breaker.currentState()).toBe('open');
    await expect(breaker.exec(async () => 'nope')).rejects.toThrow('circuit open');
    clock.advance(30_000);
    expect(breaker.currentState()).toBe('half-open');
    await expect(breaker.exec(async () => 'up')).resolves.toBe('up');
    expect(breaker.currentState()).toBe('closed');
  });
});
