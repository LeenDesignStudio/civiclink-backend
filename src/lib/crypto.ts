import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../config/env.js';

const VERSION = 1;

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256Hex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function hashIp(ip: string, secret: string = env.IP_HASH_SECRET): string {
  return hmacSha256Hex(secret, ip);
}

export interface EncryptedJson {
  v: number;
  exp: number;
  payload: unknown;
}

function keyBuffer(key: Buffer): Buffer {
  if (key.length !== 32) throw new Error('AES-256-GCM key must be 32 bytes');
  return key;
}

/** AES-256-GCM envelope. Expiry is authenticated via AAD. */
export function encryptJson(key: Buffer, payload: unknown, expiresAt: Date): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer(key), iv);
  const exp = expiresAt.getTime();
  const aad = Buffer.from(`v${VERSION}.${exp}`);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const expBuf = Buffer.alloc(8);
  expBuf.writeBigUInt64BE(BigInt(exp));
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, expBuf, ciphertext]).toString('base64url');
}

export function decryptJson(key: Buffer, token: string, now: Date = new Date()): unknown {
  const buf = Buffer.from(token, 'base64url');
  if (buf.length < 1 + 12 + 16 + 8) throw new Error('malformed');
  const version = buf[0];
  if (version !== VERSION) throw new Error('unsupported version');
  const iv = buf.subarray(1, 13);
  const tag = buf.subarray(13, 29);
  const exp = Number(buf.readBigUInt64BE(29));
  const ciphertext = buf.subarray(37);
  if (now.getTime() > exp) throw new Error('expired');
  const decipher = createDecipheriv('aes-256-gcm', keyBuffer(key), iv);
  decipher.setAAD(Buffer.from(`v${VERSION}.${exp}`));
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(json) as unknown;
}

export interface SignedLinkPayload {
  exp: number;
  [key: string]: string | number;
}

export function signLink(
  secret: string,
  payload: Record<string, string>,
  expiresAt: Date,
): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: expiresAt.getTime() }),
    'utf8',
  ).toString('base64url');
  const sig = hmacSha256Hex(secret, body);
  return `${body}.${sig}`;
}

export function verifyLink(
  secret: string,
  token: string,
  now: Date = new Date(),
): SignedLinkPayload | undefined {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmacSha256Hex(secret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || !('exp' in parsed)) return undefined;
  const record = parsed as SignedLinkPayload;
  if (typeof record.exp !== 'number' || now.getTime() > record.exp) return undefined;
  return record;
}
