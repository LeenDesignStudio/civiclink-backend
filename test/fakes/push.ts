import type { PushMessage, PushSender, PushSendResult } from '../../src/modules/notifications/push.js';

export class FakePush implements PushSender {
  readonly sent: PushMessage[] = [];
  status = 200;

  send(message: PushMessage): Promise<PushSendResult> {
    this.sent.push(message);
    return Promise.resolve({
      messageId: this.status === 200 ? `fake-push-${this.sent.length}` : null,
      status: this.status,
    });
  }
}
