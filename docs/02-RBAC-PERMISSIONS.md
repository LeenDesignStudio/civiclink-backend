# 02 — Roles, Permissions and Access Rules

This is the authorization contract for CivicLink Phase 1. Code in `src/authz/permissions.ts` must
match this file exactly, and `test/authz-matrix.test.ts` is generated from the matrix in section 3.
Operation-level mapping (which GraphQL operation needs which permission) is in
`05-API-OPERATIONS.md`, column "Permission".

Default rule: **everything is denied unless this document allows it.**

---

## 1. Principals (who can call the API)

| Principal | How they authenticate | Notes |
|---|---|---|
| **Anonymous** | none | Any visitor. Can use every public feature; discovery never requires sign-in (SOW A3). |
| **Resident** | Google or Apple OIDC → access JWT + rotating refresh token | One per person. Sub-states below change what they may do. |
| **Admin — Viewer** | Google Workspace OIDC + `admin_users` allowlist → admin session | Read-only QubaLink staff. |
| **Admin — Editor** | same | Maintains civic data, sources, services; resolves corrections. |
| **Admin — Communications** | same | Writes and sends alerts. |
| **Admin — Super Admin** | same | Everything admins can do, plus managing admin users. |
| **System** | internal only (worker process, verified Stripe webhook) | Never reachable from GraphQL. |

Resident sub-states (checked on every request):

| Sub-state | Condition | Allowed |
|---|---|---|
| `ACTIVE` + terms accepted | normal | All resident permissions |
| Terms not accepted (new account or Terms version changed) | `users.terms_version` ≠ current | Public operations + `me`, `acceptTerms`, `signOut` only. Others → `TERMS_REQUIRED` |
| `PENDING_DELETION` | deletion requested, within 30 days | Public operations + `me`, `restoreAccount`, `signOut` only. Others → `ACCOUNT_PENDING_DELETION` |
| `DELETED` | purged | Cannot sign in (`ACCOUNT_DELETED`); sessions revoked |

A request carries exactly one principal. An admin session never grants resident abilities and vice versa;
QubaLink staff who want resident features use a normal resident account.

---

## 2. Permission catalogue

### Public (granted to every principal, including Anonymous)
| Permission | Allows |
|---|---|
| `public.civic:read` | Civic Card by lookup token, office/official profiles, services and resources, service categories |
| `public.lookup:create` | Resolve a location (address, ZIP, city+state, device coordinates), reverse geocode |
| `public.plans:read` | Read active subscription plans (pricing page) |
| `public.contact:create` | Submit the contact form (Turnstile + rate limit) |
| `public.legal:read` | Read current Terms / Privacy versions |

### Resident (self only — every one of these is limited to the caller's own records)
| Permission | Allows |
|---|---|
| `self.profile:read` | Read own profile, consent state, subscription summary, unread count |
| `self.profile:update` | Update display name and marketing opt-in; accept Terms/Privacy |
| `self.session:manage` | Sign out this device; sign out everywhere |
| `self.account:delete` | Request account deletion; restore within 30 days |
| `self.locations:manage` | List, save, relabel, set default, delete own saved locations |
| `self.follows:manage` | List, follow, unfollow offices/officials |
| `self.notifications:manage` | Read, mark read, delete own notifications; read/update own preferences; register/remove own push subscriptions; send a test notification to self |
| `self.corrections:create` | Submit a data-correction request |
| `self.corrections:read` | List own corrections and their status/dismiss reason |
| `self.billing:manage` | Read own subscription and invoices; create Stripe Checkout and Portal sessions for self |

### Admin
| Permission | Allows |
|---|---|
| `admin.dashboard:read` | Work-queue counters on admin home |
| `admin.civic:read` | Read jurisdictions, offices, officials, terms, services, categories, sources, source runs, pending source changes — including RETIRED records and source record URLs |
| `admin.civic:write` | Create/update jurisdictions (metadata only), offices, office addresses, officials, office terms, services, service categories; set freshness overrides; tick "notify followers" on a record update |
| `admin.civic:retire` | Retire (and un-retire) jurisdictions, offices, officials, services |
| `admin.source:write` | Create/update sources (name, URLs, method, schedule, freshness days, active) |
| `admin.source:run` | Trigger an on-demand source refresh |
| `admin.source:decide` | Accept/reject pending source changes from page collection |
| `admin.correction:read` | Read the corrections queue and correction detail (submitter shown by display name only) |
| `admin.correction:resolve` | Assign, mark in review, apply (with source), dismiss (with reason), add internal notes |
| `admin.alert:read` | Read alerts and delivery statistics |
| `admin.alert:write` | Create/edit/delete **draft** alerts, preview, send a test to self |
| `admin.alert:send` | Send an alert to followers (irreversible) |
| `admin.changelog:read` | Read change history of any civic record / correction / alert / admin user |
| `admin.export:csv` | Export the current admin list view as CSV (civic data, corrections, alerts — never resident PII) |
| `admin.users:read` | List admin users |
| `admin.users:manage` | Invite admin, change role, deactivate/reactivate admin |

