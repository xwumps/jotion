## J. Offene Fragen und Risiken
| Prio | Risiko / Frage | Lösung / Vorgehen |
|---|---|---|
| Hoch | IServ: Welche Schnittstellen sind auf der Zielinstanz aktiv (CalDAV, iCal-Export, WebDAV)? Gibt es einen Export für das Aufgaben-Modul? | Phase-8-Spike mit Testzugang; Connector ist so gebaut, dass nur Fähigkeiten genutzt werden, die `testConnection` erkennt; Fallback manueller ICS/CSV-Import. |
| Hoch | IServ mit 2FA: funktioniert DAV-Login? App-Passwörter vorhanden? | Im Spike klären; sonst Hinweis im UI und Nutzung des Abo-/Export-Links. |
| Hoch | Komplexität Notion-Parität im Editor (Spalten, Mehrfachauswahl, Paste) | Früh (Phase 2/3) mit Fixture-Tests und klaren Akzeptanzkriterien; Spalten als eigene Node-Struktur `columnList > column`. |
| Hoch | Datenverlust im Editor | Yjs + IndexedDB + append-only Updates + Ack erst nach Commit + Snapshots + kritische E2E-Suite. |
| Hoch | Performance Formeln/Rollups bei großen, verketteten DBs | `computed_values` + inkrementeller Dependency-Graph; Limits (max. Kettentiefe, Timeout pro Formel); Benchmarks in CI. |
| Mittel | Konsistenz Yjs-Dokument vs. Block-Projektion (verzögert) | Projektion ist eventual consistent und jederzeit aus Yjs neu aufbaubar (`rebuild-projection`-Job); UI liest Inhalt nie aus der Projektion. |
| Mittel | Rechte-Leaks über Suche, Backlinks, Mentions, Rollups über unberechtigte DBs | Alle Leseabfragen über `PermissionService`-Filter; Rollups zeigen bei fehlendem Zugriff "Kein Zugriff"; generierte Leak-Tests. |
| Mittel | Zeitzonen, Ganztags-Termine, RRULE-Ausnahmen beim Sync | ical.js + rrule, Speicherung UTC + `v_tz`, Fixture-Katalog mit Randfällen (DST, EXDATE, RECURRENCE-ID). |
| Mittel | OAuth-Connectoren self-hosted: Nutzer braucht eigene Google/Microsoft-App | Assistent mit Schritt-für-Schritt-Doku; Redirect-URL wird angezeigt. |
| Mittel | Speicherwachstum `page_doc_updates` und Snapshots | Kompaktierung, Retention-Policy, Monitoring der Tabellengröße im Admin-Bereich. |
| Entfällt | Markenrecht: "Jotion" ähnelt "Notion" | Bei rein privatem Einsatz kein Thema. Branding nutzt trotzdem nur eigenes Design. Nur relevant, falls Jotion je veröffentlicht wird. |
| Entfällt | Lizenzwahl für das Projekt | Privates Repo, keine Lizenz nötig. Abhängigkeiten bleiben Open Source mit freien Lizenzen. |
| Offen | Mehrsprachigkeit über DE/EN hinaus? Mobile Apps nativ? KI-Funktionen? | Als "Später" eingeplant; Architektur blockiert nichts davon. |

---

