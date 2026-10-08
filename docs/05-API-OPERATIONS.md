# 05 — API Operations (GraphQL + required REST routes)

Every operation the Phase 1 backend exposes. Nothing else is added without updating this file,
`02-RBAC-PERMISSIONS.md` and `03-ERROR-CATALOG.md`.

Legend — **Scope**: `public` (anyone), `resident` (signed-in resident, any sub-state),
`residentActive` (ACTIVE + current Terms accepted), or an admin/system permission from doc 02.
**Rate**: limiter class from `.cursor/rules/20-security.mdc`. Every operation can also return
`BAD_REQUEST`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `INTERNAL` — not repeated below.

---

## Process

| Operation | Kind | Scope / permission | Rate | Input (validation) | Rules | Errors |
|---|---|---|---|---|---|---|
| `health` | Query | public | — | — | Returns `ok`. Used to prove the GraphQL stack is mounted. | — |

## A. Location resolution & civic read (public)

| Operation | Kind | Scope / permission | Rate | Input (validation) | Rules | Errors |
|---|---|---|---|---|---|---|
| `resolveLocation` | Query | public · `public.lookup:create` | lookup | `input: { query?: string 3–200, trimmed, no control chars; lat?: -90..90; lng?: -180..180; method?: ADDRESS\|ZIP\|CITY_STATE\|DEVICE }` — exactly one of `query` or (`lat`+`lng`) | Classify (ZIP `^\d{5}(-\d{4})?$`; `City, ST`; else address). US-only geocode. Spatial match all layers. Compute confidence per level + overall + partial levels. Persist Lookup (no raw text; anonymous expires in 30 d; links `user_id` when signed in). Returns `{ status: RESOLVED, token, confidence }` or `{ status: NEEDS_CONFIRMATION, candidates[≤5] { displayLabel, candidateToken } }` | `VALIDATION`, `LOCATION_NOT_FOUND`, `LOCATION_OUTSIDE_US`, `GEOCODER_UNAVAILABLE` |
| `confirmLocationCandidate` | Query | public | lookup | `candidateToken: string 32` (signed, 10-min expiry) | Resolves the chosen geocode candidate into a lookup | `CANDIDATE_EXPIRED` |
| `reverseGeocode` | Query | public · `public.lookup:create` | lookup | `lat, lng` ranges | Returns `{ displayLabel, candidateToken }` for the confirm step | `LOCATION_NOT_FOUND`, `LOCATION_OUTSIDE_US` |
| `civicCard` | Query | public · `public.civic:read` | — | `token: string` | Returns header (displayLabel, method, confidence), `levels[] { level, confidence, coverage: COVERED\|PARTIAL\|NONE, notice?, offices[] }`, `servicesPreview[≤5]`. Office row: name, seat, jurisdiction, currentHolder?, termStatus?, party?, photoUrl?, contact, freshness, source, `whyItApplies`, `isFollowed` (resident only, else null) | `LOOKUP_NOT_FOUND` (unknown/expired) |
| `office` | Query | public · `public.civic:read` | — | `slug` 1–160, `lookupToken?` | Active office profile; `whyItApplies` only when `lookupToken` given and office is in it; vacant/holder-unknown states | `NOT_FOUND` |
| `official` | Query | public · `public.civic:read` | — | `slug`, `lookupToken?` | Active official; if retired from all offices returns `redirectOfficeSlug` | `NOT_FOUND` |
| `services` | Query | public · `public.civic:read` | — | `{ lookupToken? \| jurisdictionId? \| officeId? }` exactly one; `categoryId?`; `first ≤100, after?` | Active services linked to the jurisdictions/offices of the lookup | `VALIDATION`, `LOOKUP_NOT_FOUND` |
| `serviceCategories` | Query | public | — | — | Active categories ordered | — |
| `plans` | Query | public · `public.plans:read` | — | — | Active plans: name, amountCents, currency, interval, features | — |
| `legalVersions` | Query | public · `public.legal:read` | — | — | Current TERMS and PRIVACY versions | — |
| `submitContactMessage` | Mutation | public · `public.contact:create` | contact | `{ name 2–80, email valid ≤254, topic enum, message 10–2000, consent: true, turnstileToken }` | Verify Turnstile server-side; store with ip_hash; enqueue email to `CONTACT_INBOX` | `VALIDATION`, `BOT_CHECK_FAILED` |

## B. Resident account & session

REST routes (Fastify, not GraphQL):