### System (worker / webhook only)
| Permission | Allows |
|---|---|
| `system.pipeline:run` | Run source collectors; write civic records and pending changes; write source runs |
| `system.notifications:deliver` | Fan out notifications and deliver email/push; update delivery status |
| `system.billing:sync` | Apply verified Stripe webhook events; sync plans from Stripe |
| `system.retention:run` | Delete expired lookups/sessions/events; purge accounts past their restore window |
| `system.locations:reresolve` | Nightly re-resolution of saved locations; link checks on services/websites |

---

## 3. Role → permission matrix

`●` = granted, blank = denied. Public permissions are granted to every row and omitted.

| Permission | Resident | Viewer | Editor | Communications | Super Admin | System |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `self.profile:read` | ● | | | | | |
| `self.profile:update` | ● | | | | | |
| `self.session:manage` | ● | | | | | |
| `self.account:delete` | ● | | | | | |
| `self.locations:manage` | ● | | | | | |
| `self.follows:manage` | ● | | | | | |
| `self.notifications:manage` | ● | | | | | |
| `self.corrections:create` | ● | | | | | |
| `self.corrections:read` | ● | | | | | |
| `self.billing:manage` | ● | | | | | |
| `admin.dashboard:read` | | ● | ● | ● | ● | |
| `admin.civic:read` | | ● | ● | ● | ● | |
| `admin.civic:write` | | | ● | | ● | |
| `admin.civic:retire` | | | ● | | ● | |
| `admin.source:write` | | | ● | | ● | |
| `admin.source:run` | | | ● | | ● | |
| `admin.source:decide` | | | ● | | ● | |
| `admin.correction:read` | | ● | ● | ● | ● | |
| `admin.correction:resolve` | | | ● | | ● | |
| `admin.alert:read` | | ● | ● | ● | ● | |
| `admin.alert:write` | | | | ● | ● | |
| `admin.alert:send` | | | | ● | ● | |
| `admin.changelog:read` | | ● | ● | ● | ● | |
| `admin.export:csv` | | ● | ● | ● | ● | |
| `admin.users:read` | | | | | ● | |
| `admin.users:manage` | | | | | ● | |
| `system.pipeline:run` | | | | | | ● |
| `system.notifications:deliver` | | | | | | ● |
| `system.billing:sync` | | | | | | ● |
| `system.retention:run` | | | | | | ● |
| `system.locations:reresolve` | | | | | | ● |

---

## 4. What each role CAN and CANNOT do

### Anonymous visitor
**Can**
- Search by full address, ZIP, city+state, or device coordinates and get a lookup token (rate limited 30 / 10 min / IP).
- View the Civic Card for any lookup token, office and official profiles, services and resources.
- Read pricing plans and current legal document versions; submit the contact form (Turnstile, 5 / hour / IP).
- Start Google/Apple sign-in with an intent (save / follow / report / subscribe / notifications).

**Cannot**
- Save locations, follow, set notification preferences, report corrections, subscribe (→ `UNAUTHENTICATED`; the client opens the sign-in sheet).
- See any other user's data, any admin data, `source_record_url`, retired records, or anything in `admin*` operations.
- Call any mutation except `submitContactMessage` (location resolution is a query).

### Resident
**Can** (always only on their own records)
- Everything Anonymous can.
- Accept Terms/Privacy; update display name and product-update opt-in; read own profile.
- Save up to the plan limit of locations (default 5), label Home/Work/Other, set one default, rename, delete.
- Follow up to the plan limit (default 50) offices/officials; unfollow.
- Read, mark read, delete own notifications; set channel preferences (in-app locked on); register/remove push subscriptions for own devices; send a test notification to self.
- Submit corrections (10 / day; one open request per entity+field); see own corrections with status and dismiss reason.
- Start Stripe Checkout and open the Stripe Portal for self; read own subscription and invoices.
- Sign out this device / everywhere; request account deletion; restore within 30 days.

