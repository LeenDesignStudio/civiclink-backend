import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pageCollector } from './collectors.js';
import { createRequestPacer } from './pace.js';
import type { SourceRow } from './records.js';
import { civicLinkUserAgent, type HttpFetcher } from './types.js';

const html = readFileSync(new URL('./fixtures/montgomery-directory.html', import.meta.url), 'utf8');

const source: SourceRow = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Montgomery County Council',
  publisher: 'Montgomery County',
  url: 'https://example.com/council',
  termsUrl: 'https://example.com/terms',
  method: 'PAGE_COLLECTION',
  schedule: 'WEEKLY',
  freshnessDays: 14,
  levels: ['COUNTY'],
  collectorKey: 'page.directory',
  active: true,
  lastRunAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  config: {
    state: 'MD',
    county: 'Montgomery',
    pageUrl: 'https://example.com/council',
    jurisdictionGeoid: '24031',
    officeId: '22222222-2222-4222-8222-222222222222',
    item: { tag: 'article', className: 'official' },
    selectors: {
      name: { tag: 'h2', className: 'name' },
      title: { tag: 'p', className: 'title' },
      phone: { tag: 'a', className: 'phone', attr: 'href' },
      email: { tag: 'a', className: 'email', attr: 'href' },
      address: { tag: 'address', className: 'office' },
    },
  },
};

describe('page.directory', () => {
  it('reads a saved directory page into pending fields and strips markup', async () => {
    const headers: Record<string, string>[] = [];
    const fetch: HttpFetcher = {
      get(_url, init) {
        headers.push(init.headers ?? {});
        const body = _url.endsWith('/council') ? html : 'User-agent: *\nAllow: /';
        return Promise.resolve({ status: 200, body: new TextEncoder().encode(body), contentType: 'text/html' });
      },
    };
    const waits: number[] = [];
    let now = 1_000;
    const snap = await pageCollector.fetch({
      source,
      fetch,
      maxBytes: 5000,
      userAgent: civicLinkUserAgent('hello@qubalink.com'),
      pace: createRequestPacer(1000, {
        now: () => now,
        sleep: (ms) => {
          waits.push(ms);
          now += ms;
          return Promise.resolve();
        },
      }),
    });
    const records = pageCollector.normalise(snap);
    expect(headers[0]?.['user-agent']).toBe('CivicLinkBot/1.0 (+hello@qubalink.com)');
    expect(waits).toEqual([1000]);
    expect(records).toHaveLength(1);
    const office = records[0];
    expect(office?.entityType).toBe('OFFICE');
    expect(office?.entityId).toBe('22222222-2222-4222-8222-222222222222');
    const directory = JSON.parse(office?.fields.directory ?? '{}') as {
      fullName: string;
      title: string;
      phone: string;
      email: string;
      address: string;
      officeName: string;
      jurisdictionGeoid: string;
    };
    expect(directory.fullName).toBe('Jane Smith');
    expect(directory.fullName).not.toContain('<');
    expect(directory.title).toBe('Councilmember');
    expect(directory.officeName).toBe('Councilmember');
    expect(directory.phone).toBe('2407770000');
    expect(directory.email).toBe('jane@example.gov');
    expect(directory.address).toBe('101 Monroe St');
    expect(directory.jurisdictionGeoid).toBe('24031');
  });

  it('does not request a page robots.txt disallows', async () => {
    const calls: string[] = [];
    let waits = 0;
    const snap = await pageCollector.fetch({
      source,
      maxBytes: 5000,
      pace: { wait: () => { waits += 1; return Promise.resolve(); } },
      fetch: {
        get: (url) => {
          calls.push(url);
          return Promise.resolve({
            status: 200,
            body: new TextEncoder().encode('User-agent: *\nDisallow: /council'),
            contentType: 'text/plain',
          });
        },
      },
    });
    expect(snap.skipped).toBe('robots');
    expect(pageCollector.normalise(snap)).toEqual([]);
    expect(calls).toEqual(['https://example.com/robots.txt']);
    expect(waits).toBe(1);
  });
});
