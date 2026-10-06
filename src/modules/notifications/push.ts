import { TimeoutError, UpstreamError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  link: string | null;
}

export interface PushSendResult {
  messageId: string | null;
  status: number;
}

export interface PushSender {
  send(message: PushMessage): Promise<PushSendResult>;
}

export interface FetchLike {
  (url: string, init: RequestInit): Promise<Response>;
}

const DEFAULT_TIMEOUT_MS = 8_000;

export class ConsolePushSender implements PushSender {
  readonly sent: PushMessage[] = [];

  send(message: PushMessage): Promise<PushSendResult> {
    this.sent.push(message);
    logger.info({ channel: 'push', titleLength: message.title.length }, 'console push accepted');
    return Promise.resolve({ messageId: `console-push-${this.sent.length}`, status: 200 });
  }
}

export class FcmPushSender implements PushSender {
  constructor(
    private readonly options: {
      fetchFn: FetchLike;
      endpoint: string;
      authorization: string;
      timeoutMs?: number;
    },
  ) {}

  async send(message: PushMessage): Promise<PushSendResult> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let response: Response;
    try {
      response = await this.options.fetchFn(this.options.endpoint, {
        method: 'POST',
        headers: {
          authorization: this.options.authorization,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: message.token,
            notification: { title: message.title, body: message.body },
            ...(message.link ? { data: { link: message.link } } : {}),
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new TimeoutError({ cause: err });
      }
      throw new UpstreamError(undefined, { cause: err });
    }
    if (response.status === 404 || response.status === 410) {
      return { messageId: null, status: response.status };
    }
    if (!response.ok) throw new UpstreamError();
    const body: unknown = await response.json();
    const messageId =
      body && typeof body === 'object' && 'name' in body && typeof body.name === 'string' ? body.name : 'fcm';
    return { messageId, status: response.status };
  }
}
