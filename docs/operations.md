## H. Docker und Betrieb
- **Services** (`compose.yml`): `caddy`, `web`, `api` (inkl. Collab-WebSocket), `worker`, `postgres:16`, `redis:7`, optional `minio` (Profil `s3`), Init-Job `migrate` (läuft `prisma migrate deploy`, `depends_on: condition: service_completed_successfully` für api/worker).
- **Volumes**: `pg_data`, `redis_data` (AOF an), `files_data`, `backups`, `caddy_data`.
- **Healthchecks**: Postgres `pg_isready`, Redis `redis-cli ping`, api `/health/ready` (DB + Redis), worker Heartbeat in Redis + CLI-Check, web `/healthz`, Caddy über `/healthz`.
- **Restart**: `unless-stopped`, `init: true` für saubere Signalweitergabe.
- **Images**: ein Dockerfile (`docker/Dockerfile`) mit Targets `web`, `api`, `worker` auf Basis `node:22-alpine` (enthält libssl3 für Prisma, keine Paketinstallation nötig). Prisma-Engines für x86_64 und ARM64 (Raspberry Pi, NAS) sind enthalten.
- **Secrets**: `.env` aus `.env.example` generiert per `scripts/init.sh` (zufällige Werte für `JOTION_MASTER_KEY`, `AUTH_SECRET`, DB-Passwort); Unterstützung für Docker Secrets (`*_FILE`-Variablen). Images laufen als non-root, read-only Root-FS wo möglich.
- **Backup** (Phase 12, ADR 119 bis 121): Dienst `backup` erstellt täglich um `JOTION_BACKUP_TIME` ein Archiv im Volume `backups` (`pg_dump -Fc`, Datei-Volume, Manifest mit Schema-Version und Master-Key-Fingerabdruck, Prüfsummen). Rotation: 7 täglich, 4 wöchentlich, 3 vor Updates, 5 manuell. Von Hand: `scripts/backup.sh`, aus der Oberfläche: Einstellungen → Server → "Jetzt sichern". Wiederherstellen: `scripts/restore.sh --list`, `scripts/restore.sh latest` oder `scripts/restore.sh <Datei>` (auch eine Datei vom Host). Wichtig: Master Key separat sichern, ohne ihn sind gespeicherte Zugangsdaten der Integrationen nach dem Wiederherstellen nicht lesbar.
- **Migrationen**: nur vorwärts, expand/contract-Muster bei Breaking Changes; Datenmigrationen als idempotente Skripte mit Verifikation; vor jedem Update eine Sicherung (`scripts/update.sh`).
- **Updates** (Phase 12, ADR 122): `scripts/update.sh` sichert, holt den neuen Stand (`git pull --ff-only`), baut die Images und startet; der `migrate`-Job spielt neue Migrationen ein. Bei Problemen: alten Stand auschecken und `scripts/restore.sh latest` (Sicherung vor dem Update). Semver-getaggte Images in einer Registry folgen mit den ersten Releases.
- **Admin-Bereich** (Phase 12, ADR 124): Einstellungen → Server (nur Instanz-Admins): Zustand von Datenbank, Redis und Hintergrund-Dienst, Zählwerte, Speicherbedarf, Sicherungen mit "Jetzt sichern", Konten (Admin-Recht, Sperren). Der erste eingerichtete Nutzer ist Admin.
- **Metriken** (Phase 12, ADR 127): `JOTION_METRICS_TOKEN` setzen, dann `GET /api/metrics` mit `Authorization: Bearer <Token>` (Prometheus-Textformat). Ohne Token antwortet der Endpunkt mit 404.
- **Sicherheits-Header** (Phase 12, ADR 129): Caddy setzt eine Content-Security-Policy und weitere Header (`docker/Caddyfile`). Wer Jotion hinter einem eigenen Proxy betreibt, sollte diese Header übernehmen.
- **REST-API** (Phase 12, ADR 123): Tokens unter Einstellungen → Konto → API-Tokens, Beschreibung in [docs/api.md](api.md).
- **Master Key wechseln** (Phase 8): neuen Schlüssel als `JOTION_MASTER_KEY` setzen, den alten in `JOTION_MASTER_KEY_PREVIOUS` (kommagetrennt, mehrere möglich). Gespeicherte Zugangsdaten der Integrationen werden beim nächsten Zugriff mit dem neuen Schlüssel verschlüsselt; der alte kann entfernt werden, wenn alle Verbindungen einmal synchronisiert haben.
- **Integrationen im LAN** (Phase 8): CalDAV-Server oder iCal-Feeds mit privater Adresse (z. B. Nextcloud im Heimnetz) müssen in `JOTION_SSRF_ALLOWLIST` stehen, sonst lehnt der Server den Abruf ab.
- **OAuth-Apps für Google, Microsoft und Dropbox** (Phase 11): Da Jotion selbst gehostet wird, registriert der Admin je Anbieter eine eigene App und trägt Client-ID und Secret in `.env` ein. Rückleitungs-URL ist immer `<JOTION_PUBLIC_URL>/api/integrations/oauth/callback` (exakt so beim Anbieter eintragen). Ohne Client-ID ist der Anbieter in der Oberfläche ausgegraut.
  - **Google** (Google Cloud Console → APIs und Dienste): Google Calendar API, Gmail API und Google Drive API aktivieren; OAuth-Zustimmungsbildschirm mit den Bereichen `calendar.readonly`, `gmail.readonly`, `drive.metadata.readonly`; Anmeldedaten "OAuth-Client-ID" vom Typ Webanwendung → `JOTION_GOOGLE_CLIENT_ID`, `JOTION_GOOGLE_CLIENT_SECRET`. Solange die App im Testmodus ist, nur eingetragene Testnutzer; Gmail gilt bei Google als eingeschränkter Bereich (für den privaten Gebrauch im Testmodus ausreichend).
  - **Microsoft** (Entra ID → App-Registrierungen): Plattform "Web" mit der Rückleitungs-URL, delegierte Berechtigungen `Calendars.Read`, `Mail.Read`, `Files.Read`, `offline_access`, `User.Read`; Geheimer Clientschlüssel → `JOTION_MICROSOFT_CLIENT_ID`, `JOTION_MICROSOFT_CLIENT_SECRET`. `JOTION_MICROSOFT_TENANT`: `common` (private und Organisationskonten), `consumers`, `organizations` oder eine Mandanten-ID.
  - **Dropbox** (App Console): Zugriff "Full Dropbox" oder "App folder", Berechtigungen `account_info.read` und `files.metadata.read`, Redirect-URI eintragen → `JOTION_DROPBOX_CLIENT_ID` (Secret optional, PKCE wird immer verwendet).
  - Tokens liegen verschlüsselt mit `JOTION_MASTER_KEY` in der Datenbank; abgelaufene Zugriffs-Tokens erneuert der Sync automatisch. Widerruft jemand die Freigabe beim Anbieter, geht die Verbindung in den Fehlerstatus und lässt sich über "Neu anmelden" wiederherstellen.
