#!/bin/sh
# Wiederherstellung im Backup-Container (api, worker und web müssen gestoppt sein).
# Aufruf: restore.sh <archiv-name-oder-pfad> [--force]
set -eu
ARG="${1:?Archiv angeben (Name in /backups oder Pfad)}"
FORCE="${2:-}"
DIR="${BACKUP_DIR:-/backups}"
FILES_DIR="${FILES_DIR:-/data/files}"
case "$ARG" in
  latest) FILE="$DIR/$(ls -1 "$DIR" | grep -E '^jotion-.*\.tar$' | sort | tail -1)" ;;
  /*) FILE="$ARG" ;;
  *) FILE="$DIR/$ARG" ;;
esac
[ -f "$FILE" ] || { echo "Archiv nicht gefunden: $FILE" >&2; exit 2; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -xf "$FILE" -C "$WORK"
(cd "$WORK" && sha256sum -c SHA256SUMS) || { echo "Prüfsummen stimmen nicht, Archiv beschädigt" >&2; exit 3; }

SCHEMA="$(sed -n 's/.*"schemaVersion": "\([^"]*\)".*/\1/p' "$WORK/manifest.json")"
FP="$(sed -n 's/.*"masterKeyFingerprint": "\([^"]*\)".*/\1/p' "$WORK/manifest.json")"
LATEST="$(ls -1 /migrations 2>/dev/null | grep -E '^[0-9]{14}_' | sort | tail -1 || true)"
echo "Archiv: $(basename "$FILE"), Schema ${SCHEMA}, Anwendung kennt bis ${LATEST:-?}"
# Neuere Sicherung als die installierte Version: erst Jotion aktualisieren
if [ -n "$LATEST" ] && [ "$SCHEMA" != "unknown" ] && [ "$SCHEMA" \> "$LATEST" ] && [ "$FORCE" != "--force" ]; then
  echo "Die Sicherung stammt von einer neueren Jotion-Version (${SCHEMA}). Bitte zuerst aktualisieren." >&2
  exit 4
fi
if [ -n "$FP" ] && [ -n "${JOTION_MASTER_KEY:-}" ]; then
  NOW="$(printf '%s' "$JOTION_MASTER_KEY" | sha256sum | cut -c1-16)"
  if [ "$NOW" != "$FP" ]; then
    echo "WARNUNG: JOTION_MASTER_KEY unterscheidet sich von der Sicherung. Gespeicherte Zugangsdaten der Integrationen sind ohne den alten Schlüssel nicht lesbar (alten Schlüssel als JOTION_MASTER_KEY_PREVIOUS eintragen)." >&2
  fi
fi

echo "Datenbank wird ersetzt …"
psql -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
pg_restore --no-owner --no-privileges --exit-on-error -d "$PGDATABASE" "$WORK/database.dump"
echo "Dateien werden ersetzt …"
find "$FILES_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
tar -xzf "$WORK/files.tar.gz" -C "$FILES_DIR"
echo "Wiederherstellung abgeschlossen. Beim Start wendet der migrate-Job neuere Migrationen an."
