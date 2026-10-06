import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeClock } from './clock.js';
import { isAppError } from './errors.js';
import { MemoryRateGate, OPERATION_RATES, RATE_CLASSES } from './rate-limit.js';

const RATE_NAMES = new Set<string>(RATE_CLASSES);

function rateClass(cell: string): string | null {
  const cleaned = cell.replace(/`/g, '').trim();
  if (cleaned === '' || cleaned === '—' || cleaned === '-') return null;
  if (cleaned.startsWith('mutation (3/hour)')) return 'test_notification';
  const head = cleaned.split(/\s+/)[0] ?? cleaned;
  return RATE_NAMES.has(head) ? head : null;
}

function ratedOperations(markdown: string): { name: string; rate: string }[] {
  const found: { name: string; rate: string }[] = [];
  let rateIndex = -1;
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) {
      rateIndex = -1;
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.includes('Rate')) {
      rateIndex = cells.indexOf('Rate');
      continue;
    }
    if (rateIndex < 0 || cells.every((cell) => /^[-:]+$/.test(cell))) continue;
    const rate = rateClass(cells[rateIndex] ?? '');
    if (!rate) continue;
    const names = [...(cells[0] ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
    for (const raw of names) {
      const query = raw.indexOf('?');
      const name = (query === -1 ? raw : raw.slice(0, query)).trim();
      if (name.length > 0) found.push({ name, rate });
    }
  }
  return found;
}

describe('rate limits', () => {
  it('rejects the 31st lookup in the window', async () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const gate = new MemoryRateGate(clock);
    for (let i = 0; i < 30; i += 1) {
      await gate.consume('lookup', 'ip');
    }
    await expect(gate.consume('lookup', 'ip')).rejects.toSatisfy((error: unknown) => {
      return (
        isAppError(error) &&
        error.code === 'RATE_LIMITED' &&
        'retryAfterSeconds' in error &&
        typeof error.retryAfterSeconds === 'number' &&
        error.retryAfterSeconds > 0
      );
    });
  });

  it('wires every docs/05 operation that names a rate class', () => {
    const markdown = readFileSync(new URL('../../docs/05-API-OPERATIONS.md', import.meta.url), 'utf8');
    const operations = ratedOperations(markdown);
    expect(operations.length).toBeGreaterThan(10);
    for (const operation of operations) {
      expect(OPERATION_RATES[operation.name], operation.name).toBe(operation.rate);
    }
  });
});
