# 10 — Aligned build steps: backend + existing frontend

Built from `docs/ALIGNMENT-REPORT.md` (frontend `civiclink-web`, backend `civiclink-backend`) and
`docs/08-ADMIN-SPEC.md` (23 Oct admin spec). This file **replaces** `09-ADMIN-SPEC-BUILD-STEPS.md`.

## Decisions this plan uses

| Topic | Decision | Why |
|---|---|---|
| Source of truth for admin | `docs/08-ADMIN-SPEC.md`. It overrides `docs/FE-01-SCREENS.md` section 3 (A-01–A-18). | 08 is newer and matches the existing frontend design |
| Admin login | Email + password, forgot/reset, invites. No Google for admins. | 08 section 5 + the frontend already has these screens |
| Backend route names | Match the frontend: `POST /admin-auth/login`, `/admin-auth/forgot-password`, `/admin-auth/reset-password` | The frontend already calls them |
| Detail / add / edit screens | **Drawers on the existing list pages**, not new routes | No extra pages. (08 section 4.3 says full page; confirm a drawer is acceptable) |
| CSV export | Not built; remove `exportCsv` | 08 section 4.2 + section 19 |
| Roles | Two: SUPER_ADMIN, ADMIN_STAFF | 08 section 17 |
| Out of scope, to remove | Followers chart, Upcoming Events tile, `/events`, home events/donate/claim/district-map/app-store blocks | SOW A20 + 08 section 6.6 |
| Frontend stack | Keep what exists: `src/lib/apiClient.ts`, `src/services/*`, Zustand stores, existing UI components and styling | Don't migrate to another data library |
| New routes allowed | Only: `/admin/civic-cards` (+ `[id]`) after QubaLink confirms; resident `/card/[token]`, `/officials/[slug]`, `/offices/[slug]`, `/me/*` | No existing page can host them |

## How to run

1. Copy `08-ADMIN-SPEC.md` and this file into **both** repos' `docs/` folders.
2. One Cursor window with both folders (File → Add Folder to Workspace).
3. Branches: `feat/admin-spec` in both repos.
4. Run the steps in the **order** below, one Cursor chat per step. Prefix `BE` = backend folder, `FE` = frontend folder.
5. After each step, the checks must pass, then commit in that repo:
   - Backend: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
   - Frontend: the project's lint, typecheck and build scripts (`npm run lint`, `npx tsc --noEmit`, `npm run build`)

