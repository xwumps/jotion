#!/bin/sh
# Dauerprozess des Backup-Dienstes: täglich zur Uhrzeit BACKUP_TIME (HH:MM, Zeitzone TZ) eine
# Sicherung; zusätzlich auf Anforderung (Datei /backups/.request, angelegt von der API).
set -eu
TIME="${BACKUP_TIME:-03:15}"
DIR="${BACKUP_DIR:-/backups}"
last=""
echo "Backup-Dienst bereit (täglich ${TIME}, Aufbewahrung ${BACKUP_KEEP_DAILY:-7} Tage, ${BACKUP_KEEP_WEEKLY:-4} Wochen)"
while true; do
  now="$(date +%H:%M)"
  today="$(date +%Y-%m-%d)"
  if [ "${BACKUP_ENABLED:-true}" = "true" ] && [ "$now" = "$TIME" ] && [ "$last" != "$today" ]; then
    last="$today"
    /scripts/backup.sh auto || echo "Sicherung fehlgeschlagen" >&2
  fi
  if [ -f "${DIR}/.request" ]; then
    rm -f "${DIR}/.request"
    /scripts/backup.sh manual || echo "Sicherung fehlgeschlagen" >&2
  fi
  sleep 10
done
