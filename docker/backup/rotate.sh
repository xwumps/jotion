#!/bin/sh
# Rotation: neueste Sicherung je Tag für BACKUP_KEEP_DAILY Tage, je Woche für BACKUP_KEEP_WEEKLY
# Wochen. Sicherungen vor Updates (pre-update) bleiben BACKUP_KEEP_PRE_UPDATE Stück erhalten,
# manuelle Sicherungen BACKUP_KEEP_MANUAL Stück (unabhängig von den täglichen).
set -eu
DIR="${1:-/backups}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
KEEP_PRE="${BACKUP_KEEP_PRE_UPDATE:-3}"
KEEP_MANUAL="${BACKUP_KEEP_MANUAL:-5}"

keep="$(mktemp)"
days=""; weeks=""; nd=0; nw=0; npre=0; nman=0
# Neueste zuerst (Zeitstempel im Namen sortiert lexikographisch)
for f in $(ls -1 "$DIR" 2>/dev/null | grep -E '^jotion-[0-9]{8}-[0-9]{6}-[a-z-]+\.tar$' | sort -r); do
  day="$(echo "$f" | cut -c8-15)"
  case "$f" in
    *-pre-update.tar)
      if [ "$npre" -lt "$KEEP_PRE" ]; then echo "$f" >> "$keep"; npre=$((npre + 1)); fi
      continue ;;
    *-manual.tar)
      if [ "$nman" -lt "$KEEP_MANUAL" ]; then echo "$f" >> "$keep"; nman=$((nman + 1)); fi
      continue ;;
  esac
  epoch="$(date -u -d "$(echo "$day" | sed 's/\(....\)\(..\)\(..\)/\1-\2-\3/')" +%s)"
  week=$((epoch / 604800))
  if [ "$nd" -lt "$KEEP_DAILY" ] && ! echo " $days " | grep -q " $day "; then
    days="$days $day"; nd=$((nd + 1)); echo "$f" >> "$keep"
  fi
  if [ "$nw" -lt "$KEEP_WEEKLY" ] && ! echo " $weeks " | grep -q " $week "; then
    weeks="$weeks $week"; nw=$((nw + 1)); echo "$f" >> "$keep"
  fi
done
for f in $(ls -1 "$DIR" 2>/dev/null | grep -E '^jotion-[0-9]{8}-[0-9]{6}-[a-z-]+\.tar$'); do
  if ! grep -qx "$f" "$keep"; then
    echo "Rotation: entferne $f"
    rm -f "$DIR/$f"
  fi
done
rm -f "$keep"