**Order:** FE-0 → BE-1 → FE-1 → FE-2 → BE-2 → BE-3 → BE-4 → FE-3 → FE-4 → FE-5 → FE-6 → FE-7 → FE-8 →
FE-9 → BE-5 → FE-10 → BE-6 → FE-11 → FE-12 → FE-13 (FE-11 waits for QubaLink's OK on Civic Cards).

### Guard (top of every prompt; Cursor reads it from the rules after FE-0)

> Source of truth for admin: `docs/08-ADMIN-SPEC.md`. It overrides `docs/FE-01-SCREENS.md` section 3.
> Change only what this step lists. FRONTEND: keep the existing design, layout, components, classes and
> copy style; reuse `src/components/ui` (DataTable, Pagination, Pill, Select, Input, Button, Card, Skeleton,
> ErrorState…); all API calls go through `src/lib/apiClient.ts` and `src/services/*`; **create no new route**
> unless this step names it; every action has loading, empty, success, validation-error, permission-denied
> and network-error states (08 section 22). BACKEND: zod validation, permission check, change-log entry,
> error codes in `docs/03-ERROR-CATALOG.md` and tests on every new mutation; migrations only via
> `prisma migrate dev`. Before changing anything, read the existing code for this area and list what exists.

---

## FE-0 — Rules and docs match reality (frontend, no app code)

```
1. Rewrite .cursor/rules/20-api-data.mdc to describe the real stack: src/lib/apiClient.ts (apiQuery/apiClient,
   CSRF header, /auth/refresh retry), GraphQL documents in src/services/*.ts, Zustand stores in src/store,
   react-hot-toast. Remove the TanStack Query and src/lib/api/client.ts references.
2. In .cursor/rules/00-core.mdc: add "docs/08-ADMIN-SPEC.md is the admin source of truth and overrides
   docs/FE-01-SCREENS.md section 3", the allowed-new-routes list from docs/10-ALIGNED-BUILD-STEPS.md, and
   "detail/add/edit = drawer on the list page".
3. At the top of docs/FE-01-SCREENS.md section 3, add a line: "Superseded by docs/08-ADMIN-SPEC.md".
4. Add src/lib/labels.ts: one map from backend enums to the display labels in 08 section 4.6 and 18.2
   (e.g. CorrectionStatus SUBMITTED→"Pending", IN_REVIEW→"In Review", APPLIED→"Applied",
   DISMISSED→"Dismissed"; RecordStatus ACTIVE→"Active", RETIRED→"Retired"; services ACTIVE/INACTIVE). Every
   badge shows text, never colour alone. Replace the scattered label maps (AdminDashboard.tsx, list tiles)
   with this file. No visual change except the corrected words.
5. Add src/lib/errorMessages.ts: ApiError code → user message (the messages in 08 sections 5 and 22).
```

## BE-1 — Admin email + password auth (backend)

```
Read docs/08-ADMIN-SPEC.md sections 5, 15, 16.2, 21, 22 and src/http/routes/admin-auth.ts. Check whether
earlier scripts (e.g. b4a 2FA columns) added admin password/2FA fields; reuse or remove them (no MFA).
1. Schema: AdminUser + passwordHash (nullable until invite accepted), passwordUpdatedAt, failedLoginCount,
   lockedUntil, lastLoginAt, invitedById, invitedAt. Table AdminAuthToken (adminUserId, purpose INVITE|RESET,
   tokenHash sha256, expiresAt, usedAt). Only token hashes are stored.
2. argon2id. Password rules: ≥12 chars, not equal to the email, not in a bundled common-password list.
3. REST, same paths the frontend already calls, same cookie/CSRF/rate-limit setup:
   POST /admin-auth/login {email,password}: one error ADMIN_INVALID_CREDENTIALS for unknown/wrong/
     deactivated; 5 failures → 15-min lock → ADMIN_LOCKED with retryAfterSeconds; success sets lastLoginAt
     and the session cookie. JSON response (no redirect) {ok:true}.
   POST /admin-auth/forgot-password {email}: always 202, same body; active account → RESET token (60 min,
     single use) + reset email via pg-boss and the existing email provider. Link:
     <PUBLIC_WEB_URL>/admin/update-password?token=…
   POST /admin-auth/reset-password {token,password}: handles RESET and INVITE (7 days) tokens; expired/used
     → ADMIN_TOKEN_EXPIRED; success sets password, marks token used, INVITED→ACTIVE, revokes other sessions.
   Keep the adminSignOut mutation as logout.
4. GraphQL: myAdminProfile, updateMyProfile(name), changeMyPassword(current,new) (revokes other sessions).
5. Idle timeout 30 min (sliding lastSeenAt; SESSION_EXPIRED when idle). adminMe returns sessionExpiresAt.
6. Remove /admin-auth/google/* and ADMIN_GOOGLE_* env vars. Resident Google/Apple sign-in unchanged.
7. CLI: pnpm admin:create --email --name --role SUPER_ADMIN → prints a one-time invite link.
Tests: lockout, enumeration-safe errors, token expiry/reuse, session revoke, idle timeout.
Update docs/02, 03, 04, 05, .env.example.
```

## FE-1 — Shared building blocks (frontend)

```
Using the existing styling and components (no new visual language), add to src/components/ui:
Drawer (right side, full-width on mobile, focus trap, Esc, unsaved-changes confirm), ConfirmDialog (optional
required note/reason field), RowMenu (three-dot: View, Edit, Retire/Reactivate + extras), FormSection,
FieldError + ErrorSummary (focus first error), Toast helpers on react-hot-toast, SessionExpiredModal.
Form handling: use the project's existing form approach; if there is none, add react-hook-form + zod.
Add src/lib/forms.ts to map ApiError.fieldErrors[].path ("input.name") onto form fields.
Add a useDrawerParam hook: the open drawer lives in the URL (?view=<id>, ?edit=<id>, ?new=1) so it is
shareable and Back closes it, without adding routes.
```

## FE-2 — Auth screens wired to BE-1 (frontend)

```
Pages that exist: /admin/login, /admin/forgot-password, /admin/update-password. Keep their design.
1. Login: wire to POST /admin-auth/login. Remove "Continue with Google" (08 section 5). Errors per 08 5.1:
   empty fields, ADMIN_INVALID_CREDENTIALS → "Email or password is incorrect", ADMIN_LOCKED → lock message with
   minutes, network → "Something went wrong. Try again." Enter submits. Success → ?next= (relative /admin
   paths only) or /admin.
2. Forgot: POST /admin-auth/forgot-password; always show the generic confirmation; "Back to log in".
3. Update password: POST /admin-auth/reset-password with ?token=; rules shown beside the field (≥12, not
   email); mismatch error; ADMIN_TOKEN_EXPIRED → the expired state on the same page with "Request a new link".
   If ?invite=1, heading "Welcome to CivicLink: set your password". Success → "Password updated" + Log In.
4. Session: on SESSION_EXPIRED from any admin call show SessionExpiredModal ("Log in again", returns to the
   same page). Warn 2 minutes before adminMe.sessionExpiresAt.
5. Gear menu (top bar): My Profile and Change password as Drawers (no pages): myAdminProfile,
   updateMyProfile, changeMyPassword. Profile icon menu: name, role, Logout (adminSignOut).
```

## BE-2 — Two roles + Admin Users (backend)

```
Read 08 sections 2, 15, 17. Roles become SUPER_ADMIN and ADMIN_STAFF. Keep permission strings, map them to
the section 17 matrix (ADMIN_STAFF: no jurisdiction retire, sources view only, no Admin Users). Data migration:
SUPER_ADMIN stays, VIEWER/EDITOR/COMMUNICATIONS → ADMIN_STAFF. Remove the old roles from code and docs/02.
Admin Users (SUPER_ADMIN only): adminUsers adds createdBy name, createdAt and tiles (total, superAdmins,
staff, invited). inviteAdmin(name, email unique, role) sends the invite (no domain rule). updateAdminUser(id,
role?, name?), resendInvite, sendPasswordReset, setAdminStatus(ACTIVE|DEACTIVATED) revokes sessions.
Guards: no self-deactivate, no own role change, last active SUPER_ADMIN can't be deactivated/demoted
(LAST_SUPER_ADMIN). Never delete. Tests for every guard. Update docs/02, 03, 05.
```

## BE-3 — Data model to 08 + remove CSV (backend)

```
Read 08 sections 4.4, 4.6, 8–10, 12, 13, 18, 20, 24.
1. displayId on jurisdictions/offices/officials/services/corrections/sources/alerts: JUR, OFF, PER, SVC,
   COR, SRC, ALT + 4 digits, one sequence per prefix, backfilled. Searchable.
2. Jurisdictions: aliases[], description, isPilot, boundaryStatus OK|MISSING (computed), childCount,
   officeCount, officialCount, freshness (computed server field so the UI stops computing it). Hierarchy
   rules (parent required except FEDERAL, no cycles, level order, name unique per parent). Retire is
   SUPER_ADMIN only; children/offices flagged parentRetired. Make AdminJurisdiction.status a RecordStatus
   enum, not String. Add adminJurisdictionTree(rootId?).
3. Offices: officeType ELECTED|APPOINTED|DEPARTMENT|COMMISSION, name unique per jurisdiction, freshness
   field, filters hasOfficial and missingContact. Officials: one ACTIVE official per office
   (OFFICE_HAS_ACTIVE_OFFICIAL), termStart/termEnd, useOfficeAddress; filters level, jurisdictionId,
   officeType, freshness; tile counts are officials (not offices); termsEndingWithin90d count.
4. Services: status ACTIVE|INACTIVE (migrate RETIRED→INACTIVE), description ≤300, ≥1 of url/phone/email,
   ≥1 of office/jurisdiction, markServiceValidated(id), needsValidation (>180 days) filter/count.
5. Sources: type API|BULK_EXPORT|SCHEDULED_PAGE|MANUAL, termsOfUseUrl, coverage, outdatedAfterDays
   (required), notes, status ACTIVE|PAUSED|RETIRED + computed health HEALTHY|OVERDUE|FAILED|PAUSED,
   pauseSource/resumeSource, recordsUsingCount, lastSuccessAt, lastAttemptAt. Paused sources are skipped.
6. Freshness = lastUpdatedAt + source.outdatedAfterDays unless overridden. Override: overrideActive,
   overrideReason (required), overriddenBy/At. Refresh never overwrites an overridden field; sets
   sourceChangedSinceOverride when the source differs.
7. Remove exportCsv, enum ExportList, its job, permission, /dev/exports route and tests.
Tests for every rule. Update docs/05 and schema.graphql.
```

## BE-4 — Corrections + Alerts to 08 (backend)

```
Read 08 sections 11, 14, 22. Keep enum values (UI labels come from the frontend labels map).
Corrections: list fields displayId, recordType, record{id,displayId,name}, field, currentValue, proposedValue,
description, submittedBy{displayName, accountId} only, evidenceUrl, status, decidedAt, decidedBy; filters status,
recordType, field, date range, age; oldest pending first; tiles pending, inReview, applied30d, dismissed30d.
Detail: recordChangedSinceSubmission, recordRetired, otherOpenCorrections. dismissCorrection requires
reasonCode CANT_VERIFY|SOURCE_CORRECT|DUPLICATE|OUT_OF_SCOPE|OTHER (+ note required for OTHER).
applyCorrection blocked on retired records (RECORD_RETIRED); with field+value it updates the record and
override fields; upsert mutations accept correctionId to apply via edit in the same transaction.
Alerts: exactly one target (office OR official); title ≤80, message ≤500, ≥1 channel; profile link auto-added.
adminAlert: followerCount, per-channel {targeted, sent, delivered, failed, notEligible}, top failure reasons,
opens/clicks where available, sentBy, sentAt. duplicateAlertAsDraft(id). Status adds PARTLY_FAILED; sent is
final. Tiles total, sent7d, drafts, failedOrPartly. Tests; docs/03, 05.
```

## FE-3 — Dashboard to 08 section 6 (frontend, page `/admin`)

```
Keep the page layout and components. Remove AdminFollowersChartCard (and apexcharts if unused elsewhere),
the Upcoming Events tile and Active Users tile.
Tiles (08 6.2): Pending corrections (+ oldest age), Records may be outdated, Source issues, Alerts needing
attention, each linking to the filtered list. Use totalCount, never edges.length.
Totals strip: officials, offices, jurisdictions, services. Until BE-5 ships, use the existing
adminDashboardCounts + list totalCounts; swap to adminDashboard in FE-10.
Replace the "recent activity" table with the Needs attention table (Type, Item, Reason, Age, Action).
Create menu (08 6.1): Add office/official/jurisdiction/service, New alert (+ Add admin user for Super Admin);
each opens the drawer on its list page via ?new=1, not /new routes.
```

## FE-4 — All admin list pages to 08 (frontend, existing pages only)

```
Pages: /admin/jurisdictions, /offices, /officials, /services, /sources, /corrections, /alerts, /users.
For each, per 08 sections 7–15 and 4.2:
- Tiles exactly as 08 lists for that module (fixes: offices "Missing Identifiers" → 08 tiles; officials
  tiles count officials; "Inactive"/"Updated Queues" wording via labels.ts).
- Columns and filters as 08 lists (use the new BE-3/BE-4 fields; freshness from the server field).
- Pagination 25 per page + 25/50/100 selector, sortable headers, ID + name columns sticky, table scrolls
  inside the card, Clear filters, empty states from 08 section 23.
- Row click opens the View drawer (?view=id); RowMenu with View, Edit, Retire/Reactivate (+ module extras).
- Add New button only where the role allows. No export buttons.
- Jurisdictions: table/tree toggle (adminJurisdictionTree).
```

## FE-5 — Corrections review drawer (frontend, on `/admin/corrections`)

```
08 section 11.2: header (displayId, status, submitter name + account ID, date), what was reported,
current vs proposed side by side with the difference highlighted, record context + provenance, other open
corrections, notes. Actions by status: Mark in review, Apply (confirm dialog; or "Apply via edit" opening the
record's edit drawer with correctionId), Dismiss (preset reasons + note). Read-only after decision.
Banners: record changed since submission; Apply disabled if record retired. Refresh tiles + dashboard after.
```

## FE-6 — Civic record drawers (frontend, on jurisdictions/offices/officials/services pages)

```
View and Add/Edit drawers per 08 sections 8–10, 12 and 4.3–4.4:
- Jurisdiction: identity, aliases, level, district, parent (validated), pilot toggle, read-only boundary,
  offices (link/unlink/add), services, provenance, change history.
- Office: identity, officeholder picker or Vacant, contact, linked services, provenance.
- Official: identity, office picker, term start/end (setOfficeTerm/endOfficeTerm), contact (+ use office
  address), provenance.
- Service: name, category, description (300), url/phone/email (≥1), office/jurisdiction (≥1), last validated +
  "Mark as validated today", status.
Shared ProvenanceBlock component (source picker, URL, last updated, freshness, override toggle + reason).
Retire/Reactivate via ConfirmDialog with the 08 wording. Validation on blur and on save; unsaved-changes prompt.
Success toast, return to the View drawer.
```

## FE-7 — Sources drawer (frontend, on `/admin/sources`)

```
08 section 13: View (fields, refresh history, records using this source with links), Add/Edit (all fields
incl. type, terms-of-use URL, coverage, schedule, outdated after days), Pause/Resume, Retire, Refresh now
(disabled while running; RATE_LIMITED countdown). Pending changes table: Accept/Reject per row
(decideSourceChange). ADMIN_STAFF sees view-only.
```

## FE-8 — Alerts composer + detail (frontend, on `/admin/alerts`)

```
08 section 14: New alert drawer: target type + record picker with follower count, title (80) and message
(500) with counters, channels (≥1) with the push note, preview tabs per channel, Save draft, Send with confirm
("Send to N followers by email and push? This can't be undone"); Send disabled after click; never auto-retry.
Detail drawer: content, target, per-channel delivery table (Targeted, Sent, Delivered, Failed, Not eligible),
failure reasons, opens/clicks, Duplicate as new draft.
```

## FE-9 — Admin users + permission states (frontend, on `/admin/users`)

```
08 section 15: Add user dialog (name, email, role with helper text) → "Invite sent". Edit drawer: change role,
resend invite, send password reset, deactivate/reactivate with the 08 dialog text; guards shown as disabled
with a reason (self, last Super Admin). Roles: Super Admin, Admin / Staff only.
Permission denied: a direct URL to a page the role can't use shows ErrorState "You don't have access to this
page" with a Dashboard link (shell-level guard), and hidden actions stay hidden.
```

## BE-5 — Read models: dashboard, search, activity, civic cards (backend)

```
Read 08 sections 4.7, 6, 7, 16.3, 27.
1. adminDashboard: tiles from 6.2, totals, needsAttention (oldest first, 5), recentlyEdited (last 10 from
   change log), pilotCoverage (+ "X of Y fully covered").
2. adminSearch(q ≥2): offices, officials, jurisdictions, services, sources, corrections by name/displayId,
   5 per group + totals. pg_trgm indexes.
3. AdminActivity table + adminActivity, adminUnreadActivityCount, markAdminActivityRead(ids|all). Events:
   new correction, source refresh failed, alert delivery failed, invite accepted (Super Admin only).
   30-day purge job.
4. (Build only after QubaLink confirms Civic Cards) adminCivicCards (filters level, parent, coverage,
   freshness, status; tiles) and adminCivicCard(jurisdictionId) reusing the resident civicCard assembly;
   coverageNote + setCoverageNote.
Indexed queries only; tests; docs/05; schema.graphql.
```

## FE-10 — Top bar search + activity bell, dashboard swap (frontend)

```
Existing top bar: global search box → dropdown of grouped results (adminSearch, min 2 chars, 5 per group,
"View all" opens that list with ?q=). Bell → Activity dropdown (08 16.3): items, unread dot, Mark all as read,
"You're all caught up", poll adminUnreadActivityCount every 60s while visible. Dashboard: switch to the
adminDashboard query; add Recently edited and Pilot coverage panels using existing Card/DataTable styles.
```

## BE-6 — Backend docs + traceability

```
Print schema, update docs/02, 03, 05, .env.example. Produce a table: 08 section → operation(s) → test → status
(done / partial / needs QubaLink confirmation). Fix partial items that don't need confirmation. Resident test
suite passes unchanged.
```

## FE-11 — Civic Cards (frontend; only after QubaLink confirms, new routes allowed)

```
New routes /admin/civic-cards (list, 08 7.1) and /admin/civic-cards/[jurisdictionId] (card screen, 08 7.2).
The card screen reuses the resident card components from FE-12 if they exist, with Edit/Retire per block
(open the record drawers from FE-6) and Add office/official/service/link existing per level, "Not covered yet"
placeholders, coverage note editor. Add "Civic Cards" to the sidebar per 08 4.1.
```

## FE-12 — Resident pages the SOW requires (frontend; new routes allowed only here)

```
No host page exists for these, so add only:
1. /card/[token]: civicCard grouped by level (A7: office, officeholder or vacant, contact, source, last
   updated, freshness, why it applies, coverage notice, confidence indicator); Services as a tab on the same
   page; Save location, Follow, Report buttons.
2. /officials/[slug] and /offices/[slug] (backend takes slug).
3. Sign-in Sheet (component, not a page) → /auth/google/start and /auth/apple/start with intent + returnTo;
   resume the intent after return.
4. /welcome: replace the static content with terms acceptance (me, legalVersions, acceptTerms).
5. Report sheet (component) → submitCorrection, opened from card/official/office.
6. /me (home), /me/locations, /me/following, /me/notifications, /me/settings (notification preferences +
   push), /me/billing (subscription, invoices, checkout, portal), /me/account (profile, sign out, delete/restore).
   Use the existing resident services in src/services.
7. Home: pricing section wired to plans; contact section wired to submitContactMessage; Terms and Privacy as
   sections or dialogs from legalVersions; fix footer links. Remove /events and the events, donate,
   claim-profile, district-map and app-store blocks (SOW A20).
Keep the existing visual style throughout.
```

## FE-13 — Final check (frontend)

```
Walk docs/08-ADMIN-SPEC.md sections 4–23 and the SOW resident screens. Produce a table: screen → route or
drawer → operations → states covered → status. Fix every partial item. Remove unused mock data, unused
packages (apexcharts if gone), dead routes. Lint/typecheck/build clean.
```

---

## Questions to send QubaLink before FE-11 / BE-5 item 4

1. Civic Cards module (08 section 1/7) approved?
2. Admin Users with two fixed roles is within A3/A9 (not A20's staff role-based access)?
3. Add/edit as a side drawer instead of a full page is acceptable?
4. 08 section 28 items (jurisdiction retire, one office per seat, service categories fixed or editable,
   resident told when a correction is decided, proposed password/lock/session numbers).
5. Address suggestions on the home page use Photon (photon.komoot.io), which sends typed addresses to a third
   party. Keep it, or use only Google Maps geocoding under QubaLink's account (SOW A13)?
