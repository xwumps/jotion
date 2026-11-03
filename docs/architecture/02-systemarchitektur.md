## B. Technische Architektur

### B.1 Systemüberblick
```
                         ┌──────────────────────────────────────────────┐
 Browser (Next.js App) ──┤  Reverse Proxy (Caddy, TLS, Auto-HTTPS)     │
                         └─────┬──────────────┬──────────────┬─────────┘
                               │ HTTP         │ HTTP/REST    │ WebSocket
                         ┌─────▼─────┐  ┌─────▼──────┐  ┌────▼────────┐
                         │ web       │  │ api        │  │ collab      │
                         │ Next.js   │  │ NestJS     │  │ Hocuspocus  │
                         │ (SSR/UI)  │  │ (Fastify)  │  │ (Yjs)       │
                         └───────────┘  └─┬───┬───┬──┘  └──┬───┬──────┘
                                          │   │   │        │   │
                          ┌───────────────┘   │   └──┐     │   │
                    ┌─────▼──────┐     ┌──────▼─┐  ┌─▼─────▼┐  │
                    │ PostgreSQL │◄────┤ Redis  │  │ Files  │  │
                    │ 16 (+ext.) │     │ queue, │  │ local  │  │
                    └─────▲──────┘     │ pubsub │  │ or S3  │  │
                          │            └───▲────┘  └────────┘  │
                    ┌─────┴────────────────┴───────────────────┘
                    │ worker (BullMQ): Sync, Automations, Indexing,
                    │ Thumbnails, Purge, Backups, Reminders
                    └──────────────────────────────────────────────
```
- **web**: Next.js (App Router) liefert UI. Keine Geschäftslogik in Route Handlers, nur Rendering und Auth-Session-Weitergabe. Kommuniziert mit `api` über einen typisierten Client (generiert aus OpenAPI via `@hey-api/openapi-ts` oder ts-rest-Contract).
- **api**: NestJS mit Fastify-Adapter. Domänenmodule (siehe F). REST + Server-Sent Events/WebSocket-Kanal für Realtime-Invalidierungen (DB-Zeilen, Sidebar, Kommentare).
- **collab**: Hocuspocus (Yjs), **eingebettet im `api`-Prozess** (eigener WebSocket-Pfad `/collab`), persistiert Yjs-Updates in PostgreSQL. Als eigenes Modul gekapselt, damit es bei Bedarf später in einen separaten Container ausgelagert werden kann (Redis-Extension).
- **worker**: gleiche Codebasis wie api (gemeinsame Module), anderer Entrypoint. BullMQ-Queues.
- **postgres**: Extensions `pg_trgm`, `unaccent`, `btree_gin`, `ltree`.
- **redis**: Queues, Pub/Sub, Rate-Limits, Cache.
- **storage**: Abstraktion `StorageDriver` mit `local` (Docker-Volume, Default) und `s3` (MinIO/S3, optional).

### B.2 Datenflüsse

**Editor-Speicherung (kritisch, kein Datenverlust)**
1. Tiptap-Editor bindet an `Y.Doc` (y-prosemirror). Jede Eingabe erzeugt ein Yjs-Update.
2. Update wird lokal sofort in IndexedDB (y-indexeddb) gepuffert, dann per WebSocket an `collab` gesendet.
3. `collab` hängt das Update append-only an `page_doc_updates` an (Transaktion), bestätigt erst danach (Ack). Debounced (2 s) wird der Gesamtstand zu `page_docs.state` kompaktiert.
4. Nach Kompaktierung: Job `page.project` in Queue. Worker leitet aus dem Yjs-Dokument die **Block-Projektion** ab (`blocks`-Tabelle: Typ, Text, Referenzen), aktualisiert Suchindex, Backlinks, Mentions, Synced-Block-Referenzen, Unterseiten-Verknüpfungen.
5. UI zeigt Status "Gespeichert/Synchronisiere/Offline". Beim Schließen mit ungesendeten Updates: `beforeunload`-Warnung; beim nächsten Öffnen werden IndexedDB-Updates nachgesendet (Yjs merged konfliktfrei).

