#!/usr/bin/env bash
# Phase 12: Upgrade-Test. Startet die Vorversion (Git-Ref, Standard origin/main) in einem eigenen
# Compose-Projekt, legt Daten an, startet dann den aktuellen Stand mit denselben Volumes
# (Migrationen laufen im migrate-Job) und prüft, dass die Daten erhalten und nutzbar sind.
# Aufruf: tests/ops/upgrade-test.sh [vorversion-ref]
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
OLD_REF="${1:-origin/main}"
PROJECT="${JOTION_UPGRADE_PROJECT:-jotion-upgrade}"
PORT="${JOTION_UPGRADE_PORT:-8090}"
BASE="http://localhost:${PORT}"
OLD_DIR="$(mktemp -d)/old"
JAR="$(mktemp)"
export JOTION_HTTP_PORT="$PORT" JOTION_HTTPS_PORT="$((PORT + 1))"

finish() {
  docker compose -p "$PROJECT" -f "$ROOT/compose.yml" down -v >/dev/null 2>&1 || true
  git -C "$ROOT" worktree remove --force "$OLD_DIR" >/dev/null 2>&1 || true
}
trap finish EXIT
fail() { echo "FEHLER: $*" >&2; docker compose -p "$PROJECT" logs --tail 80 >&2 || true; exit 1; }
api() { curl -fsS -b "$JAR" -c "$JAR" -H 'content-type: application/json' "$@"; }
json() { node -pe "const o=JSON.parse(require('fs').readFileSync(0));$1"; }

echo "Vorversion ${OLD_REF} vorbereiten …"
git worktree add --detach "$OLD_DIR" "$OLD_REF" >/dev/null
cp "$ROOT/.env" "$OLD_DIR/.env"
# Nicht versionierte Zusatzdateien aus der .env (z. B. JOTION_BUILD_CA) mitnehmen
if [[ -d "$ROOT/docker/data" ]]; then
  mkdir -p "$OLD_DIR/docker/data"
  cp -a "$ROOT/docker/data/." "$OLD_DIR/docker/data/"
fi
# Eigene Image-Tags, damit die Vorversion die aktuellen Images nicht überschreibt
(cd "$OLD_DIR" && JOTION_VERSION=upgrade-old docker compose -p "$PROJECT" up -d --build --wait --wait-timeout 300) ||
  fail "Vorversion startet nicht"

echo "Daten in der Vorversion anlegen …"
api -X POST "$BASE/api/auth/setup" \
  -d '{"name":"Upgrade Test","email":"upgrade@example.com","password":"upgrade-passwort-1","workspaceName":"Upgrade"}' >/dev/null
WS="$(api "$BASE/api/auth/me" | json 'o.workspaces[0].id')"
PAGE="$(api -X POST "$BASE/api/workspaces/$WS/pages" -d '{"title":"Seite vor dem Update","scope":"TEAM"}' | json 'o.id')"
DB="$(api -X POST "$BASE/api/workspaces/$WS/databases" -d '{"title":"Aufgaben vor dem Update","scope":"TEAM"}' | json 'o.id')"
api -X POST "$BASE/api/databases/$DB/rows" -d '{"title":"Steuererklärung"}' >/dev/null

echo "Auf den aktuellen Stand aktualisieren …"
(cd "$OLD_DIR" && JOTION_VERSION=upgrade-old docker compose -p "$PROJECT" stop web api worker caddy >/dev/null)
docker compose -p "$PROJECT" up -d --build --wait --wait-timeout 300 || fail "Aktueller Stand startet nach dem Update nicht"

echo "Daten prüfen …"
api -X POST "$BASE/api/auth/login" -d '{"email":"upgrade@example.com","password":"upgrade-passwort-1"}' >/dev/null
TITLE="$(api "$BASE/api/pages/$PAGE" | json 'o.title')"
[[ "$TITLE" == "Seite vor dem Update" ]] || fail "Seite nach dem Update: $TITLE"
ROWS="$(api -X POST "$BASE/api/databases/$DB/query" -d '{}' | json 'o.rows.map(r=>r.title).join(",")')"
[[ "$ROWS" == "Steuererklärung" ]] || fail "Zeilen nach dem Update: $ROWS"
# Schreiben nach dem Update
api -X POST "$BASE/api/databases/$DB/rows" -d '{"title":"Nach dem Update"}' >/dev/null
PENDING="$(docker compose -p "$PROJECT" logs migrate 2>&1 | grep -c 'Applying migration' || true)"
echo "Upgrade erfolgreich (${PENDING} Migration(en) angewendet)"
