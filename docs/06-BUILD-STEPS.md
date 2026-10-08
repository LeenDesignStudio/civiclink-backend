# 06 — Build Steps for Cursor (one at a time)

How to use this file:

1. Do the steps **in order**. Each step builds on the last.
2. In Cursor, open a **new Agent chat for each step** (keeps context clean). Paste the prompt block
   exactly. The `@` references attach the right docs; the `.cursor/rules` load automatically.
3. Review the diff yourself before accepting. Then run the **Verify** commands.
4. Only move on when every **Done when** box is ticked. If Cursor drifts outside scope or skips
   tests, reply: "Re-read @.cursor/rules/00-core.mdc and @.cursor/rules/70-testing-quality.mdc and fix."
5. Commit after each step: `git commit -m "step NN: <title>"`.

Model tip: use your strongest reasoning model for steps 05, 07, 08, 10, 14 and 15 (authz, resident auth,
admin auth, location resolution, notifications, billing). Any model is fine for the rest.

---

## Step 00 — Prerequisites (you, not Cursor)

- Install Node 22 LTS, pnpm (`npm install -g pnpm`), Git, Cursor.
- Development database — pick one:
  - **No Docker (e.g. company-locked laptop):** follow `docs/07-DEV-SETUP-NO-DOCKER.md` (Hetzner
    server + SSH tunnel). Do this now; Step 03 needs it.
  - **Docker available:** Docker Desktop + the provided `docker-compose.yml`.
- Create an empty repo `civiclink-api`, copy this kit's contents into it (`.cursor/`, `docs/`,
  `prisma/`, `server/`, `docker/`, `.env.example`, `docker-compose.yml`, `README.md`).
- Open the folder in Cursor → Settings → Rules: confirm the 8 project rules are listed.

---

## Step 01 — Project scaffold and tooling

```
Read @docs/01-ARCHITECTURE.md (sections 2, 3, 6, 7) and @.cursor/rules/10-architecture.mdc.

Scaffold the CivicLink backend project. Do not write feature code yet.

1. package.json: "type": "module", engines node >=22, packageManager pnpm. Scripts:
   dev (tsx watch src/server.ts), dev:worker (tsx watch src/worker.ts), build (tsc -p tsconfig.build.json),
   start, start:worker, lint, typecheck, test, test:unit, test:int, db:migrate (prisma migrate dev),
   db:deploy (prisma migrate deploy), db:seed (tsx prisma/seed.ts), db:studio, prisma:generate,
   schema:print (prints SDL to schema.graphql), format.
2. Install runtime deps at the versions in docs/01 section 2 (Fastify 5 + helmet/cookie/cors/formbody,
   graphql, graphql-yoga 5, @graphql-yoga/plugin-csrf-prevention, @escape.tech/graphql-armor,
   @pothos/core 4, @pothos/plugin-scope-auth, prisma 7.10 + @prisma/client 7.10 + @prisma/adapter-pg 7.10
   + pg, zod 4, pg-boss, openid-client 6, jose 6, rate-limiter-flexible, stripe, pino, @sentry/node,
   libphonenumber-js, dotenv, @aws-sdk/client-s3, @aws-sdk/client-sesv2, @aws-sdk/s3-request-presigner).
   pnpm is installed globally via npm: do not use corepack and do not add a "packageManager" field.
   Dev deps: typescript 5.9, tsx, vitest, @vitest/coverage-v8, @testcontainers/postgresql, eslint 9 +
   typescript-eslint (strict-type-checked), prettier, pino-pretty, @types/node, @types/pg.
3. tsconfig.json: strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, module NodeNext,
   moduleResolution NodeNext, target ES2023, verbatimModuleSyntax, outDir dist. tsconfig.build.json excludes tests.
4. eslint.config.js (flat): typescript-eslint strictTypeChecked, no-floating-promises, no-misused-promises,
   and no-restricted-imports / no-restricted-syntax rules that:
   - forbid importing src/generated/prisma or src/db/* inside any *.graphql.ts file,
   - forbid the identifiers $queryRawUnsafe and $executeRawUnsafe everywhere,
   - forbid console.* in src (use logger).
5. vitest.config.ts with two projects: unit (src/**/*.test.ts excluding *.int.test.ts) and int
   (src/**/*.int.test.ts, test/**/*.int.test.ts, globalSetup test/setup/global.ts, singleThread pool).
6. Create the empty folder structure from 10-architecture.mdc with index placeholders only.
7. .gitignore (node_modules, dist, .env*, !.env.example, src/generated, coverage).
8. Keep the provided docker-compose.yml (used only by developers who have Docker); add a `pnpm db:up`
   script = docker compose up -d db. The project must also work without Docker (docs/07).

Do not create any business logic. Finish by running lint and typecheck.
```

