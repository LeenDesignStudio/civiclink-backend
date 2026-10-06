# 01 — Backend Architecture

## 1. Context

```
                    Browser / installed PWA (resident, anonymous, admin at /admin)
                                        │  HTTPS, single origin: https://civiclink.com
                                        ▼
                         CloudFront  ── path routing ──┐
            /, /_next/*, pages ──► Next.js web (separate repo, ECS)
            /graphql, /auth/*, /admin-auth/*, /webhooks/*, /u/*, /healthz ──► API (this repo)
                                                       │
                ┌──────────────────────────────────────┼─────────────────────────────┐
                ▼                                      ▼                             ▼
     API service (Fastify + Yoga)           Worker service (pg-boss)        RDS PostgreSQL 16 + PostGIS
     ECS Fargate, ≥2 tasks                  ECS Fargate, 1–2 tasks          (app role: civiclink_app)
                │  outbound only to fixed hosts                                       ▲
                ├─► Google Geocoding / Places      ├─► Email (SES)                   │
                ├─► Google + Apple OIDC            ├─► Push (FCM)                     │
                ├─► Stripe API                     ├─► Source sites (TIGER, Open States, gov sites)
                ├─► Cloudflare Turnstile           └─► S3 (snapshots, exports)        │
                └─► PostHog, Sentry                                                   │
                                   both services ─────────────────────────────────────┘
```

**Why one origin:** the API and the web app are served from the same host via CloudFront path
routing, so auth cookies are first-party `__Host-` cookies, SameSite protections work, and CORS is
only needed for local development. The admin panel lives at `/admin` on the same origin.

## 2. Technology (pinned at kit creation, Oct 2026 — update deliberately)

| Concern | Choice | Version |
|---|---|---|
| Runtime | Node.js LTS | 22.x |
| Language | TypeScript strict, ESM | 5.9.x (TS 7 native compiler later, once tooling catches up) |
| Package manager | pnpm (via corepack) | latest stable at project start |
| HTTP | Fastify + `@fastify/helmet`, `@fastify/cookie`, `@fastify/cors`, `@fastify/formbody` | 5.x |
| GraphQL | graphql-yoga + `@graphql-yoga/plugin-csrf-prevention` + `@escape.tech/graphql-armor` | 5.x / 3.x |
| Schema | Pothos `@pothos/core` + `@pothos/plugin-scope-auth` | 4.x |
| ORM | Prisma ORM (`prisma-client` generator) + `@prisma/adapter-pg` | 7.10.x |
| Database | PostgreSQL + PostGIS | 16 + 3.5 |
| Validation | Zod | 4.x |
| Jobs | pg-boss | 12.x |
| Auth | openid-client (OIDC), jose (JWT ES256) | 6.x |
| Rate limit | rate-limiter-flexible (`RateLimiterPostgres`) | 11.x |
| Billing | stripe | 23.x |
| Logging / errors | pino, @sentry/node | 10.x / latest |
| Phone parsing | libphonenumber-js | latest |
| Tests | Vitest + @testcontainers/postgresql | 5.x / 12.x |

## 3. Layers (see `.cursor/rules/10-architecture.mdc`)

`transport (http routes, GraphQL resolvers, job handlers) → services → repositories → Prisma`.
Services hold business rules, validation, authorization, transactions, audit and events.
Repositories hold all SQL. External providers are behind interfaces with fakes for tests.

## 4. Modules

| Module | Owns | Main tables |
|---|---|---|
| `lookup` | input classification, geocoding, spatial resolution, confidence, lookup tokens, civic card assembly | lookups, (reads civic) |
| `civic` | offices, officials, terms, jurisdictions, services, categories; freshness; why-it-applies; admin CRUD | jurisdictions, offices, office_addresses, officials, office_terms, services, service_links, service_categories |
| `residents` | users, identities, consent, profile, deletion/restore/purge | users, auth_identities, deletion_requests, legal_documents |
| `auth` (src/auth) | OIDC flows, JWT, refresh rotation, admin sessions, cookies | user_sessions, admin_sessions |
| `locations` | saved locations, limits, nightly re-resolve | saved_locations |
| `follows` | follow/unfollow, limits, follower counts | follows |
| `corrections` | resident submit/list, admin queue/state machine/apply | corrections, correction_notes |
| `notifications` | preferences, push subscriptions, centre, fan-out, delivery, unsubscribe | notifications, notification_deliveries, notification_preferences, push_subscriptions |
| `alerts` | drafts, preview, send | alerts |
| `billing` | plans sync, checkout, portal, webhooks, entitlements | plans, stripe_customers, subscriptions, invoices, stripe_events |
| `admin-users` | invite, roles, status, admin dashboard counts | admin_users |
| `sources` + `pipeline` | sources, runs, collectors, pending changes, link checks | sources, source_runs, pending_source_changes |
| `audit` | change log writer/reader, CSV export | change_log |
| `contact` | contact form | contact_messages |
| `analytics` | server-side domain events to PostHog (no PII) | — |

## 5. Entitlements (plan limits)

