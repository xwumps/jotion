## H. Docker und Betrieb
- **Services** (`compose.yml`): `caddy`, `web`, `api` (inkl. Collab-WebSocket), `worker`, `postgres:16`, `redis:7`, optional `minio` (Profil `s3`), Init-Job `migrate` (läuft `prisma migrate deploy`, `depends_on: condition: service_completed_successfully` für api/worker).
- **Volumes**: `pg_data`, `redis_data` (AOF an), `files_data`, `backups`, `caddy_data`.
- **Healthchecks**: Postgres `pg_isready`, Redis `redis-cli ping`, api `/health/ready` (DB + Redis), worker Heartbeat in Redis + CLI-Check, web `/healthz`, Caddy über `/healthz`.
- **Restart**: `unless-stopped`, `init: true` für saubere Signalweitergabe.
- **Images**: ein Dockerfile (`docker/Dockerfile`) mit Targets `web`, `api`, `worker` auf Basis `node:22-alpine` (enthält libssl3 für Prisma, keine Paketinstallation nötig). Prisma-Engines für x86_64 und ARM64 (Raspberry Pi, NAS) sind enthalten.
- **Secrets**: `.env` aus `.env.example` generiert per `scripts/init.sh` (zufällige Werte für `JOTION_MASTER_KEY`, `AUTH_SECRET`, DB-Passwort); Unterstützung für Docker Secrets (`*_FILE`-Variablen). Images laufen als non-root, read-only Root-FS wo möglich.
- **Backup**: Worker-Job täglich: `pg_dump -Fc` + Tar des Datei-Volumes, Rotation (7 täglich, 4 wöchentlich), optional verschlüsselt; `scripts/restore.sh` mit Versionsprüfung. Wichtig: Master Key separat sichern (Hinweis in Doku und Admin-UI).
- **Migrationen**: nur vorwärts, expand/contract-Muster bei Breaking Changes; Datenmigrationen als idempotente Skripte mit Verifikation; vor jedem Update automatisches Backup (`migrate`-Job prüft und erstellt Pre-Update-Dump).
- **Updates**: semver-getaggte Images (GHCR), `docker compose pull && docker compose up -d`; Changelog mit Upgrade-Hinweisen.
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