**Verify**: `pnpm i && pnpm lint && pnpm typecheck` (Docker users also: `pnpm db:up`)
**Done when**
- [ ] Lint/typecheck pass on the empty skeleton.
- [ ] Dev database reachable: SSH tunnel open (docs/07) or PostGIS container healthy (`docker compose ps`).
- [ ] ESLint fails if you add `prisma.$queryRawUnsafe('x')` to any file (try it, then remove).

---

## Step 02 — Config, logger, errors, crypto foundation

```
Read @.cursor/rules/30-errors-logging.mdc, @.cursor/rules/20-security.mdc, @docs/03-ERROR-CATALOG.md,
@docs/01-ARCHITECTURE.md section 6.

Build the cross-cutting foundation in src/config and src/lib. No GraphQL or DB yet.

1. src/config/env.ts: Zod schema for EVERY variable in docs/01 section 6 with correct types, formats
   and per-APP_ENV requirements (providers may be 'console' in development/test). Parse once,
   export frozen `env`. On failure print the list of invalid keys (never values) and exit(1).
   Force GRAPHQL_INTROSPECTION=false when APP_ENV=production.
2. src/lib/errors.ts: ErrorCode union containing every code in docs/03; AppError base and subclasses
   exactly as in 30-errors-logging.mdc; domain error classes for every domain code in docs/03;
   fromZod(zodError) → ValidationError with fieldErrors; isAppError(); a CODE_META table
   (httpStatus, defaultMessage, expose, retryable, logLevel) generated from docs/03.
3. src/lib/logger.ts: pino with the redaction list from 30-errors-logging.mdc, pretty in development,
   JSON otherwise; child logger helper withRequest(requestId, principal).
4. src/lib/crypto.ts: randomToken(bytes=32) base64url; sha256Hex; hmacSha256Hex(secret, data);
   hashIp(ip) using IP_HASH_SECRET; AES-256-GCM encryptJson/decryptJson (versioned, authenticated,
   with expiry); signLink/verifyLink (HMAC, expiry, constant-time compare).
5. src/lib/clock.ts, src/lib/random.ts (injectable), src/lib/retry.ts (withRetry: max retries,
   full-jitter backoff, retryable predicate, honours Retry-After; CircuitBreaker class:
   closed/open/half-open, threshold 5, cooldown 30 s), src/lib/pagination.ts (cursor encode/decode
   base64url of `createdAt|id`, clamp first ≤100, Relay connection builder), src/lib/slug.ts.
6. Unit tests for: env parsing (missing/invalid keys), every error class mapping to CODE_META,
   fromZod paths, logger redaction (log an object with email/token/cookie and assert they are
   [Redacted]), encrypt/decrypt tamper + expiry, signLink tamper + expiry, retry/backoff/breaker
   with fake clock, cursor round-trip.
```

**Verify**: `pnpm test:unit && pnpm lint && pnpm typecheck`
**Done when**
- [ ] Every code in docs/03 exists in `ErrorCode` and `CODE_META` (add a test that parses docs/03 tables and compares).
- [ ] Redaction test passes.
- [ ] Boot with a missing secret prints the key name and exits non-zero.

---

## Step 03 — Database: Prisma 7, first migration, seed

