# Updates

Jotion aktualisiert sich nie von selbst. Ein Update kann Änderungen an der Datenbank enthalten, deshalb startet es immer ein Admin, wenn er Zeit hat nachzusehen.

## Erfahren, dass es ein Update gibt

- Der Admin-Bereich (Einstellungen → Server) zeigt "Jotion x.y.z ist verfügbar" mit Link zu den Änderungen. Dafür fragt der Server höchstens einmal am Tag die öffentliche Release-Liste auf GitHub ab, und nur, wenn ein Admin den Bereich öffnet. Abschalten mit `JOTION_UPDATE_CHECK=false`.
- Auf GitHub: [Releases](https://github.com/xwumps/jotion/releases) (oben rechts "Watch" → "Custom" → "Releases" für E-Mails).
- Was sich geändert hat und ob etwas zu beachten ist, steht im [CHANGELOG](https://github.com/xwumps/jotion/blob/main/CHANGELOG.md) unter "Update-Hinweise".

## Update einspielen

Im Projektordner:

```bash
bash scripts/update.sh
```

Das Skript

1. legt eine Sicherung an (Anlass `pre-update`),
2. holt den neuen Stand:
   - **installiert per `install.sh`**: lädt die Betriebsdateien des neuesten Releases (Compose-Datei, Skripte), trägt `JOTION_VERSION` ein und lädt die Images. Die `.env` bleibt unverändert.
   - **Git-Kopie mit fertigen Images** (`JOTION_IMAGE_PREFIX` gesetzt): wechselt auf den Tag des Releases, trägt `JOTION_VERSION` ein und lädt die Images,
   - **eigener Build**: `git pull` und Images neu bauen,
3. startet alle Dienste. Der Dienst `migrate` passt die Datenbank vorher an.

Eine bestimmte Version statt der neuesten: `bash scripts/update.sh 1.2.0`.

Ist Jotion schon aktuell, meldet das Skript das und ändert nichts.

## Zurück auf die alte Version

Migrationen laufen nur vorwärts. Zurück geht es deshalb über die Sicherung vor dem Update:

1. Alte Version starten: `bash scripts/update.sh <alte Version>` (mit fertigen Images) bzw. `git checkout <alter Stand>` und `docker compose up -d --build` (eigener Build).
2. Sicherung vor dem Update einspielen: `bash scripts/restore.sh --list` zeigt sie (Name endet auf `-pre-update.tar`), dann `bash scripts/restore.sh <Name>`.

Änderungen seit dem Update gehen dabei verloren.

## Von eigenem Build auf fertige Images wechseln

In der `.env` `JOTION_IMAGE_PREFIX=ghcr.io/xwumps/jotion` setzen und `bash scripts/update.sh` ausführen. Daten bleiben erhalten.

## Für Maintainer: Release erstellen

1. Änderungen in `CHANGELOG.md` unter `## [Unveröffentlicht]` sammeln.
2. `bash scripts/release.sh 1.2.0` setzt die Versionen, macht aus "Unveröffentlicht" den Abschnitt `[1.2.0]` und legt Commit und Tag an. Commit per Pull Request nach `main` bringen.
3. Tag veröffentlichen: `git push origin v1.2.0`, oder auf GitHub unter Releases → "Draft a new release" den Tag `v1.2.0` auf `main` anlegen und veröffentlichen.
4. Der Workflow "Release" baut die Images für x86 und ARM (etwa 20 bis 40 Minuten), veröffentlicht sie unter `ghcr.io/xwumps/jotion/<dienst>`, füllt das Release mit dem Text aus dem CHANGELOG und hängt das Paket `jotion-<Version>.tar.gz` mit den Betriebsdateien an (für `install.sh` und `update.sh`).
5. Bricht ein Build ab, unter Actions → Release → "Run workflow" den Tag (zum Beispiel `v1.2.0`) eintragen: Das Release wird mit dem aktuellen Workflow neu gebaut, der Code bleibt der des Tags.
