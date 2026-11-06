# Entwicklung

## Voraussetzungen
- Node.js 22 (siehe `.nvmrc`), pnpm 10 (`corepack enable`)
- Docker für PostgreSQL und Redis

## Einrichtung

```bash
pnpm install
```

```bash
docker compose -f compose.dev.yml up -d --wait
```

```bash
cp .env.example .env
```

In `.env` für die Entwicklung setzen:

```
DATABASE_URL=postgresql://jotion:jotion@localhost:5432/jotion
REDIS_URL=redis://:jotion@localhost:6379
JOTION_ALLOWED_ORIGINS=http://localhost:3000
# Editor-WebSocket direkt zur API, da `pnpm dev` ohne Caddy läuft
NEXT_PUBLIC_COLLAB_URL=ws://localhost:4000/collab
JOTION_FILES_DIR=./docker/data/files
JOTION_MASTER_KEY=<openssl rand -base64 32>
AUTH_SECRET=<openssl rand -base64 32>
NODE_ENV=development
```

```bash
pnpm db:generate && pnpm db:migrate
```

```bash
pnpm dev
```

Web: http://localhost:3000, API: http://localhost:4000/api/health/system.
Die Umgebungsvariablen müssen in der Shell gesetzt sein (z. B. `set -a; source .env; set +a`).

## Befehle

| Befehl | Zweck |
|---|---|
| `pnpm build` | Alle Packages und Apps bauen |
| `pnpm lint` / `pnpm typecheck` | Statische Prüfungen |
| `pnpm test --concurrency=1` | Unit- und Integrationstests (brauchen PostgreSQL und Redis). `DATABASE_URL` muss auf eine Datenbank mit Namen `*_test` zeigen, da die Tests sie leeren. |
| `pnpm e2e` | Playwright gegen einen frisch gestarteten Stack mit leerer Datenbank (`docker compose down -v && docker compose up -d --wait`), Adresse über `JOTION_E2E_URL`, Standard http://localhost:8080 |
| `pnpm format` | Prettier |
| `pnpm db:migrate:dev` | Neue Migration aus Schemaänderung erzeugen |

## Aufbau

```
apps/web       Next.js-Oberfläche (App Router, next-intl, next-themes)
apps/api       NestJS mit Fastify, Prefix /api
apps/worker    BullMQ-Worker, Heartbeat in Redis
packages/shared  Gemeinsame Konstanten, Branding, Health-Typen; @jotion/shared/env nur serverseitig
packages/db    Prisma-Schema, Migrationen, Client unter generated/client
packages/ui    Design-Tokens, Logo, Basiskomponenten
packages/config  TypeScript-Presets
packages/query   Filter-/Sortier-AST nach SQL (Kysely), Cursor, JS-Referenz, Typwechsel-Regeln
packages/formula Formelsprache: Lexer, Pratt-Parser, Typprüfer, Interpreter (Browser und Server)
packages/compute Rollups und Formeln berechnen, speichern, über Relationen weiterreichen
```

## Datenbanken (Phase 4)
- Abfragen auf Datenbankzeilen nur über `@jotion/query` (`compileRowQuery`, `compileCountQuery`, `compileCalculationQuery`). Werte aus Nutzereingaben gehen nur als Parameter ins SQL; `sql.raw` nur für feste Fragmente und intern erzeugte Aliase.
- Neue Formelfunktionen kommen in `packages/formula/src/builtins.ts` (Typregel und Auswertung) und brauchen Fälle im Katalog `catalog.test.ts`. Ergebnisse von Formeln und Rollups schreibt nur `@jotion/compute`; nach Änderungen an Zeilen oder Schema ruft die API `ComputeService` auf (Abhängige im Worker, in API-Tests direkt über `JOTION_COMPUTE_INLINE`).
- Jede neue Filter- oder Sortierregel braucht die gleiche Semantik in der JS-Referenz (`reference.ts`). Die Vergleichstests in `packages/query/src/compile.test.ts` laufen mit fast-check gegen PostgreSQL und vergleichen beide.
- Der Leistungstest `apps/api/test/databases-perf.test.ts` legt 50.000 Zeilen an und prüft p95 unter 300 ms (dauert etwa 30 Sekunden).