```
Read @.cursor/rules/40-prisma-database.mdc, @prisma/schema.prisma, @prisma/sql/00_extensions.sql,
@prisma/sql/10_post_init.sql, @prisma/sql/20_db_roles.sql.

Set up the database layer. The schema file is final for Phase 1 — do not change models without asking.

1. prisma.config.ts (Prisma 7): import 'dotenv/config'; defineConfig with schema path,
   migrations path 'prisma/migrations', seed command 'tsx prisma/seed.ts',
   datasource.url = env('MIGRATION_DATABASE_URL') and datasource.shadowDatabaseUrl =
   env('SHADOW_DATABASE_URL') (development only). The runtime app never reads this file.
2. Run `pnpm prisma migrate dev --create-only --name init`. Then edit
   prisma/migrations/<ts>_init/migration.sql: PREPEND the contents of prisma/sql/00_extensions.sql and
   APPEND the contents of prisma/sql/10_post_init.sql. Apply with `pnpm prisma migrate dev`.
   Commit the migration. (20_db_roles.sql is NOT a migration; document it in README.)
3. src/db/prisma.ts: PrismaClient with PrismaPg adapter (pool max from env), Prisma warn/error log
   events piped to logger, `withTx(fn, { isolation })` helper with retry on serialization failures
   (P2034 / 40001 / 40P01, max 3), and `mapDbError(err)` + `dbCall(fn)` implementing the mapping
   table in 30-errors-logging.mdc, including the constraint-name → domain-code map:
   saved_locations_home_work_once → LOCATION_LABEL_TAKEN, corrections_one_open_per_user_field →
   DUPLICATE_CORRECTION, office_terms_one_current_per_office → CONFLICT, saved_locations_one_default_per_user → CONFLICT.
4. src/db/spatial.repo.ts with typed $queryRaw functions only (no business logic):
   - jurisdictionsContainingPoint(lng, lat) → {id, level, type, name}[]
   - jurisdictionsIntersectingArea(areaJurisdictionId, minShare=0.01) → {id, level, type, share}[]
   - nearBoundary(jurisdictionId, lng, lat, meters=50) → boolean (another same-type polygon within distance)
   - setSavedLocationPoint(id, lng, lat), setLookupGeom(id, geojson), upsertBoundary(id, geojson)
     using ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(...),4326)))
   - zctaByZip(zip), placeByNameState(name, state)
5. prisma/seed.ts (idempotent upserts): legal_documents (TERMS v1, PRIVACY v1 current), the 10 service
   categories from docs/00, one Source row "Seed fixtures" (MANUAL), the bootstrap Super Admin from
   BOOTSTRAP_SUPER_ADMIN_EMAIL (status INVITED), default plan rows ONLY in development.
6. test/setup/global.ts supports two modes:
   (a) TEST_DATABASE_URL + TEST_MIGRATION_DATABASE_URL set (developers without Docker, see docs/07):
       use that existing database (already has roles, `extensions` schema and search_path); run
       `prisma migrate deploy` against TEST_MIGRATION_DATABASE_URL; then, as owner, idempotently
       GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES / USAGE, SELECT ON ALL SEQUENCES in public
       to civiclink_app and REVOKE UPDATE, DELETE, TRUNCATE ON change_log FROM civiclink_app.
       Refuse to run if the database name does not end in `_test` (safety guard).
   (b) otherwise (CI, Docker users): start postgis/postgis:16-3.5 with Testcontainers; as the
       superuser run docker/postgres-init/01-roles-and-extensions.sql; then `prisma migrate deploy`
       as civiclink_owner.
   In both modes: run the tests as civiclink_app
   (so missing grants fail in tests, not in production); the truncate helper alone connects as
   civiclink_owner, because the app role has no TRUNCATE right; expose a truncate-all helper (excluding
   _prisma_migrations, legal_documents, service_categories) and a factories module in test/factories
   with a builder for every model.
7. Integration tests (src/db/*.int.test.ts) proving: each partial unique index and CHECK constraint
   from 10_post_init.sql rejects bad data and maps to the right AppError; change_log UPDATE is
   rejected; spatial functions return correct results against fixtures in test/fixtures/geo
   (create: two adjacent square districts A and B, a ZCTA overlapping both, a county containing all,
   points inside A, inside B, 20 m from the A/B border, outside).
```

**Verify** (SSH tunnel open if using docs/07): `pnpm db:migrate && pnpm db:seed && pnpm test:int`
**Done when**
- [ ] `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` exits 0.
- [ ] All constraint/trigger/spatial integration tests pass.
- [ ] Seed is re-runnable without errors.

---

## Step 04 — HTTP server, health, shutdown

