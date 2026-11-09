#!/usr/bin/env bash
# Aktualisiert Jotion: Sicherung vor dem Update, neuen Stand holen, starten.
# Migrationen laufen beim Start im migrate-Job (nur vorwärts).
#
# Zwei Arten (Phase 12.2):
#  - Fertige Images (JOTION_IMAGE_PREFIX in .env gesetzt, z. B. ghcr.io/xwumps/jotion):
#    scripts/update.sh [version]  holt das neueste Release (oder die angegebene Version),
#    bringt Compose-Datei und Skripte auf dessen Stand (Git-Tag oder, bei Installation per
#    install.sh, das Paket des Releases), trägt JOTION_VERSION in .env ein, lädt die Images.
#  - Aus dem Quellcode (Standard): git pull, Images selbst bauen.
set -euo pipefail
cd "$(dirname "$0")/.."
DC=(docker compose)
[[ -n "${JOTION_COMPOSE_PROJECT:-}" ]] && DC+=(-p "$JOTION_COMPOSE_PROJECT")

env_value() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -1; }
PREFIX="$(env_value JOTION_IMAGE_PREFIX)"
REPO="${JOTION_REPO:-xwumps/jotion}"

# Betriebsdateien einer Version laden (wie scripts/install.sh): Paket am Release
fetch_release() {
  local v="$1" dest="$2"
  local base="${JOTION_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download}"
  if ! curl -fsSL "$base/v$v/jotion-$v.tar.gz" -o "$dest/.paket.tar.gz"; then
    echo "Version $v hat kein Installationspaket (jotion-$v.tar.gz, vorhanden ab 1.0.1)." >&2
    return 1
  fi
  tar -xzf "$dest/.paket.tar.gz" -C "$dest" && rm -f "$dest/.paket.tar.gz"
}
CURRENT="$(env_value JOTION_VERSION)"
TARGET=""

if [[ -n "$PREFIX" ]]; then
  if [[ -n "${1:-}" ]]; then
    TARGET="${1#v}"
  else
    echo "Neueste Version suchen …"
    if [[ -d .git ]]; then
      TARGET="$(git ls-remote --tags --refs origin 'v*' | sed 's#.*refs/tags/v##' |
        grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)"
    else
      TARGET="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
        sed -n 's/.*"tag_name": *"v\{0,1\}\([0-9][^"]*\)".*/\1/p' | head -1 || true)"
    fi
  fi
  [[ -n "$TARGET" ]] || { echo "Kein Release gefunden." >&2; exit 1; }
  if [[ "$TARGET" == "$CURRENT" ]]; then
    echo "Jotion ist aktuell (Version $CURRENT)."
    exit 0
  fi
  echo "Update von ${CURRENT:-?} auf $TARGET"
fi

if "${DC[@]}" ps --status running --services 2>/dev/null | grep -qx backup; then
  echo "Sicherung vor dem Update …"
  "${DC[@]}" exec -T backup /scripts/backup.sh pre-update
else
  echo "Backup-Dienst läuft nicht: keine Sicherung vor dem Update (Abbruch mit Strg+C)." >&2
  sleep 5
fi

if [[ -n "$PREFIX" ]]; then
  # Compose-Datei und Skripte passend zur Version
  if [[ -d .git ]]; then
    git fetch --quiet --tags origin
    git checkout --quiet "v$TARGET"
  else
    # Installation per install.sh: Dateien der neuen Version holen und einzeln ersetzen.
    # mv statt Überschreiben, damit dieses laufende Skript unverändert weiterläuft.
    NEW="$(mktemp -d)"
    fetch_release "$TARGET" "$NEW"
    (cd "$NEW" && find . -type f) | while read -r f; do
      mkdir -p "$(dirname "$f")"
      mv -f "$NEW/$f" "$f"
    done
    rm -rf "$NEW"
    chmod +x scripts/*.sh
  fi
  if grep -q '^JOTION_VERSION=' .env; then
    sed -i.bak "s/^JOTION_VERSION=.*/JOTION_VERSION=$TARGET/" .env && rm -f .env.bak
  else
    printf '\nJOTION_VERSION=%s\n' "$TARGET" >> .env
  fi
  echo "Images laden …"
  "${DC[@]}" pull --quiet api worker web backup
  "${DC[@]}" up -d --no-build --wait
else
  if [[ -d .git && "${JOTION_UPDATE_PULL:-true}" == "true" ]]; then
    echo "Neuen Stand holen …"
    git pull --ff-only
  fi
  echo "Images bauen und starten …"
  "${DC[@]}" up -d --build --wait
fi
"${DC[@]}" ps
echo "Update abgeschlossen. Bei Problemen: scripts/restore.sh latest (Sicherung vor dem Update)."