**Datenbank-Zeilen**
1. UI sendet Mutation `PATCH /databases/:id/rows/:rowId/properties` mit `clientMutationId`.
2. api validiert gegen Property-Schema, schreibt in `property_values` (Transaktion), aktualisiert `last_edited_*`, invalidiert abhängige Formeln/Rollups (Dependency-Graph), schreibt `change_events` (Outbox).
3. Outbox-Relay publiziert `db.rows.changed` via Redis; alle verbundenen Clients (Views, Charts, Dashboard) invalidieren TanStack-Query-Caches gezielt. Automations-Engine konsumiert dieselben Events.
4. Optimistic UI mit Rollback bei Fehler.

**Sync (extern → Jotion)**
Scheduler (BullMQ repeatable) → `sync.run(connectionId)` → Connector `pull(cursor)` → Normalisierung zu `ExternalRecord` → Mapping-Engine → Upsert über `external_entities` (Dedupe) → Field-Ownership-Check → Schreiben über dieselbe Domänen-API wie die UI (keine Direkt-SQL-Umgehung) → `sync_runs`-Protokoll.

### B.3 Komponentenübersicht Frontend
- `AppShell`: Sidebar (Workspace-Switcher, Suche, Inbox, Einstellungen, Favoriten, Team (geteilte Seiten), Privat, Papierkorb), Topbar (Breadcrumbs, Teilen, Kommentare, Updates, Favorit, `...`-Menü).
- `PageView`: Cover, Icon, Titel, Properties-Bereich (bei DB-Zeilen), Editor, Backlinks, Kommentare.
- `Editor`: Tiptap-Instanz, Extensions-Registry, SlashMenu, BlockMenu, DragHandle, BubbleMenu, MentionPicker, NodeViews.
- `DatabaseView`: ViewTabs, Toolbar (Filter, Sort, Group, Properties, Suche, Neu), Renderer je ViewType, PropertyCellEditors, RowPeek.
- `ChartBuilder`, `ChartRenderer`, `DashboardGrid`, `WidgetRegistry`.
- `Settings`: Konto, Workspace, Mitglieder, Integrationen, Import/Export, Sicherheit, Admin.

### B.3.1 Drucken und PDF (Browser-Druckfunktion)
PDF entsteht ausschließlich im Browser über "Drucken → Als PDF speichern". Es gibt keinen serverseitigen PDF-Renderer.
- **Auslösen**: Seitenmenü `...` → "Drucken / Als PDF" sowie Cmd/Strg+P. Beides öffnet die Route `/print/$pageId` (gleiche Daten, statisch gerendert) und ruft nach vollständigem Laden `window.print()` auf. Danach Rücksprung zur Seite.
- **Druck-Stylesheet** (`@media print`, Tailwind-Variante `print:`): Sidebar, Topbar, Drag-Handles, Hover-Menüs, Kommentar-Leiste und Editor-Cursor ausgeblendet; Seitenbreite = Druckbreite; `@page { size: A4; margin: 18mm 16mm }`; Cover und Icon oben; Seitentitel und Druckdatum optional in der Kopfzeile.
- **Seitenumbrüche**: `break-inside: avoid` für Callouts, Codeblöcke, Bilder, Tabellenzeilen, Karten; Überschriften `break-after: avoid`.
- **Farben**: `print-color-adjust: exact` für Callouts, Select-Badges und Charts; immer helles Theme beim Druck, auch wenn Dark Mode aktiv ist.
- **Druckoptionen** (kleiner Dialog vor dem Druck, Auswahl wird lokal gemerkt): Toggles aufgeklappt oder zugeklappt, Kommentare ja/nein, Unterseiten-Links als Liste, Hintergrundfarben ja/nein.
- **Datenbanken**: Inline- und Full-Page-DBs werden für den Druck nicht virtualisiert gerendert (alle Zeilen der aktuellen Ansicht, Hinweis ab 1.000 Zeilen). Board, Gallery, Kalender und Timeline drucken in ihrer Ansicht mit umbrechenden Spalten; als Alternative "Als Tabelle drucken".
- **Charts**: ECharts reagiert auf `beforeprint` (Resize auf Druckbreite, Animationen aus) und wird zur sicheren Darstellung als SVG-Renderer neu gezeichnet; `afterprint` stellt den Normalzustand wieder her.
- **Code, Formeln**: Syntax-Highlighting in Druckfarben, lange Zeilen umbrechen; KaTeX unverändert.