```
Read @.cursor/rules/10-architecture.mdc (request lifecycle), @.cursor/rules/20-security.mdc (headers, CORS),
@.cursor/rules/30-errors-logging.mdc (process-level safety).

1. src/http/server.ts: buildServer(deps) returning a Fastify instance: trustProxy (CloudFront/ALB),
   requestId (accept x-request-id if it matches ^[A-Za-z0-9-]{8,64}$ else generate ULID), bodyLimit 100 KB,
   @fastify/helmet with the exact headers in 20-security.mdc, @fastify/cors with CORS_ORIGINS +
   credentials, @fastify/cookie, access log hook (requestId, method, route, status, durationMs —
   no bodies, no query strings for /auth/*).
2. Global error handler: AppError → { error: { code, message, requestId } } with CODE_META status;
   unknown → 500 INTERNAL, logged with stack, Sentry capture.
3. src/http/routes/health.ts: GET /healthz (200 always while process is up), GET /readyz (SELECT 1 with
   1 s timeout; 503 when shutting down or DB down).
4. src/server.ts: load env, init Sentry, build container (src/app/container.ts with prisma + logger for
   now), start server, register SIGTERM/SIGINT graceful shutdown (stop accepting, 20 s drain,
   prisma.$disconnect, flush logs) and unhandledRejection/uncaughtException → fatal + shutdown + exit 1.
5. Integration tests with fastify.inject: security headers present, CORS rejects unknown origin,
   oversized body → 413, /readyz 503 after shutdown begins, unknown route → 404 JSON with requestId.
```

**Verify**: `pnpm dev` then `curl -i localhost:4000/healthz` and `/readyz`; `pnpm test`
**Done when**
- [ ] Headers match 20-security.mdc exactly.
- [ ] Killing the process with SIGTERM logs a clean shutdown and exits 0.

---

## Step 05 — GraphQL foundation (Yoga + Pothos + scope-auth + armor + masking)

```
Read @.cursor/rules/50-graphql-api.mdc, @.cursor/rules/60-rbac-authz.mdc, @.cursor/rules/30-errors-logging.mdc,
@docs/02-RBAC-PERMISSIONS.md.

1. src/authz/permissions.ts: Permission union and ROLE_PERMISSIONS exactly per docs/02 section 3
   (Resident, VIEWER, EDITOR, COMMUNICATIONS, SUPER_ADMIN, System). PUBLIC_PERMISSIONS granted to all.
2. src/authz/authz.ts: Principal type from 60-rbac-authz.mdc; class Authz(principal) with
   can(p), require(p) (throws UnauthenticatedError / ForbiddenError), requireResident({active}) that
   enforces TERMS_REQUIRED and ACCOUNT_PENDING_DELETION rules from docs/02 section 1, requireAdmin(),
   requireSystem().
3. src/graphql/builder.ts: Pothos SchemaBuilder with ScopeAuth plugin; scopes: public, resident,
   residentActive, permission(Permission). unauthorizedError → the right catalog error.
   Scalars: DateTime (ISO UTC), URL (https?), UUID. Shared Relay connection helpers + PageInfo.
4. src/graphql/context.ts: per-request context { requestId, principal, authz, services, loaders,
   ipHash, userAgent, reply }. For now principal is always anonymous (auth comes in step 07).
5. src/graphql/errors.ts: maskError per 30-errors-logging.mdc.
6. src/graphql/armor.ts: graphql-armor with the limits in 20-security.mdc.
7. Mount Yoga in Fastify at /graphql (POST only; GET + GraphiQL only in development), with
   useCSRFPrevention({ requestHeaders: ['x-civiclink-csrf'] }), introspection per env, batching off,
   maskedErrors with maskError.
8. Add a temporary query `health: String! @public` returning "ok" to prove wiring.
9. test/schema-guard.test.ts: build the schema, walk every Query and Mutation field, fail if
   the field has no authScopes extension. test/authz-matrix.test.ts: parse the matrix table from
   docs/02-RBAC-PERMISSIONS.md section 3 and assert ROLE_PERMISSIONS matches it cell-for-cell.
10. Test helper test/gql.ts: gql(principal).execute(query, vars) + expectCode(res, code).
11. Integration tests: missing CSRF header → rejected; depth 9 query → rejected; introspection off
    when APP_ENV=production; thrown unknown Error → INTERNAL with requestId and no stack in response.
```

**Verify**: `pnpm test` and a manual request: `curl -s -X POST localhost:4000/graphql -H 'content-type: application/json' -H 'x-civiclink-csrf: 1' -d '{"query":"{health}"}'`
**Done when**
- [ ] schema-guard and authz-matrix tests pass.
- [ ] Requests without `x-civiclink-csrf` fail.

---

## Step 06 — Rate limiting

