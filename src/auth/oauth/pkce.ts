import { createHash } from 'node:crypto';

export function pkceS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
