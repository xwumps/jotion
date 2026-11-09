#!/usr/bin/env bash
# Stellt eine Sicherung wieder her. Aufruf: scripts/restore.sh <archiv|latest> [--force]
# Archive liegen im Volume "backups" (Liste: scripts/restore.sh --list) oder als Datei auf dem Host.
set -euo pipefail
cd "$(dirname "$0")/.."
DC=(docker compose)
[[ -n "${JOTION_COMPOSE_PROJECT:-}" ]] && DC+=(-p "$JOTION_COMPOSE_PROJECT")

if [[ "${1:-}" == "--list" || -z "${1:-}" ]]; then
  "${DC[@]}" run --rm --no-deps --entrypoint sh backup -c 'ls -1t /backups | grep -E "^jotion-.*\.tar$" || true'
  [[ -z "${1:-}" ]] && echo "Aufruf: scripts/restore.sh <archiv|latest> [--force]"
  exit 0
fi

ARCHIVE="$1"
# Datei vom Host: in das Volume kopieren
if [[ -f "$ARCHIVE" ]]; then
  NAME="$(basename "$ARCHIVE")"
  "${DC[@]}" run --rm --no-deps -T --entrypoint sh backup -c "cat > /backups/$NAME" < "$ARCHIVE"
  ARCHIVE="$NAME"
fi

echo "Jotion wird für die Wiederherstellung angehalten …"
"${DC[@]}" stop web api worker caddy
"${DC[@]}" run --rm --no-deps --entrypoint /scripts/restore.sh backup "$ARCHIVE" ${2:+"$2"}
echo "Jotion wird gestartet …"
"${DC[@]}" up -d --wait
echo "Fertig."
