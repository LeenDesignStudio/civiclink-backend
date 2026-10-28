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
| `submitContactMessage` | Mutation | public · `public.contact:create` | contact | `{ name 2–80, email valid ≤254, topic enum, message 10–2000, consent: true, turnstileToken }` | Verify Turnstile server-side; store with ip_hash; enqueue `email.contact`, which sends name, email, topic, and message to `CONTACT_INBOX` with Reply-To set to the sender and sets `emailed_at` on success | `VALIDATION`, `BOT_CHECK_FAILED` |

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
| `requestAccountDeletion` | Mutation | residentActive · `self.account:delete` | mutation | `{ reason?: enum, reasonText? ≤500, confirm: "DELETE" }` | status → PENDING_DELETION; purge_after = now+30d; revoke all sessions; Stripe `cancel_at_period_end=true`; enqueue `email.accountDeletion` (plain text + HTML: scheduled, purge date, restore within `ACCOUNT_PURGE_DAYS`; no tokens or ids in the body) | `VALIDATION` |
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
| `POST /webhooks/stripe` | REST | system · `system.billing:sync` | — | raw body + `Stripe-Signature` | Verify; dedupe by event id; handle `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid/payment_failed/finalized`; `product.updated` and `price.updated` enqueue `billing.syncPlans` with singletonKey `billing.syncPlans` (a burst runs one sync); ignore older out-of-order events; 2xx fast, heavy work in job | 400 bad signature; 200 duplicate |

## G. Admin — auth & users

