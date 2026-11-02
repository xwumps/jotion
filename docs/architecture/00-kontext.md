## 0. Kontext

Das Arbeitsverzeichnis `/home/user` ist leer (kein Repo, kein Bestandscode). Es handelt sich um ein Greenfield-Projekt.
Ziel: eine selbst gehostete, möglichst funktionsgleiche Notion-Alternative mit dem Namen **Jotion**, inklusive
Block-Editor, Datenbanken mit 7 Ansichten, Charts, Dashboard, Automatisierungen, Templates und einem generischen
Integrationsframework (erste Integration: IServ). Diese Phase ist reine Planung. Nach Freigabe wird dieser Plan als
Dokumentation in ein neues Repo `/home/user/jotion` geschrieben (`docs/architecture/*.md`, `docs/adr/*.md`,
`docs/roadmap.md`), danach setzt ein Coding-Agent Phase für Phase um.

**Transparente Annahmen**
- A1: Zielgruppe sind kleine bis mittlere Installationen (1 bis ca. 500 Nutzer, bis ca. 1 Mio. Blöcke pro Workspace). Architektur ist horizontal skalierbar, aber nicht auf Notion-Scale ausgelegt.
- A2: Realtime-Kollaboration (mehrere Personen gleichzeitig auf einer Seite) ist gewünscht. Sie wird von Anfang an architektonisch eingeplant, weil sie gleichzeitig das stärkste Mittel gegen Datenverlust ist.
- A3: UI-Sprache: Deutsch und Englisch (i18n ab Phase 0), Default Deutsch.
- A4: Keine Pflicht-Cloud-Dienste. Alles läuft in Docker Compose. Optionale Dienste (SMTP, S3) sind konfigurierbar.
- A5: Die IServ-Schnittstellen in Abschnitt D sind aus öffentlich bekannten IServ-Funktionen abgeleitet und **müssen gegen die Zielinstanz verifiziert werden** (Phase 8, Spike). Es werden keine undokumentierten Endpunkte angenommen.

---

