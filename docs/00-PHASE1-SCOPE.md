# 00 — Phase 1 Backend Scope

Source: signed Scope of Work "CivicLink Phase 1" (QubaLink Inc. ↔ Leen Design Studio LLC,
24 Sep 2026), clauses A1–A20, and the Phase 1 delivery specification derived from it.
This repo delivers the **backend and database** for that scope. The Next.js PWA and admin UI are a
separate deliverable and are not built here.

## In scope (build it)

| Area | Backend responsibility | SOW |
|---|---|---|
| Location resolution | Address / ZIP / city+state / device coordinates → geocode → PostGIS match across federal, state, county, municipal, education, selected special districts → confidence + coverage → lookup token | A5, A8, UC-01 |
| Civic Card & profiles | Offices grouped by level with holder, contact, source, last updated, freshness, why-it-applies; office/official profiles; vacant/holder-unknown states | A7, UC-03, UC-04 |
| Services & resources | Read-only links per jurisdiction/office with category, description, URL/contact, last validated | A7 |
| Resident accounts | Google + Apple sign-in only, consent, profile, sessions, account deletion request + 30-day purge | A3, UC-02 |
| Saved locations, follows | CRUD with limits; persistence across devices | A5, UC-05 |
| Notifications | In-app centre, preferences (in-app/email/push), push subscriptions, alert + record-update fan-out, delivery with duplicate protection and graceful push fallback | A10, UC-06, UC-07 |
| Corrections | Resident submission + status; admin queue, apply/dismiss with reason | UC-08, UC-10 |
| Billing | Stripe Checkout, Customer Portal, webhooks, subscription/invoice mirror, entitlements | A11 |
| Admin API | Officials, offices, terms, jurisdictions (metadata), services, sources, pending source changes, corrections, alerts, admin users, change history, CSV export, dashboard counts | A9 |
| Civic data pipeline | Collectors for public sources (API / bulk / scheduled page collection), runs, pending changes, link checks, nightly re-resolve | A8 |
| Analytics events | Server-side domain events for A12 metrics, no PII | A12 |
| Contact form | Store + email to QubaLink, Turnstile | A4 |
| Ops | Health checks, logging, monitoring hooks, backups config, CI/CD, docs | A13, A16, A17 |

## Out of scope (do not build, stub or model)

Events/calendar/RSVP · constituent inbox, "ask a question", ticketing, SLA · office claim/verification
portal, office staff roles · publishing workflows / notice composer for offices · ad engine, sponsored
content · donations, payouts, KYC/KYB/AML · SMS · email digests, topic/keyword alerts · forums, polls,
town halls · multilingual · partner embeds, public API, API marketplace · interactive district map
tiles · in-admin analytics dashboards, A/B testing, cohorts · AI summaries/recommendations ·
native-app-only features (biometrics, offline sync) · manual civic data entry/migration beyond
automated collection · committed performance/uptime SLAs · compliance/audit tooling beyond the
practices in Annexure F.

If a request touches any of these, stop and flag it as a Change Order item.

## Open decisions (defaults used until QubaLink confirms at M1)

| ID | Decision | Default wired in code |
|---|---|---|
| D-02 | What a paid plan unlocks | Entitlements JSON on plans: `maxSavedLocations`, `maxFollows` |
| D-03 | Coverage outside pilot | Federal nationwide; state legislature nationwide if data QA passes; county and below pilot only |
| D-04 | Admin sign-in | Google Workspace OIDC + allowlist |
| D-05 | Email / push providers | SES / FCM behind interfaces |
| D-06 | Analytics | PostHog, server events without PII |
| D-07 | Purge window | 30 days (`ACCOUNT_PURGE_DAYS`) |
| D-08 | Limits | 5 saved locations, 50 follows |
| D-09 | Notification defaults | Alerts: in-app + email; Updates: in-app only |
| D-10 | Freshness default | 90 days |
