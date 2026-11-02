## C. Datenmodell (PostgreSQL, Prisma-Schema)

Konventionen: Primärschlüssel `id uuid` (UUIDv7, zeitlich sortierbar), `created_at`, `updated_at`, `deleted_at` (Soft Delete) wo sinnvoll. Reihenfolgen über **Fractional Indexing** (`position text`, Bibliothek `fractional-indexing`). Alle workspace-gebundenen Tabellen haben `workspace_id` (Index, Mandantentrennung in jeder Query).

### C.1 Identität und Workspaces
- `users` (email unique, name, avatar_file_id, locale, timezone, password_hash via Better-Auth-Tabellen `accounts`, `sessions`, `verifications`, `two_factor`)
- `workspaces` (name, icon, slug, settings jsonb)
- `workspace_members` (workspace_id, user_id, role enum[owner,admin,member,guest], unique(workspace_id,user_id))
- `groups`, `group_members`
- `teamspaces` (workspace_id, name, icon, default_access), `teamspace_members`
- `invitations` (workspace_id, email, role, token_hash, expires_at)

### C.2 Seiten und Inhalte (polymorphes Modell)
- `pages`
  - `workspace_id`, `teamspace_id?`, `parent_type enum[workspace,teamspace,page,database,block]`, `parent_id?`
  - `path ltree` (materialisierter Pfad für Subtree-Queries, Rechtevererbung, Breadcrumbs)
  - `position text`, `title text`, `icon jsonb` ({type: emoji|file|icon, value}), `cover jsonb`
  - `kind enum[page,database_row,database]` (eine Full-Page-DB ist eine Page mit `kind=database`)
  - `database_id?` (bei Zeilen), `settings jsonb` (Schrift, volle Breite, Sperre)
  - `is_template bool`, `archived_at`, `deleted_at`, `deleted_by`, `created_by`, `last_edited_by`, `last_edited_at`
  - Indizes: `(workspace_id, parent_id, position)`, GIST auf `path`, `(database_id)` partial, trigram auf `title`
- `page_docs` (page_id PK, `state bytea` = kompaktierter Yjs-State, `state_vector bytea`, `version bigint`)
- `page_doc_updates` (id bigserial, page_id, `update bytea`, client_id, user_id, created_at) append-only, wird nach Kompaktierung + Snapshot gekürzt
- `page_snapshots` (page_id, `state bytea`, created_at, created_by, `reason enum[auto,manual,restore,sync]`) für Seitenhistorie (alle 10 min aktiver Bearbeitung + bei Sitzungsende; Aufbewahrung konfigurierbar)
- `blocks` (**abgeleitete Projektion**, nicht Quelle der Wahrheit): `id` (= stabile Block-ID aus Yjs-Node-Attribut), `page_id`, `parent_block_id?`, `type`, `position`, `plain_text`, `props jsonb`, `search tsvector`. Zweck: Suche, Inhaltsverzeichnis serverseitig, Deep Links auf Blöcke, Synced-Block-Auflösung, Export.
- `block_references` (source_page_id, source_block_id, `target_type enum[page,user,database,block,date]`, target_id) für Backlinks, Mentions, Link-to-Page.
- `synced_blocks` (id, workspace_id, origin_page_id, `doc_state bytea`) : ein Synced Block ist ein eigenes Yjs-Subdokument; Referenzblöcke in Seiten speichern nur `synced_block_id`.
- `favorites` (user_id, page_id, position), `page_visits` (user_id, page_id, visited_at) für "Zuletzt"
- `comments` (page_id, block_id?, thread_id, `anchor` (Yjs RelativePosition), body jsonb, author_id, resolved_at), `comment_reactions`
- `notifications` (user_id, type, payload jsonb, read_at)
- `files` (workspace_id, storage_key, mime, size, sha256, width/height, uploaded_by, `ref_count`) plus Garbage Collection für verwaiste Dateien.

### C.3 Berechtigungen und Freigaben
- `page_permissions` (page_id, `principal_type enum[user,group,workspace,teamspace,public]`, principal_id?, `level enum[full,edit,edit_content,comment,view,none]`)
- `share_links` (page_id, token_hash, level, expires_at, password_hash?, allow_search_index bool)
- Auflösung: Pfad hochlaufen (via `path`), erster expliziter Eintrag pro Principal gewinnt; Ergebnis in Redis gecacht (Invalidierung bei Rechte- oder Strukturänderung).

### C.4 Datenbanksystem (flexibles Typsystem)
- `databases` (id = page_id der DB-Seite oder eigene id mit `page_id`, `workspace_id`, `title_property_id`, `is_inline bool`, `host_page_id?`, `locked bool`)
- `db_properties` (database_id, `type enum[...]`, name, position, `config jsonb`, `is_system bool`)
  - `config` je Typ, validiert per Zod-Schema aus `packages/shared`, z. B.:
    - number: `{format, precision, showAs: number|bar|ring, divideBy}`
    - select/multi_select: `{options:[{id,name,color,position}]}`
    - status: `{options:[...], groups:[{id:'todo'|'in_progress'|'complete', optionIds}]}`
    - date: `{dateFormat, timeFormat, includeTime default}`
    - relation: `{targetDatabaseId, twoWay: bool, reversePropertyId?, limit: 'one'|'many'}`
    - rollup: `{relationPropertyId, targetPropertyId, aggregation, displayAs}`
    - formula: `{expression, ast(cache), resultType}`
    - unique_id: `{prefix, nextValue}`
