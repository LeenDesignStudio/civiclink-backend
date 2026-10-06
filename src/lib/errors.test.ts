import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AccountDeletedError,
  AccountPendingDeletionError,
  AdminLockedError,
  AdminNotAllowedError,
  AlreadyDecidedError,
  AlreadySubscribedError,
  AlertAlreadySentError,
  BadRequestError,
  BillingUnavailableError,
  BotCheckFailedError,
  CandidateExpiredError,
  CODE_META,
  ConflictError,
  CorrectionDailyLimitError,
  DatabaseUnavailableError,
  DuplicateCorrectionError,
  ERROR_CODES,
  ExportTooLargeError,
  FollowLimitError,
  ForbiddenError,
  fromZod,
  GeocoderUnavailableError,
  HasActiveChildrenError,
  HasCurrentTermError,
  InAppLockedError,
  InternalError,
  isAppError,
  JurisdictionCycleError,
  LastSuperAdminError,
  LocationLabelTakenError,
  LocationNotFoundError,
  LocationOutsideUsError,
  LookupNotFoundError,
  NoBillingAccountError,
  NoRecipientsError,
  NotFoundError,
  NotPendingDeletionError,
  OauthFailedError,
  PreconditionError,
  RateLimitedError,
  RecipientsChangedError,
  RelatedRecordMissingError,
  RunInProgressError,
  SavedLocationLimitError,
  SelfRoleChangeError,
  SessionExpiredError,
  SessionRevokedError,
  SourceInactiveError,
  TermsRequiredError,
  TermsVersionMismatchError,
  TimeoutError,
  TryAgainError,
  UnauthenticatedError,
  UnknownCollectorError,
  UpstreamError,
  ValidationError,
  type AppError,
} from './errors.js';

function samples(): AppError[] {
  return [
    new BadRequestError(),
    new ValidationError('Enter a valid email address.', [
      { path: 'input.email', code: 'invalid_email', message: 'Enter a valid email address.' },
    ]),
    new UnauthenticatedError(),
    new SessionExpiredError(),
    new SessionRevokedError(),
    new ForbiddenError(),
    new NotFoundError(),
    new ConflictError(),
    new RelatedRecordMissingError(),
    new TryAgainError(),
    new PreconditionError(),
    new RateLimitedError(12),
    new UpstreamError(),
    new DatabaseUnavailableError(),
    new TimeoutError(),
    new InternalError(),
    new TermsRequiredError(),
    new TermsVersionMismatchError(),
    new AccountPendingDeletionError(),
    new AccountDeletedError(),
    new NotPendingDeletionError(),
    new OauthFailedError(),
    new AdminNotAllowedError(),
    new AdminLockedError(),
    new SelfRoleChangeError(),
    new LastSuperAdminError(),
    new BotCheckFailedError(),
    new LocationNotFoundError(),
    new LocationOutsideUsError(),
    new CandidateExpiredError(),
    new LookupNotFoundError(),
    new GeocoderUnavailableError(),
    new LocationLabelTakenError('HOME'),
    new SavedLocationLimitError(5),
    new FollowLimitError(50),
    new InAppLockedError(),
    new DuplicateCorrectionError(),
    new CorrectionDailyLimitError(3600),
    new AlreadySubscribedError(),
    new NoBillingAccountError(),
    new BillingUnavailableError(),
    new JurisdictionCycleError(),
    new HasActiveChildrenError(),
    new HasCurrentTermError(),
    new UnknownCollectorError(),
    new RunInProgressError(),
    new SourceInactiveError(),
    new AlreadyDecidedError(),
    new AlertAlreadySentError(),
    new RecipientsChangedError(),
    new NoRecipientsError(),
    new ExportTooLargeError(),
  ];
}

describe('error catalog', () => {
  it('matches every code in docs/03', () => {
    const doc = readFileSync(new URL('../../docs/03-ERROR-CATALOG.md', import.meta.url), 'utf8');
    const documented = doc
      .split('\n')
      .flatMap((line) => {
        const match = /^\| `([A-Z0-9_]+)` \|/.exec(line);
        return match?.[1] ? [match[1]] : [];
      });
    expect(new Set(documented)).toEqual(new Set(ERROR_CODES));
    expect(Object.keys(CODE_META).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('maps every error class onto CODE_META', () => {
    const seen = new Set<string>();
    for (const error of samples()) {
      const meta = CODE_META[error.code];
      expect(error.httpStatus).toBe(meta.httpStatus);
      expect(error.expose).toBe(meta.expose);
      expect(error.retryable).toBe(meta.retryable);
      expect(error.logLevel).toBe(meta.logLevel);
      expect(isAppError(error)).toBe(true);
      seen.add(error.code);
    }
    expect(seen).toEqual(new Set(ERROR_CODES));
  });

  it('hides non-exposed messages', () => {
    expect(new InternalError('sql blew up').clientMessage()).toBe('Something went wrong.');
    expect(new DatabaseUnavailableError().clientMessage()).toBe(
      'A service we depend on is unavailable. Try again shortly.',
    );
    expect(new GeocoderUnavailableError().clientMessage()).toContain('look up locations');
  });

  it('builds field errors from Zod paths', () => {
    const parsed = z
      .object({ input: z.object({ email: z.email() }) })
      .safeParse({ input: { email: 'nope' } });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const error = fromZod(parsed.error);
    expect(error.code).toBe('VALIDATION');
    expect(error.fieldErrors[0]?.path).toBe('input.email');
    expect(error.fieldErrors[0]?.message.length).toBeGreaterThan(0);
  });
});