```
Read @.cursor/rules/20-security.mdc (rate limiting table) and @docs/05-API-OPERATIONS.md ("Rate" column).

1. The `rate_limits` table already exists (model RateLimit in prisma/schema.prisma) — the app role has
   no DDL rights, so the library must never create tables. src/lib/rate-limit.ts: RateLimiterPostgres instances (shared pg pool, tableName 'rate_limits',
   tableCreated: true, plus a daily cleanup of expired rows) for classes:
   lookup, auth, contact, correction, mutation, admin, alert_send, test_notification (3/hour/user).
2. A Pothos field extension `rateLimit: RateClass` applied in a Yoga plugin (or resolver wrapper) that
   keys by ipHash or principal id per the table; throws RateLimitedError with retryAfterSeconds.
3. A Fastify preHandler for REST routes (auth, contact) setting Retry-After.
4. Tests with a fake clock / small limits: 31st lookup in window → RATE_LIMITED with retryAfterSeconds.
```

**Done when**
- [ ] Every operation in docs/05 with a Rate value is wired (add a test listing them).

---

## Step 07 — Resident authentication (Google + Apple), sessions, consent

```
Read @.cursor/rules/20-security.mdc (residents + sessions), @docs/02-RBAC-PERMISSIONS.md section 1,
@docs/05-API-OPERATIONS.md section B, @docs/03-ERROR-CATALOG.md section 2.

Implement exactly section B of docs/05.

1. src/auth/oauth/google.ts and apple.ts using openid-client v6 discovery: authorization URL with
   PKCE S256, state, nonce, scope openid email profile (Apple: name email, response_mode form_post);
   callback verification of state/nonce/PKCE and ID token. Apple client_secret = ES256 JWT built with
   APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY (5-minute lifetime, cached).
2. src/auth/cookies.ts: set/clear helpers for __Host-cl_oauth (encrypted, 10 min; SameSite=None for
   Apple flow), __Host-cl_at, __Host-cl_rt with the exact attributes in 20-security.mdc.
3. src/auth/tokens.ts: ES256 access JWT sign/verify with kid + optional previous public key.
4. src/auth/sessions.ts: create session (refresh token hash, family id), rotate with reuse detection
   (reuse of a rotated token → revoke family → SESSION_REVOKED + warn log), revoke one / all.
5. src/modules/residents: identity upsert + linking rules (link only when both providers assert
   email_verified for the same email), Apple first-login name capture, DELETED → ACCOUNT_DELETED,
   PENDING_DELETION allowed in with restore flow.
6. REST routes: GET /auth/:provider/start, GET /auth/google/callback, POST /auth/apple/callback,
   POST /auth/refresh — returnTo allowlist; intent passthrough; errors redirect to /signin?error=CODE.
7. Context: read __Host-cl_at → resident Principal (load status + termsAccepted, cache 30 s per request id).
8. GraphQL: me, acceptTerms, updateProfile, signOut — with authScopes per docs/05; acceptTerms also
   creates default notification preferences (D-09).
9. Tests (OIDC providers faked with a local JWKS + signed ID tokens): happy path both providers;
   state mismatch, nonce mismatch, bad signature, wrong aud, expired token → OAUTH_FAILED;
   unverified email does not link; refresh rotation; refresh reuse revokes family; deleted user blocked;
   open-redirect attempt rejected; TERMS_REQUIRED gating of residentActive fields.
```

**Done when**
- [ ] All section-B behaviours tested, including every OAUTH_FAILED cause.
- [ ] No token, code or email appears in logs during tests (add a log-capture assertion).

---

## Step 08 — Admin authentication and admin users

```
Read @.cursor/rules/20-security.mdc (admins), @.cursor/rules/60-rbac-authz.mdc (admin rules),
@docs/02-RBAC-PERMISSIONS.md sections 3–4, @docs/05-API-OPERATIONS.md section G.

1. src/auth/admin-auth.ts: separate Google OIDC client; enforce hd = ADMIN_GOOGLE_HD, email_verified,
   allowlisted admin_users row ACTIVE or INVITED (INVITED → ACTIVE on first login, store google_subject;
   later logins must match google_subject); lockout after 5 failures / 15 min; opaque session token
   hashed in admin_sessions; idle 30 min (sliding lastActivityAt), absolute 12 h.
2. REST: GET /admin-auth/google/start, GET /admin-auth/google/callback; errors → /admin/login?error=CODE.
3. Context: __Host-cl_admin → admin Principal with role loaded from DB (cache ≤30 s). Deactivated or
   expired → anonymous.
4. GraphQL: adminMe, adminSignOut, adminUsers, inviteAdmin, updateAdminRole, setAdminStatus per docs/05 G,
   with SELF_ROLE_CHANGE and LAST_SUPER_ADMIN rules, session revocation on deactivation, audit rows
   (src/modules/audit/audit.service.ts record() — create it now).
5. Tests: every role allowed/denied for each operation; lockout; idle and absolute timeout; role change
   effective on next request; deactivation kills sessions; last-super-admin protection; audit rows.
```

