export interface RateGate {
  consume(
    key: string,
    limit: number,
    windowMs: number,
    now: Date,
  ): { ok: true } | { ok: false; retryAfterSeconds: number };
}

export class MemoryRateGate implements RateGate {
  private readonly hits = new Map<string, number[]>();

  consume(
    key: string,
    limit: number,
    windowMs: number,
    now: Date,
  ): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const start = now.getTime() - windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > start);
    const oldest = recent[0];
    if (recent.length >= limit && oldest !== undefined) {
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now.getTime()) / 1000));
      return { ok: false, retryAfterSeconds };
    }
    recent.push(now.getTime());
    this.hits.set(key, recent);
    return { ok: true };
  }
}
