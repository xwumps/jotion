#!/usr/bin/env bash
# Erzeugt eine .env mit zufälligen Secrets aus .env.example.
# Bestehende .env wird nie überschrieben.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  echo ".env existiert bereits, nichts geändert."
  exit 0
fi

rand_b64() { openssl rand -base64 32 | tr -d '\n'; }
rand_hex() { openssl rand -hex 24; }

PG_PASS="$(rand_hex)"
REDIS_PASS="$(rand_hex)"

sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://jotion:${PG_PASS}@localhost:5432/jotion|" \
  -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASS}|" \
  -e "s|^REDIS_URL=.*|REDIS_URL=redis://:${REDIS_PASS}@localhost:6379|" \
  -e "s|^JOTION_MASTER_KEY=.*|JOTION_MASTER_KEY=$(rand_b64)|" \
  -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$(rand_b64)|" \
  .env.example > .env
chmod 600 .env

echo ".env erstellt."
echo "WICHTIG: JOTION_MASTER_KEY aus .env an einem sicheren Ort zusätzlich sichern."
