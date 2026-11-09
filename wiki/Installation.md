# Installation

## Voraussetzungen

- Ein 64-Bit-System mit x86 (amd64) oder ARM (arm64): PC, Server, NAS, Mini-PC, Raspberry Pi 4 oder 5 (bzw. Pi 3 mit 64-Bit-System), Mac mit Apple-Chip über Docker Desktop.
- Docker mit Compose v2 (`docker compose version`).
- Richtwert 2 CPU-Kerne und 4 GB RAM. Im Betrieb mit einigen Nutzern braucht Jotion etwa 300 MB RAM.
- `curl` und `tar` (auf fast jedem Linux vorhanden). Git nur für die Installation aus dem Quellcode.

32-Bit-Systeme werden nicht unterstützt: Prisma, die Datenbank-Bibliothek von Jotion, liefert dafür keine Engine.

## 1. Installieren mit einem Befehl (empfohlen)

```bash
curl -fsSL https://raw.githubusercontent.com/xwumps/jotion/main/scripts/install.sh | bash
```

Das Skript

1. prüft Docker, Compose und die Architektur,
2. legt den Ordner `jotion/` im aktuellen Verzeichnis an,
3. lädt aus dem neuesten Release nur die Betriebsdateien: `compose.yml`, `docker/Caddyfile`, `.env.example`, die Skripte und das Changelog (kein Git, kein Quellcode),
4. erzeugt die `.env` mit zufälligen Passwörtern und Schlüsseln und trägt die fertigen Images ein,
5. lädt die Images und startet Jotion.

Optionen, vor `bash` als Umgebungsvariablen gesetzt:

| Variable                                     | Wirkung                                             |
| -------------------------------------------- | --------------------------------------------------- |
| `JOTION_DIR=/opt/jotion`                     | anderer Installationsordner                         |
| `JOTION_HTTP_PORT=8090`                      | anderer Port                                        |
| `JOTION_PUBLIC_URL=http://192.168.1.10:8080` | Adresse, unter der Jotion im Browser erreichbar ist |

Beispiel: `curl -fsSL …/install.sh | JOTION_DIR=/opt/jotion bash`. Eine bestimmte Version: `… | bash -s -- 1.2.0`.

Braucht Docker auf dem Rechner `sudo`, das Skript mit `sudo bash` statt `bash` starten.

> **Wichtig:** Den Wert von `JOTION_MASTER_KEY` aus `jotion/.env` zusätzlich an einem sicheren Ort aufbewahren (Passwortmanager, Ausdruck). Ohne ihn lassen sich Sicherungen nicht einspielen und gespeicherte Zugangsdaten von Integrationen nicht mehr lesen.

Weitere Einstellungen stehen unter [Konfiguration](Konfiguration). Für den Anfang reichen die Standardwerte. Pro Rechner ist eine Jotion-Installation vorgesehen (Docker-Projektname `jotion`).

## 2. Alternative: aus dem Quellcode

Für eigene Änderungen am Code oder wenn die GitHub Container Registry nicht erreichbar ist:

```bash
git clone https://github.com/xwumps/jotion.git && cd jotion
```

```bash
bash scripts/init.sh
```

```bash
docker compose up -d --build --wait
```

Docker baut die Images dabei selbst. Das dauert beim ersten Mal einige Minuten, auf einem Raspberry Pi deutlich länger. Mit einer Git-Kopie lassen sich auch fertige Images nutzen: in der `.env` `JOTION_IMAGE_PREFIX=ghcr.io/xwumps/jotion` setzen und `bash scripts/update.sh` ausführen.

## 3. Einrichten

Im Browser http://localhost:8080 (oder die Adresse des Servers) öffnen. Die erste Person legt Name, E-Mail, Passwort und den ersten Workspace an. Sie ist Owner des Workspace und Admin der Instanz. Weitere Personen kommen über Einladungslinks dazu (Einstellungen → Mitglieder).

## Dienste

| Dienst     | Aufgabe                                                      |
| ---------- | ------------------------------------------------------------ |
| `caddy`    | Reverse Proxy, optional automatisches HTTPS                  |
| `web`      | Oberfläche (Next.js)                                         |
| `api`      | REST-API und Echtzeit-Bearbeitung                            |
| `worker`   | Hintergrundjobs (Synchronisation, Berechnungen, Wartung)     |
| `migrate`  | Einmaliger Job: Datenbank-Migrationen vor jedem Start        |
| `postgres` | Datenbank                                                    |
| `redis`    | Job-Queue und Cache                                          |
| `backup`   | Tägliche, verschlüsselte Sicherung von Datenbank und Dateien |

Daten liegen in Docker-Volumes: `pg_data` (Datenbank), `files_data` (hochgeladene Dateien), `backups` (Sicherungen), `redis_data`, `caddy_data` (Zertifikate).

## Zugriff im LAN oder per VPN

Standardmäßig lauscht Jotion auf Port 8080 ohne TLS. Andere Geräte im Netz erreichen es unter `http://<IP-des-Servers>:8080`. Dann in der `.env` `JOTION_PUBLIC_URL` auf genau diese Adresse setzen und neu starten (`docker compose up -d`), sonst werden Einladungslinks und Anmeldungen mit falscher Adresse erzeugt.

## Eigene Domain mit HTTPS

Voraussetzung: Die Domain zeigt auf den Server, Ports 80 und 443 sind von außen erreichbar. In der `.env`:

```
JOTION_SITE_ADDRESS=jotion.example.org
JOTION_PUBLIC_URL=https://jotion.example.org
JOTION_HTTP_PORT=80
JOTION_HTTPS_PORT=443
```

Dann `docker compose up -d`. Caddy holt und erneuert das Zertifikat automatisch.

Läuft Jotion hinter einem eigenen Reverse Proxy, bleibt `JOTION_SITE_ADDRESS=:80`. Der eigene Proxy leitet auf `JOTION_HTTP_PORT` weiter und sollte die Sicherheits-Header aus [`docker/Caddyfile`](https://github.com/xwumps/jotion/blob/main/docker/Caddyfile) übernehmen (Content-Security-Policy und andere).

## Build hinter einem TLS-abfangenden Proxy

Nur für den eigenen Build (2b) in Netzen, die TLS aufbrechen (Firma, Schule): Die CA des Proxys als PEM-Datei ins Projekt legen, zum Beispiel `docker/data/extra-ca.pem` (von Git ausgeschlossen), und in der `.env` eintragen:

```
JOTION_BUILD_CA=./docker/data/extra-ca.pem
```

Die Datei wird nur während des Builds genutzt und landet nicht in den Images.

## Deinstallieren

```bash
docker compose down
```

stoppt alles und behält die Daten. `docker compose down -v` löscht zusätzlich alle Volumes, also **alle Daten und Sicherungen**.
