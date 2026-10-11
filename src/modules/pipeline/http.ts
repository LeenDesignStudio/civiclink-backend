import { isAppError, UpstreamError } from '../../lib/errors.js';
import type { HttpResult } from './types.js';

export async function httpGet(
  url: string,
  init: { maxBytes: number; timeoutMs: number; headers?: Record<string, string> },
): Promise<HttpResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...(init.headers ? { headers: init.headers } : {}),
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new UpstreamError(timedOut ? 'Download timed out.' : undefined, { cause: err });
  }
  const body = await readAtMost(response, init.maxBytes);
  return { status: response.status, body, contentType: response.headers.get('content-type') ?? '' };
}

async function readAtMost(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > maxBytes + 1 ? bytes.slice(0, maxBytes + 1) : bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const limit = maxBytes + 1;
  while (total <= maxBytes) {
    const next = await reader.read();
    if (next.done) break;
    const value = next.value;
    const room = limit - total;
    if (value.byteLength > room) {
      chunks.push(value.slice(0, room));
      total += room;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
