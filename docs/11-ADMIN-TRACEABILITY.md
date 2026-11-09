# 11 — Admin spec traceability (BE-6)

Maps `docs/08-ADMIN-SPEC.md` to the operations in `docs/05-API-OPERATIONS.md` and the tests that cover them.

Status:

- **done** — operation exists, permission is in `docs/02`, and a unit or integration test covers the rule.
- **partial** — the operation exists, and a listed field or screen behaviour has no API yet. These are called out below. None of them were fixed in BE-6 because each one changes the data model or the resident card.
- **needs QubaLink confirmation** — `docs/08` section 28, or Civic Cards (section 7). Not built.

Integration tests exist for civic admin and admin read. They need Docker (Postgres + PostGIS) and were not re-run in this step. Resident unit tests were re-run and left unchanged.

## Checklist

| 08 section | Operation(s) | Test | Status |
|---|---|---|---|
| 4.1 Sidebar, role visibility | `adminMe` permissions | `src/authz` matrix (`test/authz-matrix.test.ts`) | done |
| 4.7 Global search | `adminSearch` | `src/modules/admin-read/admin-read.service.test.ts`, `admin-read.int.test.ts` | done |
| 4.8 Activity bell, mark read, 30-day purge | `adminActivity`, `adminUnreadActivityCount`, `markAdminActivityRead`, job `admin.activity.purge` | `admin-read.service.test.ts` | done |
| 5 Sign-in, forgot password, reset, invite accept | `POST /admin-auth/login`, `forgot-password`, `reset-password` | `src/auth/admin-auth.test.ts`, `src/auth/passwords.test.ts` | done |
| 6 Dashboard tiles, attention, recent edits, pilot coverage | `adminDashboard` | `admin-read.rules.test.ts`, `admin-read.service.test.ts` | done |
| 6 Followers chart | none — sample graphic on the dashboard, not follower counts | — | partial |
| 7 Civic Cards list and card screen | none | — | needs QubaLink confirmation |
| 8 Offices list, tiles, create/edit, retire | `adminOffices`, `adminOffice`, `adminOfficeTiles`, `upsertOffice`, `retireOffice`, `restoreOffice` | `src/modules/civic/civic.service.test.ts`, `civic-admin.int.test.ts` | done |
| 8 Unlink an official from an office | none — a term is ended, not unlinked | — | partial |
| 9 Officials list, tiles, create/edit, retire, term | `adminOfficials`, `adminOfficial`, `adminOfficialTiles`, `upsertOfficial`, `setOfficeTerm`, `retireOfficial`, `restoreOfficial` | `civic.service.test.ts`, `civic-admin.int.test.ts` | done |
| 9 Official phone, email, and own address | none — the official uses the office address (`useOfficeAddress`) | — | partial |
| 10 Jurisdictions list, create/edit | `adminJurisdictions`, `adminJurisdiction`, `upsertJurisdiction` | `civic.service.test.ts`, `civic-admin.int.test.ts` | done. No parent field and no jurisdiction tree. Filter by level and state |
| 10 Jurisdiction tiles (27.6) | `adminJurisdictionTiles` | `src/modules/civic/civic.service.test.ts` | done |
| 10 Retire / restore jurisdiction | `retireJurisdiction`, `restoreJurisdiction` (Super Admin) | `civic.service.test.ts` | done. Section 28 item 1 still asks QubaLink to confirm retire is in scope |
| 10 Draw or upload a boundary | none — geometry is collector-owned (`docs/02` section 4) | — | done (intentionally absent) |
| 11 Corrections queue, apply, dismiss, notes | `adminCorrections`, `adminCorrection`, `adminCorrectionTiles`, `assignCorrection`, `markCorrectionInReview`, `applyCorrection`, `dismissCorrection`, `addCorrectionNote` | `src/modules/corrections/corrections.service.test.ts` | done |
| 11 Email the resident when a correction is decided | none | — | needs QubaLink confirmation (section 28 item 5) |
| 12 Services and categories | `adminServices`, `adminService`, `upsertService`, `markServiceValidated`, `retireService`, `restoreService`, `serviceCategories`, `upsertServiceCategory` | `civic.service.test.ts` | done. Section 28 item 4 still asks whether categories stay a fixed list |
| 12 Service tiles (27.8) | `adminServiceTiles` | `civic.service.test.ts` | done |
| 13 Sources, pause, refresh, runs | `adminSources`, `adminSource`, `upsertSource`, `pauseSource`, `resumeSource`, `triggerSourceRefresh` | `src/modules/sources/sources.service.test.ts` | done |
| 13 Source tiles (27.9) | `adminSourceTiles` | `src/modules/sources/sources.service.test.ts` | done |
| 13 Accept or reject a pending source change | `pendingSourceChanges`, `decideSourceChange` (`admin.source:decide`, Super Admin) | `sources.service.test.ts` | needs QubaLink confirmation (section 28 item 7). The operation is already Super Admin only |
| 14 Alerts drafts, preview, test, send | `adminAlerts`, `adminAlert`, `adminAlertTiles`, `saveAlertDraft`, `deleteAlertDraft`, `previewAlert`, `sendTestAlert`, `sendAlert`, `duplicateAlertAsDraft` | `src/modules/alerts/alerts.service.test.ts` | done |
| 15 Admin Users | `adminUsers`, `adminUserTiles`, `inviteAdmin`, `updateAdminUser`, `resendInvite`, `sendPasswordReset`, `updateAdminRole`, `setAdminStatus` | `src/modules/admin-users/admin-users.service.test.ts` | done. Section 28 item 2 still asks QubaLink to confirm two fixed roles |
| 16 My Profile, password, sign out | `myAdminProfile`, `updateMyProfile`, `changeMyPassword`, `adminSignOut` | `admin-auth.test.ts` | done |
| 17 Two roles | `ADMIN_STAFF`, `SUPER_ADMIN` in `src/authz/permissions.ts` | `test/authz-matrix.test.ts` | done. Same confirmation as section 28 item 2 |
| 27.2–27.11 Field definitions | The operations in sections 6 and 8–15. Counts are active records. Freshness is `MAY_BE_OUTDATED` past the source window unless overridden | the tests named above | done, except the rows marked partial or needs confirmation |

