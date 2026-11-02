## A. Produktanalyse: Feature-Matrix

Legende Stufe: G = Grundfunktion, E = Erweitert, P = Professionell (bei Notion teils Bezahl-Tarif), S = Später.
Komplexität: 1 (gering) bis 5 (sehr hoch). Phase: siehe Roadmap (E).

### A.1 Workspace und Seiten
| Funktion | Stufe | Komplex. | Phase |
|---|---|---|---|
| Registrierung, Login, Sessions | G | 2 | 1 |
| Mehrere Workspaces, Workspace-Switcher | G | 2 | 1 |
| Seiten, Unterseiten, beliebig tiefe Verschachtelung | G | 3 | 1 |
| Sidebar mit Baum, Drag-and-drop zum Verschieben | G | 3 | 1 |
| Seiten-Icons (Emoji, Upload, Icon-Set), Cover-Bilder | G | 2 | 1 |
| Breadcrumbs | G | 1 | 1 |
| Favoriten | G | 1 | 1 |
| Zuletzt geöffnet | G | 1 | 1 |
| Papierkorb (Soft Delete, Wiederherstellen, endgültig löschen, Auto-Purge nach 30 Tagen) | G | 2 | 1 |
| Archiv (ausgeblendet, durchsuchbar, nicht gelöscht) | E | 2 | 1 |
| Seite duplizieren (inkl. Unterseiten, Inline-DBs) | E | 3 | 3 |
| Seite verschieben (in andere Seite, anderen Workspace) | G | 3 | 1/10 |
| Seitenoptionen: Schriftart (Default/Serif/Mono), Kleine Schrift, Volle Breite, Sperren | G | 1 | 2 |
| Schnellsuche (Cmd+K / Cmd+P) | G | 2 | 2 |
| Globale Volltextsuche mit Filtern (Workspace, Ersteller, Datum, Typ) | E | 3 | 3 |
| Seitenhistorie (Versionen, Diff-Ansicht, Wiederherstellen) | P | 4 | 10 |
| Teilen: Mitglieder, Gäste, Rollen pro Seite | E | 4 | 10 |
| Öffentlich veröffentlichen (Read-only Link, optional Ablaufdatum, Passwort) | P | 3 | 10 |
| Templates (Seiten-Templates, Template-Galerie, eigene Templates) | E | 3 | 9 |
| Import/Export (Markdown, HTML, CSV, PDF, Notion-Export-ZIP) | E | 4 | 12 |
| Teamspaces (Bereiche innerhalb Workspace mit eigenen Rechten) | P | 3 | S |
| Benachrichtigungen / Inbox (Mentions, Kommentare, Erinnerungen) | E | 3 | 10 |
| Dark Mode, Light Mode, System | G | 1 | 0 |
| Mobile-taugliche Web-UI (responsive), PWA | E | 3 | 12 |
| Offline-Modus (lokale Yjs-Persistenz in IndexedDB) | S | 4 | S |
| KI-Funktionen (optional, lokales LLM via Ollama) | S | 4 | S |

