## E. Entwicklungs-Roadmap

Jede Phase endet mit lauffähigem `docker compose up`, grüner CI und aktualisierter Doku. DoD für alle Phasen (zusätzlich zu den phasenspezifischen Punkten): Typecheck + Lint fehlerfrei, Tests grün, Migrationen vorwärts lauffähig auf Kopie der Vorphasen-Daten, keine neuen kritischen `npm audit`-Funde, i18n-Strings DE/EN, Dark Mode geprüft, Accessibility-Basics (Tastatur, Fokus, ARIA) geprüft.

### Phase 0: Fundament und Branding
- **Ziel**: Monorepo, Tooling, Infrastruktur, Designsystem "Jotion".
- **Funktionen**: Leere App-Shell, Theme (Light/Dark/System), Logo, Login-Platzhalter.
- **Aufgaben**: pnpm + Turborepo; apps `web`, `api`, `collab`, `worker`; packages `shared`, `db`, `ui`, `editor`, `formula`, `query`, `integrations-sdk`, `config`; ESLint/Prettier/TS strict; Prisma-Setup + erste Migration; Docker Compose (dev + prod), Caddy; GitHub Actions (lint, typecheck, test, build images); pino-Logging; Konfiguration via Zod-validierte ENV; i18n (next-intl). **Branding**: Name "Jotion", Wortmarke + Signet (stilisiertes "J" als Blatt/Block, monochrom, SVG), Notion-ähnliche ruhige Typografie (Inter / System-UI, Serif-Option: Lyon-ähnliche freie Schrift wie "Source Serif 4", Mono: "JetBrains Mono"), Farbpalette (neutrales Grau, 10 Notion-ähnliche Textfarben + Hintergrundfarben als Tokens), Favicon, PWA-Manifest, `<title>`-Muster "Seitentitel | Jotion".
- **Abhängigkeiten**: keine.
- **Akzeptanz**: `docker compose up` startet alle Dienste mit Healthchecks grün; Web zeigt gebrandete Shell.
- **Tests**: Smoke-E2E (Playwright), Docker-Healthcheck-Test in CI.

### Phase 1: Auth, Workspaces, Seitenbaum
- **Funktionen**: Registrierung/Login/Logout, Passwort-Reset (SMTP optional, sonst Admin-Reset), Workspaces + Mitglieder + Einladungslinks, Sidebar-Baum mit DnD (dnd-kit), Seite anlegen/umbenennen/verschieben/löschen, Icons/Cover, Breadcrumbs, Favoriten, Zuletzt, Papierkorb, Archiv, Basis-Rechte (Workspace-Rolle).
- **Aufgaben**: Better Auth integrieren; `PermissionService`; `PageService` mit `ltree`-Pfadpflege bei Move (Transaktion, Zyklusprüfung); Fractional Indexing; Datei-Upload-Service + StorageDriver; Outbox + Realtime-Kanal (SSE) für Sidebar.
- **Abhängigkeiten**: Phase 0.
- **Akzeptanz**: 1.000 Seiten in Baum performant (<100 ms Sidebar-Load lazy), Move in eigene Unterseite verhindert, Papierkorb-Restore stellt Unterbaum wieder her.
- **Tests**: Unit (Pfadlogik, Fractional Index), API-Tests (Supertest + Testcontainers-Postgres), Berechtigungstests (Matrix Rolle × Aktion), E2E Login + Seite anlegen.