| Route | Purpose | Rules | Errors (HTTP) |
|---|---|---|---|
| `GET /auth/:provider/start?intent=&returnTo=` | Begin Google/Apple OIDC | provider ∈ {google, apple}; `intent` ∈ {SAVE_LOCATION, FOLLOW, NOTIFICATIONS, REPORT, SUBSCRIBE, SIGN_IN}; `returnTo` relative + allowlisted; sets encrypted `__Host-cl_oauth` (state, nonce, PKCE, intent); 302 to provider | 400 `VALIDATION`, 429 |
| `GET /auth/google/callback`, `POST /auth/apple/callback` | Complete OIDC | Verify state/nonce/PKCE/ID token; upsert user per linking rules; reject DELETED; restore prompt if PENDING_DELETION; create session; set `__Host-cl_at` + `__Host-cl_rt`; 302 to `returnTo` (+ `?intent=…&welcome=1` when terms not accepted) | 302 to `/signin?error=<code>` with `OAUTH_FAILED`, `ACCOUNT_DELETED` |
| `POST /auth/refresh` | Rotate refresh token | Requires `x-civiclink-csrf`; rotate; reuse → revoke family | 401 `SESSION_EXPIRED`, `SESSION_REVOKED` |

| Operation | Kind | Scope / permission | Rate | Input | Rules | Errors |
|---|---|---|---|---|---|---|
| `me` | Query | resident · `self.profile:read` | — | — | displayName, email, provider, status, termsAccepted, currentTermsVersion, marketingOptIn, subscription summary, unreadCount, activeSessionCount | `UNAUTHENTICATED` |
| `acceptTerms` | Mutation | resident · `self.profile:update` | mutation | `{ termsVersion, privacyVersion, displayName 1–60, marketingOptIn: bool }` | Versions must equal current; stores accepted_at; creates default notification preferences if none (D-09) | `VALIDATION`, `TERMS_VERSION_MISMATCH` |
| `updateProfile` | Mutation | residentActive · `self.profile:update` | mutation | `{ displayName? 1–60, marketingOptIn? }` | — | `VALIDATION` |
| `signOut` | Mutation | resident · `self.session:manage` | mutation | `{ everywhere?: bool }` | Revoke current (or all) sessions; clear cookies | — |
| `requestAccountDeletion` | Mutation | residentActive · `self.account:delete` | mutation | `{ reason?: enum, reasonText? ≤500, confirm: "DELETE" }` | status → PENDING_DELETION; purge_after = now+30d; revoke all sessions; Stripe `cancel_at_period_end=true`; enqueue confirmation email | `VALIDATION` |
| `restoreAccount` | Mutation | resident (PENDING_DELETION only) · `self.account:delete` | mutation | — | status → ACTIVE; restored_at set; Stripe cancel flag left as-is (resident can resubscribe in portal) | `NOT_PENDING_DELETION` |

## C. Saved locations & follows

| Operation | Kind | Scope | Rate | Input | Rules | Errors |
|---|---|---|---|---|---|---|
| `savedLocations` | Query | residentActive · `self.locations:manage` | — | — | Own only, default first | — |
| `saveLocation` | Mutation | residentActive · `self.locations:manage` | mutation | `{ lookupToken, label: HOME\|WORK\|OTHER, customName? 1–40 (required if OTHER), makeDefault? }` | Lookup must be RESOLVED with a point (address/device) or area (ZIP/city); copy normalised address, point, jurisdictions, confidence; first location becomes default; enforce plan limit inside a serializable tx | `LOOKUP_NOT_FOUND`, `LOCATION_LABEL_TAKEN`, `SAVED_LOCATION_LIMIT`, `VALIDATION` |
| `updateSavedLocation` | Mutation | residentActive | mutation | `{ id, label?, customName? }` | Owner only | `NOT_FOUND`, `LOCATION_LABEL_TAKEN` |
| `setDefaultLocation` | Mutation | residentActive | mutation | `{ id }` | Unset previous default in same tx | `NOT_FOUND` |
| `deleteSavedLocation` | Mutation | residentActive | mutation | `{ id }` | If default deleted, next most recent becomes default | `NOT_FOUND` |
| `follows` | Query | residentActive · `self.follows:manage` | — | `first, after` | Own follows with office, holder, level, lastUpdatedAt | — |
| `follow` | Mutation | residentActive · `self.follows:manage` | mutation | `{ officeId, officialId? }` | Office must be ACTIVE; if officialId given it must hold or have held that office; idempotent (existing follow returned); enforce plan limit | `NOT_FOUND`, `FOLLOW_LIMIT` |
| `unfollow` | Mutation | residentActive | mutation | `{ officeId }` | Idempotent | — |