### A.2 Block-Editor
| Funktion | Stufe | Komplex. | Phase |
|---|---|---|---|
| Text, H1 bis H3, Bullet, nummeriert, To-do | G | 2 | 2 |
| Toggle, Toggle-Überschriften | G | 3 | 2 |
| Callout (Icon, Farbe), Zitat, Trennlinie | G | 2 | 2 |
| Codeblock (Syntax-Highlighting via Shiki/lowlight, Sprachwahl, Copy, Wrap) | G | 2 | 2 |
| Bild, Video, Audio, Datei, PDF-Embed (Upload, URL, Resize, Caption) | G | 3 | 3 |
| Bookmark (Link-Preview via serverseitigem OpenGraph-Fetch) | E | 2 | 3 |
| Embeds (YouTube, Figma, Maps usw. via oEmbed-Whitelist, iframe sandbox) | E | 3 | 3 |
| Einfache Tabelle (nicht DB) mit Header-Zeile/Spalte | G | 3 | 3 |
| Spaltenlayouts (2 bis 5 Spalten, Breite ziehbar) | E | 4 | 3 |
| Inhaltsverzeichnis, Breadcrumb-Block | G | 2 | 3 |
| Unterseiten-Block, Link-to-Page | G | 2 | 2 |
| Inline-Datenbank, Linked Database (Ansicht auf bestehende DB) | E | 4 | 4 |
| Synced Blocks (Original + Referenzen, überall editierbar) | P | 5 | 10 |
| Mathematische Formeln (KaTeX, Block und Inline) | E | 2 | 3 |
| Mentions: @Person, @Seite, @Datum/Erinnerung | G | 3 | 3 |
| Kommentare (inline am Text, Seitenkommentare, Threads, Auflösen) | E | 4 | 10 |
| Buttons-Block (führt Aktionen aus) | P | 3 | 9 |
| Chart-Block (eingebettetes Diagramm) | P | 3 | 7 |
| Slash-Menü mit Suche, Markdown-Shortcuts | G | 3 | 2 |
| Drag-Handle (6-Punkte), Drag-and-drop von Blöcken, auch in Spalten | G | 4 | 2/3 |
| Block-Menü: Löschen, Duplizieren, Umwandeln in, Farbe, Link kopieren, Verschieben nach | G | 3 | 2 |
| Inline-Formatierung: Fett, Kursiv, Unterstrichen, Durchgestrichen, Code, Link, Text-/Hintergrundfarbe | G | 2 | 2 |
| Mehrfachauswahl von Blöcken (Shift-Klick, Rechteckauswahl mit Maus) | E | 4 | 3 |
| Copy & Paste (HTML, Markdown, Plaintext, aus Notion/Google Docs/Word, Bilder aus Zwischenablage) | G | 4 | 3 |
| Undo/Redo (lokal, Yjs UndoManager, nur eigene Änderungen) | G | 3 | 2 |
| Tastaturkürzel (Notion-kompatibel, Übersicht mit Cmd+/) | G | 2 | 2 |
| Autosave (kontinuierlich, kein Speichern-Button) | G | 3 | 2 |
| Realtime-Kollaboration, Live-Cursor, Präsenz | E | 4 | 2 (Basis) / 10 (UI) |
| Performance mit großen Dokumenten (5.000+ Blöcke) | G | 4 | 3 |

### A.3 Datenbanken
| Funktion | Stufe | Komplex. | Phase |
|---|---|---|---|
| Full-Page- und Inline-Datenbanken | G | 3 | 4 |
| Property-Typen: Title, Text, Number (Formate), Select, Multi-Select, Status, Date (Bereich, Uhrzeit, Zeitzone, Erinnerung), Person, Checkbox, URL, Email, Phone, Files, Created Time, Created By, Last Edited Time, Last Edited By, Unique ID | G | 4 | 4 |
| Relation (ein-/zweiseitig, auch zur selben DB, Limit 1 oder viele) | E | 4 | 6 |
| Rollup (alle Aggregationen inkl. Prozent, Datumsbereich, Show original) | E | 4 | 6 |
| Formula (Notion-Formula-2.0-kompatible Sprache, Listen, Lets, Typisierung) | P | 5 | 6 |
| Button-Property, Verification (S) | P | 3 | 9 |
| Zeile als Seite öffnen (Seitenansicht, Seitenleiste, Modal) | G | 3 | 4 |
| Filter (einfach, verschachtelte UND/ODER-Gruppen bis Tiefe 3) | E | 4 | 4/6 |
| Sortierung (mehrstufig, manuelle Reihenfolge) | G | 3 | 4 |
| Gruppierung (in Table, List, Board, Gallery, Timeline) | E | 3 | 5 |
| Mehrere gespeicherte Ansichten pro DB, Ansichten-Tabs | G | 3 | 4 |
| Spaltenberechnungen (Count, Sum, Avg, Median, Min, Max, Range, % leer usw.) | E | 3 | 4 |
| Datenbank-Templates (Zeilen-Templates, Default-Template pro Ansicht, wiederkehrende Templates) | P | 3 | 9 |
| Datenbank-Automatisierungen | P | 5 | 9 |
| Datenbankübergreifende Auswertungen (Charts/Widgets über mehrere DBs, Relation-basierte Rollups) | P | 4 | 7 |
| Zeilen-Sperren (Lock database), Property-Sichtbarkeit pro Ansicht | E | 2 | 5 |
| CSV-Import/-Export | E | 3 | 12 |
| Sub-Items (Zeilen-Hierarchie), Abhängigkeiten in Timeline | P | 4 | S |

