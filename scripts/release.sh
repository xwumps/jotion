#!/usr/bin/env bash
# Bereitet ein Release vor (für Maintainer): Versionen setzen, CHANGELOG-Abschnitt
# "Unveröffentlicht" in die neue Version umbenennen, Commit und Tag anlegen.
# Aufruf: scripts/release.sh 1.2.0   danach: git push origin main v1.2.0
# Der Tag startet .github/workflows/release.yml (Images und GitHub-Release).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:?Version angeben, z. B. 1.2.0}"
VERSION="${VERSION#v}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Version im Format 1.2.3 angeben" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Arbeitsverzeichnis ist nicht sauber" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null && { echo "Tag v$VERSION gibt es schon" >&2; exit 1; }
grep -q '^## \[Unveröffentlicht\]' CHANGELOG.md || { echo "CHANGELOG.md braucht einen Abschnitt [Unveröffentlicht]" >&2; exit 1; }

for f in package.json apps/api/package.json apps/web/package.json apps/worker/package.json; do
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('$f', 'utf8'));
    p.version = '$VERSION';
    fs.writeFileSync('$f', JSON.stringify(p, null, 2) + '\n');
  "
done
TODAY="$(date +%Y-%m-%d)"
sed -i.bak "s/^## \[Unveröffentlicht\]/## [Unveröffentlicht]\n\n## [$VERSION] - $TODAY/" CHANGELOG.md && rm -f CHANGELOG.md.bak

git add package.json apps/*/package.json CHANGELOG.md
git commit -q -m "Release $VERSION"
git tag -a "v$VERSION" -m "Jotion $VERSION"
echo "Release $VERSION vorbereitet. Veröffentlichen mit: git push origin HEAD v$VERSION"
