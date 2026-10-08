# 04 — Security Baseline

Controls the Phase 1 backend must implement, mapped to the threats they address. This applies the
SOW's Annexure F secure-development practices to Leen's own work; it is not a compliance
certification (government-grade compliance is excluded by SOW A20). Implementation rules live in
`.cursor/rules/20-security.mdc`.

## 1. Threat → control matrix

| # | Threat | Controls | Verified by |
|---|---|---|---|
| T1 | Account takeover via OAuth flaws (CSRF on callback, code injection, token substitution) | PKCE S256 + state + nonce; full ID-token verification (sig, iss, aud, exp, nonce); encrypted short-lived OAuth cookie; allowlisted relative `returnTo` | Unit tests for each verification failure; integration test with forged state |
| T2 | Session theft / replay | HttpOnly Secure `__Host-` cookies; 15-min ES256 access JWT; rotating refresh tokens with family reuse detection; hashed tokens at rest; sign-out everywhere | Test: reused refresh token revokes family |
| T3 | Account linking abuse (attacker's Apple account claims victim's Google account) | Link providers only when both assert `email_verified` for the same email; identity keyed by `(provider, sub)` | Test: unverified email creates separate user |
| T4 | Admin compromise | Workspace `hd` + allowlist; 2-step verification enforced in Workspace; idle 30 min / absolute 12 h; lockout; role read from DB per request; deactivation revokes sessions; all admin actions audited | Tests for lockout, deactivation, role change |
| T5 | Broken object-level authorization (IDOR) | Ownership in SQL `WHERE user_id = $principal`; other residents' ids → NOT_FOUND; service-layer `requireResident` | Ownership test on every resident operation |
| T6 | Broken function-level authorization | `authScopes` on every root field (schema-guard test) + `authz.require` in services; fixed role→permission map | `authz-matrix.test.ts` table-driven from doc 02 |
| T7 | Excessive data exposure | Explicit DTO allowlists; field-level scopes; admins never see resident email/locations/follows; no Stripe ids to clients | Snapshot tests of DTO shapes |
| T8 | Injection (SQL, CSV, header) | Prisma + tagged `$queryRaw` only (`$queryRawUnsafe` banned by lint); CSV cell prefixing; no user input in headers/redirects without allowlist | Lint rule; CSV unit test |
| T9 | CSRF on cookie-authenticated GraphQL | `x-civiclink-csrf` required on `/graphql` except OPTIONS. Outside production, a document that is only an introspection query (`__schema` / `__type`) may omit that header, and the depth limit is not applied to that document. In development and test, that same document is also accepted when `Origin` is outside `CORS_ORIGINS`; every other operation is still rejected. The CORS allowlist itself is unchanged. Production always requires the header and rejects a disallowed `Origin` before the query is read. Introspection stays forced off in production. | Tests: non-introspection without the header rejected; Apollo Studio introspection allowed in development/test; a protected field stays unauthorized |
| T10 | DoS / resource abuse (deep queries, scraping, geocoder cost) | `src/graphql/limits.ts` depth/alias/directive/token/cost limits; pagination caps; Postgres-backed rate limits per class; geocoder circuit breaker; body size limits; statement timeout 15 s | Tests for each limit |
| T11 | Webhook forgery / replay (Stripe) | Signature verification with 300 s tolerance; event-id idempotency; out-of-order guard | Tests with bad signature, duplicate, older event |
| T12 | Secrets leakage | Env validated at boot; Secrets Manager in staging/prod; pino redaction; no secrets in repo (gitleaks in CI); Sentry PII scrubbing | CI gitleaks; logger redaction test |
| T13 | PII leakage via logs/analytics/URLs | No raw addresses stored or logged; IP HMAC hashing; analytics get jurisdiction/ZIP only; lookup tokens instead of addresses in URLs | Logger + analytics unit tests |
| T14 | Open redirect (OAuth return, email click tracking) | Relative-path allowlist; click redirects only to URLs stored on the notification | Unit tests |
| T15 | Malicious source data (scraped HTML, huge files) | Fetch size cap (50 MB bulk, 5 MB page), content-type checks, timeouts, parse in worker only, strip HTML to text, URL validation, page-collection changes need editor approval | Pipeline unit tests |
| T16 | Spam via contact/corrections | Turnstile, rate limits, daily correction cap, duplicate-open constraint | Tests |
| T17 | Privilege escalation in admin management | Only SUPER_ADMIN manages admins; no self role change; last Super Admin protected; audit | Tests |
| T18 | Audit tampering | `change_log` append-only trigger + revoked UPDATE/DELETE grants | DB test (exists in prisma/sql/10_post_init.sql) |
| T19 | Dependency / supply-chain compromise | Lockfile; `pnpm audit --prod` + osv-scanner in CI; Renovate weekly; minimal base image; non-root container | CI |
| T20 | Data loss | RDS automated backups + PITR (7–35 days per QubaLink), encryption at rest (KMS), restore drill documented at handover | Runbook |

