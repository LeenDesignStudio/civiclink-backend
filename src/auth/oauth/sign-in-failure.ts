import { isAppError, OauthFailedError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export const RESIDENT_SIGN_IN_REASONS = [
  'state_cookie_missing',
  'state_mismatch',
  'pkce_missing',
  'token_exchange',
  'id_token_verify',
  'user_upsert',
  'session_create',
  'unknown',
] as const;

export type ResidentSignInReason = (typeof RESIDENT_SIGN_IN_REASONS)[number];

const PROVIDER_ERRORS = [
  'invalid_client',
  'invalid_grant',
  'redirect_uri_mismatch',
  'unauthorized_client',
  'invalid_request',
  'access_denied',
  'unsupported_response_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
] as const;

const CLAIM_DESCRIPTION: Record<string, string> = {
  iss: 'iss mismatch',
  aud: 'aud mismatch',
  nonce: 'nonce mismatch',
  exp: 'exp mismatch',
  iat: 'iat mismatch',
  sub: 'sub mismatch',
  email: 'email mismatch',
  email_verified: 'email_verified mismatch',
  id_token: 'id token missing',
};


export function requestHost(host: string | undefined): string {
  if (host && /^(?:[A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\])(?::\d{1,5})?$/.test(host) && host.length <= 255) {
    return host;
  }
  return 'unknown';
}

export function residentOauthFailure(
  reason: ResidentSignInReason,
  extra?: { cause?: unknown; providerError?: string; providerErrorDescription?: string },
): OauthFailedError {
  const details: Record<string, unknown> = { reason };
  if (extra?.providerError) details.providerError = extra.providerError;
  if (extra?.providerErrorDescription) details.providerErrorDescription = extra.providerErrorDescription;
  return new OauthFailedError({
    ...(extra?.cause !== undefined ? { cause: extra.cause } : {}),
    details,
  });
}

export function tokenExchangeFailure(err: unknown): OauthFailedError {
  const provider = readProviderFailure(err);
  const reason = looksLikePkce(err, provider.providerErrorDescription) ? 'pkce_missing' : 'token_exchange';
  return residentOauthFailure(reason, {
    cause: err,
    ...(provider.providerError ? { providerError: provider.providerError } : {}),
    ...(provider.providerErrorDescription ? { providerErrorDescription: provider.providerErrorDescription } : {}),
  });
}

export function idTokenFailure(claim: string, cause?: unknown): OauthFailedError {
  const providerErrorDescription = CLAIM_DESCRIPTION[claim] ?? 'id token rejected';
  return residentOauthFailure('id_token_verify', {
    ...(cause !== undefined ? { cause } : {}),
    providerErrorDescription,
  });
}

export function callbackFailure(input: {
  providerError?: string | undefined;
  providerErrorDescription?: string | undefined;
  hasCookie: boolean;
  hasState: boolean;
}): OauthFailedError {
  const providerError = normalizeProviderError(input.providerError);
  const providerErrorDescription = safeDescription(input.providerErrorDescription);
  let reason: ResidentSignInReason = 'unknown';
  if (!providerError) {
    reason = input.hasCookie ? (input.hasState ? 'unknown' : 'state_mismatch') : 'state_cookie_missing';
  }
  return residentOauthFailure(reason, {
    ...(providerError ? { providerError } : {}),
    ...(providerErrorDescription ? { providerErrorDescription } : {}),
  });
}

export function logResidentSignInFailure(input: {
  requestId: string;
  err: unknown;
  redirectUri: string;
  host: string;
}): void {
  const described = describeResidentSignInFailure(input.err);
  const payload: Record<string, string> = {
    reason: described.reason,
    redirectUri: input.redirectUri,
    host: input.host,
    errorName: described.errorName,
    errorMessage: described.errorMessage,
  };
  if (described.providerError) payload.providerError = described.providerError;
  if (described.providerErrorDescription) payload.providerErrorDescription = described.providerErrorDescription;
  logger.warn({ requestId: input.requestId, ...payload }, 'resident sign-in failed');
}

export function describeResidentSignInFailure(err: unknown): {
  reason: ResidentSignInReason;
  errorName: string;
  errorMessage: string;
  providerError?: string;
  providerErrorDescription?: string;
} {
  const reason = classifyReason(err);
  const provider = providerFields(err, reason);
  const underlying = underlyingError(err);
  const described: {
    reason: ResidentSignInReason;
    errorName: string;
    errorMessage: string;
    providerError?: string;
    providerErrorDescription?: string;
  } = {
    reason,
    errorName: safeName(underlying),
    errorMessage: safeMessage(underlying),
  };
  if (provider.providerError) described.providerError = provider.providerError;
  if (provider.providerErrorDescription) described.providerErrorDescription = provider.providerErrorDescription;
  return described;
}

function classifyReason(err: unknown): ResidentSignInReason {
  const raw = detailString(err, 'reason');
  const provider = readProviderFailure(err);
  const description = detailString(err, 'providerErrorDescription') ?? provider.providerErrorDescription;
  if (raw === 'pkce_missing' || (raw === 'token_exchange' && looksLikePkce(err, description))) return 'pkce_missing';
  if (raw && isResidentReason(raw)) return raw;
  if (raw === 'state') return 'state_mismatch';
  if (raw === 'token_exchange') return 'token_exchange';
  if (raw && raw in CLAIM_DESCRIPTION) return 'id_token_verify';
  if (looksLikePkce(err, description)) return 'pkce_missing';
  return 'unknown';
}

function providerFields(
  err: unknown,
  reason: ResidentSignInReason,
): { providerError?: string; providerErrorDescription?: string } {
  const fromCause = readProviderFailure(err);
  const providerError = normalizeProviderError(detailString(err, 'providerError')) ?? fromCause.providerError;
  const described =
    safeDescription(detailString(err, 'providerErrorDescription')) ??
    fromCause.providerErrorDescription ??
    (reason === 'id_token_verify' ? claimDescription(detailString(err, 'reason')) : undefined);
  return {
    ...(providerError ? { providerError } : {}),
    ...(described ? { providerErrorDescription: described } : {}),
  };
}

function claimDescription(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  return CLAIM_DESCRIPTION[reason];
}

function readProviderFailure(err: unknown): { providerError?: string; providerErrorDescription?: string } {
  const seen = new Set<unknown>();
  let current: unknown = err;
  let message: string | undefined;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) message = current.message;
    const record = current as Record<string, unknown>;
    const providerError =
      normalizeProviderError(stringField(record, 'error')) ?? normalizeProviderError(stringField(record, 'code'));
    const providerErrorDescription = safeDescription(stringField(record, 'error_description'));
    if (providerError || providerErrorDescription) {
      return {
        ...(providerError ? { providerError } : {}),
        ...(providerErrorDescription ? { providerErrorDescription } : {}),
      };
    }
    current = record.cause;
  }
  const fromMessage = normalizeProviderError(message);
  return fromMessage ? { providerError: fromMessage } : {};
}