## Inhalte (Phase 3)
- Neue Editor-Knoten: Schema in `packages/editor/src/nodes/*`, Eintrag in `jotionExtensions` und `BLOCK_NODE_TYPES`, Text und Eigenschaften in der Projektion (`projection.ts`), Test in `content.test.ts` (Schema, Yjs-Rundreise, Projektion). React-Ansicht in `apps/web/src/components/editor/content-views.tsx`.
- URLs aus Knotenattributen beim Darstellen immer prüfen (`safeMediaSrc`, `safeExternalUrl`, `resolveEmbed`); neue Embed-Anbieter nur in `packages/editor/src/embeds.ts` mit Test.
- Einfügen: `@jotion/editor/paste` (nur im Browser, ESM). Gespeicherte Zwischenablagen für Tests liegen in `packages/editor/src/paste-fixtures` (von Prettier ausgenommen).
- Serverseitige Abrufe nur über `SafeHttpClient` (`apps/api/src/common/safe-http.ts`). Für Tests mit lokalem Server `JOTION_SSRF_ALLOWLIST=127.0.0.1`.
- ENV: `JOTION_MAX_UPLOAD_MB` (Standard 100), `JOTION_SSRF_ALLOWLIST` (Standard leer).
- E2E: `tests/e2e/content.spec.ts` richtet selbst ein oder meldet sich an und läuft daher auch allein. Mehrere Stacks parallel: `docker compose -p <name>` und `JOTION_COMPOSE_PROJECT=<name>` für den Neustart-Test.
- Im Entwicklungsmodus (`next dev`) blieb der Speicherstatus bei Browser-Tests auf "offline" (Ursache noch offen); Browser-Tests daher gegen einen Produktions-Build oder den Docker-Stack laufen lassen.

## Konventionen
- Texte in der Oberfläche nur über `apps/web/messages/{de,en}.json`. Ein Test prüft, dass beide Sprachen dieselben Schlüssel haben.
- Konfiguration nur über `@jotion/shared/env` (Zod-validiert, unterstützt `*_FILE` für Docker Secrets). Fehlermeldungen nennen Schlüssel, nie Werte.
- Datenbankänderungen nur über Prisma-Migrationen, nur vorwärts.
- Keine Em-Dashes in Texten und Übersetzungen (wird für Übersetzungen per Test geprüft).

## Migrationen erzeugen
`prisma migrate diff` bzw. `migrate dev` kennt einige von Hand gepflegte Datenbankobjekte nicht und schlägt vor, sie zu löschen. Diese Zeilen **immer aus neuen Migrationen entfernen**:
- Index `pages_path_gist_idx` (GiST auf dem ltree-Pfad)
- Index `pages_title_trgm_idx` (Trigramm-Suche auf Titeln)
- Trigger und Funktionen `jotion_pages_*` (Seitenbaum)
- Phase 3: Funktion `jotion_unaccent` sowie die Ausdrucksindizes `blocks_search_idx`, `blocks_plain_text_trgm_idx` und `pages_title_unaccent_trgm_idx` (Volltextsuche). Prisma zeigt Ausdrucksindizes derzeit nicht im Diff, sollten sie dort auftauchen, ebenfalls entfernen.

Ein Test in `packages/db` prüft, dass die Indizes vorhanden sind.

## Editor und Yjs
- `packages/editor` wird als ESM (für die Web-App) und CommonJS (für API und Worker) gebaut. Nie beide Formate im selben Prozess laden: doppelte Kopien von yjs oder ProseMirror führen zu Fehlern wie "Yjs was already imported" oder "Adding different instances of a keyed plugin".
- Die Vitest-Konfiguration der API lädt das Editor-Package deshalb direkt aus `src`.
- E2E-Tests mit Server-Neustart laufen nur mit `JOTION_E2E_DOCKER=1`.