## D. Notifications (resident)

| Operation | Kind | Scope | Rate | Input | Rules | Errors |
|---|---|---|---|---|---|---|
| `notifications` | Query | residentActive · `self.notifications:manage` | — | `{ filter?: ALL\|UNREAD\|ALERTS\|UPDATES, first ≤50, after }` | Own, not deleted, newest first | — |
| `unreadNotificationCount` | Query | residentActive | — | — | — | — |
| `markNotificationsRead` | Mutation | residentActive | mutation | `{ ids?: ID[] ≤100 } \| { all: true }` | Own only; returns updatedCount | `VALIDATION` |
| `deleteNotification` | Mutation | residentActive | mutation | `{ id }` | Soft delete | `NOT_FOUND` |
| `notificationPreferences` | Query | residentActive | — | — | 2 categories × 3 channels; IN_APP always true | — |
| `updateNotificationPreference` | Mutation | residentActive | mutation | `{ category, channel: EMAIL\|PUSH, enabled }` | IN_APP cannot be disabled | `IN_APP_LOCKED`, `VALIDATION` |
| `registerPushSubscription` | Mutation | residentActive | mutation | `{ token ≤2048, userAgent? }` | Upsert by token; re-assign token to caller if previously owned by someone else (device changed hands) | `VALIDATION` |
| `removePushSubscription` | Mutation | residentActive | mutation | `{ token }` | Own only, idempotent | — |
| `sendTestNotification` | Mutation | residentActive | mutation (3/hour) | — | Delivers to every enabled channel for self | `RATE_LIMITED` |