## What BE-6 changed

- `docs/02`: `admin.dashboard:read` covers the home, search, and bell. `system.retention:run` includes the 30-day activity purge. The audit list includes `admin.activity_read`.
- `docs/03`: search and mark-read add no new error codes.
- `docs/05`: rate class `admin` for the dashboard operations; jobs `admin.activity.purge` (04:05 UTC) and `email.adminPasswordReset`. Tile queries `adminJurisdictionTiles`, `adminServiceTiles`, and `adminSourceTiles`.
- `.env.example`: no new variable. Comment points at the `pg_trgm` migration.
- `schema.graphql` reprinted from the current schema. The three tile types are new. No migration.

## Left for later

- FE-11 and the Civic Cards API, after QubaLink confirms section 7.
- The partial rows in the table (followers chart data, unlink, official contact fields).

## FE-13 — frontend screens

Walked `docs/08` sections 4–23 and the resident screens. Apexcharts is not a dependency. Dead event mock, the events card, and the sample representative card are removed. Empty copy on the dashboard matches section 23.

| Screen | Route or drawer | Operations | States | Status |
|---|---|---|---|---|
| Admin frame, sidebar, search, bell | `/admin` shell | `adminMe`, `adminSearch`, `adminActivity`, `markAdminActivityRead` | loading, denied, empty bell | done |
| Sign in, forgot password, reset, invite | `/admin/login`, `/admin/forgot-password`, `/admin/update-password` | `/admin-auth/*` | field errors, locked, expired link | done |
| Dashboard | `/admin` | `adminDashboard` | loading, error, empty attention and edits | done. Followers chart is the sample graphic from BE-6, not live counts |
| Civic Cards | `/admin/civic-cards` | none until QubaLink confirms | — | needs QubaLink confirmation |
| Offices | `/admin/offices` drawer | `adminOffices`, `upsertOffice`, `retireOffice`, `restoreOffice` | empty, filtered empty, denied, save error | done |
| Officials | `/admin/officials` drawer | `adminOfficials`, `upsertOfficial`, `setOfficeTerm`, retire and restore | empty, filtered empty, denied | done. No separate phone, email, or unlink. A term is ended |
| Jurisdictions | `/admin/jurisdictions` drawer | `adminJurisdictions`, `upsertJurisdiction`, retire and restore | empty, filtered empty | done. Retire still needs the section 28 confirmation |
| Corrections | `/admin/corrections` drawer | `adminCorrections`, assign, review, apply, dismiss, notes | empty, validation, denied | done. No email to the resident until QubaLink confirms |
| Services | `/admin/services-resources` drawer | `adminServices`, `upsertService`, validate, retire, restore, categories | empty, filtered empty | done. Categories fixed-or-editable still needs confirmation |
| Sources | `/admin/sources` drawer | `adminSources`, pause, resume, refresh, `decideSourceChange` | empty, pending changes | done. Decide is Super Admin only, pending confirmation |
| Alerts | `/admin/alerts` drawer | drafts, preview, test, send, duplicate | empty, validation, not confirmed | done |
| Admin users | `/admin/users` drawer | invite, update, role, status, reset | empty, denied, last Super Admin | done. Two roles still need confirmation |
| Admin profile and password | `/admin/settings`, gear menu | `myAdminProfile`, `updateMyProfile`, `changeMyPassword` | unsaved, validation | done |
| Resident sign-in and sign-up | `/signin`, `/signup` | `/auth/google/start`, `/auth/apple/start` | error query, already signed in | done. Same card, different URL |
| Terms | `/welcome` | `me`, `legalVersions`, `acceptTerms` | signed out, pending deletion, accepted | done |
| Civic Card, office, official | `/card/[token]`, `/offices/[slug]`, `/officials/[slug]` | `civicCard`, `office`, `official` | not covered, report, follow | done |
| Resident home | `/me` | `me`, saved locations, follows, notifications | loading shell, signed out redirect | done |
| Places, following, notifications | `/me/locations`, `/me/following`, `/me/notifications` | location, follow, notification operations | empty tables, errors | done |
| Settings and profile | `/me/settings`, `/me/account` | preferences, `updateProfile`, sign out, deletion | unsaved, pending deletion | done |
| Billing and contact | `/me/billing`, `/#pricing`, `/#contact` | plans, checkout, portal, invoices, `submitContactMessage` | empty plans, checkout return, Turnstile missing | done in code. Contact stays disabled until the site key is set |
