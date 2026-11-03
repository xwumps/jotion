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
```

## Datenbanken (Phase 4)
- Abfragen auf Datenbankzeilen nur über `@jotion/query` (`compileRowQuery`, `compileCountQuery`, `compileCalculationQuery`). Werte aus Nutzereingaben gehen nur als Parameter ins SQL; `sql.raw` nur für feste Fragmente und intern erzeugte Aliase.
- Jede neue Filter- oder Sortierregel braucht die gleiche Semantik in der JS-Referenz (`reference.ts`). Die Vergleichstests in `packages/query/src/compile.test.ts` laufen mit fast-check gegen PostgreSQL und vergleichen beide.
- Der Leistungstest `apps/api/test/databases-perf.test.ts` legt 50.000 Zeilen an und prüft p95 unter 300 ms (dauert etwa 30 Sekunden).

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

Ein Test in `packages/db` prüft, dass die Indizes vorhanden sind.

## Editor und Yjs
- `packages/editor` wird als ESM (für die Web-App) und CommonJS (für API und Worker) gebaut. Nie beide Formate im selben Prozess laden: doppelte Kopien von yjs oder ProseMirror führen zu Fehlern wie "Yjs was already imported" oder "Adding different instances of a keyed plugin".
- Die Vitest-Konfiguration der API lädt das Editor-Package deshalb direkt aus `src`.
- E2E-Tests mit Server-Neustart laufen nur mit `JOTION_E2E_DOCKER=1`.
