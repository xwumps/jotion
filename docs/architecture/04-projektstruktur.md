## F. Projektstruktur
```
jotion/
├─ apps/
│  ├─ web/                    Next.js App Router
│  │  ├─ app/(auth)/ (app)/[workspace]/[pageId]/ settings/ share/[token]/
│  │  ├─ components/          shell/, sidebar/, page/, database/views/{table,board,list,gallery,calendar,timeline,chart}/,
│  │  │                       properties/{cells,editors}/, charts/, dashboard/widgets/, settings/integrations/
│  │  ├─ lib/                 api-client, query-keys, realtime, i18n
│  │  └─ messages/            de.json, en.json
│  ├─ api/                    NestJS
│  │  └─ src/modules/         auth, users, workspaces, permissions, pages, docs, blocks, search, files, databases,
│  │                          properties, rows, views, query, formulas, charts, dashboards, templates, automations,
│  │                          comments, notifications, integrations, sync, realtime, audit, admin, health
│  ├─ worker/                 Entrypoint + processors/ (sync, project-page, recompute, automations, purge, backup,
│  │                          thumbnails, reminders, export)
│  └─ collab/                 Hocuspocus-Server + Persistence-Extension
├─ packages/
│  ├─ shared/                 Zod-Schemas (PropertyConfig, ViewConfig, FilterAST, ChartSpec, Automation), Typen, Konstanten
│  ├─ db/                     Prisma-Schema, Migrationen, Seeds, Kysely-Typen (prisma-kysely)
│  ├─ query/                  Filter/Sort/Group → SQL-Compiler, JS-Referenz-Evaluator
│  ├─ formula/                Parser, Typchecker, Interpreter, Funktionsbibliothek
│  ├─ editor/                 Tiptap-Extensions, Schema, Serializer (Markdown/HTML), Paste-Normalizer
│  ├─ ui/                     shadcn/ui-basierte Komponenten, Jotion-Design-Tokens, Icons, Logo
│  ├─ integrations-sdk/       Connector-Interface, ExternalRecord, SafeHttpClient, Testing-Utilities
│  ├─ connectors/             ical/, caldav/, webdav/, iserv/, google/, microsoft/, dropbox/, nextcloud/, telegram/
│  ├─ crypto/                 Envelope Encryption, Key-Rotation
│  └─ config/                 eslint, tsconfig, tailwind preset
├─ docker/                    Dockerfiles (multi-stage, non-root), Caddyfile, compose.yml, compose.dev.yml, backup/
├─ scripts/                   backup.sh, restore.sh, migrate.sh, seed
├─ tests/                     e2e/ (Playwright), load/ (k6), fixtures/ (ics, caldav, paste-html)
└─ docs/                      architecture/, adr/, roadmap.md, operations.md, integrations/iserv.md
```

---

