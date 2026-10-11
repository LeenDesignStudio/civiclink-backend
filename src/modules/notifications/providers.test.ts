import { describe, expect, it } from 'vitest';
import { SesEmailSender } from './email.js';
import { FcmPushSender } from './push.js';

describe('provider failures', () => {
  it('reports an email provider failure as UPSTREAM_UNAVAILABLE and sends Reply-To', async () => {
    const bodies: string[] = [];
    const sender = new SesEmailSender({
      fetchFn: (_url, init) => {
        bodies.push(typeof init.body === 'string' ? init.body : '');
        return Promise.resolve(new Response('no', { status: 503 }));
      },
      endpoint: 'https://email.example/v2/email/outbound-emails',
      from: 'CivicLink <no-reply@civiclink.com>',
    });
    await expect(
      sender.send({
        to: 'hello@qubalink.com',
        replyTo: 'ada@example.com',
        subject: 'CivicLink contact: GENERAL',
        text: 'Hello',
        html: '<p>Hello</p>',
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(bodies[0]).toContain('"ReplyToAddresses":["ada@example.com"]');
  });

  it('reports a push provider failure as UPSTREAM_UNAVAILABLE', async () => {
    const sender = new FcmPushSender({
      fetchFn: () => Promise.resolve(new Response('no', { status: 503 })),
      endpoint: 'https://fcm.example/send',
      authorization: 'Bearer test',
    });
    await expect(
      sender.send({ token: 'device', title: 'Hello', body: 'There', link: null }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
