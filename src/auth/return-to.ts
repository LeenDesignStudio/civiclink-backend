import { ValidationError, type FieldError } from '../lib/errors.js';

export const AUTH_INTENTS = [
  'SAVE_LOCATION',
  'FOLLOW',
  'NOTIFICATIONS',
  'REPORT',
  'SUBSCRIBE',
  'SIGN_IN',
] as const;

export type AuthIntent = (typeof AUTH_INTENTS)[number];

const EXACT = new Set(['/card', '/officials', '/offices', '/me', '/pricing']);
const PREFIXES = ['/card/', '/officials/', '/offices/', '/me/', '/pricing/'];

function invalid(path: string, message: string): ValidationError {
  const fieldErrors: FieldError[] = [{ path, code: 'invalid', message }];
  return new ValidationError(message, fieldErrors);
}

export function parseIntent(value: unknown): AuthIntent {
  if (typeof value !== 'string' || !(AUTH_INTENTS as readonly string[]).includes(value)) {
    throw invalid('intent', 'Choose a valid sign-in intent.');
  }
  return value as AuthIntent;
}

function normalizePath(path: string): string | undefined {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('://')) {
    return undefined;
  }
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    if (segment.includes('@') || segment.includes('\\')) return undefined;
    parts.push(segment);
  }
  return `/${parts.join('/')}`;
}

/** Relative allowlisted return path. Rejects open redirects. */
export function assertReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw invalid('returnTo', 'returnTo must be a relative path.');
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw invalid('returnTo', 'returnTo must be a relative path.');
  }
  const hash = decoded.indexOf('#');
  const withoutHash = hash >= 0 ? decoded.slice(0, hash) : decoded;
  const query = withoutHash.indexOf('?');
  const pathPart = query >= 0 ? withoutHash.slice(0, query) : withoutHash;
  const queryPart = query >= 0 ? withoutHash.slice(query) : '';
  const normalized = normalizePath(pathPart);
  if (!normalized) throw invalid('returnTo', 'returnTo must be a relative path.');
  const allowed = EXACT.has(normalized) || PREFIXES.some((prefix) => normalized.startsWith(prefix));
  if (!allowed) throw invalid('returnTo', 'That return path is not allowed.');
  return `${normalized}${queryPart}`;
}

export function residentReturnUrl(
  webUrl: string,
  returnTo: string,
  extras?: { intent: AuthIntent },
): string {
  const base = new URL(webUrl);
  const url = new URL(returnTo, base);
  if (url.origin !== base.origin) {
    throw invalid('returnTo', 'That return path is not allowed.');
  }
  if (extras) {
    url.searchParams.set('intent', extras.intent);
    url.searchParams.set('welcome', '1');
  }
  return url.toString();
}
