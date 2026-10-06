# CivicLink Phase 1 — Backend Cursor Kit

Everything Cursor needs to build the CivicLink Phase 1 **backend and database** (Node.js 22,
TypeScript, GraphQL, PostgreSQL 16 + PostGIS, Prisma 7) to a senior standard: secure by default,
typed errors everywhere, and a complete role/permission model. Scope is the signed SOW (A1–A20)
only. The Next.js frontend is not part of this kit.

## What's inside

| Path | What it is | Who uses it |
|---|---|---|
| `.cursor/rules/*.mdc` | 8 project rules Cursor loads automatically: core scope + non-negotiables, architecture, security, errors & logging, Prisma/DB, GraphQL, RBAC, testing | Cursor (every chat) |
| `docs/00-PHASE1-SCOPE.md` | In/out of scope for the backend + open decisions with defaults | You + Cursor |
| `docs/01-ARCHITECTURE.md` | System context, stack versions, layers, modules, env vars, environments, deployment | You + Cursor |
| `docs/02-RBAC-PERMISSIONS.md` | Every principal and role, permission catalogue, role→permission matrix, what each role can and cannot do, field-level visibility, audit | You + Cursor + tests |
| `docs/03-ERROR-CATALOG.md` | Every error code with HTTP status, message, exposure, retry, log level | You + Cursor + tests |
| `docs/04-SECURITY-BASELINE.md` | Threat → control matrix, OWASP API Top 10 mapping, encryption, release checklist | You + reviewers |
| `docs/05-API-OPERATIONS.md` | Every GraphQL operation and REST route: scope, permission, rate limit, input validation, rules, errors; background jobs | You + Cursor + tests |
| `docs/06-BUILD-STEPS.md` | **19 numbered prompts to paste into Cursor, one per chat**, each with verify commands and done criteria | You |
| `prisma/schema.prisma` | Final Phase 1 data model (36 models, 31 enums), Prisma 7 syntax, validated | Cursor (step 03) |
| `prisma/sql/00_extensions.sql` | Prepend to first migration: PostGIS + citext in an `extensions` schema | Cursor (step 03) |
| `prisma/sql/10_post_init.sql` | Append to first migration: spatial indexes, partial unique indexes, CHECK constraints, append-only audit trigger | Cursor (step 03) |
| `prisma/sql/20_db_roles.sql` | Staging/production DB roles (owner / app / readonly), run by DBA | DevOps |
| `server/install-dev-db.sh`, `server/dev-db-init.sql` | No-Docker option: installs Postgres 16 + PostGIS on an Ubuntu server (Hetzner) with dev/shadow/test databases | You |
| `docs/07-DEV-SETUP-NO-DOCKER.md` | Step-by-step for the Hetzner dev database + SSH tunnel on Windows | You |
| `docker-compose.yml`, `docker/postgres-init/` | Alternative for machines with Docker | You |
| `.env.example` | Every env var with local defaults | You |

## How to use it

1. Create an empty repo (`civiclink-api`), copy everything here into it, `git init`, first commit.
2. Open it in Cursor. Check **Settings → Rules** lists the 8 project rules.
3. Open `docs/06-BUILD-STEPS.md`. For each step: new Agent chat → paste the prompt → review the diff →
   run the Verify commands → tick Done when → commit. Don't skip ahead.
4. When Cursor proposes something outside scope or without tests, point it back at
   `.cursor/rules/00-core.mdc` and `.cursor/rules/70-testing-quality.mdc`.

## Local quick start (after step 03)

```bash
npm install -g pnpm             # once (no admin needed)
pnpm install
cp .env.example .env            # then fill the secrets below + DB URLs
# Database, pick one:
#   No Docker: keep `ssh -N -L 5433:localhost:5432 <user>@<server>` open (docs/07-DEV-SETUP-NO-DOCKER.md)
#   Docker:    pnpm db:up
pnpm db:migrate && pnpm db:seed
pnpm dev                        # API on :4000
pnpm dev:worker                 # jobs
```

### Generate dev secrets

```bash
# ES256 key pair for access tokens
openssl ecparam -name prime256v1 -genkey -noout -out jwt.key
openssl pkcs8 -topk8 -nocrypt -in jwt.key -out jwt.pk8.pem && openssl ec -in jwt.key -pubout -out jwt.pub.pem
# 32-byte secrets
openssl rand -base64 32   # COOKIE_ENC_KEY
openssl rand -base64 48   # LINK_SIGNING_SECRET
openssl rand -base64 48   # IP_HASH_SECRET
```
Put PEMs in `.env` with `\n` for newlines. Delete the key files afterwards.

## Database roles (why there are two connection strings)

- `MIGRATION_DATABASE_URL` → `civiclink_owner`: owns tables, used only by Prisma migrations.
- `DATABASE_URL` → `civiclink_app`: runtime role with read/write on rows only. It cannot create or
  drop tables and cannot update or delete the audit log.
- PostGIS must be created by a superuser before the first migration (local: automatic in
  `docker/postgres-init`; RDS: run `prisma/sql/20_db_roles.sql` Part A as the master user, then
  Part B after the first deploy).

## Verified in this kit

- `schema.prisma` validates and formats cleanly with Prisma 7.10's schema engine (no lint warnings).
- On PostgreSQL 16 + PostGIS: the dev init script, an owner-role (non-superuser) migration of the
  extension and constraint SQL, and the runtime role's permissions were exercised end to end:
  every partial unique index and CHECK constraint rejects bad rows, invalid polygons are refused,
  the audit log rejects UPDATE/DELETE by trigger and by grant, point-in-polygon works through the
  `extensions` search path, and `spatial_ref_sys` stays out of `public`.
- Not yet run: Prisma's generated `init` migration itself (the Prisma CLI could not download its
  engines in the environment where the kit was built). Step 03 creates and applies it on your machine.
