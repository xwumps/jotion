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

# Phase 12.1: Sicherung ist verschlüsselt, öffnet nur mit dem richtigen (auch früheren) Master Key
DC=(docker compose)
[[ -n "${JOTION_COMPOSE_PROJECT:-}" ]] && DC+=(-p "$JOTION_COMPOSE_PROJECT")
LIST="$("${DC[@]}" exec -T backup sh -c 'tar -tf "/backups/$(ls -1 /backups | grep -E "^jotion-.*\.tar$" | sort | tail -1)"')"
grep -qx payload.enc <<<"$LIST" || fail "Sicherung nicht verschlüsselt: $LIST"
grep -q database.dump <<<"$LIST" && fail "Datenbank liegt unverschlüsselt im Archiv"
KEY="$("${DC[@]}" exec -T backup printenv JOTION_MASTER_KEY)"
OTHER="$(head -c 32 /dev/urandom | base64)"
verify() { "${DC[@]}" run --rm --no-deps -e JOTION_MASTER_KEY="$1" -e JOTION_MASTER_KEY_PREVIOUS="$2" --entrypoint /scripts/restore.sh backup latest --verify; }
verify "$OTHER" "" >/dev/null 2>&1 && fail "Sicherung ließ sich mit fremdem Schlüssel öffnen"
OUT="$(verify "$OTHER" "$OTHER,$KEY")"
grep -q "früheren Master Key" <<<"$OUT" || fail "Früherer Master Key wird nicht verwendet: $OUT"
OUT="$(bash scripts/restore.sh latest --verify)"
grep -q "lesbar und vollständig" <<<"$OUT" || fail "Prüfung mit --verify fehlgeschlagen: $OUT"

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
