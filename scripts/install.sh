#!/usr/bin/env bash
# Jotion installieren, ohne Git und ohne Quellcode:
#
#   curl -fsSL https://raw.githubusercontent.com/xwumps/jotion/main/scripts/install.sh | bash
#
# Legt den Ordner ./jotion an (anderer Ort: JOTION_DIR=/pfad), lädt die Betriebsdateien des
# neuesten Releases (compose.yml, Caddyfile, Skripte), erzeugt die .env, lädt die fertigen
# Images und startet Jotion. Eine bestimmte Version: ... | bash -s -- 1.2.0
# Optional vorab setzen: JOTION_PUBLIC_URL (Adresse im Browser), JOTION_HTTP_PORT,
# JOTION_IMAGE_PREFIX und JOTION_DOWNLOAD_BASE (eigener Spiegel für Images und Pakete).
set -euo pipefail

REPO="${JOTION_REPO:-xwumps/jotion}"
DIR="${JOTION_DIR:-$PWD/jotion}"
VERSION="${1:-}"
VERSION="${VERSION#v}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { echo "FEHLER: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 wird benötigt"; }

need curl
need tar
need docker
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 wird benötigt (docker compose)"
docker info >/dev/null 2>&1 || fail "Docker läuft nicht oder dieser Benutzer darf Docker nicht nutzen (ggf. mit sudo starten)"
case "$(uname -m)" in
  x86_64 | amd64 | aarch64 | arm64) ;;
  *) fail "Nicht unterstützte Architektur $(uname -m): Jotion braucht ein 64-Bit-System (x86 oder ARM)" ;;
esac

# Betriebsdateien einer Version laden: Paket jotion-<Version>.tar.gz am Release
fetch_release() {
  local v="$1" dest="$2"
  local base="${JOTION_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download}"
  if ! curl -fsSL "$base/v$v/jotion-$v.tar.gz" -o "$dest/.paket.tar.gz"; then
    echo "Version $v hat kein Installationspaket (jotion-$v.tar.gz, vorhanden ab 1.0.1)." >&2
    return 1
  fi
  tar -xzf "$dest/.paket.tar.gz" -C "$dest" && rm -f "$dest/.paket.tar.gz"
}

if [[ -z "$VERSION" ]]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
    sed -n 's/.*"tag_name": *"v\{0,1\}\([0-9][^"]*\)".*/\1/p' | head -1)"
  [[ -n "$VERSION" ]] || fail "Neueste Version nicht gefunden (Netzwerk?)"
fi

if [[ -f "$DIR/.env" ]]; then
  fail "In $DIR ist Jotion schon installiert. Aktualisieren mit: cd $DIR && bash scripts/update.sh"
fi
say "Jotion $VERSION wird in $DIR installiert …"
mkdir -p "$DIR"
fetch_release "$VERSION" "$DIR"
cd "$DIR"
chmod +x scripts/*.sh

bash scripts/init.sh >/dev/null
set_env() {
  if grep -q "^$1=" .env; then
    sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}
set_env JOTION_IMAGE_PREFIX "${JOTION_IMAGE_PREFIX:-ghcr.io/$REPO}"
set_env JOTION_VERSION "$VERSION"
[[ -n "${JOTION_HTTP_PORT:-}" ]] && set_env JOTION_HTTP_PORT "$JOTION_HTTP_PORT"
if [[ -n "${JOTION_PUBLIC_URL:-}" ]]; then
  set_env JOTION_PUBLIC_URL "${JOTION_PUBLIC_URL%/}"
elif [[ -n "${JOTION_HTTP_PORT:-}" ]]; then
  set_env JOTION_PUBLIC_URL "http://localhost:$JOTION_HTTP_PORT"
fi

say "Images laden …"
docker compose pull --quiet
say "Jotion starten …"
docker compose up -d --no-build --wait

URL="$(sed -n 's/^JOTION_PUBLIC_URL=//p' .env | tail -1)"
echo
say "Fertig. Jotion läuft unter ${URL:-http://localhost:8080}"
echo "Die erste Person, die sich dort einrichtet, wird Owner und Admin."
echo
echo "WICHTIG: Den JOTION_MASTER_KEY aus $DIR/.env zusätzlich sicher aufbewahren."
echo "Ohne ihn lassen sich Sicherungen nicht einspielen."
echo
echo "Von anderen Geräten aus: JOTION_PUBLIC_URL in .env auf die Adresse des Servers setzen"
echo "(z. B. http://192.168.1.10:8080) und 'docker compose up -d' ausführen."
echo "Aktualisieren: cd $DIR && bash scripts/update.sh"
