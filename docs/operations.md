## H. Docker und Betrieb
- **Services** (`docker/compose.yml`): `caddy`, `web`, `api`, `collab`, `worker`, `postgres:16`, `redis:7`, optional `minio` (Profil `s3`), Init-Job `migrate` (läuft `prisma migrate deploy`, `depends_on: condition: service_completed_successfully` für api/worker/collab).
- **Volumes**: `pg_data`, `redis_data` (AOF an), `files_data`, `backups`, `caddy_data`.
- **Healthchecks**: Postgres `pg_isready`, Redis `redis-cli ping`, api `/health/ready` (DB + Redis), collab `/health`, worker Heartbeat in Redis + CLI-Check, web `/api/health`.
- **Restart**: `unless-stopped`. Ressourcenlimits dokumentiert.
- **Secrets**: `.env` aus `.env.example` generiert per `scripts/init.sh` (zufällige Werte für `JOTION_MASTER_KEY`, `AUTH_SECRET`, DB-Passwort); Unterstützung für Docker Secrets (`*_FILE`-Variablen). Images laufen als non-root, read-only Root-FS wo möglich.
- **Backup**: Worker-Job täglich: `pg_dump -Fc` + Tar des Datei-Volumes, Rotation (7 täglich, 4 wöchentlich), optional verschlüsselt; `scripts/restore.sh` mit Versionsprüfung. Wichtig: Master Key separat sichern (Hinweis in Doku und Admin-UI).
- **Migrationen**: nur vorwärts, expand/contract-Muster bei Breaking Changes; Datenmigrationen als idempotente Skripte mit Verifikation; vor jedem Update automatisches Backup (`migrate`-Job prüft und erstellt Pre-Update-Dump).
- **Updates**: semver-getaggte Images (GHCR), `docker compose pull && docker compose up -d`; Changelog mit Upgrade-Hinweisen.
- **Keine externen Pflichtdienste**: keine Telemetrie, Fonts lokal gebündelt, kein CDN.

---

