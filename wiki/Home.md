# Jotion

Jotion ist ein selbst gehosteter Arbeitsbereich für Notizen, Wissen und Aufgaben: Seiten mit einem Block-Editor, Datenbanken mit vielen Ansichten, Diagramme, Vorlagen, Automatisierungen und Integrationen für Kalender, Mail und Dateien. Alles läuft auf deinem eigenen Server mit Docker, ohne Telemetrie und ohne externe Pflichtdienste.

## Schnellstart

```bash
git clone https://github.com/xwumps/jotion.git && cd jotion
bash scripts/init.sh
```

In der `.env` `JOTION_IMAGE_PREFIX=ghcr.io/xwumps/jotion` setzen, dann:

```bash
bash scripts/update.sh
```

Jotion läuft danach unter http://localhost:8080. Die erste Person, die sich dort einrichtet, wird Owner und Admin.

## Inhalt

**Betrieb**

- [Installation](Installation): Voraussetzungen, fertige Images oder eigener Build, eigene Domain mit HTTPS
- [Konfiguration](Konfiguration): alle Einstellungen der `.env`
- [Sicherungen](Sicherungen): automatische, verschlüsselte Sicherungen und Wiederherstellen
- [Updates](Updates): neue Versionen einspielen und zurückgehen
- [Admin-Bereich](Admin-Bereich): Zustand des Servers, Konten, Metriken
- [Fehlerbehebung](Fehlerbehebung): häufige Probleme

**Benutzung**

- [Funktionen](Funktionen): Überblick über alles, was Jotion kann
- [Seiten und Editor](Seiten-und-Editor)
- [Datenbanken](Datenbanken): Properties, Ansichten, Relationen, Formeln, Diagramme
- [Vorlagen und Automatisierungen](Vorlagen-und-Automatisierungen)
- [Zusammenarbeit](Zusammenarbeit): Teilen, Rechte, Kommentare, Versionsverlauf
- [Integrationen](Integrationen): iCal, CalDAV, IServ, iCloud, Nextcloud, Google, Microsoft, Dropbox, Telegram
- [Import und Export](Import-und-Export): Markdown, CSV, Notion
- [REST-API](REST-API): Zugriff für Skripte mit API-Tokens

## Weitere Quellen

- [Änderungen (CHANGELOG)](https://github.com/xwumps/jotion/blob/main/CHANGELOG.md)
- [Releases](https://github.com/xwumps/jotion/releases)
- [Technische Doku im Repository](https://github.com/xwumps/jotion/tree/main/docs): Architektur, Entscheidungen, Roadmap, Entwicklung
