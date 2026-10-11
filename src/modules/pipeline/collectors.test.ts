import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../../lib/errors.js';
import { tigerCollector } from './collectors.js';
import type { SourceRow } from './records.js';

const source: SourceRow = {
  id: 'src',
  name: 'Tiger',
  publisher: 'Census',
  url: 'https://example.com/tiger.json',
  termsUrl: 'https://example.com/terms',
  method: 'BULK',
  schedule: 'MONTHLY',
  freshnessDays: 90,
  levels: ['COUNTY'],
  collectorKey: 'tiger.boundaries',
  active: true,
  lastRunAt: null,
  config: {},
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('source fetch', () => {
  it('maps a provider or transport failure to UPSTREAM_UNAVAILABLE', async () => {
    await expect(
      tigerCollector.fetch({
        source,
        maxBytes: 1000,
        fetch: {
          get: () => Promise.resolve({ status: 503, body: new Uint8Array(), contentType: 'text/plain' }),
        },
      }),
    ).rejects.toBeInstanceOf(UpstreamError);
    await expect(
      tigerCollector.fetch({
        source,
        maxBytes: 1000,
        fetch: { get: () => Promise.reject(new Error('network')) },
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
