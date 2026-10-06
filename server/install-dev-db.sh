#!/usr/bin/env bash
# CivicLink — install PostgreSQL 16 + PostGIS 3 on an Ubuntu 22.04/24.04 Hetzner server
# and create the development databases. Run on the server as root (or with sudo):
#   bash install-dev-db.sh
# Postgres listens on localhost only; your laptop connects through an SSH tunnel.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run as root (sudo bash install-dev-db.sh)"; exit 1; fi
cd "$(dirname "$0")"

echo "==> Adding the official PostgreSQL apt repository"
apt-get update -y
apt-get install -y postgresql-common ca-certificates
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y

echo "==> Installing PostgreSQL 16 and PostGIS 3"
apt-get install -y postgresql-16 postgresql-16-postgis-3

echo "==> Making sure Postgres listens on localhost only"
CONF=/etc/postgresql/16/main/postgresql.conf
sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" "$CONF"
systemctl restart postgresql

echo "==> Generating strong passwords"
OWNER_PW="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)Aa1!"
APP_PW="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)Aa1!"

echo "==> Creating roles and databases"
cp dev-db-init.sql /tmp/dev-db-init.sql && chmod 644 /tmp/dev-db-init.sql
sudo -u postgres psql -v ON_ERROR_STOP=1 \
  -v owner_pw="'${OWNER_PW}'" -v app_pw="'${APP_PW}'" -f /tmp/dev-db-init.sql
rm -f /tmp/dev-db-init.sql

cat <<EOF

============================================================================
 Done. Copy these into your laptop's .env (they are shown only once):

 DATABASE_URL=postgresql://civiclink_app:${APP_PW}@localhost:5433/civiclink
 MIGRATION_DATABASE_URL=postgresql://civiclink_owner:${OWNER_PW}@localhost:5433/civiclink
 SHADOW_DATABASE_URL=postgresql://civiclink_owner:${OWNER_PW}@localhost:5433/civiclink_shadow
 TEST_DATABASE_URL=postgresql://civiclink_app:${APP_PW}@localhost:5433/civiclink_test
 TEST_MIGRATION_DATABASE_URL=postgresql://civiclink_owner:${OWNER_PW}@localhost:5433/civiclink_test

 Then on your laptop keep this tunnel open while you work:
   ssh -N -L 5433:localhost:5432 <your-user>@<server-ip>
============================================================================
EOF