---

## Step 09 — Civic read model (offices, officials, jurisdictions, services)

```
Read @docs/05-API-OPERATIONS.md section A (office, official, services, serviceCategories, plans, legalVersions)
and @.cursor/rules/40-prisma-database.mdc (querying).

1. src/modules/civic: repos + services + DTOs for public reads. Freshness = CURRENT when
   now - lastUpdatedAt <= source.freshnessDays, else MAY_BE_OUTDATED; overrides win. whyItApplies
   renders office.whyTemplate (or the default template per jurisdiction type) with tokens
   {jurisdiction},{office},{district}; for MULTIPLE matches: "Your ZIP code overlaps {list}.".
2. Public DTOs never include source_record_url, freshness_note, retired records or internal ids of
   other entities beyond what the client needs.
3. GraphQL: office(slug, lookupToken?), official(slug, lookupToken?) (with redirectOfficeSlug),
   services(...), serviceCategories, plans, legalVersions.
4. DataLoaders for office → current term → official, office → addresses, office/jurisdiction → services.
5. Tests: freshness boundaries and overrides; vacant / holderUnknown states; retired hidden;
   official redirect; services pagination; no N+1 (assert query count with a Prisma query event counter).
```

---

## Step 10 — Location resolution and the Civic Card

```
Read @docs/05-API-OPERATIONS.md section A (resolveLocation, confirmLocationCandidate, reverseGeocode,
civicCard) and @.cursor/rules/40-prisma-database.mdc (geometry), @.cursor/rules/30-errors-logging.mdc (external calls).

1. src/modules/lookup/clients/geocoder.ts: interface Geocoder { geocode(query): Candidate[];
   reverse(lat,lng): Candidate[] } and GoogleGeocoder (components=country:US, 4 s timeout, 2 retries on
   retryable errors, CircuitBreaker, Zod-validate the response, map location_type to precision).
   FakeGeocoder in test/fakes with scripted responses.
2. Input classification (ZIP / CITY_STATE / ADDRESS) as pure functions with unit tests.
3. Resolution service:
   - ADDRESS/DEVICE → point → spatial.jurisdictionsContainingPoint; LIKELY if precision is not
     ROOFTOP/RANGE_INTERPOLATED or nearBoundary() is true.
   - ZIP → ZCTA → jurisdictionsIntersectingArea; MULTIPLE where >1 jurisdiction of the same type.
   - CITY_STATE → place polygon → same as ZIP.
   - Per-level confidence, overall = worst level; partial levels = levels with no jurisdiction or no
     active office; candidates (≤5) when geocoder returns several → signed candidateToken (10 min).
   - Persist Lookup with random 22-char token, no raw input; anonymous TTL from env; user_id when signed in.
4. civicCard(token): assemble levels in fixed order FEDERAL, STATE, COUNTY, MUNICIPAL, EDUCATION,
   SPECIAL; offices ordered by displayOrder; coverage + notice; servicesPreview; isFollowed for residents.
5. Analytics domain events lookup_started/lookup_completed/lookup_failed with method, confidence,
   latency, zip, county id (no address) via src/modules/analytics (interface + PostHog impl + fake).
6. Tests using the geo fixtures: EXACT inside A; LIKELY 20 m from border; MULTIPLE for the ZCTA;
   partial coverage for a level with no data; LOCATION_NOT_FOUND; LOCATION_OUTSIDE_US;
   GEOCODER_UNAVAILABLE when the fake times out and when the breaker is open; expired token →
   LOOKUP_NOT_FOUND; assert lookups table never contains the raw query string.
```

---

## Step 11 — Saved locations, follows, entitlements

```
Read @docs/05-API-OPERATIONS.md section C and @docs/01-ARCHITECTURE.md section 5.

1. src/modules/billing/entitlements.service.ts (limits from active plan or env defaults).
2. src/modules/locations and src/modules/follows per docs/05 C, all owner-filtered in SQL,
   serializable transactions for default handling and limit checks.
3. Tests: every rule and error in section C; other resident's id → NOT_FOUND; concurrent saves
   cannot exceed the limit (run two in parallel); deleting default promotes the next.
```

