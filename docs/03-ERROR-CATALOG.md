# 03 — Error Catalog

Clients branch **only** on `extensions.code`. Messages below are the default client-facing text
(short, no PII, no internals). `Expose = no` means the client always gets the generic text for that
class, while the real cause is logged with the `requestId`.

Response shape (GraphQL):
```json
{ "errors": [{ "message": "Enter a valid email address.",
  "path": ["submitContactMessage"],
  "extensions": { "code": "VALIDATION", "requestId": "01J…",
    "fieldErrors": [{ "path": "input.email", "code": "invalid_email", "message": "Enter a valid email address." }] } }] }
```
REST routes return `{ "error": { "code", "message", "requestId" } }` with the HTTP status below.

## 1. Generic codes

| Code | Class | HTTP | Default message | Expose | Retryable | Log level |
|---|---|---|---|---|---|---|
| `BAD_REQUEST` | (GraphQL parse/validation) | 400 | "The request is malformed." | yes | no | info |
| `VALIDATION` | ValidationError | 400 | field-specific | yes (+fieldErrors) | no | info |
| `UNAUTHENTICATED` | UnauthenticatedError | 401 | "Please sign in to continue." | yes | no | info |
| `SESSION_EXPIRED` | UnauthenticatedError | 401 | "Your session expired. Please sign in again." | yes | no | info |
| `SESSION_REVOKED` | UnauthenticatedError | 401 | "You were signed out. Please sign in again." | yes | no | warn (possible token theft when reuse detected) |
| `FORBIDDEN` | ForbiddenError | 403 | "You don't have access to this." | yes | no | warn |
| `NOT_FOUND` | NotFoundError | 404 | "We couldn't find that." | yes | no | info |
| `CONFLICT` | ConflictError | 409 | "That conflicts with existing data." | yes | no | info |
| `RELATED_RECORD_MISSING` | ConflictError | 409 | "A related record no longer exists." | yes | no | info |
| `TRY_AGAIN` | ConflictError | 409 | "Please try that again." | yes | yes | warn |
| `INVALID_STATE` | ConflictError | 409 | "This can't be done in its current state." | yes | no | info |
| `RATE_LIMITED` | RateLimitedError | 429 | "Too many requests. Please wait a moment." (+`retryAfterSeconds`) | yes | yes | warn |
| `UPSTREAM_UNAVAILABLE` | UpstreamError | 503 | "A service we depend on is unavailable. Try again shortly." | no | yes | error |
| `DATABASE_UNAVAILABLE` | UpstreamError | 503 | (generic upstream text) | no | yes | error |
| `TIMEOUT` | UpstreamError | 503 | (generic upstream text) | no | yes | error |
| `INTERNAL` | InternalError / unknown | 500 | "Something went wrong." | no | no | error (with stack) |

## 2. Account & access

| Code | Class | HTTP | Default message | When |
|---|---|---|---|---|
| `TERMS_REQUIRED` | ForbiddenError | 403 | "Please accept the Terms to continue." | Resident hasn't accepted current Terms |
| `TERMS_VERSION_MISMATCH` | ConflictError | 409 | "The Terms were updated. Please review them again." | acceptTerms with an old version |
| `ACCOUNT_PENDING_DELETION` | ForbiddenError | 403 | "Your account is scheduled for deletion. Restore it to continue." | Resident in PENDING_DELETION |
| `ACCOUNT_DELETED` | ForbiddenError | 403 | "This account has been deleted." | Sign-in to a DELETED user |
| `NOT_PENDING_DELETION` | ConflictError | 409 | "Your account isn't scheduled for deletion." | restoreAccount when ACTIVE |
| `OAUTH_FAILED` | UnauthenticatedError | 400 | "Sign-in didn't complete. Please try again." | state/nonce/PKCE/token verification failure or provider error (cause logged) |
| `ADMIN_NOT_ALLOWED` | ForbiddenError | 403 | "This account doesn't have admin access." | Not in allowlist / wrong domain / deactivated |
| `ADMIN_LOCKED` | ForbiddenError | 423 | "Too many attempts. Try again in 15 minutes." | Admin lockout |
| `SELF_ROLE_CHANGE` | ConflictError | 409 | "You can't change your own role or status." | |
| `LAST_SUPER_ADMIN` | ConflictError | 409 | "At least one Super Admin must remain active." | |
| `BOT_CHECK_FAILED` | ValidationError | 400 | "Please complete the verification and try again." | Turnstile failed |

## 3. Location & civic

