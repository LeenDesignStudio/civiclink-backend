import { signLink, verifyLink } from '../../lib/crypto.js';
import type { NotificationCategory } from '../../generated/prisma/enums.js';

export const LINK_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface LinkSecrets {
  secret: string;
  webUrl: string;
}

export function signCategoryLink(
  secret: string,
  kind: 'unsub',
  userId: string,
  category: NotificationCategory,
  expiresAt: Date,
): string {
  return signLink(secret, { k: kind, u: userId, c: category }, expiresAt);
}

export function signDeliveryLink(
  secret: string,
  kind: 'o' | 'c',
  deliveryId: string,
  expiresAt: Date,
  path?: string,
): string {
  const payload: Record<string, string> = { k: kind, d: deliveryId };
  if (path !== undefined) payload.p = path;
  return signLink(secret, payload, expiresAt);
}

export interface UnsubClaims {
  userId: string;
  category: NotificationCategory;
}

export function readUnsub(secret: string, token: string, now: Date): UnsubClaims | undefined {
  const payload = verifyLink(secret, token, now);
  if (!payload || payload.k !== 'unsub') return undefined;
  if (typeof payload.u !== 'string' || (payload.c !== 'ALERTS' && payload.c !== 'UPDATES')) return undefined;
  return { userId: payload.u, category: payload.c };
}

export function readOpen(secret: string, token: string, now: Date): { deliveryId: string } | undefined {
  const payload = verifyLink(secret, token, now);
  if (!payload || payload.k !== 'o' || typeof payload.d !== 'string') return undefined;
  return { deliveryId: payload.d };
}

export function readClick(
  secret: string,
  token: string,
  now: Date,
): { deliveryId: string; path: string } | undefined {
  const payload = verifyLink(secret, token, now);
  if (!payload || payload.k !== 'c' || typeof payload.d !== 'string' || typeof payload.p !== 'string') {
    return undefined;
  }
  return { deliveryId: payload.d, path: payload.p };
}
