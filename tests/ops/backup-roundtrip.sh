#!/usr/bin/env bash
# Phase 12: Backup-Restore-Roundtrip gegen den laufenden Docker-Stack.
#  1. Anmelden (Owner aus den E2E-Tests), Seite "Vor der Sicherung" und Datei anlegen
#  2. Sicherung über den Backup-Dienst
#  3. Seite "Nach der Sicherung" anlegen und die erste Seite umbenennen
#  4. Wiederherstellen (scripts/restore.sh latest)
#  5. Prüfen: Stand der Sicherung ist zurück, spätere Änderung ist weg, Datei ist abrufbar
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="${JOTION_E2E_URL:-http://localhost:8080}"
EMAIL="${JOTION_E2E_EMAIL:-jarne@example.com}"
PASS="${JOTION_E2E_PASSWORD:-ein-sicheres-passwort}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
api() { curl -fsS -b "$JAR" -c "$JAR" -H 'content-type: application/json' "$@"; }
fail() { echo "FEHLER: $*" >&2; exit 1; }
login() {
  api -X POST "$BASE/api/auth/login" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" >/dev/null
}

login
WS="$(api "$BASE/api/auth/me" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).workspaces[0].id))')"
RUN="$(date +%s)"
PAGE="$(api -X POST "$BASE/api/workspaces/$WS/pages" -d "{\"title\":\"Vor der Sicherung $RUN\",\"scope\":\"TEAM\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')"
# Kleines PNG (1x1 Pixel)
echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > "$JAR.png"
FILE="$(curl -fsS -b "$JAR" -F "file=@$JAR.png;type=image/png" "$BASE/api/workspaces/$WS/files" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')"
# Bilder werden beim Hochladen neu kodiert: Vergleich mit dem gespeicherten Stand
SUM="$(curl -fsS -b "$JAR" "$BASE/api/files/$FILE" | sha256sum | cut -c1-64)"
echo "Seite $PAGE und Datei $FILE angelegt"

bash scripts/backup.sh manual

api -X PATCH "$BASE/api/pages/$PAGE" -d '{"title":"Nach der Sicherung umbenannt"}' >/dev/null
LATER="$(api -X POST "$BASE/api/workspaces/$WS/pages" -d "{\"title\":\"Nach der Sicherung $RUN\",\"scope\":\"TEAM\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')"

bash scripts/restore.sh latest

login
TITLE="$(api "$BASE/api/pages/$PAGE" | node -pe 'JSON.parse(require("fs").readFileSync(0)).title')"
[[ "$TITLE" == "Vor der Sicherung $RUN" ]] || fail "Titel nach Wiederherstellung: $TITLE"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/api/pages/$LATER")"
[[ "$CODE" == "404" ]] || fail "Seite nach der Sicherung existiert noch (Status $CODE)"
GOT="$(curl -fsS -b "$JAR" "$BASE/api/files/$FILE" | sha256sum | cut -c1-64)"
[[ "$GOT" == "$SUM" ]] || fail "Datei nach Wiederherstellung unterscheidet sich"
rm -f "$JAR.png"
echo "Backup-Restore-Roundtrip erfolgreich"
