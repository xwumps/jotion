## K. Verifikation des Plans / nächste Schritte nach Freigabe
1. Repo `/home/user/jotion` anlegen und diesen Plan in `docs/` aufteilen (Architektur, Datenmodell, Integrationen, ADRs je Entscheidung, Roadmap mit DoD-Checklisten).
2. Phase 0 umsetzen und mit `docker compose up` + Playwright-Smoke-Test prüfen (Shell mit Jotion-Branding im Browser, Screenshot).
3. Jede weitere Phase: Implementierung, `pnpm turbo lint typecheck test`, E2E, Docker-Smoke, Abgleich mit Akzeptanzkriterien dieser Datei.