| Code | Class | HTTP | Default message | When |
|---|---|---|---|---|
| `LOCATION_NOT_FOUND` | NotFoundError | 404 | "We couldn't find that location. Check the spelling or try a ZIP code." | Geocoder zero results |
| `LOCATION_OUTSIDE_US` | ValidationError | 422 | "CivicLink covers U.S. locations only." | Non-US result / coordinates |
| `CANDIDATE_EXPIRED` | NotFoundError | 410 | "That choice expired. Please search again." | candidateToken expired/invalid |
| `LOOKUP_NOT_FOUND` | NotFoundError | 404 | "This lookup has expired. Search again." | Unknown/expired lookup token |
| `GEOCODER_UNAVAILABLE` | UpstreamError | 503 | "We couldn't look up locations right now. Try again shortly." (expose: yes, fixed text) | Geocoder timeout/5xx/breaker open |

## 4. Resident features

| Code | Class | HTTP | Default message | When |
|---|---|---|---|---|
| `LOCATION_LABEL_TAKEN` | ConflictError | 409 | "You already have a location labelled {label}." | HOME/WORK duplicate (constraint `saved_locations_home_work_once`) |
| `SAVED_LOCATION_LIMIT` | ConflictError (LimitExceeded) | 409 | "You can save up to {n} locations. Remove one to add another." | Plan limit |
| `FOLLOW_LIMIT` | ConflictError (LimitExceeded) | 409 | "You can follow up to {n} offices." | Plan limit |
| `IN_APP_LOCKED` | ValidationError | 400 | "In-app notifications can't be turned off." | |
| `DUPLICATE_CORRECTION` | ConflictError | 409 | "You've already reported this — we're reviewing it." | Constraint `corrections_one_open_per_user_field` |
| `CORRECTION_DAILY_LIMIT` | RateLimitedError | 429 | "You've reached today's limit for reports." | 10/day |
| `ALREADY_SUBSCRIBED` | ConflictError | 409 | "You already have a subscription. Manage it from Billing." | |
| `NO_BILLING_ACCOUNT` | ConflictError | 409 | "You don't have a billing account yet." | Portal before any checkout |
| `BILLING_UNAVAILABLE` | UpstreamError | 503 | "Billing is unavailable right now. Try again shortly." (expose: yes, fixed text) | Stripe timeout/5xx |

## 5. Admin

| Code | Class | HTTP | Default message | When |
|---|---|---|---|---|
| `JURISDICTION_CYCLE` | ValidationError | 400 | "A jurisdiction can't be its own ancestor." | parent chain cycle |
| `HAS_ACTIVE_CHILDREN` | ConflictError | 409 | "Retire or move its active offices first." | retireJurisdiction |
| `HAS_CURRENT_TERM` | ConflictError | 409 | "End this official's current term first." | retireOfficial |
| `UNKNOWN_COLLECTOR` | ValidationError | 400 | "Unknown collector key." | upsertSource |
| `RUN_IN_PROGRESS` | ConflictError | 409 | "A refresh is already running for this source." | |
| `SOURCE_INACTIVE` | ConflictError | 409 | "Activate the source before refreshing it." | |
| `ALREADY_DECIDED` | ConflictError | 409 | "This change was already decided." | |
| `ALERT_ALREADY_SENT` | ConflictError | 409 | "This alert was already sent and can't be changed." | |
| `RECIPIENTS_CHANGED` | ConflictError | 409 | "The number of recipients changed. Review and confirm again." | sendAlert count mismatch |
| `NO_RECIPIENTS` | ConflictError | 409 | "Nobody follows this office yet." | |
| `EXPORT_TOO_LARGE` | ValidationError | 413 | "Narrow your filters — exports are limited to 50,000 rows." | |

## 6. Mapping rules (summary — implementation in src/lib/errors.ts and src/db/prisma.ts)

- Zod failure → `VALIDATION` via `fromZod()`; each issue → `{ path, code, message }`.
- Known DB constraint names → their domain code (table above); unknown unique → `CONFLICT`;
  check violation → `VALIDATION` (constraint name logged, not exposed).
  PG `42501` (change_log append-only trigger, or revoked UPDATE/DELETE) → `FORBIDDEN`.
- Provider failures → domain upstream code (`GEOCODER_UNAVAILABLE`, `BILLING_UNAVAILABLE`) or
  `UPSTREAM_UNAVAILABLE`; provider messages never reach clients.
- Pothos scope failure → `UNAUTHENTICATED` if no principal, `TERMS_REQUIRED` / `ACCOUNT_PENDING_DELETION`
  for resident sub-states, else `FORBIDDEN`.
- Anything not an `AppError` → `INTERNAL` + Sentry event.