function looksLikePkce(err: unknown, description: string | undefined): boolean {
  const message = err instanceof Error ? err.message : '';
  const causeMessage = err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
  return /code_verifier|code verifier|\bpkce\b/i.test(`${description ?? ''} ${message} ${causeMessage}`);
}

function underlyingError(err: unknown): unknown {
  if (err instanceof Error && err.cause instanceof Error && err.name === 'OauthFailedError') return err.cause;
  return err;
}

function safeName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  const name = err.name.replace(/[^\w.]/g, '').slice(0, 80);
  return name.length > 0 ? name : 'Error';
}

function safeMessage(err: unknown): string {
  if (err instanceof Error && err.name === 'ZodError') return 'Invalid callback query';
  if (!(err instanceof Error) || err.message.trim().length === 0) return 'Sign-in failed';
  return redact(err.message);
}

function redact(value: string): string {
  const secretParam = /(?:code_verifier|id_token|access_token|refresh_token|client_secret|cookie|code)=([^&\s]+)/gi;
  const cleaned = value
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(secretParam, (match) => `${match.slice(0, match.indexOf('='))}=[redacted]`)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]')
    .replace(/[\r\n]/g, ' ')
    .trim()
    .slice(0, 300);
  return cleaned.length > 0 ? cleaned : 'Sign-in failed';
}

function safeDescription(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const known = normalizeProviderError(value);
  if (known && value.trim().toLowerCase() === known) return known;
  const cleaned = redact(value);
  if (cleaned === 'Sign-in failed' || cleaned === '[redacted]') return undefined;
  return cleaned.slice(0, 180);
}

function normalizeProviderError(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  return PROVIDER_ERRORS.find((code) => lower === code || new RegExp(`\\b${code}\\b`).test(lower));
}

function detailString(err: unknown, key: string): string | undefined {
  if (!isAppError(err)) return undefined;
  const value = err.details?.[key];
  return typeof value === 'string' ? value : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function isResidentReason(value: string): value is ResidentSignInReason {
  return (RESIDENT_SIGN_IN_REASONS as readonly string[]).includes(value);
}
