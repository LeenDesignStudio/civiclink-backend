import { z } from 'zod';

export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION',
  'UNAUTHENTICATED',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RELATED_RECORD_MISSING',
  'TRY_AGAIN',
  'INVALID_STATE',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'DATABASE_UNAVAILABLE',
  'TIMEOUT',
  'INTERNAL',
  'TERMS_REQUIRED',
  'TERMS_VERSION_MISMATCH',
  'ACCOUNT_PENDING_DELETION',
  'ACCOUNT_DELETED',
  'NOT_PENDING_DELETION',
  'OAUTH_FAILED',
  'ADMIN_NOT_ALLOWED',
  'ADMIN_LOCKED',
  'SELF_ROLE_CHANGE',
  'LAST_SUPER_ADMIN',
  'BOT_CHECK_FAILED',
  'LOCATION_NOT_FOUND',
  'LOCATION_OUTSIDE_US',
  'CANDIDATE_EXPIRED',
  'LOOKUP_NOT_FOUND',
  'GEOCODER_UNAVAILABLE',
  'LOCATION_LABEL_TAKEN',
  'SAVED_LOCATION_LIMIT',
  'FOLLOW_LIMIT',
  'IN_APP_LOCKED',
  'DUPLICATE_CORRECTION',
  'CORRECTION_DAILY_LIMIT',
  'ALREADY_SUBSCRIBED',
  'NO_BILLING_ACCOUNT',
  'BILLING_UNAVAILABLE',
  'JURISDICTION_CYCLE',
  'HAS_ACTIVE_CHILDREN',
  'HAS_CURRENT_TERM',
  'UNKNOWN_COLLECTOR',
  'RUN_IN_PROGRESS',
  'SOURCE_INACTIVE',
  'ALREADY_DECIDED',
  'ALERT_ALREADY_SENT',
  'RECIPIENTS_CHANGED',
  'NO_RECIPIENTS',
  'EXPORT_TOO_LARGE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type LogLevel = 'info' | 'warn' | 'error';

export interface CodeMeta {
  httpStatus: number;
  defaultMessage: string;
  expose: boolean;
  retryable: boolean;
  logLevel: LogLevel;
}

const UPSTREAM_MESSAGE = 'A service we depend on is unavailable. Try again shortly.';