**Cannot**
- Read or change any other resident's data — any attempt with another resident's id returns `NOT_FOUND`.
- See who else follows an office, other residents' corrections, or any admin-only field (internal notes, assignee, change log).
- Call any `admin*` operation (→ `FORBIDDEN`).
- Change their email or sign-in provider (comes from Google/Apple).
- Bypass plan limits, the correction daily limit, or the duplicate-open-correction rule.
- Do anything other than `me`, `restoreAccount`, `signOut` while `PENDING_DELETION`; anything other than `me`, `acceptTerms`, `signOut` until Terms are accepted.

### Admin — Viewer
**Can**: open admin home counters; read every civic record (incl. retired), sources, runs, pending source changes, services, corrections queue and detail, alerts and delivery stats, change history; export list views to CSV.
**Cannot**: create, edit, retire anything; resolve corrections; trigger source runs; write or send alerts; manage admins.

### Admin — Editor
**Can**: everything Viewer can, plus create/update/retire jurisdictions (metadata, not geometry), offices, office addresses, officials and terms, services and categories; set freshness overrides with a note; tick "notify followers" when saving a record change (sends a Record Update notification); manage sources and trigger refreshes; accept/reject pending source changes; assign, review, apply and dismiss corrections, add internal notes.
**Cannot**: write or send alerts; manage admin users; draw or upload boundary geometry (pipeline only); hard-delete anything.

### Admin — Communications
**Can**: everything Viewer can, plus create, edit and delete draft alerts; preview; send a test to self; send alerts to the followers of one office or official (10 sends / hour).
**Cannot**: edit civic data, sources or services; resolve corrections; manage admin users; edit or recall an alert after it is sent.

### Admin — Super Admin
**Can**: everything Editor and Communications can, plus invite admins by email, change roles, deactivate/reactivate admins.
**Cannot**: demote/deactivate the last active Super Admin (`LAST_SUPER_ADMIN`); change their own role or deactivate themselves (`SELF_ROLE_CHANGE`); read resident PII (see section 5); impersonate residents; edit or delete the change log; hard-delete civic records.

### System
**Can**: run collectors and write civic data/pending changes; deliver notifications; apply verified Stripe events; run retention and purge; re-resolve saved locations; check links.
**Cannot**: be invoked through GraphQL or any unauthenticated route. Stripe processing runs only after signature verification.

---

## 5. Data visibility rules (field level)

| Data | Anonymous | Resident (own) | Resident (others') | Any admin | System |
|---|---|---|---|---|---|
| Civic records (active) | ✓ | ✓ | — | ✓ | ✓ |
| Retired civic records, `source_record_url`, freshness note | ✗ | ✗ | — | ✓ | ✓ |
| Resident email | ✗ | ✓ | ✗ | ✗ | ✓ (delivery only) |
| Resident display name | ✗ | ✓ | ✗ | ✓ only on corrections they submitted | ✓ |
| Saved locations, lookups with user id | ✗ | ✓ | ✗ | ✗ | ✓ (re-resolve) |
| Follows | ✗ | ✓ | ✗ | counts only (followers per office) | ✓ (fan-out) |
| Notifications, preferences, push tokens | ✗ | ✓ | ✗ | ✗ (alert stats are aggregates) | ✓ |
| Corrections | ✗ | ✓ own (no internal notes/assignee) | ✗ | ✓ incl. notes | ✓ |
| Subscriptions, invoices, Stripe ids | ✗ | ✓ own (no Stripe ids) | ✗ | ✗ | ✓ |
| Sessions, IP hashes | ✗ | ✗ (only "signed in on N devices" count) | ✗ | ✗ | ✓ (retention) |
| Admin users list | ✗ | ✗ | ✗ | Super Admin only | ✗ |
| Change log | ✗ | ✗ | ✗ | ✓ | write only |

---

## 6. Audit

Every admin mutation and every system write to civic data appends a `change_log` row in the same
transaction: `actor_type` (ADMIN / SYSTEM / SOURCE / RESIDENT), `actor_id` (admin id or null),
`entity_type`, `entity_id`, `action`, `before`, `after` (changed non-secret fields only), `request_id`.
Resident-originated entries (e.g. correction submitted) use `actor_type = RESIDENT` and `actor_id = NULL`
so account purge never needs to modify the log. The table is append-only (DB trigger + revoked grants).

Logged admin actions include: sign-in success/failure, admin invited/role changed/deactivated,
every civic create/update/retire, freshness override, source change accept/reject, source run triggered,
correction assigned/applied/dismissed, alert created/edited/sent, CSV export (list + filter, not contents).
