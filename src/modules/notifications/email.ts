import { TimeoutError, UpstreamError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ messageId: string }>;
}

export interface FetchLike {
  (url: string, init: RequestInit): Promise<Response>;
}

const DEFAULT_TIMEOUT_MS = 8_000;

export class ConsoleEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<{ messageId: string }> {
    this.sent.push(message);
    logger.info({ channel: 'email', subjectLength: message.subject.length }, 'console email accepted');
    return Promise.resolve({ messageId: `console-email-${this.sent.length}` });
  }
}

export class SesEmailSender implements EmailSender {
  constructor(
    private readonly options: {
      fetchFn: FetchLike;
      endpoint: string;
      from: string;
      timeoutMs?: number;
      headers?: Record<string, string>;
    },
  ) {}

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const headers = new Headers(this.options.headers);
    headers.set('content-type', 'application/json');
    let response: Response;
    try {
      response = await this.options.fetchFn(this.options.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          FromEmailAddress: this.options.from,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: 'UTF-8' },
              Body: {
                Text: { Data: message.text, Charset: 'UTF-8' },
                Html: { Data: message.html, Charset: 'UTF-8' },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) throw new TimeoutError({ cause: err });
      throw new UpstreamError(undefined, { cause: err });
    }
    if (!response.ok) throw new UpstreamError();
    const body: unknown = await response.json();
    const messageId =
      body && typeof body === 'object' && 'MessageId' in body && typeof body.MessageId === 'string'
        ? body.MessageId
        : 'ses';
    return { messageId };
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}
