# Installation

## Voraussetzungen

- Ein 64-Bit-System mit x86 (amd64) oder ARM (arm64): PC, Server, NAS, Mini-PC, Raspberry Pi 4 oder 5 (bzw. Pi 3 mit 64-Bit-System), Mac mit Apple-Chip über Docker Desktop.
- Docker mit Compose v2 (`docker compose version`).
- Richtwert 2 CPU-Kerne und 4 GB RAM. Im Betrieb mit einigen Nutzern braucht Jotion etwa 300 MB RAM.
- Git (zum Holen des Repositorys und für Updates).

32-Bit-Systeme werden nicht unterstützt: Prisma, die Datenbank-Bibliothek von Jotion, liefert dafür keine Engine.

## 1. Repository holen und konfigurieren

```bash
git clone https://github.com/xwumps/jotion.git && cd jotion
```

```bash
bash scripts/init.sh
```

`scripts/init.sh` legt eine `.env` mit zufälligen Passwörtern und Schlüsseln an. Eine bestehende `.env` wird nie überschrieben.

> **Wichtig:** Den Wert von `JOTION_MASTER_KEY` aus der `.env` zusätzlich an einem sicheren Ort aufbewahren (Passwortmanager, Ausdruck). Ohne ihn lassen sich Sicherungen nicht einspielen und gespeicherte Zugangsdaten von Integrationen nicht mehr lesen.

Weitere Einstellungen stehen unter [Konfiguration](Konfiguration). Für den Anfang reichen die Standardwerte.

## 2a. Starten mit fertigen Images (empfohlen)

In der `.env` setzen:

```
JOTION_IMAGE_PREFIX=ghcr.io/xwumps/jotion
```

Dann:

```bash
bash scripts/update.sh
```

Das Skript sucht das neueste Release, wechselt im Repository auf dessen Stand, trägt `JOTION_VERSION` in die `.env` ein, lädt die Images und startet alle Dienste. Eine bestimmte Version: `bash scripts/update.sh 1.0.0`.

## 2b. Starten mit eigenem Build

Ohne `JOTION_IMAGE_PREFIX` baut Docker die Images aus dem Quellcode. Das dauert beim ersten Mal einige Minuten (auf einem Raspberry Pi deutlich länger):

```bash
docker compose up -d --build --wait
```

Sinnvoll für eigene Änderungen am Code oder wenn die GitHub Container Registry nicht erreichbar ist.

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
