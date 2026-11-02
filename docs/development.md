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
| `pnpm test --concurrency=1` | Unit- und Integrationstests (brauchen PostgreSQL und Redis) |
| `pnpm e2e` | Playwright gegen laufenden Stack (`JOTION_E2E_URL`, Standard http://localhost:8080) |
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
```

## Konventionen
- Texte in der Oberfläche nur über `apps/web/messages/{de,en}.json`. Ein Test prüft, dass beide Sprachen dieselben Schlüssel haben.
- Konfiguration nur über `@jotion/shared/env` (Zod-validiert, unterstützt `*_FILE` für Docker Secrets). Fehlermeldungen nennen Schlüssel, nie Werte.
- Datenbankänderungen nur über Prisma-Migrationen, nur vorwärts.
- Keine Em-Dashes in Texten und Übersetzungen (wird für Übersetzungen per Test geprüft).