---

## Step 12 — Corrections (resident + admin) and audit reads

```
Read @docs/05-API-OPERATIONS.md sections E and I, @docs/02-RBAC-PERMISSIONS.md sections 5–6.

1. submitCorrection / myCorrections (resident) with field-validity per entity type and value format checks.
2. Admin queue and state machine (assign, in review, apply, dismiss, notes) — apply updates the target
   record + last_updated_at and writes two audit rows in one transaction.
3. changeLog query (admin.changelog:read).
4. Tests: state machine transitions (allowed + INVALID_STATE), duplicate open → DUPLICATE_CORRECTION,
   daily limit, residents never see notes/assignee, admins see displayName only (no email),
   Viewer cannot resolve, Communications cannot resolve.
```

---

## Step 13 — Admin civic data CRUD, sources, services, export, dashboard

```
Read @docs/05-API-OPERATIONS.md section H and @docs/02-RBAC-PERMISSIONS.md section 4 (Viewer/Editor).

Implement every operation in section H with its validation, rules, errors and audit.
- setOfficeTerm makes the new term current and ends the old one atomically.
- notifyFollowers enqueues notify.fanout with a RECORD_UPDATE payload (queue only; delivery is step 14).
- exportCsv is CSV-injection safe, ≤50,000 rows, audited, URL valid 10 min. Staging and production stream to the exports S3 bucket. Development and test store the file in memory and serve `GET /dev/exports/:token` so the API can be tested before AWS is live.
- Tests: role matrix per operation; JURISDICTION_CYCLE; HAS_ACTIVE_CHILDREN; HAS_CURRENT_TERM;
  RUN_IN_PROGRESS; UNKNOWN_COLLECTOR; audit before/after contains only changed fields; CSV cell
  starting with "=" is prefixed.
```

---

## Step 14 — Notifications, alerts, worker

```
Read @docs/05-API-OPERATIONS.md sections D, J, K and @.cursor/rules/30-errors-logging.mdc (jobs).

1. src/jobs/boss.ts + src/worker.ts: pg-boss start/stop with graceful shutdown, handler registry,
   schedules (cron in UTC).
2. Resident notification operations (section D) incl. IN_APP_LOCKED, push subscription upsert/reassign.
3. Alerts (section J): drafts, preview with recipient counts after preferences, test send to the admin's
   email, sendAlert atomic DRAFT→SENDING with RECIPIENTS_CHANGED check.
4. Jobs (section K): notify.fanout (one notification per follower, unique (user_id, source_ref)),
   notify.deliver.email / notify.deliver.push with dedupe_key, providers behind EmailSender /
   PushSender interfaces (SES, FCM, console), push token 404/410 → revoke subscription,
   alert.finalize. Email templates: plain + HTML, unsubscribe link (signed) per category, open pixel,
   click redirect routes /u/unsub, /u/o, /u/c.
5. Tests: fan-out respects preferences; retries never double-send (simulate crash after provider call
   by re-running the job); push unsupported/revoked fallback; unsubscribe link turns off only that
   category's email; Viewer/Editor cannot send alerts; Communications can; ALERT_ALREADY_SENT.
```

---

## Step 15 — Billing (Stripe)

```
Read @docs/05-API-OPERATIONS.md section F and @.cursor/rules/20-security.mdc (webhooks).

1. BillingProvider interface + Stripe implementation (10 s timeout, idempotency keys) + FakeStripe.
2. createCheckoutSession, createPortalSession, subscription, invoices.
3. POST /webhooks/stripe with raw body, signature verification, stripe_events dedupe, enqueue
   billing.applyEvent; handler applies events with the out-of-order guard (last_event_at).
4. billing.syncPlans job mirroring active Prices/Products (features + entitlements from product metadata).
5. Tests: bad signature 400; duplicate event no-op; older event ignored; status transitions
   ACTIVE → PAST_DUE → CANCELED; ALREADY_SUBSCRIBED; NO_BILLING_ACCOUNT; entitlements change with plan.
```

---

## Step 16 — Account deletion, purge, retention, contact form

```
Read @docs/05-API-OPERATIONS.md sections B (requestAccountDeletion, restoreAccount), A (submitContactMessage), K.

1. requestAccountDeletion / restoreAccount with session revocation and Stripe cancel_at_period_end.
2. accounts.purge job exactly as described at the end of docs/05 section K; resumable.
3. retention.* jobs.
4. submitContactMessage with Turnstile verification (interface + fake), storage, email job.
5. Tests: purge removes every resident-owned row and de-identifies corrections; restore within window;
   PENDING_DELETION gating; BOT_CHECK_FAILED; contact rate limit.
```