| Operation | Kind | Permission | Rate | Input | Rules | Errors |
|---|---|---|---|---|---|---|
| `POST /admin-auth/login` | REST | — | auth | `{ email, password }` | One error for unknown, wrong, deactivated, or no password. Five failures lock 15 minutes. Success sets lastLoginAt and `__Host-cl_admin`. JSON `{ ok: true }` | `ADMIN_INVALID_CREDENTIALS`, `ADMIN_LOCKED`, `VALIDATION` |
| `POST /admin-auth/forgot-password` | REST | — | auth | `{ email }` | Always 202 `{ ok: true }`. An active account with a password gets one 60-minute link by email | `VALIDATION` |
| `POST /admin-auth/reset-password` | REST | — | auth | `{ token, password }` | RESET (60 min) or INVITE (7 days). Sets the password, marks the token used, activates an invite, revokes sessions | `ADMIN_TOKEN_EXPIRED`, `VALIDATION` |
| `adminMe` | Query | any admin | admin | — | id, email, name, role, permissions[], sessionExpiresAt. Idle or absolute expiry is `SESSION_EXPIRED` | `UNAUTHENTICATED`, `SESSION_EXPIRED`, `SESSION_REVOKED` |
| `myAdminProfile` | Query | any admin | admin | — | Same fields as `adminMe` | `UNAUTHENTICATED`, `SESSION_EXPIRED` |
| `updateMyProfile` | Mutation | any admin | admin | `{ name ≤100 }` | Audit `admin.profile_updated` | `VALIDATION` |
| `changeMyPassword` | Mutation | any admin | admin | `{ currentPassword, newPassword }` | Password rules. Revokes other sessions. Audit `admin.password_changed` without the password | `ADMIN_INVALID_CREDENTIALS`, `VALIDATION` |
| `adminSignOut` | Mutation | any admin | admin | — | Revoke session | — |
| `adminUsers` | Query | `admin.users:read` | admin | `filter { role?, status? }, first, after` | Each node includes `createdByName` (inviter's name) and `createdAt` | `FORBIDDEN` |
| `adminUserTiles` | Query | `admin.users:read` | admin | — | `{ total, superAdmins, staff, invited }` | `FORBIDDEN` |
| `inviteAdmin` | Mutation | `admin.users:manage` | admin | `{ name ≤100, email, role }` | Any unique email. status INVITED; sets invitedAt; emails the invite link; audit. Never deletes an admin | `CONFLICT` (exists), `VALIDATION` |
| `updateAdminUser` | Mutation | `admin.users:manage` | admin | `{ adminId, role?, name? }` | At least one of role or name. Not own role; not last Super Admin; audit | `SELF_ROLE_CHANGE`, `LAST_SUPER_ADMIN`, `NOT_FOUND`, `VALIDATION` |
| `resendInvite` | Mutation | `admin.users:manage` | admin | `{ adminId }` | Only while status is INVITED. Emails a new invite link; audit omits the URL | `NOT_FOUND`, `VALIDATION` |
| `sendPasswordReset` | Mutation | `admin.users:manage` | admin | `{ adminId }` | Active admin with a password. Emails a reset link; audit omits the URL | `NOT_FOUND`, `VALIDATION` |
| `updateAdminRole` | Mutation | `admin.users:manage` | admin | `{ adminId, role }` | Not self; not last Super Admin; audit; effective next request | `SELF_ROLE_CHANGE`, `LAST_SUPER_ADMIN`, `NOT_FOUND` |
| `setAdminStatus` | Mutation | `admin.users:manage` | admin | `{ adminId, status: ACTIVE\|DEACTIVATED }` | Not self; not last Super Admin; deactivation revokes sessions; audit. Reactivate does not delete history | same |

## H. Admin — dashboard, civic data, sources, services

| Operation | Kind | Permission | Input highlights | Rules | Errors |
|---|---|---|---|---|---|
| `adminDashboardCounts` | Query | `admin.dashboard:read` | — | Corrections by status/age>5d, stale records per level, failed source runs, pending source changes, alerts last 7d + failures | — |
| `adminJurisdictions` / `adminJurisdiction(id)` | Query | `admin.civic:read` | `filter { level?, type?, state?, status?, parentId?, isPilot?, boundary: OK\|MISSING, freshness?, q? ≤100 }`, `sort: NEWEST\|NAME`, first/after | Includes displayId, aliases, description, isPilot, parentRetired, boundaryStatus, child/office/official counts, freshness, boundary vintage, has-boundary flag (no geometry), sourceRecordUrl. q matches name, displayId, or an alias. Connection includes totalCount | `NOT_FOUND` |
| `adminJurisdictionTree` | Query | `admin.civic:read` | `{ rootId? }` | Nested by parent. rootId returns that subtree; otherwise the top level | — |
| `upsertJurisdiction` | Mutation | `admin.civic:write` | `{ id?, correctionId?, name 2–150, aliases?, description? ≤300, isPilot?, level, type, subtype?, parentId? (required unless FEDERAL or NATION; no cycles; parent level allowed), districtCode? ≤40, geoid? ≤40, state? ^[A-Z]{2}$, website? URL, sourceId, sourceRecordUrl?, lastUpdatedAt, freshnessOverride, freshnessNote? (required if override≠NONE) }` | Name unique per parent. Geometry not editable; audit. correctionId applies that open correction in the same transaction and records the override | `VALIDATION`, `CONFLICT`, `JURISDICTION_CYCLE`, `RECORD_RETIRED`, `INVALID_STATE` |
| `retireJurisdiction` / `restoreJurisdiction` | Mutation | `admin.civic:retire` | `{ id, retireActiveOffices?: bool }` | Super Admin only. Flags children and offices parentRetired. If active offices exist and flag false → error | `FORBIDDEN`, `HAS_ACTIVE_CHILDREN` |
| `adminOffices` / `adminOffice(id)` | Query | `admin.civic:read` | `filter { level?, jurisdictionId?, officeType?, hasOfficial?, missingContact?, vacantOnly?, staleOnly?, status?, q? }`, `sort: NEWEST\|NAME`, first/after | Includes displayId, officeType, parentRetired, freshness, followerCount, and totalCount. q matches name or displayId | — |
| `adminOfficeTiles` | Query | `admin.civic:read` | — | `{ active, vacant, outdated, missingContact }` | — |
| `upsertOffice` | Mutation | `admin.civic:write` | `{ id?, correctionId?, jurisdictionId, name 2–150, seatLabel? ≤60, selectionMethod, officeType: ELECTED\|APPOINTED\|DEPARTMENT\|COMMISSION, displayOrder 0–10000, whyTemplate? ≤300 (tokens: {jurisdiction},{office},{district}), phone? E.164, email?, website?, contactUrl?, addresses[≤5] {label,street,city,state,zip ^\d{5}(-\d{4})?$,phone?,hours?}, holderUnknown, sourceId, sourceRecordUrl?, lastUpdatedAt, freshnessOverride, freshnessNote?, notifyFollowers?: bool }` | Name unique per jurisdiction. Slug generated, unique; audit; if notifyFollowers and contact/holder fields changed → enqueue RECORD_UPDATE fan-out. correctionId applies that open correction in the same transaction | `VALIDATION`, `CONFLICT`, `NOT_FOUND`, `RECORD_RETIRED` |
| `retireOffice` / `restoreOffice` | Mutation | `admin.civic:retire` | `{ id }` | Retired offices hidden from cards; follows kept, hidden | `NOT_FOUND` |
| `adminOfficials` / `adminOfficial(id)` | Query | `admin.civic:read` | `filter { status?, level?, jurisdictionId?, officeType?, freshness?, q?, officeId? }`, `sort: NEWEST\|NAME`, first/after | Official includes displayId, useOfficeAddress, freshness, and terms. Connection includes totalCount. NAME orders by fullName | — |
| `adminOfficialTiles` | Query | `admin.civic:read` | — | Counts officials: `{ active, termsEndingWithin90d, outdated, missingContact }` | — |
| `upsertOfficial` | Mutation | `admin.civic:write` | `{ id?, correctionId?, fullName 2–120, displayName?, party? ≤60, photoUrl? https, website?, useOfficeAddress?, sourceId, sourceRecordUrl?, lastUpdatedAt, freshnessOverride, freshnessNote?, notifyFollowers? }` | audit. correctionId applies that open correction in the same transaction | `VALIDATION`, `RECORD_RETIRED` |
| `setOfficeTerm` | Mutation | `admin.civic:write` | `{ officeId, officialId, status: ELECTED\|APPOINTED\|ACTING, termStart?, termEnd?, makeCurrent: bool, notifyFollowers? }` | One active official per office. makeCurrent refuses when a different official is already current. Clears holderUnknown; audit; optional fan-out | `NOT_FOUND`, `OFFICE_HAS_ACTIVE_OFFICIAL`, `VALIDATION` |
| `endOfficeTerm` | Mutation | `admin.civic:write` | `{ termId, termEnd? }` | Returns `{ term, office }` where office is the full admin office. Office becomes vacant | `NOT_FOUND` |
| `retireOfficial` / `restoreOfficial` | Mutation | `admin.civic:retire` | `{ id }` | Must have no current term | `HAS_CURRENT_TERM` |
| `adminServices` / `adminService(id)` | Query | `admin.civic:read` | `filter { categoryId?, status: ACTIVE\|INACTIVE, needsValidation?, linkBroken?, q? }`, `sort: NEWEST\|NAME`, first/after | Service includes displayId, email, and links. needsValidation is last validated more than 180 days ago. q matches title or displayId | — |
| `upsertService` | Mutation | `admin.civic:write` | `{ id?, correctionId?, title 3–120, categoryId, description 20–300, url? https, phoneContact? ≤120, email?, jurisdictionIds[], officeIds[] (≥1 total; at least one of url, phone, email), lastValidatedAt, sourceId }` | Replace links in same tx; audit. correctionId applies that open correction in the same transaction. An inactive service counts as retired | `VALIDATION`, `RECORD_RETIRED` |
| `markServiceValidated` | Mutation | `admin.civic:write` | `{ id }` | Sets lastValidatedAt to now; audit | `NOT_FOUND` |
| `retireService` / `restoreService` | Mutation | `admin.civic:retire` | `{ id }` | Retire sets status INACTIVE. Restore sets ACTIVE | — |
| `upsertServiceCategory` | Mutation | `admin.civic:write` | `{ id?, name 2–60 unique, sortOrder, active }` | — | `CONFLICT` |
| `adminSources` / `adminSource(id)` | Query | `admin.civic:read` | — | Includes displayId, kind, termsOfUseUrl, outdatedAfterDays, coverage, notes, status, health, recordsUsingCount, lastSuccessAt, lastAttemptAt, and the last 20 runs. Paused and retired sources are skipped by the pipeline | — |
| `upsertSource` | Mutation | `admin.source:write` | `{ id?, name 2–150 unique, publisher, url https, termsUrl https, method, kind?, notes? ≤500, schedule, freshnessDays 1–730, levels[], collectorKey? (must exist in registry), active }` | audit. active false stores status PAUSED | `VALIDATION`, `CONFLICT`, `UNKNOWN_COLLECTOR` |
| `pauseSource` / `resumeSource` | Mutation | `admin.source:write` | `{ sourceId }` | Pause sets status PAUSED and active false. Resume sets ACTIVE | `NOT_FOUND` |
| `triggerSourceRefresh` | Mutation | `admin.source:run` | `{ sourceId }` | Reject if a run is QUEUED/RUNNING; enqueue job; audit | `RUN_IN_PROGRESS`, `SOURCE_INACTIVE` |
| `pendingSourceChanges` | Query | `admin.civic:read` | `filter { sourceId?, decision? }` | — | — |
| `decideSourceChange` | Mutation | `admin.source:decide` | `{ id, decision: ACCEPTED\|REJECTED }` | Accept applies value with audit actor ADMIN | `ALREADY_DECIDED` |
| `changeLog` | Query | `admin.changelog:read` | `{ entityType, entityId, first, after }` | — | — |

## I. Admin — corrections

| Operation | Kind | Permission | Input | Rules | Errors |
|---|---|---|---|---|---|
| `adminCorrections` | Query | `admin.correction:read` | `filter { status?, level?, entityType? or recordType?, field?, olderThanDays?, submittedFrom?, submittedTo?, assignedToMe?, q? }` | Oldest pending first. Submitter is displayName and account id only. q matches displayId. Each row includes the record brief | — |
| `adminCorrection(id)` | Query | `admin.correction:read` | — | Record brief, recordChangedSinceSubmission, recordRetired, otherOpenCorrections, decidedAt, decidedBy | `NOT_FOUND` |
| `adminCorrectionTiles` | Query | `admin.correction:read` | — | `{ pending, inReview, applied30d, dismissed30d }` | — |
| `assignCorrection` | Mutation | `admin.correction:resolve` | `{ id, assigneeId? (default self) }` | Assignee must have `admin.correction:resolve` | `NOT_FOUND`, `INVALID_STATE` |
| `markCorrectionInReview` | Mutation | `admin.correction:resolve` | `{ id }` | SUBMITTED → IN_REVIEW | `INVALID_STATE` |
| `applyCorrection` | Mutation | `admin.correction:resolve` | `{ id, value (validated by field type), sourceId? \| sourceUrl?, notifyFollowers? }` | Open only. Refuses a retired record or inactive service. Updates the target, sets the override, status APPLIED; audit both | `INVALID_STATE`, `VALIDATION`, `RECORD_RETIRED` |
| `dismissCorrection` | Mutation | `admin.correction:resolve` | `{ id, reason: CANT_VERIFY\|SOURCE_CORRECT\|DUPLICATE\|OUT_OF_SCOPE\|OTHER, note? ≤500 (required if OTHER) }` | Open only; DISMISSED; audit | `INVALID_STATE`, `VALIDATION` |
| `addCorrectionNote` | Mutation | `admin.correction:resolve` | `{ id, body 1–2000 }` | Internal only | `NOT_FOUND` |

State machine: `SUBMITTED → IN_REVIEW → APPLIED | DISMISSED`; `SUBMITTED → APPLIED | DISMISSED` allowed; APPLIED/DISMISSED are terminal.

## J. Admin — alerts

| Operation | Kind | Permission | Input | Rules | Errors |
|---|---|---|---|---|---|
| `adminAlerts` / `adminAlert(id)` | Query | `admin.alert:read` | `filter { status?, channel?, targetType?, targetOfficeId?, sentFrom?, sentTo?, sentBy?, q? }` | Includes displayId. q matches displayId or title. Detail adds followerCount, per-channel targeted/sent/delivered/failed/notEligible, opens, clicks, top failure reasons, sentBy, sentAt | — |
| `adminAlertTiles` | Query | `admin.alert:read` | — | `{ total, sent7d, drafts, failedOrPartly }` | — |
| `saveAlertDraft` | Mutation | `admin.alert:write` | `{ id?, targetOfficeId? \| targetOfficialId? (exactly one), title 5–80, body 10–500, link? https (default target profile), channels ≥1 of IN_APP\|EMAIL\|PUSH }` | Draft only. Profile link is added when link is omitted | `VALIDATION`, `ALERT_ALREADY_SENT` |
| `deleteAlertDraft` | Mutation | `admin.alert:write` | `{ id }` | Draft only (hard delete allowed for drafts) | `ALERT_ALREADY_SENT` |
| `previewAlert` | Query | `admin.alert:write` | `{ id }` | Rendered in-app / email / push + recipientCount per channel after preferences | — |
| `sendTestAlert` | Mutation | `admin.alert:write` | `{ id }` | Sends to the admin's own email only (admins have no push) | — |
| `sendAlert` | Mutation | `admin.alert:send` | `{ id, confirmRecipientCount: int }` | Draft → SENDING atomically (`UPDATE … WHERE status='DRAFT'`); count must match current count ±5% else `RECIPIENTS_CHANGED`; enqueue fan-out; audit; rate 10/hour/admin. Finalize sets SENT, PARTLY_FAILED, or FAILED from delivery rows. Sent alerts stay final | `ALERT_ALREADY_SENT`, `RECIPIENTS_CHANGED`, `NO_RECIPIENTS` |
| `duplicateAlertAsDraft` | Mutation | `admin.alert:write` | `{ id }` | Copies target, title, message, link, and channels into a new draft | `NOT_FOUND` |

## K. Background jobs (worker, System principal)

| Job | Permission | Trigger | Idempotency | Retry |
|---|---|---|---|---|
| `notify.fanout` | `system.notifications:deliver` | sendAlert / record update with notifyFollowers | `notifications (user_id, source_ref)` unique | 5, backoff |
| `notify.deliver.email` / `notify.deliver.push` | `system.notifications:deliver` | per delivery row | `notification_deliveries.dedupe_key` unique; skip if status ≠ QUEUED | 3, backoff; 410/404 push token → revoke subscription |
| `alert.finalize` | `system.notifications:deliver` | after fan-out | sets status SENT, recipient_count, sent_at | 3 |
| `billing.applyEvent` | `system.billing:sync` | webhook | `stripe_events.processed_at` | 8, backoff |
| `billing.syncPlans` | `system.billing:sync` | daily + `product/price.updated` | list active Prices with Products (10s timeout); upsert by `stripe_price_id` (name, amount, currency, interval, features and entitlements from product metadata); `active=false` when the price is no longer active | 3 |
| `source.run` | `system.pipeline:run` | schedule / triggerSourceRefresh | one active run per source | per source config |
| `locations.reresolve` | `system.locations:reresolve` | nightly 03:00 UTC | overwrite | 2 |
| `services.linkcheck` | `system.locations:reresolve` | nightly | overwrite flag | 2 |
| `retention.lookups` / `retention.sessions` / `retention.stripeEvents` | `system.retention:run` | daily | delete-where | 2 |
| `accounts.purge` | `system.retention:run` | daily | `purged_at` set | 3; partial failure resumes |
| `email.contact` / `email.accountDeletion` | `system.notifications:deliver` | on demand | job key = entity id. Contact mail goes to `CONTACT_INBOX` (Reply-To = sender, `emailed_at` on success). Deletion mail is plain text + HTML to the resident (purge date, restore within `ACCOUNT_PURGE_DAYS`, no tokens or ids). Provider failure is `UPSTREAM_UNAVAILABLE` and retries | 3 |

Purge (`accounts.purge`) for each due deletion request: delete saved_locations, follows, notifications
(+ deliveries), preferences, push subscriptions, sessions, identities, lookups; null `corrections.user_id`;
replace user email with `deleted+<id>@invalid`, display name `Deleted user`, status DELETED; keep
stripe_customers/subscriptions/invoices rows only as Stripe requires for legal records (no PII beyond ids).
