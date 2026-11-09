# Jotion

Jotion ist eine selbst gehostete Alternative zu Notion für den privaten Gebrauch und kleine Teams: Block-Editor, flexible Datenbanken (Table, Board, List, Gallery, Calendar, Timeline, Chart), Dashboards, Automatisierungen, Templates und ein modulares Integrationssystem (zuerst IServ).

**Stand: Phase 12 abgeschlossen.** Anmeldung mit Einladungen, mehrere Workspaces, Seitenbaum mit Drag-and-drop und ein Block-Editor mit Echtzeit-Bearbeitung, Live-Cursor, Medien, Tabellen, Spalten, Formeln, Erwähnungen, Synced Blocks, Volltextsuche und Druck als PDF. Datenbanken mit allen Basis-Property-Typen, Filtern, Sortierung und Berechnungen in den Ansichten Tabelle, Board (Kanban mit Swimlanes), Liste, Galerie, Kalender und Zeitleiste, dazu Relationen, Rollups und Formeln (Notion-Formula-2.0-kompatibel) und Diagramme. Die Startseite ist ein Dashboard mit Widgets. Integrationen für iCal, CalDAV, IServ, iCloud, Nextcloud, WebDAV, Google, Microsoft 365, Dropbox und Telegram, Vorlagen und Automatisierungen. Teilen mit Rechten je Mitglied und Lese-Link, Kommentare mit Posteingang und Seitenhistorie. Dazu Sicherungen mit Wiederherstellen und Update-Skript, Import aus Markdown, CSV und Notion, Export als Markdown, HTML und CSV, eine REST-API mit Tokens, ein Admin-Bereich, Metriken und eine mobile Ansicht. Alle Phasen der [Roadmap](docs/roadmap.md) sind umgesetzt.

Beim ersten Aufruf führt Jotion durch die Einrichtung: Das erste Konto wird Owner. Weitere Personen kommen nur über Einladungslinks dazu.

## Schnellstart (Docker)

Voraussetzung: Docker mit Compose v2 auf einem 64-Bit-System (x86 oder ARM, zum Beispiel PC, Server, NAS, Raspberry Pi 4 oder 5 mit 64-Bit-System), Richtwert 2 CPU-Kerne und 4 GB RAM.

```bash
git clone https://github.com/xwumps/jotion.git && cd jotion
```

```bash
bash scripts/init.sh
```

**Mit fertigen Images** (empfohlen, ab dem ersten Release): in der `.env` `JOTION_IMAGE_PREFIX=ghcr.io/xwumps/jotion` setzen, dann

```bash
bash scripts/update.sh
```

Das Skript wählt das neueste Release, lädt die Images und startet Jotion.

**Aus dem Quellcode bauen** (zum Beispiel für eigene Änderungen):

```bash
docker compose up -d --build --wait
```

Danach ist Jotion unter http://localhost:8080 erreichbar.

`scripts/init.sh` erzeugt eine `.env` mit zufälligen Passwörtern und Schlüsseln. **Den `JOTION_MASTER_KEY` aus der `.env` zusätzlich sicher aufbewahren**, ohne ihn sind gespeicherte Zugangsdaten von Integrationen nicht mehr lesbar.

## Dienste

| Dienst     | Aufgabe                                                       |
| ---------- | ------------------------------------------------------------- |
| `caddy`    | Reverse Proxy, optional automatisches HTTPS                   |
| `web`      | Oberfläche (Next.js)                                          |
| `api`      | REST-API (NestJS) und Echtzeit-Bearbeitung                    |
| `worker`   | Hintergrundjobs (Synchronisation, Automatisierungen, Wartung) |
| `migrate`  | Einmaliger Job: Datenbankmigrationen vor jedem Start          |
| `postgres` | Datenbank                                                     |
| `redis`    | Job-Queue und Cache                                           |
| `backup`   | Tägliche, verschlüsselte Sicherung von Datenbank und Dateien  |

## Weitere Dokumentation

- [Entwicklung](docs/development.md): lokale Einrichtung, Tests, Projektaufbau
- [Wiki](https://github.com/xwumps/jotion/wiki): Installation, Konfiguration, Funktionen und Anleitungen
- [Betrieb](docs/operations.md): Docker, Backups, Updates
- [Änderungen](CHANGELOG.md): neue Versionen und Hinweise zum Update
- [Technischer Bauplan](docs/README.md): Architektur, Datenmodell, Integrationen, Roadmap
