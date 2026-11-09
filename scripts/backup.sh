#!/usr/bin/env bash
# Sicherung sofort erstellen. Aufruf: scripts/backup.sh [manual|pre-update]
set -euo pipefail
cd "$(dirname "$0")/.."
DC=(docker compose)
[[ -n "${JOTION_COMPOSE_PROJECT:-}" ]] && DC+=(-p "$JOTION_COMPOSE_PROJECT")
"${DC[@]}" exec -T backup /scripts/backup.sh "${1:-manual}"
