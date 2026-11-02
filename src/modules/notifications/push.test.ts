import { describe, expect, it } from 'vitest';
import { readWebPushSubscription } from './push.js';

describe('readWebPushSubscription', () => {
  it('accepts a browser subscription and ignores other tokens', () => {
    const subscription = {
      endpoint: 'https://push.example/send/1',
      keys: { p256dh: 'key', auth: 'auth' },
    };
    expect(readWebPushSubscription(JSON.stringify(subscription))?.endpoint).toBe(subscription.endpoint);
    expect(readWebPushSubscription('fcm-token')).toBeNull();
    expect(readWebPushSubscription('{"endpoint":"http://insecure"}')).toBeNull();
  });
});
