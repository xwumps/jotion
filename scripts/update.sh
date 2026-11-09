#!/usr/bin/env bash
# Aktualisiert Jotion: Sicherung vor dem Update, neuen Stand holen, Images bauen, starten.
# Migrationen laufen beim Start im migrate-Job (nur vorwärts).
set -euo pipefail
cd "$(dirname "$0")/.."
DC=(docker compose)
[[ -n "${JOTION_COMPOSE_PROJECT:-}" ]] && DC+=(-p "$JOTION_COMPOSE_PROJECT")

if "${DC[@]}" ps --status running --services 2>/dev/null | grep -qx backup; then
  echo "Sicherung vor dem Update …"
  "${DC[@]}" exec -T backup /scripts/backup.sh pre-update
else
  echo "Backup-Dienst läuft nicht: keine Sicherung vor dem Update (Abbruch mit Strg+C)." >&2
  sleep 5
fi
if [[ -d .git && "${JOTION_UPDATE_PULL:-true}" == "true" ]]; then
  echo "Neuen Stand holen …"
  git pull --ff-only
fi
echo "Images bauen und starten …"
"${DC[@]}" up -d --build --wait
"${DC[@]}" ps
echo "Update abgeschlossen. Bei Problemen: scripts/restore.sh latest (Sicherung vor dem Update)."