REST: `GET /u/unsub?t=<signed>` (turn off one category's email), `GET /u/o?t=` (open pixel), `GET /u/c?t=&r=` (click → allowlisted redirect). Tokens HMAC-signed, 90-day expiry; invalid → friendly page, no detail.

## E. Corrections (resident)

| Operation | Kind | Scope | Rate | Input | Rules | Errors |
|---|---|---|---|---|---|---|
| `submitCorrection` | Mutation | residentActive · `self.corrections:create` | correction | `{ entityType, entityId, field: CorrectionField, proposedValue? 1–500 (required unless DOES_NOT_APPLY), details? ≤1000, evidenceUrl? https? ≤2048, lookupToken? }` | Entity must exist and be ACTIVE; field must be valid for entity type; format-check email/URL/phone fields; snapshot current value; one open per user+entity+field; audit (RESIDENT) | `NOT_FOUND`, `VALIDATION`, `DUPLICATE_CORRECTION`, `CORRECTION_DAILY_LIMIT` |
| `myCorrections` | Query | residentActive · `self.corrections:read` | — | `first, after` | Own; exposes status, dismissReason, dismissNote; never notes/assignee | — |

## F. Billing (resident) + Stripe webhook

| Operation | Kind | Scope | Rate | Input | Rules | Errors |
|---|---|---|---|---|---|---|
| `subscription` | Query | residentActive · `self.billing:manage` | — | — | Plan, status, currentPeriodEnd, cancelAtPeriodEnd | — |
| `invoices` | Query | residentActive | — | `first ≤24, after` | Own via stripe customer | — |
| `createCheckoutSession` | Mutation | residentActive | mutation | `{ planId }` | Plan active; reject if already ACTIVE/TRIALING/PAST_DUE (use portal); create/reuse Stripe customer (idempotency key `cust:<userId>`); return URL | `NOT_FOUND`, `ALREADY_SUBSCRIBED`, `BILLING_UNAVAILABLE` |
| `createPortalSession` | Mutation | residentActive | mutation | — | Requires Stripe customer | `NO_BILLING_ACCOUNT`, `BILLING_UNAVAILABLE` |
| `POST /webhooks/stripe` | REST | system · `system.billing:sync` | — | raw body + `Stripe-Signature` | Verify; dedupe by event id; handle `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid/payment_failed/finalized`, `product.updated`, `price.updated`; ignore older out-of-order events; 2xx fast, heavy work in job | 400 bad signature; 200 duplicate |

## G. Admin — auth & users

| Operation | Kind | Permission | Rate | Input | Rules | Errors |
|---|---|---|---|---|---|---|
| `GET /admin-auth/google/start`, `GET /admin-auth/google/callback` | REST | — | auth | — | Workspace `hd` + allowlist + ACTIVE/INVITED (first login activates INVITED); lockout; session cookie | 302 `/admin/login?error=` `ADMIN_NOT_ALLOWED`, `ADMIN_LOCKED` |
| `adminMe` | Query | any admin | admin | — | id, email, name, role, permissions[] | `UNAUTHENTICATED` |
| `adminSignOut` | Mutation | any admin | admin | — | Revoke session | — |
| `adminUsers` | Query | `admin.users:read` | admin | `filter { role?, status? }, first, after` | — | `FORBIDDEN` |
| `inviteAdmin` | Mutation | `admin.users:manage` | admin | `{ email (must match ADMIN_GOOGLE_HD), name? ≤100, role }` | status INVITED; audit | `CONFLICT` (exists), `VALIDATION` |
| `updateAdminRole` | Mutation | `admin.users:manage` | admin | `{ adminId, role }` | Not self; not last Super Admin; audit; effective next request | `SELF_ROLE_CHANGE`, `LAST_SUPER_ADMIN`, `NOT_FOUND` |
| `setAdminStatus` | Mutation | `admin.users:manage` | admin | `{ adminId, status: ACTIVE\|DEACTIVATED }` | Not self; not last Super Admin; deactivation revokes sessions; audit | same |

## H. Admin — dashboard, civic data, sources, services

| Operation | Kind | Permission | Input highlights | Rules | Errors |
|---|---|---|---|---|---|
| `adminDashboardCounts` | Query | `admin.dashboard:read` | — | Corrections by status/age>5d, stale records per level, failed source runs, pending source changes, alerts last 7d + failures | — |
| `adminJurisdictions` / `adminJurisdiction(id)` | Query | `admin.civic:read` | `filter { level?, type?, state?, status?, freshness?, q? ≤100 }`, `sort: NEWEST\|NAME`, first/after | Includes RETIRED, boundary vintage, has-boundary flag (no geometry), sourceRecordUrl. Connection includes totalCount. NAME orders by name | `NOT_FOUND` |
| `upsertJurisdiction` | Mutation | `admin.civic:write` | `{ id?, name 2–150, level, type, subtype?, parentId? (required unless NATION; no cycles), districtCode? ≤40, geoid? ≤40, state? ^[A-Z]{2}$, website? URL, sourceId, sourceRecordUrl?, lastUpdatedAt, freshnessOverride, freshnessNote? (required if override≠NONE) }` | Geometry not editable; audit | `VALIDATION`, `CONFLICT` (type+geoid), `JURISDICTION_CYCLE` |
| `retireJurisdiction` / `restoreJurisdiction` | Mutation | `admin.civic:retire` | `{ id, retireActiveOffices?: bool }` | If active offices exist and flag false → error | `HAS_ACTIVE_CHILDREN` |
| `adminOffices` / `adminOffice(id)` | Query | `admin.civic:read` | `filter { level?, jurisdictionId?, vacantOnly?, staleOnly?, status?, q? }`, `sort: NEWEST\|NAME`, first/after | Includes followerCount (aggregate) and totalCount. NAME orders by name | — |
| `upsertOffice` | Mutation | `admin.civic:write` | `{ id?, jurisdictionId, name 2–150, seatLabel? ≤60, selectionMethod, displayOrder 0–10000, whyTemplate? ≤300 (tokens: {jurisdiction},{office},{district}), phone? E.164, email?, website?, contactUrl?, addresses[≤5] {label,street,city,state,zip ^\d{5}(-\d{4})?$,phone?,hours?}, holderUnknown, sourceId, sourceRecordUrl?, lastUpdatedAt, freshnessOverride, freshnessNote?, notifyFollowers?: bool }` | Slug generated, unique; audit; if notifyFollowers and contact/holder fields changed → enqueue RECORD_UPDATE fan-out | `VALIDATION`, `NOT_FOUND` |
| `retireOffice` / `restoreOffice` | Mutation | `admin.civic:retire` | `{ id }` | Retired offices hidden from cards; follows kept, hidden | `NOT_FOUND` |
| `adminOfficials` / `adminOfficial(id)` | Query | `admin.civic:read` | `filter { status?, q?, officeId? }`, `sort: NEWEST\|NAME`, first/after | Official includes terms. Connection includes totalCount. NAME orders by fullName | — |
| `upsertOfficial` | Mutation | `admin.civic:write` | `{ id?, fullName 2–120, displayName?, party? ≤60, photoUrl? https, website?, sourceId, sourceRecordUrl?, lastUpdatedAt, freshnessOverride, freshnessNote?, notifyFollowers? }` | audit | `VALIDATION` |
| `setOfficeTerm` | Mutation | `admin.civic:write` | `{ officeId, officialId, status: ELECTED\|APPOINTED\|ACTING, termStart?, termEnd?, makeCurrent: bool, notifyFollowers? }` | Returns `{ id, officeId }`. makeCurrent ends existing current term (is_current=false, term_end default today) in a serializable tx; clears holderUnknown; audit; optional fan-out "X is now Y" | `NOT_FOUND`, `VALIDATION` (dates) |
| `endOfficeTerm` | Mutation | `admin.civic:write` | `{ termId, termEnd? }` | Returns `{ id, officeId }`. Office becomes vacant | `NOT_FOUND` |
| `retireOfficial` / `restoreOfficial` | Mutation | `admin.civic:retire` | `{ id }` | Must have no current term | `HAS_CURRENT_TERM` |
| `adminServices` / `adminService(id)` | Query | `admin.civic:read` | `filter { categoryId?, status?, linkBroken?, q? }`, `sort: NEWEST\|NAME`, first/after | Service includes links. Connection includes totalCount. NAME orders by title | — |
| `upsertService` | Mutation | `admin.civic:write` | `{ id?, title 3–120, categoryId, description 20–400, url? https, phoneContact? ≤120 (url or phone required), jurisdictionIds[], officeIds[] (≥1 total), lastValidatedAt, sourceId }` | Replace links in same tx; audit | `VALIDATION` |
| `retireService` / `restoreService` | Mutation | `admin.civic:retire` | `{ id }` | — | — |
| `upsertServiceCategory` | Mutation | `admin.civic:write` | `{ id?, name 2–60 unique, sortOrder, active }` | — | `CONFLICT` |
| `adminSources` / `adminSource(id)` | Query | `admin.civic:read` | — | Includes last 20 runs | — |
| `upsertSource` | Mutation | `admin.source:write` | `{ id?, name 2–150 unique, publisher, url https, termsUrl https, method, schedule, freshnessDays 1–3650, levels[], collectorKey? (must exist in registry), active }` | audit | `VALIDATION`, `CONFLICT`, `UNKNOWN_COLLECTOR` |
| `triggerSourceRefresh` | Mutation | `admin.source:run` | `{ sourceId }` | Reject if a run is QUEUED/RUNNING; enqueue job; audit | `RUN_IN_PROGRESS`, `SOURCE_INACTIVE` |
| `pendingSourceChanges` | Query | `admin.civic:read` | `filter { sourceId?, decision? }` | — | — |
| `decideSourceChange` | Mutation | `admin.source:decide` | `{ id, decision: ACCEPTED\|REJECTED }` | Accept applies value with audit actor ADMIN | `ALREADY_DECIDED` |
| `changeLog` | Query | `admin.changelog:read` | `{ entityType, entityId, first, after }` | — | — |
| `exportCsv` | Mutation | `admin.export:csv` | `{ list: JURISDICTIONS\|OFFICES\|OFFICIALS\|SERVICES\|SOURCES\|CORRECTIONS\|ALERTS, filter }` | Max 50,000 rows; no resident PII columns; CSV-injection safe (prefix `'` to cells starting with = + - @); audit. Staging and production write the file to the exports S3 bucket and return a presigned URL valid 10 min. Development and test keep the file in memory and return a same-host `GET /dev/exports/:token` URL valid 10 min (that route is not registered in staging or production) | `EXPORT_TOO_LARGE` |

## I. Admin — corrections

| Operation | Kind | Permission | Input | Rules | Errors |
|---|---|---|---|---|---|
| `adminCorrections` | Query | `admin.correction:read` | `filter { status?, level?, entityType?, olderThanDays?, assignedToMe? }`, oldest open first | Submitter displayName only | — |
| `adminCorrection(id)` | Query | `admin.correction:read` | — | Current record values + proposal + notes + history | `NOT_FOUND` |
| `assignCorrection` | Mutation | `admin.correction:resolve` | `{ id, assigneeId? (default self) }` | Assignee must have `admin.correction:resolve` | `NOT_FOUND`, `INVALID_STATE` |
| `markCorrectionInReview` | Mutation | `admin.correction:resolve` | `{ id }` | SUBMITTED → IN_REVIEW | `INVALID_STATE` |
| `applyCorrection` | Mutation | `admin.correction:resolve` | `{ id, value (validated by field type), sourceId? \| sourceUrl?, notifyFollowers? }` | Open only; updates target record + last_updated_at in same tx; status APPLIED; audit both | `INVALID_STATE`, `VALIDATION` |
| `dismissCorrection` | Mutation | `admin.correction:resolve` | `{ id, reason: DismissReason, note? ≤500 (required if OTHER) }` | Open only; DISMISSED; audit | `INVALID_STATE`, `VALIDATION` |
| `addCorrectionNote` | Mutation | `admin.correction:resolve` | `{ id, body 1–2000 }` | Internal only | `NOT_FOUND` |

State machine: `SUBMITTED → IN_REVIEW → APPLIED | DISMISSED`; `SUBMITTED → APPLIED | DISMISSED` allowed; APPLIED/DISMISSED are terminal.

## J. Admin — alerts

| Operation | Kind | Permission | Input | Rules | Errors |
|---|---|---|---|---|---|
| `adminAlerts` / `adminAlert(id)` | Query | `admin.alert:read` | `filter { status?, targetOfficeId? }` | Delivery stats per channel: queued/sent/delivered/failed/skipped, opens, clicks | — |
| `saveAlertDraft` | Mutation | `admin.alert:write` | `{ id?, targetOfficeId? \| targetOfficialId? (exactly one), title 5–80, body 10–1000, link? https (default target profile), channels ⊆ {EMAIL, PUSH} (IN_APP always) }` | Draft only | `VALIDATION`, `ALERT_ALREADY_SENT` |
| `deleteAlertDraft` | Mutation | `admin.alert:write` | `{ id }` | Draft only (hard delete allowed for drafts) | `ALERT_ALREADY_SENT` |
| `previewAlert` | Query | `admin.alert:write` | `{ id }` | Rendered in-app / email / push + recipientCount per channel after preferences | — |
| `sendTestAlert` | Mutation | `admin.alert:write` | `{ id }` | Sends to the admin's own email only (admins have no push) | — |
| `sendAlert` | Mutation | `admin.alert:send` | `{ id, confirmRecipientCount: int }` | Draft → SENDING atomically (`UPDATE … WHERE status='DRAFT'`); count must match current count ±5% else `RECIPIENTS_CHANGED`; enqueue fan-out; audit; rate 10/hour/admin | `ALERT_ALREADY_SENT`, `RECIPIENTS_CHANGED`, `NO_RECIPIENTS` |

## K. Background jobs (worker, System principal)

| Job | Permission | Trigger | Idempotency | Retry |
|---|---|---|---|---|
| `notify.fanout` | `system.notifications:deliver` | sendAlert / record update with notifyFollowers | `notifications (user_id, source_ref)` unique | 5, backoff |
| `notify.deliver.email` / `notify.deliver.push` | `system.notifications:deliver` | per delivery row | `notification_deliveries.dedupe_key` unique; skip if status ≠ QUEUED | 3, backoff; 410/404 push token → revoke subscription |
| `alert.finalize` | `system.notifications:deliver` | after fan-out | sets status SENT, recipient_count, sent_at | 3 |
| `billing.applyEvent` | `system.billing:sync` | webhook | `stripe_events.processed_at` | 8, backoff |
| `billing.syncPlans` | `system.billing:sync` | daily + `product/price.updated` | upsert by price id | 3 |
| `source.run` | `system.pipeline:run` | schedule / triggerSourceRefresh | one active run per source | per source config |
| `locations.reresolve` | `system.locations:reresolve` | nightly 03:00 UTC | overwrite | 2 |
| `services.linkcheck` | `system.locations:reresolve` | nightly | overwrite flag | 2 |
| `retention.lookups` / `retention.sessions` / `retention.stripeEvents` | `system.retention:run` | daily | delete-where | 2 |
| `accounts.purge` | `system.retention:run` | daily | `purged_at` set | 3; partial failure resumes |
| `email.contact` / `email.accountDeletion` | `system.notifications:deliver` | on demand | job key = entity id | 3 |

Purge (`accounts.purge`) for each due deletion request: delete saved_locations, follows, notifications
(+ deliveries), preferences, push subscriptions, sessions, identities, lookups; null `corrections.user_id`;
replace user email with `deleted+<id>@invalid`, display name `Deleted user`, status DELETED; keep
stripe_customers/subscriptions/invoices rows only as Stripe requires for legal records (no PII beyond ids).