### B.4 Integrationsarchitektur (Adapter-Pattern)
```
 UI (Settings → Integrationen)            Domänenkern (Pages/Databases)
        │ REST                                       ▲
        ▼                                            │ nur über RowService/PageService
 IntegrationsModule ── ConnectionService             │
        │                                             │
        ▼                                             │
 SyncEngine ──► MappingEngine ──► ConflictResolver ──┘
        ▲
        │ ExternalRecord (normalisiert: Event | Task | File | Contact | Message)
        │
 ConnectorRegistry ──► Connector (interface)
                          ├─ ical-feed (generisch)
                          ├─ caldav (generisch: Apple/iCloud, Nextcloud, IServ)
                          ├─ webdav (Dateien: Nextcloud, IServ)
                          ├─ iserv (Komposition aus caldav/ical/webdav + IServ-Spezifika)
                          ├─ google (OAuth2: Calendar, Gmail, Drive)
                          ├─ microsoft (OAuth2 Graph: Outlook, OneDrive)
                          ├─ dropbox (OAuth2)
                          └─ telegram (Bot API, bidirektional für Nachrichten)
```
Regel: Connectoren kennen weder UI noch Jotion-Datenmodell. Sie liefern nur `ExternalRecord`s mit stabiler `externalId`, `etag/version`, `updatedAt` und typisierten Feldern. Die Abbildung auf Jotion-Properties erfolgt ausschließlich durch die Mapping-Engine anhand nutzerdefinierter Konfiguration.

### B.5 Sicherheitskonzept
- **AuthN**: eigene Session-Authentifizierung, siehe ADR 13 (Email/Passwort mit Argon2id, Sessions in DB, HttpOnly/Secure/SameSite=Lax Cookies), TOTP-2FA, später OIDC. Rate-Limiting für Login (Redis). Account-Lockout mit Backoff.
- **AuthZ**: Zentrale `PermissionService.can(user, action, resource)`; Seitenrechte werden über den Baum vererbt (nächster expliziter Eintrag gewinnt). Jede API-Route deklariert benötigte Berechtigung per Decorator; Default deny. Collab-Server prüft beim Verbindungsaufbau und bei Rechteänderung (Disconnect).
- **Secrets der Integrationen**: AES-256-GCM, Envelope Encryption: Master Key aus `JOTION_MASTER_KEY` (Docker Secret), pro Datensatz Data Key, Spalte `key_version` für Rotation. Secrets werden nie an das Frontend zurückgegeben (nur "gesetzt/nicht gesetzt"), nie geloggt (Log-Redaction in pino).
- **Uploads**: MIME-Sniffing (file-type), Größenlimit, Bild-Re-Encoding (sharp) zum Entfernen von EXIF, Auslieferung über signierte, kurzlebige URLs mit `Content-Disposition` und separatem Pfad; SVG nur als Download oder sanitized.
- **XSS/Injection**: Editor-Inhalte sind strukturierte Yjs/ProseMirror-Daten, kein Roh-HTML. Paste-HTML wird über Schema geparst. Embeds nur über Whitelist mit `sandbox`-iframe. Strikte CSP mit Nonces. Formeln laufen in eigenem Interpreter (kein `eval`).
- **SSRF**: Bookmark-Preview, Webhooks und Connector-Requests über `SafeHttpClient` (DNS-Auflösung prüfen, private IP-Bereiche blockieren, außer explizit freigegeben z. B. für intern gehostetes Nextcloud/IServ per Admin-Allowlist), Timeouts, Größenlimits.
- **CSRF**: SameSite-Cookies plus Origin-Check für mutierende Requests.
- **Audit-Log**: Später. Für den privaten Einsatz genügt ein Aktivitätsprotokoll für Logins und Integrationsänderungen.
- **Zugang**: Registrierung standardmäßig geschlossen (Einladung durch Owner). Betrieb hinter VPN empfohlen; bei öffentlicher Domain Caddy mit Auto-HTTPS.
- **Backups** verschlüsselt (optional age-Key).

---

