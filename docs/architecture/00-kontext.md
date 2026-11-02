## 0. Kontext

Das Arbeitsverzeichnis `/home/user` ist leer (kein Repo, kein Bestandscode). Es handelt sich um ein Greenfield-Projekt.
Ziel: eine selbst gehostete, möglichst funktionsgleiche Notion-Alternative mit dem Namen **Jotion**, inklusive
Block-Editor, Datenbanken mit 7 Ansichten, Charts, Dashboard, Automatisierungen, Templates und einem generischen
Integrationsframework (erste Integration: IServ). Diese Phase ist reine Planung. Nach Freigabe wird dieser Plan als
Dokumentation in ein neues Repo `/home/user/jotion` geschrieben (`docs/architecture/*.md`, `docs/adr/*.md`,
`docs/roadmap.md`), danach setzt ein Coding-Agent Phase für Phase um.

**Transparente Annahmen**
- A1: **Privater Gebrauch und ein privates Team** (1 bis ca. 20 Nutzer, ein Server: Homeserver, NAS, kleiner VPS). Kein öffentliches Angebot, keine Fremdnutzer, keine Weitergabe. Die Architektur bleibt sauber modular, wird aber auf **eine Instanz** ausgelegt (keine horizontale Skalierung nötig).
- A1a: Zugriff typischerweise über LAN, VPN (z. B. Tailscale/WireGuard) oder eine eigene Domain. Registrierung ist standardmäßig geschlossen, neue Personen kommen nur per Einladung.
- A2: Realtime-Kollaboration (mehrere Personen gleichzeitig auf einer Seite) ist gewünscht. Sie wird von Anfang an architektonisch eingeplant, weil sie gleichzeitig das stärkste Mittel gegen Datenverlust ist.
- A3: UI-Sprache: Deutsch und Englisch (i18n ab Phase 0), Default Deutsch.
- A4: Keine Pflicht-Cloud-Dienste. Alles läuft in Docker Compose. Optionale Dienste (SMTP, S3) sind konfigurierbar.
- A5: Die IServ-Schnittstellen in Abschnitt D sind aus öffentlich bekannten IServ-Funktionen abgeleitet und **müssen gegen die Zielinstanz verifiziert werden** (Phase 8, Spike). Es werden keine undokumentierten Endpunkte angenommen.

---


### Auswirkungen des privaten Einsatzes
- **Weniger Dienste**: der Collab-Server (Hocuspocus) läuft im selben Prozess wie die API. Container: `caddy`, `web`, `api`, `worker`, `postgres`, `redis`.
- **Einfacheres Rechtemodell**: Workspace-Rollen Owner/Member, dazu private Seiten und Teilen innerhalb des Teams. Gäste, Gruppen, Teamspaces, Audit-Log und öffentliche Links werden auf "Später" verschoben.
- **Performance-Ziele** bleiben als Qualitätsmaßstab bestehen (große Seiten, große Datenbanken), Lasttests mit vielen gleichzeitigen Nutzern entfallen.
- **Marke und Lizenz** sind kein Thema, solange Jotion nicht veröffentlicht wird.
- **Unverändert wichtig**: kein Datenverlust, keine Dubletten bei der Synchronisation, Backups, sichere Speicherung der Zugangsdaten.