## 2. OWASP API Security Top 10 (2023) coverage

| OWASP | Covered by |
|---|---|
| API1 Broken Object Level Authorization | T5 |
| API2 Broken Authentication | T1, T2, T3, T4 |
| API3 Broken Object Property Level Authorization | T7, Zod `.strict()` inputs (no mass assignment) |
| API4 Unrestricted Resource Consumption | T10, T16 |
| API5 Broken Function Level Authorization | T6, T17 |
| API6 Unrestricted Access to Sensitive Business Flows | Rate classes for lookup/contact/correction/alert_send; sendAlert confirmation count |
| API7 Server Side Request Forgery | Only fixed provider hosts are called; source URLs restricted to https and an allowlist of hostnames per source; no user-supplied URLs are fetched server-side (evidence URLs are stored, not fetched) |
| API8 Security Misconfiguration | Helmet headers, introspection off in prod, CORS allowlist, least-privilege DB role, env validation |
| API9 Improper Inventory Management | `schema.graphql` committed and diff-checked; docs 05 lists every operation; no undocumented routes |
| API10 Unsafe Consumption of APIs | Provider responses validated with Zod at client boundary; timeouts; no provider text forwarded |

## 3. Encryption & keys

| Item | Mechanism |
|---|---|
| In transit | TLS 1.2+ (ALB/CloudFront); HSTS preload; RDS `sslmode=verify-full` with the RDS CA bundle |
| At rest | RDS + S3 encryption with KMS; backups encrypted |
| Access JWT | ES256 key pair from Secrets Manager; `kid` header to allow rotation (keep previous public key for 24 h) |
| OAuth cookie, signed links | AES-256-GCM (`COOKIE_ENC_KEY`, 32 bytes) and HMAC-SHA256 (`LINK_SIGNING_SECRET`) |
| IP hashing | HMAC-SHA256 with `IP_HASH_SECRET` |
| Refresh / admin session tokens | 32 random bytes, stored as SHA-256 |

## 4. Pre-release security checklist (run at M3 and M4)

- [ ] `pnpm audit --prod` and osv-scanner: no high/critical.
- [ ] gitleaks: no secrets in history.
- [ ] Introspection disabled and GraphiQL off in production build.
- [ ] Every root field has authScopes (schema-guard green); authz matrix test green.
- [ ] Ownership tests pass for every resident operation.
- [ ] Rate limits verified on staging (lookup, auth, contact, correction, alert_send).
- [ ] Stripe webhook rejects bad signature; duplicate event is a no-op.
- [ ] Logs sampled on staging contain no emails, addresses, tokens, cookies.
- [ ] App connects as `civiclink_app`; migrations run as `civiclink_owner`.
- [ ] Container runs as non-root with read-only filesystem.
- [ ] Backup restore tested once on staging.