export const CODE_META: Record<ErrorCode, CodeMeta> = {
  BAD_REQUEST: {
    httpStatus: 400,
    defaultMessage: 'The request is malformed.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  VALIDATION: {
    httpStatus: 400,
    defaultMessage: 'Some fields need attention.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  UNAUTHENTICATED: {
    httpStatus: 401,
    defaultMessage: 'Please sign in to continue.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  SESSION_EXPIRED: {
    httpStatus: 401,
    defaultMessage: 'Your session expired. Please sign in again.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  SESSION_REVOKED: {
    httpStatus: 401,
    defaultMessage: 'You were signed out. Please sign in again.',
    expose: true,
    retryable: false,
    logLevel: 'warn',
  },
  FORBIDDEN: {
    httpStatus: 403,
    defaultMessage: "You don't have access to this.",
    expose: true,
    retryable: false,
    logLevel: 'warn',
  },
  NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: "We couldn't find that.",
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  CONFLICT: {
    httpStatus: 409,
    defaultMessage: 'That conflicts with existing data.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  RELATED_RECORD_MISSING: {
    httpStatus: 409,
    defaultMessage: 'A related record no longer exists.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  TRY_AGAIN: {
    httpStatus: 409,
    defaultMessage: 'Please try that again.',
    expose: true,
    retryable: true,
    logLevel: 'warn',
  },
  INVALID_STATE: {
    httpStatus: 409,
    defaultMessage: "This can't be done in its current state.",
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  RATE_LIMITED: {
    httpStatus: 429,
    defaultMessage: 'Too many requests. Please wait a moment.',
    expose: true,
    retryable: true,
    logLevel: 'warn',
  },
  UPSTREAM_UNAVAILABLE: {
    httpStatus: 503,
    defaultMessage: UPSTREAM_MESSAGE,
    expose: false,
    retryable: true,
    logLevel: 'error',
  },
  DATABASE_UNAVAILABLE: {
    httpStatus: 503,
    defaultMessage: UPSTREAM_MESSAGE,
    expose: false,
    retryable: true,
    logLevel: 'error',
  },
  TIMEOUT: {
    httpStatus: 503,
    defaultMessage: UPSTREAM_MESSAGE,
    expose: false,
    retryable: true,
    logLevel: 'error',
  },
  INTERNAL: {
    httpStatus: 500,
    defaultMessage: 'Something went wrong.',
    expose: false,
    retryable: false,
    logLevel: 'error',
  },
  TERMS_REQUIRED: {
    httpStatus: 403,
    defaultMessage: 'Please accept the Terms to continue.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  TERMS_VERSION_MISMATCH: {
    httpStatus: 409,
    defaultMessage: 'The Terms were updated. Please review them again.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  ACCOUNT_PENDING_DELETION: {
    httpStatus: 403,
    defaultMessage: 'Your account is scheduled for deletion. Restore it to continue.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  ACCOUNT_DELETED: {
    httpStatus: 403,
    defaultMessage: 'This account has been deleted.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  NOT_PENDING_DELETION: {
    httpStatus: 409,
    defaultMessage: "Your account isn't scheduled for deletion.",
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  OAUTH_FAILED: {
    httpStatus: 400,
    defaultMessage: "Sign-in didn't complete. Please try again.",
    expose: true,
    retryable: false,
    logLevel: 'warn',
  },
  ADMIN_NOT_ALLOWED: {
    httpStatus: 403,
    defaultMessage: "This account doesn't have admin access.",
    expose: true,
    retryable: false,
    logLevel: 'warn',
  },
  ADMIN_LOCKED: {
    httpStatus: 423,
    defaultMessage: 'Too many attempts. Try again in 15 minutes.',
    expose: true,
    retryable: false,
    logLevel: 'warn',
  },
  SELF_ROLE_CHANGE: {
    httpStatus: 409,
    defaultMessage: "You can't change your own role or status.",
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  LAST_SUPER_ADMIN: {
    httpStatus: 409,
    defaultMessage: 'At least one Super Admin must remain active.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  BOT_CHECK_FAILED: {
    httpStatus: 400,
    defaultMessage: 'Please complete the verification and try again.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  LOCATION_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: "We couldn't find that location. Check the spelling or try a ZIP code.",
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  LOCATION_OUTSIDE_US: {
    httpStatus: 422,
    defaultMessage: 'CivicLink covers U.S. locations only.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  CANDIDATE_EXPIRED: {
    httpStatus: 410,
    defaultMessage: 'That choice expired. Please search again.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  LOOKUP_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'This lookup has expired. Search again.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  GEOCODER_UNAVAILABLE: {
    httpStatus: 503,
    defaultMessage: "We couldn't look up locations right now. Try again shortly.",
    expose: true,
    retryable: true,
    logLevel: 'error',
  },
  LOCATION_LABEL_TAKEN: {
    httpStatus: 409,
    defaultMessage: 'You already have a location labelled {label}.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  SAVED_LOCATION_LIMIT: {
    httpStatus: 409,
    defaultMessage: 'You can save up to {n} locations. Remove one to add another.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  FOLLOW_LIMIT: {
    httpStatus: 409,
    defaultMessage: 'You can follow up to {n} offices.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  IN_APP_LOCKED: {
    httpStatus: 400,
    defaultMessage: "In-app notifications can't be turned off.",
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  DUPLICATE_CORRECTION: {
    httpStatus: 409,
    defaultMessage: "You've already reported this — we're reviewing it.",
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  CORRECTION_DAILY_LIMIT: {
    httpStatus: 429,
    defaultMessage: "You've reached today's limit for reports.",
    expose: true,
    retryable: true,
    logLevel: 'warn',
  },
  ALREADY_SUBSCRIBED: {
    httpStatus: 409,
    defaultMessage: 'You already have a subscription. Manage it from Billing.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  NO_BILLING_ACCOUNT: {
    httpStatus: 409,
    defaultMessage: "You don't have a billing account yet.",
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  BILLING_UNAVAILABLE: {
    httpStatus: 503,
    defaultMessage: 'Billing is unavailable right now. Try again shortly.',
    expose: true,
    retryable: true,
    logLevel: 'error',
  },
  JURISDICTION_CYCLE: {
    httpStatus: 400,
    defaultMessage: "A jurisdiction can't be its own ancestor.",
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  HAS_ACTIVE_CHILDREN: {
    httpStatus: 409,
    defaultMessage: 'Retire or move its active offices first.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  HAS_CURRENT_TERM: {
    httpStatus: 409,
    defaultMessage: "End this official's current term first.",
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  UNKNOWN_COLLECTOR: {
    httpStatus: 400,
    defaultMessage: 'Unknown collector key.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  RUN_IN_PROGRESS: {
    httpStatus: 409,
    defaultMessage: 'A refresh is already running for this source.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  SOURCE_INACTIVE: {
    httpStatus: 409,
    defaultMessage: 'Activate the source before refreshing it.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  ALREADY_DECIDED: {
    httpStatus: 409,
    defaultMessage: 'This change was already decided.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  ALERT_ALREADY_SENT: {
    httpStatus: 409,
    defaultMessage: "This alert was already sent and can't be changed.",
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  RECIPIENTS_CHANGED: {
    httpStatus: 409,
    defaultMessage: 'The number of recipients changed. Review and confirm again.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  NO_RECIPIENTS: {
    httpStatus: 409,
    defaultMessage: 'Nobody follows this office yet.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
  EXPORT_TOO_LARGE: {
    httpStatus: 413,
    defaultMessage: 'Narrow your filters — exports are limited to 50,000 rows.',
    expose: true,
    retryable: false,
    logLevel: 'info',
  },
};

export interface FieldError {
  path: string;
  code: string;
  message: string;
}

export interface AppErrorOptions {
  cause?: unknown;
  details?: Record<string, unknown>;
}

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options?: AppErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    if (options?.details) this.details = options.details;
  }

  get httpStatus(): number {
    return CODE_META[this.code].httpStatus;
  }

  get expose(): boolean {
    return CODE_META[this.code].expose;
  }

  get retryable(): boolean {
    return CODE_META[this.code].retryable;
  }

  get logLevel(): LogLevel {
    return CODE_META[this.code].logLevel;
  }

  clientMessage(): string {
    return this.expose ? this.message : CODE_META[this.code].defaultMessage;
  }
}

export class ValidationError extends AppError {
  readonly code: ErrorCode = 'VALIDATION';
  readonly fieldErrors: FieldError[];

  constructor(message: string, fieldErrors: FieldError[] = [], options?: AppErrorOptions) {
    super(message, { ...options, details: { ...options?.details, fieldErrors } });
    this.fieldErrors = fieldErrors;
  }
}

export class UnauthenticatedError extends AppError {
  readonly code: ErrorCode = 'UNAUTHENTICATED';
  constructor(message = CODE_META.UNAUTHENTICATED.defaultMessage, options?: AppErrorOptions) {
    super(message, options);
  }
}

export class SessionExpiredError extends UnauthenticatedError {
  override readonly code = 'SESSION_EXPIRED' as const;
  constructor(options?: AppErrorOptions) {
    super(CODE_META.SESSION_EXPIRED.defaultMessage, options);
  }
}

export class SessionRevokedError extends UnauthenticatedError {
  override readonly code = 'SESSION_REVOKED' as const;
  constructor(options?: AppErrorOptions) {
    super(CODE_META.SESSION_REVOKED.defaultMessage, options);
  }
}

export class OauthFailedError extends UnauthenticatedError {
  override readonly code = 'OAUTH_FAILED' as const;
  constructor(options?: AppErrorOptions) {
    super(CODE_META.OAUTH_FAILED.defaultMessage, options);
  }
}

export class ForbiddenError extends AppError {
  readonly code: ErrorCode = 'FORBIDDEN';
  constructor(message = CODE_META.FORBIDDEN.defaultMessage, options?: AppErrorOptions) {
    super(message, options);
  }
}

export class TermsRequiredError extends ForbiddenError {
  override readonly code = 'TERMS_REQUIRED' as const;
  constructor() {
    super(CODE_META.TERMS_REQUIRED.defaultMessage);
  }
}

export class AccountPendingDeletionError extends ForbiddenError {
  override readonly code = 'ACCOUNT_PENDING_DELETION' as const;
  constructor() {
    super(CODE_META.ACCOUNT_PENDING_DELETION.defaultMessage);
  }
}

export class AccountDeletedError extends ForbiddenError {
  override readonly code = 'ACCOUNT_DELETED' as const;
  constructor() {
    super(CODE_META.ACCOUNT_DELETED.defaultMessage);
  }
}

export class AdminNotAllowedError extends ForbiddenError {
  override readonly code = 'ADMIN_NOT_ALLOWED' as const;
  constructor() {
    super(CODE_META.ADMIN_NOT_ALLOWED.defaultMessage);
  }
}

export class AdminLockedError extends ForbiddenError {
  override readonly code = 'ADMIN_LOCKED' as const;
  constructor() {
    super(CODE_META.ADMIN_LOCKED.defaultMessage);
  }
}

export class NotFoundError extends AppError {
  readonly code: ErrorCode = 'NOT_FOUND';
  constructor(message = CODE_META.NOT_FOUND.defaultMessage, options?: AppErrorOptions) {
    super(message, options);
  }
}

export class LocationNotFoundError extends NotFoundError {
  override readonly code = 'LOCATION_NOT_FOUND' as const;
  constructor() {
    super(CODE_META.LOCATION_NOT_FOUND.defaultMessage);
  }
}

export class CandidateExpiredError extends NotFoundError {
  override readonly code = 'CANDIDATE_EXPIRED' as const;
  constructor() {
    super(CODE_META.CANDIDATE_EXPIRED.defaultMessage);
  }
}

export class LookupNotFoundError extends NotFoundError {
  override readonly code = 'LOOKUP_NOT_FOUND' as const;
  constructor() {
    super(CODE_META.LOOKUP_NOT_FOUND.defaultMessage);
  }
}

export class ConflictError extends AppError {
  readonly code: ErrorCode = 'CONFLICT';
  constructor(message = CODE_META.CONFLICT.defaultMessage, options?: AppErrorOptions) {
    super(message, options);
  }
}

export class RelatedRecordMissingError extends ConflictError {
  override readonly code = 'RELATED_RECORD_MISSING' as const;
  constructor(options?: AppErrorOptions) {
    super(CODE_META.RELATED_RECORD_MISSING.defaultMessage, options);
  }
}

export class TryAgainError extends ConflictError {
  override readonly code = 'TRY_AGAIN' as const;
  constructor() {
    super(CODE_META.TRY_AGAIN.defaultMessage);
  }
}

export class PreconditionError extends ConflictError {
  override readonly code = 'INVALID_STATE' as const;
  constructor(message = CODE_META.INVALID_STATE.defaultMessage) {
    super(message);
  }
}

export class LimitExceededError extends ConflictError {
  constructor(codeMessage: string) {
    super(codeMessage);
  }
}

export class SavedLocationLimitError extends LimitExceededError {
  override readonly code = 'SAVED_LOCATION_LIMIT' as const;
  constructor(limit: number) {
    super(`You can save up to ${limit} locations. Remove one to add another.`);
  }
}

export class FollowLimitError extends LimitExceededError {
  override readonly code = 'FOLLOW_LIMIT' as const;
  constructor(limit: number) {
    super(`You can follow up to ${limit} offices.`);
  }
}

export class LocationLabelTakenError extends ConflictError {
  override readonly code = 'LOCATION_LABEL_TAKEN' as const;
  constructor(label: string) {
    super(`You already have a location labelled ${label}.`);
  }
}

export class TermsVersionMismatchError extends ConflictError {
  override readonly code = 'TERMS_VERSION_MISMATCH' as const;
  constructor() {
    super(CODE_META.TERMS_VERSION_MISMATCH.defaultMessage);
  }
}

export class NotPendingDeletionError extends ConflictError {
  override readonly code = 'NOT_PENDING_DELETION' as const;
  constructor() {
    super(CODE_META.NOT_PENDING_DELETION.defaultMessage);
  }
}

export class SelfRoleChangeError extends ConflictError {
  override readonly code = 'SELF_ROLE_CHANGE' as const;
  constructor() {
    super(CODE_META.SELF_ROLE_CHANGE.defaultMessage);
  }
}

export class LastSuperAdminError extends ConflictError {
  override readonly code = 'LAST_SUPER_ADMIN' as const;
  constructor() {
    super(CODE_META.LAST_SUPER_ADMIN.defaultMessage);
  }
}

export class DuplicateCorrectionError extends ConflictError {
  override readonly code = 'DUPLICATE_CORRECTION' as const;
  constructor() {
    super(CODE_META.DUPLICATE_CORRECTION.defaultMessage);
  }
}

export class AlreadySubscribedError extends ConflictError {
  override readonly code = 'ALREADY_SUBSCRIBED' as const;
  constructor() {
    super(CODE_META.ALREADY_SUBSCRIBED.defaultMessage);
  }
}

export class NoBillingAccountError extends ConflictError {
  override readonly code = 'NO_BILLING_ACCOUNT' as const;
  constructor() {
    super(CODE_META.NO_BILLING_ACCOUNT.defaultMessage);
  }
}

export class HasActiveChildrenError extends ConflictError {
  override readonly code = 'HAS_ACTIVE_CHILDREN' as const;
  constructor() {
    super(CODE_META.HAS_ACTIVE_CHILDREN.defaultMessage);
  }
}

export class HasCurrentTermError extends ConflictError {
  override readonly code = 'HAS_CURRENT_TERM' as const;
  constructor() {
    super(CODE_META.HAS_CURRENT_TERM.defaultMessage);
  }
}

export class RunInProgressError extends ConflictError {
  override readonly code = 'RUN_IN_PROGRESS' as const;
  constructor() {
    super(CODE_META.RUN_IN_PROGRESS.defaultMessage);
  }
}

export class SourceInactiveError extends ConflictError {
  override readonly code = 'SOURCE_INACTIVE' as const;
  constructor() {
    super(CODE_META.SOURCE_INACTIVE.defaultMessage);
  }
}

export class AlreadyDecidedError extends ConflictError {
  override readonly code = 'ALREADY_DECIDED' as const;
  constructor() {
    super(CODE_META.ALREADY_DECIDED.defaultMessage);
  }
}

export class AlertAlreadySentError extends ConflictError {
  override readonly code = 'ALERT_ALREADY_SENT' as const;
  constructor() {
    super(CODE_META.ALERT_ALREADY_SENT.defaultMessage);
  }
}

export class RecipientsChangedError extends ConflictError {
  override readonly code = 'RECIPIENTS_CHANGED' as const;
  constructor() {
    super(CODE_META.RECIPIENTS_CHANGED.defaultMessage);
  }
}

export class NoRecipientsError extends ConflictError {
  override readonly code = 'NO_RECIPIENTS' as const;
  constructor() {
    super(CODE_META.NO_RECIPIENTS.defaultMessage);
  }
}

export class RateLimitedError extends AppError {
  readonly code: ErrorCode = 'RATE_LIMITED';
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = CODE_META.RATE_LIMITED.defaultMessage) {
    super(message, { details: { retryAfterSeconds } });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class CorrectionDailyLimitError extends RateLimitedError {
  override readonly code = 'CORRECTION_DAILY_LIMIT' as const;
  constructor(retryAfterSeconds: number) {
    super(retryAfterSeconds, CODE_META.CORRECTION_DAILY_LIMIT.defaultMessage);
  }
}

export class UpstreamError extends AppError {
  readonly code: ErrorCode = 'UPSTREAM_UNAVAILABLE';
  constructor(message = CODE_META.UPSTREAM_UNAVAILABLE.defaultMessage, options?: AppErrorOptions) {
    super(message, options);
  }
}

export class DatabaseUnavailableError extends UpstreamError {
  override readonly code = 'DATABASE_UNAVAILABLE' as const;
  constructor(options?: AppErrorOptions) {
    super(CODE_META.DATABASE_UNAVAILABLE.defaultMessage, options);
  }
}

export class TimeoutError extends UpstreamError {
  override readonly code = 'TIMEOUT' as const;
  constructor(options?: AppErrorOptions) {
    super(CODE_META.TIMEOUT.defaultMessage, options);
  }
}

export class GeocoderUnavailableError extends UpstreamError {
  override readonly code = 'GEOCODER_UNAVAILABLE' as const;
  constructor(options?: AppErrorOptions) {
    super(CODE_META.GEOCODER_UNAVAILABLE.defaultMessage, options);
  }
}

export class BillingUnavailableError extends UpstreamError {
  override readonly code = 'BILLING_UNAVAILABLE' as const;
  constructor(options?: AppErrorOptions) {
    super(CODE_META.BILLING_UNAVAILABLE.defaultMessage, options);
  }
}

export class InternalError extends AppError {
  readonly code = 'INTERNAL' as const;
  constructor(message = CODE_META.INTERNAL.defaultMessage, options?: AppErrorOptions) {
    super(message, options);
  }
}

export class LocationOutsideUsError extends ValidationError {
  override readonly code = 'LOCATION_OUTSIDE_US' as const;
  constructor() {
    super(CODE_META.LOCATION_OUTSIDE_US.defaultMessage);
  }
}

export class BotCheckFailedError extends ValidationError {
  override readonly code = 'BOT_CHECK_FAILED' as const;
  constructor() {
    super(CODE_META.BOT_CHECK_FAILED.defaultMessage);
  }
}

export class InAppLockedError extends ValidationError {
  override readonly code = 'IN_APP_LOCKED' as const;
  constructor() {
    super(CODE_META.IN_APP_LOCKED.defaultMessage);
  }
}

export class JurisdictionCycleError extends ValidationError {
  override readonly code = 'JURISDICTION_CYCLE' as const;
  constructor() {
    super(CODE_META.JURISDICTION_CYCLE.defaultMessage);
  }
}

export class UnknownCollectorError extends ValidationError {
  override readonly code = 'UNKNOWN_COLLECTOR' as const;
  constructor() {
    super(CODE_META.UNKNOWN_COLLECTOR.defaultMessage);
  }
}

export class ExportTooLargeError extends ValidationError {
  override readonly code = 'EXPORT_TOO_LARGE' as const;
  constructor() {
    super(CODE_META.EXPORT_TOO_LARGE.defaultMessage);
  }
}

export class BadRequestError extends AppError {
  readonly code = 'BAD_REQUEST' as const;
  constructor(message = CODE_META.BAD_REQUEST.defaultMessage) {
    super(message);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function fromZod(error: z.ZodError): ValidationError {
  const fieldErrors: FieldError[] = error.issues.map((issue) => ({
    path: issue.path.map((part) => String(part)).join('.'),
    code: issue.code,
    message: issue.message,
  }));
  const first = fieldErrors[0];
  return new ValidationError(first?.message ?? CODE_META.VALIDATION.defaultMessage, fieldErrors);
}

const CONSTRAINT_CODES = {
  saved_locations_home_work_once: 'LOCATION_LABEL_TAKEN',
  corrections_one_open_per_user_field: 'DUPLICATE_CORRECTION',
  office_terms_one_current_per_office: 'CONFLICT',
  saved_locations_one_default_per_user: 'CONFLICT',
} as const satisfies Record<string, ErrorCode>;

export function errorForConstraint(constraint: string | undefined): AppError | undefined {
  if (!constraint) return undefined;
  const code = CONSTRAINT_CODES[constraint as keyof typeof CONSTRAINT_CODES];
  if (!code) return undefined;
  switch (code) {
    case 'LOCATION_LABEL_TAKEN':
      return new LocationLabelTakenError('that label');
    case 'DUPLICATE_CORRECTION':
      return new DuplicateCorrectionError();
    case 'CONFLICT':
      return new ConflictError();
    default:
      return undefined;
  }
}
