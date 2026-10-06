import { describe, expect, it } from 'vitest';
import { FakeAnalytics, PostHogAnalytics, sanitizeProperties } from './analytics.js';
import { ANALYTICS_EVENTS } from './events.js';

const EMAIL = /@/;
const STREET =
  /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl)\b/i;

describe('analytics properties', () => {
  it('never keeps an email or street address', async () => {
    const fake = new FakeAnalytics();
    for (const built of ANALYTICS_EVENTS) {
      await fake.track('user-1', built.name, {
        ...built.properties,
        leakedEmail: 'resident@example.com',
        leakedStreet: '123 Main Street',
      });
    }
    for (const captured of fake.events) {
      for (const value of Object.values(captured.properties)) {
        if (typeof value !== 'string') continue;
        expect(value).not.toMatch(EMAIL);
        expect(value).not.toMatch(STREET);
      }
    }
    expect(sanitizeProperties({ email: 'a@b.co', street: '9 Oak Avenue', zip: '10001' })).toEqual({
      zip: '10001',
    });
  });

  it('posts a stripped payload', async () => {
    const calls: { url: string; body: string }[] = [];
    const client = new PostHogAnalytics({
      apiKey: 'ph',
      host: 'https://analytics.example',
      fetchFn: (url, init) => {
        calls.push({ url, body: String(init.body) });
        return Promise.resolve(new Response('{}', { status: 200 }));
      },
    });
    await client.track('user-1', 'login', { provider: 'GOOGLE', email: 'a@b.co' });
    const body = calls[0]?.body ?? '';
    expect(body).not.toMatch(EMAIL);
    expect(calls[0]?.url).toBe('https://analytics.example/capture/');
  });
});
