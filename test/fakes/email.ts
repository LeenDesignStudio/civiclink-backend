import type { EmailMessage, EmailSender } from '../../src/modules/notifications/email.js';

export class FakeEmail implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failNext = false;

  send(message: EmailMessage): Promise<{ messageId: string }> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('email down'));
    }
    this.sent.push(message);
    return Promise.resolve({ messageId: `fake-email-${this.sent.length}` });
  }
}
