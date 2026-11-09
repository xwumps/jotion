#!/bin/sh
# Jotion-Sicherung: Datenbank (pg_dump -Fc) und Datei-Volume in ein Archiv mit Manifest.
# Aufruf im Backup-Container: backup.sh [auto|manual|pre-update]
# Ergebnis: /backups/jotion-<YYYYmmdd-HHMMSS>-<anlass>.tar, Status in /backups/status.json
set -eu

TRIGGER="${1:-manual}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
FILES_DIR="${FILES_DIR:-/data/files}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
NAME="jotion-${STAMP}-${TRIGGER}.tar"
WORK="$(mktemp -d "${BACKUP_DIR}/.work-XXXXXX")"
LOCK="${BACKUP_DIR}/.lock"

status() {
  # $1 ok|failed, $2 Datei oder Fehlermeldung
  printf '{"lastRun":"%s","ok":%s,"trigger":"%s","%s":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$([ "$1" = ok ] && echo true || echo false)" \
    "$TRIGGER" "$([ "$1" = ok ] && echo file || echo error)" "$(printf '%s' "$2" | tr '"\n' "' ")" \
    > "${BACKUP_DIR}/status.json.tmp"
  mv "${BACKUP_DIR}/status.json.tmp" "${BACKUP_DIR}/status.json"
}

cleanup() { rm -rf "$WORK"; rmdir "$LOCK" 2>/dev/null || true; }

if ! mkdir "$LOCK" 2>/dev/null; then
  # Verwaiste Sperre (älter als 6 Stunden) entfernen
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +360 2>/dev/null)" ]; then
    rmdir "$LOCK" && mkdir "$LOCK"
  else
    echo "Sicherung läuft bereits" >&2
    rm -rf "$WORK"
    exit 75
  fi
fi
trap 'status failed "Abbruch in Zeile $LINENO"; cleanup' EXIT INT TERM

echo "Sicherung ${NAME} beginnt"
SCHEMA="$(psql -Atq -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1" 2>/dev/null || echo unknown)"
pg_dump -Fc --no-owner --no-privileges -f "${WORK}/database.dump"
tar -czf "${WORK}/files.tar.gz" -C "$FILES_DIR" .
KEYFP=""
if [ -n "${JOTION_MASTER_KEY:-}" ]; then
  KEYFP="$(printf '%s' "$JOTION_MASTER_KEY" | sha256sum | cut -c1-16)"
fi
DB_BYTES=$(wc -c < "${WORK}/database.dump")
FILES_BYTES=$(wc -c < "${WORK}/files.tar.gz")
(cd "$WORK" && sha256sum database.dump files.tar.gz > SHA256SUMS)
ENC_JSON='"encrypted": false'
PARTS="database.dump files.tar.gz"
# Phase 12.1: Inhalt mit einem aus dem Master Key abgeleiteten Schlüssel verschlüsseln
if [ "${BACKUP_ENCRYPT:-true}" = "true" ] && [ -n "${JOTION_MASTER_KEY:-}" ]; then
  . /scripts/crypto.sh
  tar -cf "${WORK}/payload.tar" -C "$WORK" database.dump files.tar.gz SHA256SUMS
  rm -f "${WORK}/database.dump" "${WORK}/files.tar.gz"
  ENC="$(encrypt_payload "$JOTION_MASTER_KEY" "${WORK}/payload.tar" "${WORK}/payload.enc")"
  set -- $ENC
  rm -f "${WORK}/payload.tar"
  ENC_JSON="\"encrypted\": true, \"cipher\": \"aes-256-cbc+hmac-sha256\", \"iv\": \"$1\", \"mac\": \"$2\""
  PARTS="payload.enc"
fi
cat > "${WORK}/manifest.json" <<JSON
{
  "format": 2,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "trigger": "${TRIGGER}",
  "schemaVersion": "${SCHEMA}",
  "masterKeyFingerprint": "${KEYFP}",
  "databaseBytes": ${DB_BYTES},
  "filesBytes": ${FILES_BYTES},
  ${ENC_JSON}
}
JSON
# Äußere Prüfsummen (Manifest und Inhalt); bei unverschlüsselten Sicherungen wie Format 1
(cd "$WORK" && sha256sum manifest.json $PARTS > SHA256SUMS)
tar -cf "${BACKUP_DIR}/.${NAME}.part" -C "$WORK" manifest.json $PARTS SHA256SUMS
mv "${BACKUP_DIR}/.${NAME}.part" "${BACKUP_DIR}/${NAME}"

/scripts/rotate.sh "$BACKUP_DIR"
trap - EXIT INT TERM
status ok "$NAME"
cleanup
echo "Sicherung fertig: ${NAME}"