- `property_values` (**typisiertes EAV**, Quelle der Wahrheit für Zeilen-Properties)
  - `row_id` (= pages.id), `property_id`, `database_id` (denormalisiert für Index)
  - Spalten: `v_text text`, `v_number numeric`, `v_bool bool`, `v_date_start timestamptz`, `v_date_end timestamptz`, `v_date_has_time bool`, `v_tz text`, `v_option_ids uuid[]`, `v_user_ids uuid[]`, `v_json jsonb` (Files, URL-Metadaten)
  - PK `(row_id, property_id)`; Indizes je Typspalte `(database_id, property_id, v_number)` usw., GIN auf `v_option_ids`, `v_user_ids`, trigram auf `v_text`
  - Begründung: performantes Filtern/Sortieren in SQL, saubere Typen, keine dynamischen DDL-Änderungen pro DB.
- `relation_links` (database_id, property_id, `from_row_id`, `to_row_id`, position); bei Zwei-Wege-Relation wird nur eine Kante gespeichert und beidseitig gelesen (keine Inkonsistenz möglich). FK mit `ON DELETE` Soft-Handling (Kanten zu gelöschten Zeilen werden ausgeblendet, beim Restore wieder sichtbar).
- `computed_values` (row_id, property_id, `value` typisierte Spalten wie oben, `computed_at`, `stale bool`) : materialisierter Cache für Formeln/Rollups, damit Filter/Sort in SQL möglich sind. Invalidierung über Dependency-Graph (`property_dependencies`).
- `property_dependencies` (property_id, depends_on_property_id, via_relation_property_id?)
- `db_views` (database_id, `type enum[table,board,list,gallery,calendar,timeline,chart]`, name, position, `config jsonb`)
  - `config`: `filter` (AST: `{op:'and'|'or', children:[...]}` oder `{propertyId, operator, value}`), `sorts[]`, `groupBy {propertyId, hideEmpty, order[], hidden[], sortMode}`, `subGroupBy`, `properties [{id, visible, width, wrap}]`, `calculations {propertyId: fn}`, typspezifisch: board `{cardPreview, cardSize, colorColumns}`, calendar `{dateProperty, showWeekends}`, timeline `{startProperty, endProperty, zoom, showTable}`, gallery `{cover, size, fit}`, chart `{ChartSpec}`
- `db_view_row_order` (view_id, row_id, position) nur für manuelle Sortierung.
- `db_templates` (database_id, page_id(Template-Seite), is_default, `recurrence jsonb?`)

### C.5 Charts, Dashboard
- Chart-Konfiguration als `ChartSpec` (jsonb, Zod-validiert): `{source:{databaseId, viewId?}, type, x:{propertyId, bucket?}, y:{aggregation, propertyId?}, series?:{propertyId}, filter, sort, limit, dateRange, style:{palette, legend, labels, stacked, smooth, cumulative}}`. Verwendet in `db_views.config` (Chart-View), im Chart-Block (Block-Attribut `chartId`) und in Widgets.
- `charts` (id, workspace_id, spec jsonb, created_by) als wiederverwendbare Einheit.
- `dashboards` (workspace_id, owner_user_id? (null = geteilt), name, `layout jsonb` (react-grid-layout Breakpoints))
- `dashboard_widgets` (dashboard_id, `type enum[upcoming,overdue,board,chart,calendar,kpi,recent,favorites,note,links]`, `config jsonb`, grid position)

### C.6 Automatisierungen
- `automations` (database_id?, workspace_id, name, enabled, `trigger jsonb`, `conditions jsonb` (Filter-AST), `actions jsonb[]`, created_by, `run_as enum[creator,trigger_user]`)
- `automation_runs` (automation_id, status, trigger_event_id, started_at, finished_at, error, `chain_depth`)
- `change_events` (Outbox: id bigserial, workspace_id, type, entity_id, payload jsonb, actor, created_at, published_at)

### C.7 Integrationen und Mapping
- `integration_connections` (workspace_id, `connector_type`, name, `config jsonb` (nicht geheim: baseUrl, Auswahl der Quellen), `secrets_enc bytea`, `key_version`, `status enum[active,paused,error,disconnected]`, `sync_enabled`, `sync_interval_minutes`, `last_sync_at`, `last_success_at`, `last_error`, created_by)
- `sync_sources` (connection_id, `external_source_id` (z. B. CalDAV-Kalender-URL), `kind enum[event,task,file,contact,message]`, name, enabled, `cursor jsonb` (sync-token, ctag, etag-Map, since))
- `sync_mappings` (source_id, `target_database_id`, `field_map jsonb` [{externalField, propertyId, transform, ownership: 'remote'|'local_preserve'|'once'}], `options jsonb` (create new options for unknown select values, timezone, delete policy))
- `external_entities` (connection_id, source_id, `external_id` text, `row_id`, `remote_version` (etag/sequence/hash), `remote_updated_at`, `remote_deleted_at?`, `last_synced_at`) **UNIQUE(connection_id, source_id, external_id)** und UNIQUE(row_id)
- `external_field_state` (row_id, property_id, `last_synced_hash`, `last_synced_value jsonb`) Basis der Konfliktlösung (Drei-Wege-Vergleich)
- `sync_runs` (connection_id, started_at, finished_at, status, stats jsonb {created, updated, skipped, conflicts, errors}, log jsonb gekürzt)
- `sync_conflicts` (run_id, row_id, property_id, local_value, remote_value, base_value, resolution, resolved_at)

### C.8 Sonstiges
- `audit_logs`, `api_tokens` (persönliche Tokens für eine öffentliche REST-API, gehasht), `webhooks_outgoing`, `system_settings` (Instanzweite Einstellungen, Branding), `jobs_locks` falls nötig.

---

