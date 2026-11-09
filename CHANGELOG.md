# Änderungen

Alle nennenswerten Änderungen an Jotion. Versionen nach [Semantic Versioning](https://semver.org/lang/de/):
eine neue Hauptversion kann Handarbeit beim Update verlangen (steht dann unter "Update-Hinweise").

Update: `scripts/update.sh` (siehe [Betrieb](docs/operations.md)). Vor jedem Update wird automatisch
gesichert; zurück geht es mit `scripts/restore.sh latest` und dem alten Stand.

## [Unveröffentlicht]

### Neu

- Erstes Release mit allen Phasen der Roadmap: Seiten mit Block-Editor und Echtzeit-Bearbeitung,
  Datenbanken mit Tabelle, Board, Liste, Galerie, Kalender, Zeitleiste und Diagrammen, Relationen,
  Rollups und Formeln, Dashboard, Vorlagen und Automatisierungen, Teilen mit Rechten, Kommentare und
  Seitenhistorie, Integrationen (iCal, CalDAV, IServ, iCloud, Nextcloud, WebDAV, Google, Microsoft
  365, Dropbox, Telegram), Import und Export, REST-API mit Tokens, Admin-Bereich, Metriken.
- Sicherungen werden mit einem aus `JOTION_MASTER_KEY` abgeleiteten Schlüssel verschlüsselt;
  `scripts/restore.sh --verify` prüft eine Sicherung, ohne sie einzuspielen.
- Fertige Images für x86 (amd64) und ARM (arm64) in der GitHub Container Registry; Update mit
  `scripts/update.sh` lädt sie statt selbst zu bauen.
- Hinweis auf neue Versionen im Admin-Bereich (abschaltbar mit `JOTION_UPDATE_CHECK=false`).

### Update-Hinweise

- Der Backup-Dienst hat jetzt ein eigenes Image (`jotion/backup`), statt Skripte aus dem Repository
  einzubinden. Beim ersten Update wird es gebaut oder geladen.