### Phase 2: Editor-Kern mit Yjs-Persistenz
- **Funktionen**: Tiptap v3 mit Blöcken: Paragraph, H1-3, Listen, To-do, Toggle, Callout, Zitat, Trennlinie, Code, Unterseite, Link-to-Page; Slash-Menü, Markdown-Shortcuts, Bubble-Menü (Inline-Formatierung, Farben, Link), Drag-Handle + Block-DnD, Block-Menü (Löschen, Duplizieren, Umwandeln, Farbe, Link zum Block), Undo/Redo, Tastaturkürzel, Autosave-Status, Seitenoptionen, Schnellsuche (Titel).
- **Aufgaben**: `packages/editor` (Extensions, Schema, eindeutige Block-IDs via UniqueID-Extension); Hocuspocus-Server mit Auth-Hook und PostgreSQL-Extension (append-only Updates + Kompaktierung); y-indexeddb; Projektion `page.project` → `blocks`, `block_references`; Unterseiten-Block erzeugt Page atomar (Server bestätigt, Block erhält pageId).
- **Abhängigkeiten**: Phase 1.
- **Akzeptanz**: Kein Datenverlust bei: Tab-Close während Tippen, Netzabbruch 5 min, Server-Neustart, zwei Tabs gleichzeitig. Markdown-Shortcuts identisch zu Notion (`#`, `##`, `-`, `1.`, `[]`, `>`, `"`, ```` ``` ````, `---`).
- **Tests**: Unit (Extensions, Input Rules), Yjs-Persistenz-Integrationstests (Update-Reihenfolge, Kompaktierung, Crash zwischen Append und Ack), **Datenverlust-E2E-Suite** (Playwright mit Netzwerk-Offline-Simulation, Container-Restart), Snapshot-Tests des Schemas.

### Phase 3: Editor erweitert
- **Funktionen**: Bild/Video/Audio/Datei/PDF, Bookmark, Embeds, einfache Tabelle, Spalten, Inhaltsverzeichnis, Breadcrumb-Block, KaTeX, Mentions (@Person/@Seite/@Datum), Mehrfachauswahl (Rechteck), erweitertes Copy & Paste, Seite duplizieren, Volltextsuche (Postgres FTS + trigram, Ranking, Filter).
- **Aufgaben**: NodeViews in React; Paste-Normalisierer (Notion/Google Docs/Word-HTML → Schema); OpenGraph-Fetcher über SafeHttpClient; Performance: Lazy NodeViews, `content-visibility: auto` für Blöcke außerhalb des Viewports, Profiling mit 5.000 Blöcken.
- **Akzeptanz**: Dokument mit 5.000 Blöcken: Öffnen <1,5 s, Tippen-Latenz p95 <16 ms (Chrome, Mittelklasse-Laptop).
- **Tests**: Paste-Fixture-Tests (gespeicherte HTML-Clipboards), Performance-Benchmark in CI (Playwright + Trace), E2E Upload/Mention/Suche.

### Phase 4: Datenbank-Kern und Table View
- **Funktionen**: Full-Page- und Inline-DB, Linked DB, alle Basis-Property-Typen (A.3 Zeile 2), Table View (virtualisiert, Spalten-DnD/Resize/Fix, Zellen-Editoren), Zeilen-Peek/Seite, Filter (einfach + Gruppen), Sort, Suche, Ansichten-Tabs, Spaltenberechnungen.
- **Aufgaben**: `packages/query`: Filter/Sort-AST (Zod) → SQL-Compiler mit Kysely über `property_values` (parametrisiert, nie String-Konkatenation); Cursor-Pagination; `RowService`; Property-Typwechsel mit Konvertierungsregeln (z. B. Text → Select erzeugt Optionen) als Migration-Job mit Undo-Snapshot; Realtime-Invalidierung.
- **Akzeptanz**: DB mit 50.000 Zeilen: gefilterte Table View erste Seite <300 ms (p95, Server), Scrollen 60 fps.
- **Tests**: Property-Wert-Validierung pro Typ (Property-based Tests mit fast-check), Query-Compiler-Tests gegen echte Postgres-Instanz (Testcontainers) mit Referenz-Implementierung in JS (Ergebnisvergleich), Typwechsel-Tests, E2E.

### Phase 5: Board, List, Gallery, Calendar, Timeline
- **Funktionen**: vollständiges Kanban (siehe A.4), List, Gallery, Calendar (Monat/Woche), Timeline (Zoom, DnD, Resize), Gruppierung + Sub-Gruppierung, Property-Sichtbarkeit pro View, DB-Lock.
- **Aufgaben**: gemeinsames `GroupingEngine` (Server-seitige Gruppen mit Zählern, Lazy-Load pro Gruppe); Board-DnD ändert Gruppen-Property + Position atomar (Optimistic + Konfliktbehandlung); Kalender/Timeline als Eigenentwicklung auf date-fns + dnd-kit + Virtualisierung.
- **Akzeptanz**: Board mit 2.000 Karten und 10 Spalten flüssig; DnD zwischen Spalten persistent und bei zwei Clients konsistent.
- **Tests**: Unit Grouping/Date-Bucketing (Zeitzonen, DST-Grenzen), E2E DnD (Board, Kalender, Timeline), Multi-Client-Konsistenztest.

### Phase 6: Relationen, Rollups, Formeln, verschachtelte Filter
- **Funktionen**: Relation (ein-/zweiseitig, Self-Relation, Limit), Rollup (alle Aggregationen), Formula 2.0 (Funktionsumfang wie Notion: Logik, Mathe, Text, Datum, Listen `map/filter/find/sort`, `let/lets`, `prop()`, Zugriff auf Relation-Listen), verschachtelte Filter bis Tiefe 3 inkl. Filter auf Formeln/Rollups.
- **Aufgaben**: `packages/formula`: Lexer/Parser (Chevrotain oder handgeschriebener Pratt-Parser), Typprüfer, Interpreter (isomorph: Browser-Vorschau + Server), Editor mit Autocomplete und Fehlermarkierung (CodeMirror 6); Dependency-Graph + `computed_values` + inkrementelle Neuberechnung im Worker; Zyklenerkennung.
- **Akzeptanz**: Formel-Testkatalog (>300 Fälle) grün; Änderung eines Werts propagiert über 2 Relationsebenen <2 s bei 10.000 Zeilen.
- **Tests**: Golden-Tests für Formeln, Fuzzing des Parsers, Relation-Integritätstests (Löschen/Restore/zweiseitig), Rollup-Konsistenz gegen JS-Referenz.

### Phase 7: Charts und Dashboard
- **Funktionen**: Chart View, Chart-Block, Chart-Builder, alle Typen aus A.5, Drilldown, Live-Update, Dashboard mit Widgets aus A.6, aggregiertes "Anstehend/Überfällig" über mehrere DBs.
- **Aufgaben**: `AggregationService` (SQL GROUP BY über `property_values`/`computed_values`, Datums-Bucketing mit `date_trunc` in Nutzer-Zeitzone, Multi-Select-Explode), Caching in Redis mit Invalidierung per Outbox-Event; Apache ECharts mit Jotion-Theme; react-grid-layout für Dashboard.
- **Akzeptanz**: Chart über 50.000 Zeilen <500 ms; Änderung in DB aktualisiert offenes Chart <2 s.
- **Tests**: Aggregations-Tests gegen Referenz, Visual-Regression (Playwright Screenshots) pro Chart-Typ in Light/Dark, E2E Dashboard-Layout persistiert.

### Phase 8: Integrationsframework, iCal/CalDAV, IServ
- **Funktionen**: Einstellungen → Integrationen (Liste, Hinzufügen), generischer iCal-Feed- und CalDAV-Connector, IServ-Connector, Mapping-Editor mit Vorschau, Sync-Zeitplan, manuelle Sync, Fehler-/Konfliktanzeige, Trennen.
- **Aufgaben**: **Spike zuerst (Gate)**: gegen eine echte IServ-Testinstanz verifizieren: CalDAV-Discovery-URL, Auth mit/ohne 2FA, Verfügbarkeit von VTODO/Aufgaben-Export, iCal-Export, WebDAV. Ergebnis als ADR. Danach: `integrations-sdk`, `SyncEngine`, `MappingEngine`, `ConflictResolver`, Crypto-Service, Connector-Implementierungen (tsdav für CalDAV, ical.js für Parsing, rrule für Wiederholungen).
- **Abhängigkeiten**: Phase 4 (DB-Kern), 6 optional (Relationen im Mapping).
- **Akzeptanz**: 3-maliger Sync derselben Daten erzeugt 0 Dubletten; lokal geänderte Felder bleiben nach Remote-Änderung erhalten; abgebrochener Sync (Kill -9 des Workers) hinterlässt konsistenten Zustand und setzt beim nächsten Lauf korrekt fort.
- **Tests**: Connector-Tests gegen aufgezeichnete Fixtures (ICS-Dateien, CalDAV-XML-Antworten) und gegen einen lokalen Radicale-CalDAV-Server in Testcontainers; **Sync-Konflikt-Suite** (Matrix: lokal ja/nein × remote ja/nein × Ownership × gelöscht); Idempotenz-Tests (Doppelausführung, parallele Trigger); Crypto-Tests (Rotation).

### Phase 9: Templates, Buttons, Automatisierungen
- **Funktionen**: Seiten-Templates + Galerie (mitgelieferte Jotion-Templates: Aufgaben, Stundenplan, Hausaufgaben-Tracker, Projekt-Roadmap, Notizen, Wiki), DB-Templates (Default, wiederkehrend), Button-Block + Button-Property, Automations-Builder, Ausführungsprotokoll.
- **Aufgaben**: Template-Instanziierung (Deep Copy inkl. Yjs-Doc, Inline-DBs, Relation-Remapping, Variablen wie `@heute`, `@ersteller`); Automation-Engine im Worker (Outbox-Consumer, idempotent pro Event + Automation, Kettentiefe, Rate-Limit); Zeit-Trigger via BullMQ-Repeatables.
- **Akzeptanz**: Automation "Status = Erledigt → Datum Abgeschlossen setzen" greift <2 s; Endlosschleife wird bei Tiefe 5 gestoppt und protokolliert.
- **Tests**: Engine-Unit-Tests, Template-Kopie-Integrität (Relationen zeigen in Kopie korrekt), E2E Builder.

### Phase 10: Kollaboration, Rechte, Historie, Synced Blocks
- **Funktionen**: Seitenrechte + Teilen-Dialog, Gäste, Gruppen, Teamspaces, öffentliche Links, Live-Cursor/Präsenz, Kommentare + Inbox + Mentions-Benachrichtigungen, Seitenhistorie mit Diff und Restore, Synced Blocks, Seite in anderen Workspace verschieben, OIDC-Login (inkl. IServ-SSO falls verfügbar), Audit-Log.
- **Aufgaben**: Rechtevererbung + Cache; Collab-Rechteprüfung; Snapshot-Diff (Projektion beider Versionen → Block-Diff); Synced Blocks als Yjs-Subdocs.
- **Tests**: Vollständige Berechtigungsmatrix (Principal × Level × Vererbung × Aktion, generiert), Leak-Tests (Suche/Backlinks/Mentions zeigen keine unberechtigten Titel), E2E Mehrbenutzer.

### Phase 11: Weitere Connectoren
Nextcloud (CalDAV/WebDAV), iCloud, Google (Calendar, Gmail read-only, Drive), Microsoft Graph, Dropbox, Telegram. Je Connector: Fixtures + Contract-Tests gegen das SDK-Interface. Abhängigkeit: Phase 8.

### Phase 12: Betrieb, Import/Export, Härtung
- **Funktionen**: Backup/Restore-CLI und geplanter Backup-Job, Update-Prozess, Import (Markdown, CSV, Notion-Export-ZIP), Export (Markdown, HTML, PDF via Chromium im Worker, CSV), öffentliche REST-API mit Tokens, responsive/PWA, Admin-Bereich, Metriken (Prometheus-Endpoint optional).
- **Tests**: Backup-Restore-Roundtrip in CI, Upgrade-Test (Daten der Vorversion → neue Version, Migrationen + Datenvalidierung), Lasttests (k6), Security-Scan (ZAP Baseline, Trivy für Images).

**Reihenfolge-Abhängigkeiten**: 0 → 1 → 2 → 3; 2 → 4 → 5 → 6 → 7; 4 → 8 → 11; 6 → 9; 2+4 → 10; alles → 12. Phasen 3 und 4 sowie 7 und 8 können parallel bearbeitet werden.

---