---

## Step 17 — Civic data pipeline

```
Read @docs/00-PHASE1-SCOPE.md, @docs/05-API-OPERATIONS.md section K (source.run, locations.reresolve,
services.linkcheck), @docs/04-SECURITY-BASELINE.md T15.

1. src/modules/pipeline: Collector interface { key, fetch(ctx) → RawSnapshot, normalise(raw) →
   NormalisedRecords } and a registry keyed by sources.collector_key.
2. Run orchestration (source.run job): create source_run, fetch with size caps + timeouts + host
   allowlist, store snapshot to S3 with sha256 (skip if unchanged), normalise, match (external id →
   deterministic keys), apply: structured sources write + audit as SOURCE; PAGE_COLLECTION changes to
   holder/contact fields create pending_source_changes; record counts/errors.
3. Collectors (each with fixture-based tests, no network in tests):
   - tiger.boundaries: load TIGER/Line shapefiles/GeoJSON for configured layers and states
     (nation, state, CD, SLDU, SLDL, county, place, unified/elementary/secondary school districts, ZCTA)
     via ogr2ogr or a GeoJSON stream → upsertBoundary().
   - congress.legislators: unitedstates/congress-legislators current YAML/JSON → federal offices, officials, terms.
   - openstates.people: Open States nightly CSV per state → state legislative offices/officials/terms.
   - page.directory: generic configurable HTML directory collector (CSS selectors in source config)
     for county/city/school board pages, respecting robots.txt, 1 req/s, identifying user agent.
4. locations.reresolve and services.linkcheck jobs.
5. Tests: idempotent re-run (no duplicate records); unchanged snapshot skipped; page change creates
   pending change instead of writing; oversized download aborted; robots disallow respected.
```

---

## Step 18 — Analytics events, schema export, docs

```
Read @docs/05-API-OPERATIONS.md and @.cursor/rules/20-security.mdc (data protection). Server-side events only.

1. Server-side events: signup_completed, login, location_saved/deleted, follow/unfollow,
   notification_pref_changed, notification_sent/delivered/failed/opened/clicked, correction_submitted/
   resolved, checkout_started, subscription_status_changed, outbound_click (from /u/c). Properties
   never include email, address, name or tokens; distinct id = internal user uuid.
2. pnpm schema:print → schema.graphql committed; CI step fails when stale.
3. Generate docs/API-REFERENCE.md from the schema (operation, args, scope) with a small script.
4. Test: analytics fake receives no property matching an email/address regex across the whole test suite.
```

---

## Step 19 — Hardening, CI/CD, container

```
Read @docs/04-SECURITY-BASELINE.md (all) and @.cursor/rules/70-testing-quality.mdc (gates).

1. Dockerfile: multi-stage, pnpm fetch/install --frozen-lockfile, prisma generate, build, prune dev deps,
   final stage node:22-alpine (or distroless), non-root user, read-only root FS friendly, HEALTHCHECK on /healthz.
2. .github/workflows/ci.yml: install → lint → typecheck → unit → integration (services: postgis) →
   prisma migrate diff check → schema diff check → pnpm audit --prod → osv-scanner → gitleaks →
   docker build. deploy.yml: staging on main, production on tag with manual approval and a
   `prisma migrate deploy` one-off task using MIGRATION_DATABASE_URL.
3. Walk the pre-release checklist in docs/04 section 4 and fix every gap; add missing tests.
4. README: local setup, env, DB roles (prisma/sql/20_db_roles.sql), runbook (deploy, rollback,
   restore, rotating JWT/cookie keys, re-running a failed source).
```

**Done when**
- [ ] CI is green on a fresh clone.
- [ ] Every item in docs/04 section 4 is ticked.
- [ ] Coverage ≥ 80% on src/modules/**.

---

## After step 19 — handover checklist (SOW A16/A17)

- [ ] All operations in docs/05 implemented and tested.
- [ ] `schema.graphql` and `docs/API-REFERENCE.md` current.
- [ ] Setup, admin, data and operations docs written (README + docs/).
- [ ] Repos, migrations and config in QubaLink-owned GitHub; secrets only in QubaLink AWS.
