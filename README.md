# Jotion

Jotion ist eine selbst gehostete Alternative zu Notion für den privaten Gebrauch und kleine Teams: Block-Editor, flexible Datenbanken (Table, Board, List, Gallery, Calendar, Timeline, Chart), Dashboards, Automatisierungen, Templates und ein modulares Integrationssystem (zuerst IServ).

**Stand: Phase 2 abgeschlossen.** Anmeldung mit Einladungen, mehrere Workspaces, Seitenbaum mit Drag-and-drop und ein Block-Editor mit Slash-Menü, Markdown-Kürzeln, Formatierung und Echtzeit-Bearbeitung. Jede Änderung wird gespeichert, bevor sie als gespeichert gilt, und offline lokal gesichert. Als Nächstes folgen Medien, Tabellen, Spalten und Volltextsuche (Phase 3), siehe [Roadmap](docs/roadmap.md).

Beim ersten Aufruf führt Jotion durch die Einrichtung: Das erste Konto wird Owner. Weitere Personen kommen nur über Einladungslinks dazu.

## Schnellstart (Docker)

Voraussetzung: Docker mit Compose v2.

```bash
bash scripts/init.sh
```

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
| `api`      | REST-API (NestJS), ab Phase 2 auch Echtzeit-Bearbeitung       |
| `worker`   | Hintergrundjobs (Synchronisation, Automatisierungen, Wartung) |
| `migrate`  | Einmaliger Job: Datenbankmigrationen vor jedem Start          |
| `postgres` | Datenbank                                                     |
| `redis`    | Job-Queue und Cache                                           |

## Weitere Dokumentation

- [Entwicklung](docs/development.md): lokale Einrichtung, Tests, Projektaufbau
- [Betrieb](docs/operations.md): Docker, Backups, Updates
- [Technischer Bauplan](docs/README.md): Architektur, Datenmodell, Integrationen, Roadmap
