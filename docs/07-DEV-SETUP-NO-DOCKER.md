# 07 — Development setup without Docker (Hetzner dev database)

Use this when your laptop can't run Docker (for example a company-locked Windows laptop). The
development database runs on Leen's Hetzner server; your laptop runs the API code and connects
through an SSH tunnel. Nothing needs admin rights on the laptop.

```
Laptop (Cursor, Node, pnpm)                     Hetzner server (Ubuntu)
  pnpm dev / pnpm test  ──► localhost:5433 ══ SSH tunnel ══► Postgres 16 + PostGIS on localhost:5432
```

**Environment boundary (SOW A13/A14):** Hetzner is for **development only** (fake data).
Staging, UAT and production must run in **QubaLink's own AWS account**. Hosting staging or
production on Hetzner would need a signed Change Order.

## 1. On the Hetzner server (once, about 5 minutes)

From Git Bash on your laptop, copy the two files up and run the installer:

```bash
scp server/install-dev-db.sh server/dev-db-init.sql <user>@<server-ip>:~/
ssh <user>@<server-ip>
sudo bash ~/install-dev-db.sh
```

It installs PostgreSQL 16 + PostGIS 3, keeps Postgres on localhost only (no public port), creates
`civiclink_owner` and `civiclink_app` with random strong passwords, and creates three databases:
`civiclink` (dev), `civiclink_shadow` (Prisma migrations) and `civiclink_test` (integration tests).
At the end it **prints five connection strings once**. Copy them into your laptop's `.env`.

## 2. On your laptop, every work session

Open a Git Bash or PowerShell window and leave it running:

```bash
ssh -N -L 5433:localhost:5432 <user>@<server-ip>
```

(OpenSSH ships with Windows 10/11 and Git Bash — no install needed.) While this window is open,
`localhost:5433` on your laptop is the server's Postgres. Close it when you're done.

Tip: an SSH key avoids typing a password each time: `ssh-keygen -t ed25519`, then append
`~/.ssh/id_ed25519.pub` to the server's `~/.ssh/authorized_keys`.

## 3. How tests work

- **On your laptop:** integration tests use `civiclink_test` on the server (via the tunnel) when
  `TEST_DATABASE_URL` is set. They run one file at a time and truncate tables between tests.
  Expect them to be slower than local Docker because of network latency — that's normal.
- **In CI (GitHub Actions):** the runner has Docker, so Testcontainers starts a throwaway PostGIS.
  Same tests, no secrets needed.

## 4. Commands that change on Windows

| Kit says | On Windows |
|---|---|
| `corepack enable` | skip; use `npm install -g pnpm` (already done) |
| `pnpm db:up` | not used; open the SSH tunnel instead |
| `cp .env.example .env` | Git Bash: same. PowerShell/cmd: `copy .env.example .env` |
| `openssl rand -base64 32` | run in Git Bash (includes openssl) |

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:5433` | The tunnel window is closed. Reopen it. |
| `password authentication failed` | Re-copy the connection string from the installer output; check special characters are not altered. |
| `permission denied for schema public` when running migrations | You used `DATABASE_URL` (app role) for migrations. Migrations must use `MIGRATION_DATABASE_URL`. |
| `type "geometry" does not exist` | The database was not created by the installer (missing `extensions` schema / search_path). Re-run the matching block of `server/dev-db-init.sql` as postgres. |
| Lost the passwords | On the server: `sudo -u postgres psql -c "ALTER ROLE civiclink_app PASSWORD 'NewStr0ng!pass'"` (same for civiclink_owner). |