- **Telegram-Bot** (Phase 11): Bot bei @BotFather anlegen, Token in der Oberfläche eintragen und erlaubte Absender angeben. Der Abruf läuft per Long Polling (`getUpdates`), Jotion braucht dafür keine öffentliche Adresse. Ist für den Bot ein Webhook gesetzt, meldet die Verbindung einen Fehler (`deleteWebhook` aufrufen).
- **Apple iCloud und Nextcloud** (Phase 11): iCloud braucht ein app-spezifisches Passwort (appleid.apple.com), Nextcloud ein App-Passwort (Einstellungen → Sicherheit). Eine Nextcloud im Heimnetz muss in `JOTION_SSRF_ALLOWLIST` stehen.
- **Keine externen Pflichtdienste**: keine Telemetrie, Fonts lokal gebündelt, kein CDN.

---

- **Zielumgebung privat**: läuft auf einem Rechner mit 2 CPU-Kernen und 4 GB RAM (Richtwert). Zugriff im LAN oder per VPN; Caddy wahlweise mit interner CA oder Auto-HTTPS für eigene Domain.
- **Backups extern ablegen**: z. B. auf NAS oder USB-Platte (Volume `backups` per Bind-Mount), Restore regelmäßig testen.

## Gemessener Speicherbedarf

**Phase 2** (nach komplettem E2E-Lauf mit Editor, zwei Nutzern und offenen Dokumenten): caddy 24 MB, web 79 MB, api 67 MB, worker 30 MB, postgres 60 MB, redis 5 MB, **gesamt ca. 265 MB**.

**Phase 1** (nach komplettem E2E-Lauf, zwei Nutzer): caddy 21 MB, web 80 MB, api 64 MB, worker 28 MB, postgres 55 MB, redis 5 MB, **gesamt ca. 255 MB**.

### Stand Phase 0

**RAM im Leerlauf** (`docker stats`, alle Dienste gesund, keine Nutzer):

| Dienst | RAM |
|---|---|
| caddy | ca. 50 MB |
| web | ca. 46 MB |
| api | ca. 39 MB |
| worker | ca. 27 MB |
| postgres | ca. 27 MB |
| redis | ca. 5 MB |
| **Gesamt** | **ca. 195 MB** |

Mit Editor, Datenbanken und Nutzern steigt der Bedarf. Die Werte werden nach jeder Phase neu gemessen.

**Image-Größen** (unkomprimiert): api ca. 600 MB, worker ca. 580 MB, web ca. 430 MB. Verkleinerung ist für Phase 12 vorgesehen.

## Build hinter einem TLS-Proxy
Fängt ein Proxy (Firma, Schule) TLS-Verbindungen ab, schlägt `pnpm install` im Docker-Build mit einem Zertifikatsfehler fehl. Dann die CA des Proxys als PEM-Datei ins Projekt legen, z. B. `docker/data/extra-ca.pem` (von git ausgeschlossen), und in `.env` eintragen:

```
JOTION_BUILD_CA=./docker/data/extra-ca.pem
```

Die Datei wird nur während des Builds als Secret genutzt und landet nicht im Image. Ohne Angabe nutzt der Build die leere Platzhalterdatei `docker/no-extra-ca.pem`, es ist also nichts zu tun.

## Eigene Domain mit HTTPS
In `.env` `JOTION_SITE_ADDRESS=jotion.example.org`, `JOTION_PUBLIC_URL=https://jotion.example.org` sowie `JOTION_HTTP_PORT=80` und `JOTION_HTTPS_PORT=443` setzen. Caddy holt das Zertifikat automatisch. Für LAN oder VPN bleibt `JOTION_SITE_ADDRESS=:80`.