`entitlements.service.ts` returns `{ maxSavedLocations, maxFollows }` for a user: the active
subscription's `plans.entitlements` merged over defaults from env (`LIMIT_DEFAULT_*`). Status
ACTIVE/TRIALING/PAST_DUE count as subscribed (PAST_DUE keeps access during Stripe retries).
What a paid plan unlocks is decision D-02; only these two limits are wired in Phase 1.

## 6. Environment variables

All validated by `src/config/env.ts` (Zod) at boot. `S` = secret (Secrets Manager in staging/prod).

| Variable | S | Example / rule |
|---|:-:|---|
| `APP_ENV` | | `development` \| `test` \| `staging` \| `production` |
| `PORT` | | `4000` |
| `LOG_LEVEL` | | `info` |
| `PUBLIC_WEB_URL` | | `https://civiclink.com` (used for redirects, email links) |
| `CORS_ORIGINS` | | comma list; dev only needs `http://localhost:3000` |
| `DATABASE_URL` | S | app role connection string (`sslmode=verify-full` outside dev) |
| `MIGRATION_DATABASE_URL` | S | owner role, used only by `prisma.config.ts` |
| `SHADOW_DATABASE_URL` | S | development only: shadow DB for `prisma migrate dev` (owner role) |
| `TEST_DATABASE_URL` / `TEST_MIGRATION_DATABASE_URL` | S | optional, local tests without Docker: app / owner role on a database whose name ends in `_test` (docs/07) |
| `DB_POOL_MAX` | | `10` |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` / `JWT_KEY_ID` | S | ES256 PEM; `JWT_PREVIOUS_PUBLIC_KEY` optional during rotation |
| `COOKIE_ENC_KEY` | S | base64, 32 bytes |
| `LINK_SIGNING_SECRET` | S | ≥32 bytes |
| `IP_HASH_SECRET` | S | ≥32 bytes |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | S | resident OIDC |
| `APPLE_CLIENT_ID` / `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY` | S | Sign in with Apple (client secret JWT generated at runtime) |
| `ADMIN_GOOGLE_CLIENT_ID` / `ADMIN_GOOGLE_CLIENT_SECRET` | S | separate OAuth client for admin |
| `ADMIN_GOOGLE_HD` | | `qubalink.com` |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` | | seeded once as SUPER_ADMIN (INVITED) |
| `GOOGLE_MAPS_API_KEY` | S | Geocoding (+ Places if D-11) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | S | test keys outside production |
| `EMAIL_PROVIDER` | | `ses` \| `console` (dev/test) |
| `EMAIL_FROM` / `CONTACT_INBOX` | | `CivicLink <no-reply@civiclink.com>` / `hello@qubalink.com` |
| `PUSH_PROVIDER` | | `fcm` \| `console` |
| `FCM_SERVICE_ACCOUNT_JSON` | S | base64 JSON |
| `TURNSTILE_SECRET_KEY` | S | |
| `POSTHOG_API_KEY` / `POSTHOG_HOST` | S / | |
| `SENTRY_DSN` | S | optional in dev |
| `AWS_REGION` / `S3_BUCKET_EXPORTS` / `S3_BUCKET_SNAPSHOTS` | | |
| `LIMIT_DEFAULT_MAX_SAVED_LOCATIONS` / `LIMIT_DEFAULT_MAX_FOLLOWS` | | `5` / `50` (D-08) |
| `ACCOUNT_PURGE_DAYS` / `ANON_LOOKUP_TTL_DAYS` / `FRESHNESS_DEFAULT_DAYS` | | `30` / `30` / `90` |
| `GRAPHQL_INTROSPECTION` | | `true` in dev only; forced `false` when `APP_ENV=production` |

## 7. Environments

| Env | Database | Providers | Notes |
|---|---|---|---|
| development | Hetzner dev server via SSH tunnel (docs/07) or docker-compose `postgis/postgis:16-3.5` | console email/push, Stripe test, real Google key restricted to dev | GraphiQL on. Dev data only |
| test | `civiclink_test` on the dev server (local) or Testcontainers (CI) | all fakes | no external provider calls |
| staging | RDS (QubaLink AWS) | real providers in test mode | UAT happens here |
| production | RDS Multi-AZ (QubaLink AWS) | live | migrations via CI job with owner role |

## 8. Deployment & operations (backend part)

- Single Docker image, two commands: `node dist/server.js` (API) and `node dist/worker.js` (worker).
- CI (GitHub Actions): lint → typecheck → unit → integration (PostGIS service) → migrate-diff check →
  schema diff check → audit/osv/gitleaks → build image → push ECR → deploy staging (auto) /
  production (manual approval, `prisma migrate deploy` as a one-off task before rollout).
- Health: `/healthz` (process alive), `/readyz` (DB reachable, not shutting down). ALB uses `/readyz`.
- Alarms (CloudWatch): 5xx rate > 2% for 5 min, p95 latency on `/graphql` > 3 s for 10 min
  (operational signal only, not an SLA — SOW A15), job failures, DB CPU/storage, geocoder breaker open.
- Rollback: redeploy previous image; migrations are expand/contract so the previous image still works.