### A.4 Ansichten
| Ansicht | Kernfunktionen | Komplex. | Phase |
|---|---|---|---|
| Table | Virtualisiert, Spalten ziehen/resizen/fixieren, Zellen-Editoren, Wrap, Berechnungen | 4 | 4 |
| Board/Kanban | Gruppierung nach Status/Select/Multi-Select/Person/Relation/Checkbox/Datum; DnD zwischen und in Spalten; eigene Spalten anlegen/umbenennen/ausblenden/einfärben; Spalten-Reihenfolge; Kartenvorschau (Cover, Seiteninhalt, Datei-Property, keine); Kartengröße S/M/L; sichtbare Properties pro Board; Sub-Gruppierung (Swimlanes); Filter, Sort; Karte als Peek öffnen und direkt bearbeiten; mehrere Boards auf dieselbe DB; Spaltenzähler und Aggregationen | 5 | 5 |
| List | Kompakt, Gruppierung, Properties rechts | 2 | 5 |
| Gallery | Kartenraster, Cover-Quelle, Kartengröße, Fit/Crop | 2 | 5 |
| Calendar | Monat/Woche, nach Date-Property, DnD von Einträgen, mehrtägige Einträge, Wochenenden ein/aus, Klick zum Anlegen | 4 | 5 |
| Timeline | Gantt-artig, Zoom (Stunde bis Jahr), Start/Ende ziehen und resizen, Tabelle links ein/aus, Gruppierung, Heute-Linie | 5 | 5 |
| Chart | Siehe A.5 | 4 | 7 |

### A.5 Charts (hohe Priorität)
| Funktion | Komplex. | Phase |
|---|---|---|
| Typen: Bar vertikal/horizontal, gestapelt (absolut/100 %), Line, Area (gestapelt), Pie, Donut, Scatter, Progress (Balken/Ring), KPI-Karte (mit Vergleich zum Vorzeitraum, Sparkline) | 4 | 7 |
| Datenquelle: beliebige DB oder bestehende DB-Ansicht (übernimmt deren Filter) | 3 | 7 |
| X-Achse: beliebige Property (Datum mit Bucketing Tag/Woche/Monat/Quartal/Jahr, Select, Person, Text, Relation) | 4 | 7 |
| Y-Achse: Count, Count unique, Sum, Avg, Median, Min, Max über Number/Formula/Rollup | 3 | 7 |
| Gruppierung (Serie), Filter, Sortierung (nach X oder Y), Top-N, leere Gruppen ein/aus | 3 | 7 |
| Datumsbereiche (fix, relativ: letzte 7/30/90 Tage, dieses Jahr), kumulativ | 3 | 7 |
| Darstellung: Farbpalette, Select-Farben übernehmen, Legende, Datenlabels, Achsentitel, Gitter, Glättung, Höhe | 2 | 7 |
| Einbetten als Block in Seiten, Widget im Dashboard | 2 | 7 |
| Live-Update bei DB-Änderungen (Realtime-Invalidierung) | 3 | 7 |
| Klick auf Segment öffnet gefilterte Zeilenliste (Drilldown) | 3 | 7 |
| Export PNG/SVG/CSV | 2 | 12 |

### A.6 Dashboard (Startseite)
Widgets: Anstehend (aggregiert aus mehreren DBs mit Date-Property), Überfällig, Kanban (eingebettete Board-Ansicht), Chart, Kalender (Mini/Agenda), KPI-Karte, Zuletzt bearbeitet, Favoriten, Schnellnotiz, Link-Liste. Frei verschiebbar und skalierbar (12-Spalten-Raster), pro Nutzer oder als geteiltes Dashboard. Komplexität 4, Phase 7.

### A.7 Automatisierungen, Buttons, Templates (Phase 9)
- Trigger: Zeile erstellt, Property geändert (mit Bedingung), Zeitplan (Cron/täglich/wöchentlich), Datum erreicht (z. B. Fälligkeit minus 1 Tag), Sync-Ereignis, Button-Klick.
- Aktionen: Property setzen, Zeile/Seite erstellen (aus Template), Seite bearbeiten in anderer DB (über Relation), Benachrichtigung senden, E-Mail (SMTP, optional), Webhook aufrufen (ausgehend, signiert), Kommentar schreiben.
- Variablen: Trigger-Zeile, Auslöser-Person, Now, Formel-Ausdrücke.
- Ausführungsprotokoll pro Automation, Fehleranzeige, Schleifenschutz (max. Kettentiefe 5).
Komplexität 5.

### A.8 Benutzerverwaltung (Phase 1/10)
Rollen Workspace: Owner, Member (Admin und Guest später). Seiten sind entweder **privat** oder **im Team geteilt**; pro Seite optional Einschränkung auf Can edit / Can comment / Can view für einzelne Mitglieder. Einladungen per Link. 2FA (TOTP) optional. Gruppen, Gäste, OIDC-Login, Audit-Log und Admin-Statistiken: Später. Einfacher Owner-Bereich: Mitglieder, Speicherbelegung, Backups.

---

