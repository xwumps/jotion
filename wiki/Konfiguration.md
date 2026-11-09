# Konfiguration

Alle Einstellungen stehen in der Datei `.env` im Projektordner. `scripts/init.sh` legt sie aus [`.env.example`](https://github.com/xwumps/jotion/blob/main/.env.example) an und füllt Passwörter und Schlüssel mit Zufallswerten. Nach einer Änderung übernimmt `docker compose up -d` die neuen Werte (betroffene Dienste starten neu).

## Adresse und Netzwerk

| Variable                | Standard                | Bedeutung                                                                                                                                                     |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOTION_PUBLIC_URL`     | `http://localhost:8080` | Adresse, unter der Jotion im Browser erreichbar ist, ohne `/` am Ende. Muss stimmen: Anmeldung, Einladungslinks, Echtzeit-Bearbeitung und OAuth hängen daran. |
| `JOTION_HTTP_PORT`      | `8080`                  | Port auf dem Host für HTTP                                                                                                                                    |
| `JOTION_HTTPS_PORT`     | `8443`                  | Port auf dem Host für HTTPS (nur mit eigener Domain)                                                                                                          |
| `JOTION_SITE_ADDRESS`   | `:80`                   | `:80` für LAN/VPN, eine Domain für automatisches HTTPS (siehe [Installation](Installation#eigene-domain-mit-https))                                           |
| `JOTION_DEFAULT_LOCALE` | `de`                    | Sprache für neue Konten: `de` oder `en`                                                                                                                       |
| `JOTION_TIMEZONE`       | `Europe/Berlin`         | Zeitzone für Formeln (`now()`, `today()`), Integrationen und die Uhrzeit der Sicherung                                                                        |
| `LOG_LEVEL`             | `info`                  | `debug`, `info`, `warn` oder `error`                                                                                                                          |

## Geheimnisse

| Variable                              | Bedeutung                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `JOTION_MASTER_KEY`                   | Verschlüsselt Zugangsdaten der Integrationen und die Sicherungen. **Getrennt sicher aufbewahren.** |
| `JOTION_MASTER_KEY_PREVIOUS`          | Frühere Master Keys (kommagetrennt) nach einem Schlüsselwechsel, siehe unten                       |
| `AUTH_SECRET`                         | Pflichtwert, den `scripts/init.sh` setzt; derzeit für künftige Signaturen reserviert               |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | Passwörter der internen Dienste                                                                    |

`DATABASE_URL`, `REDIS_URL` und `API_INTERNAL_URL` werden nur für die lokale Entwicklung gebraucht. Im Docker-Betrieb setzt `compose.yml` sie selbst.

### Master Key wechseln

1. Neuen Schlüssel erzeugen: `openssl rand -base64 32`.
2. In der `.env` den alten Wert nach `JOTION_MASTER_KEY_PREVIOUS` verschieben, den neuen als `JOTION_MASTER_KEY` eintragen.
3. `docker compose up -d`.

Zugangsdaten der Integrationen werden beim nächsten Zugriff mit dem neuen Schlüssel verschlüsselt. Ältere Sicherungen lassen sich mit dem alten Schlüssel aus `JOTION_MASTER_KEY_PREVIOUS` weiter einspielen. Den alten Schlüssel daher erst entfernen, wenn keine Sicherung mit ihm mehr gebraucht wird.

## Dateien und Integrationen

| Variable                                                                                  | Standard       | Bedeutung                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `JOTION_MAX_UPLOAD_MB`                                                                    | `100`          | Höchstgröße für Datei-Uploads in MB (Bilder höchstens 10 MB)                                                                                                       |
| `JOTION_SSRF_ALLOWLIST`                                                                   | leer           | Hosts oder IP-Bereiche im eigenen Netz, die Jotion abrufen darf, zum Beispiel `nextcloud.lan,10.0.5.0/24`. Ohne Eintrag werden nur öffentliche Adressen abgerufen. |
| `JOTION_GOOGLE_CLIENT_ID`, `JOTION_GOOGLE_CLIENT_SECRET`                                  | leer           | OAuth-App für Google, siehe [Integrationen](Integrationen)                                                                                                         |
| `JOTION_MICROSOFT_CLIENT_ID`, `JOTION_MICROSOFT_CLIENT_SECRET`, `JOTION_MICROSOFT_TENANT` | leer, `common` | OAuth-App für Microsoft 365 und Outlook.com                                                                                                                        |
| `JOTION_DROPBOX_CLIENT_ID`, `JOTION_DROPBOX_CLIENT_SECRET`                                | leer           | OAuth-App für Dropbox                                                                                                                                              |

## Sicherungen

| Variable                        | Standard | Bedeutung                                       |
| ------------------------------- | -------- | ----------------------------------------------- |
| `JOTION_BACKUP_ENABLED`         | `true`   | Tägliche Sicherung an oder aus                  |
| `JOTION_BACKUP_TIME`            | `03:15`  | Uhrzeit (HH:MM, Zeitzone aus `JOTION_TIMEZONE`) |
| `JOTION_BACKUP_ENCRYPT`         | `true`   | Sicherungen mit dem Master Key verschlüsseln    |
| `JOTION_BACKUP_KEEP_DAILY`      | `7`      | Wie viele Tage je eine Sicherung behalten       |
| `JOTION_BACKUP_KEEP_WEEKLY`     | `4`      | Wie viele Wochen je eine Sicherung behalten     |
| `JOTION_BACKUP_KEEP_PRE_UPDATE` | `3`      | Sicherungen vor Updates                         |
| `JOTION_BACKUP_KEEP_MANUAL`     | `5`      | Von Hand angelegte Sicherungen                  |

Mehr unter [Sicherungen](Sicherungen).

## Updates und Betrieb

| Variable               | Standard                  | Bedeutung                                                                                                                                |
| ---------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `JOTION_IMAGE_PREFIX`  | leer                      | `ghcr.io/xwumps/jotion` für fertige Images, leer für eigenen Build                                                                       |
| `JOTION_VERSION`       | vom Update-Skript gesetzt | Version der Images                                                                                                                       |
| `JOTION_UPDATE_CHECK`  | `true`                    | Admin-Bereich zeigt neue Versionen an (höchstens eine Abfrage bei GitHub pro Tag, nur wenn ein Admin den Bereich öffnet). `false` = nie. |
| `JOTION_METRICS_TOKEN` | leer                      | Token für Prometheus-Metriken unter `/api/metrics`. Leer = Endpunkt aus.                                                                 |
| `JOTION_BUILD_CA`      | leer                      | Zusätzliche CA für den eigenen Build hinter einem TLS-Proxy                                                                              |
