## G. Technische Entscheidungen (ADRs)
| # | Entscheidung | Begründung | Alternativen (verworfen) |
|---|---|---|---|
| 1 | Monorepo pnpm + Turborepo, TypeScript strict überall | Geteilte Schemas (Zod) zwischen Frontend, API, Worker; ein Stack für alle | Polyrepo; Go-Backend (Sync-Jobs sind I/O-gebunden, Node reicht; zweite Sprache erhöht Wartung) |
| 2 | Next.js (App Router) nur als UI-Schicht, separates NestJS-Backend (Fastify) | Langlebige Prozesse (WebSocket, Worker) passen nicht in Next.js-Route-Handler; klare Modulgrenzen, DI, Testbarkeit | Next.js API Routes (zu wenig Struktur für diesen Umfang); Hono/Fastify pur (weniger Struktur) |
| 3 | Tiptap v3 (ProseMirror) + eigene Notion-UX-Extensions | Volle Kontrolle über Schema und Verhalten, große Community, Yjs-Integration | BlockNote (schneller Start, aber weniger Kontrolle, Teile mit restriktiver Lizenz); Lexical (schwächere Kollaboration); Eigenbau (zu teuer) |
| 4 | **Yjs-Dokument pro Seite als Quelle der Wahrheit für Seiteninhalt**, Blöcke als abgeleitete Projektion | CRDT verhindert Datenverlust bei Offline/Mehrfach-Tabs, ermöglicht Realtime, Undo pro Nutzer; Projektion liefert SQL-Abfragbarkeit | Blöcke als Zeilen als Quelle (Notion-Stil): aufwendige Konfliktlogik, viele Writes, Realtime schwerer |
| 5 | Hocuspocus als Collab-Server, eingebettet im API-Prozess | Ausgereift, Auth-Hooks, Persistence-API; für ein privates Team reicht ein Prozess, Auslagerung später möglich | y-websocket (zu minimal), Liveblocks (Cloud) |
| 6 | Datenbank-Zeilen relational: typisiertes EAV `property_values` + `relation_links` + `computed_values` | SQL-Filter/Sort/Aggregation mit Indizes, keine Laufzeit-DDL, saubere Relationen | JSONB pro Zeile (Sort/Filter auf Zahlen/Datum langsamer, schwächere Typisierung); echte Tabelle pro DB (DDL-Migrationen zur Laufzeit, riskant) |
| 7 | Prisma für Schema/Migrationen/CRUD, Kysely für dynamische Queries | Prisma wie gewünscht, Kysely typisiert den Query-Compiler sicher | Nur Prisma (dynamisches SQL umständlich); Drizzle (gut, aber Vorgabe Prisma) |
| 8 | PostgreSQL 16 + FTS + pg_trgm für Suche | Keine Zusatzdienste; ausreichend für A1 | Meilisearch/Typesense (später optional als Plugin) |
| 9 | Redis + BullMQ für Queues, Pub/Sub, Rate-Limits | Etabliert, Repeatable Jobs, Concurrency-Kontrolle pro Connection | pg-boss (weniger Last auf Redis, aber Pub/Sub für Collab ohnehin nötig) |
| 10 | Transactional Outbox für Domänenevents | Konsistenz zwischen DB-Änderung und Realtime/Automationen | Direkt-Publish (Eventverlust bei Crash) |
| 11 | Apache ECharts für Charts | Alle geforderten Typen, Canvas-Performance, Theming/Dark Mode, Animationen, Apache-2.0 | Recharts (SVG, schwächer bei vielen Punkten, weniger Typen); Nivo; Visx (zu low-level); Chart.js (weniger flexibel) |
| 12 | TanStack Query/Table/Virtual, dnd-kit, react-grid-layout, date-fns | Bewährte, headless Bausteine passend zu Notion-Look | AG Grid (Lizenz, Fremdlook), FullCalendar (Styling schwer an Notion anpassbar) |
| 13 | Better Auth | Self-hosted, TS-nativ, 2FA, OIDC, Organisationen | Auth.js (schwächere Credentials/2FA-Story), Keycloak (schwergewichtig, optional als OIDC-Provider) |
| 14 | Storage-Abstraktion, Default lokales Volume | Keine Cloud-Pflicht; S3/MinIO optional | Pflicht-MinIO (mehr Betriebsaufwand) |
| 15 | Fractional Indexing für alle Reihenfolgen | Kein Umsortieren vieler Zeilen, konfliktarm | Integer-Positionen |
| 16 | Eigene Formelsprache mit isomorphem Interpreter | Sicherheit (kein eval), Notion-Kompatibilität, identische Ergebnisse Client/Server | JS-Sandbox (Sicherheitsrisiko) |
| 17 | Drei-Wege-Feldvergleich + Feld-Ownership für Sync | Schützt lokale Änderungen nachweisbar | Last-write-wins (überschreibt Nutzerdaten) |
| 18 | Caddy als Reverse Proxy | Auto-HTTPS, einfache Konfiguration, WebSocket out of the box | Traefik, nginx |

---

