## I. Teststrategie (Übersicht)
| Ebene | Werkzeug | Schwerpunkte |
|---|---|---|
| Unit | Vitest, fast-check | Formel, Query-Compiler, Mapping, Ownership-Logik, Fractional Index, Datums-/Zeitzonenlogik |
| Integration/DB | Vitest + Testcontainers (Postgres, Redis, Radicale) | Repositories, Migrationen, Transaktionen, Constraints (Dubletten-Constraint), Relation-Integrität |
| API | Supertest gegen NestJS-App | Contracts, Validierung, Berechtigungsmatrix |
| Collab | Mehrere Yjs-Clients gegen echten Hocuspocus | Konvergenz, Persistenz, Crash-Recovery |
| Sync | Fixtures + Radicale + Fault Injection | Dedupe, Idempotenz, Konfliktmatrix, Abbruch mitten im Run, Zeitzonen/RRULE |
| E2E | Playwright | Kern-Workflows, Datenverlust-Suite, DnD, Visual Regression |
| Performance | Playwright-Traces, k6, EXPLAIN-Snapshots | Große Seiten, große DBs, Charts, Sync von 10.000 Einträgen |
| Docker | CI-Job `compose up` + Smoke + Backup/Restore + Upgrade von letzter Version | Betriebssicherheit |
| Security | ZAP Baseline, Trivy, Dependency-Audit, SSRF-Tests | Härtung |
Kritische Invarianten werden als eigene Test-Suites mit Namen `critical/*` geführt und blockieren jeden Merge: Editor-Datenverlust, Sync-Dubletten, Sync-Überschreiben, Relation-Integrität, Migrations-Datenintegrität.

---

