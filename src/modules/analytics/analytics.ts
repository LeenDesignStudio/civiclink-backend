const EMAIL_VALUE = /@/;
const STREET_VALUE =
  /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl)\b/i;

export type AnalyticsValue = string | number | boolean;

export interface Analytics {
  track(distinctId: string, event: string, properties: Record<string, unknown>): Promise<void>;
}

export interface AnalyticsCapture {
  distinctId: string;
  event: string;
  properties: Record<string, AnalyticsValue>;
}

export function sanitizeProperties(properties: Record<string, unknown>): Record<string, AnalyticsValue> {
  const out: Record<string, AnalyticsValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === 'string') {
      if (EMAIL_VALUE.test(value) || STREET_VALUE.test(value)) continue;
      out[key] = value;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

export class FakeAnalytics implements Analytics {
  readonly events: AnalyticsCapture[] = [];

  track(distinctId: string, event: string, properties: Record<string, unknown>): Promise<void> {
    this.events.push({ distinctId, event, properties: sanitizeProperties(properties) });
    return Promise.resolve();
  }
}

export interface FetchLike {
  (url: string, init: RequestInit): Promise<Response>;
}

export class PostHogAnalytics implements Analytics {
  constructor(
    private readonly options: {
      fetchFn: FetchLike;
      apiKey: string;
      host: string;
      timeoutMs?: number;
    },
  ) {}

  async track(distinctId: string, event: string, properties: Record<string, unknown>): Promise<void> {
    if (!this.options.apiKey) return;
    const safe = sanitizeProperties(properties);
    const host = this.options.host.replace(/\/$/, '');
    await this.options.fetchFn(`${host}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: this.options.apiKey,
        event,
        distinct_id: distinctId,
        properties: safe,
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
    });
  }
}
