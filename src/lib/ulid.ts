import { randomBytes } from 'node:crypto';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now = Date.now()): string {
  let time = now;
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    const index = time % 32;
    out = (ENCODING[index] ?? '0') + out;
    time = Math.floor(time / 32);
  }
  const bytes = randomBytes(16);
  for (let i = 0; i < 16; i += 1) {
    const byte = bytes[i] ?? 0;
    out += ENCODING[byte % 32] ?? '0';
  }
  return out;
}

export const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
