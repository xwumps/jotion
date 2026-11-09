# Import und Export

## Importieren

Seitenleiste → **Importieren**, Datei auswählen oder hineinziehen, Ziel wählen (Team oder privat).

| Datei                       | Ergebnis                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.md`, `.markdown`, `.txt`  | eine Seite. Überschriften, Listen, To-dos, Zitate, Code, Tabellen, Links und Formatierung bleiben erhalten. Die erste Überschrift wird zum Titel. |
| `.csv`                      | eine Datenbank. Spaltentypen werden erkannt: Zahl, Datum, Checkbox, Auswahl, Mehrfachauswahl, URL, E-Mail, sonst Text.                            |
| `.zip` mit Markdown-Dateien | Seitenbaum nach der Ordnerstruktur, Bilder werden hochgeladen                                                                                     |
| `.zip` aus Notion           | siehe unten                                                                                                                                       |

Nach dem Import öffnet sich die erste angelegte Seite. Eine Meldung nennt, wie viele Seiten, Datenbanken, Zeilen und Bilder importiert wurden, und weist auf Probleme hin.

### Von Notion umziehen

1. In Notion: Seite (oder ganzer Workspace) → `…` → **Export** → Format **Markdown & CSV**, "Unterseiten einbeziehen" an.
2. Die heruntergeladene ZIP-Datei unverändert in Jotion importieren.

Übernommen werden:

- der Seitenbaum mit allen Unterseiten und ihrem Inhalt,
- Datenbanken aus den CSV-Dateien, mit erkannten Spaltentypen und den Inhalten der Zeilen-Seiten,
- Bilder,
- Links zwischen den Seiten (zeigen danach auf die neuen Jotion-Seiten).

Nicht übernommen werden Relationen, Rollups und Formeln (sie kommen als Text an), Kommentare und verschachtelte Datenbanken innerhalb von Zeilen.

Grenzen für eine ZIP-Datei: höchstens 5.000 Dateien und 500 MB entpackt.

## Exportieren

Seitenoptionen (`…` oben rechts):

| Export                    | Ergebnis                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Markdown**              | ZIP mit der Seite und allen Unterseiten als `.md`, Bilder im Ordner `_dateien/`, Datenbanken als CSV |
| **HTML**                  | wie Markdown, aber als `.html`-Dateien, zum Beispiel zum Archivieren                                 |
| **CSV** (bei Datenbanken) | alle Zeilen mit allen Properties, öffnet sich in Excel und LibreOffice mit Umlauten                  |
| **PDF**                   | über Drucken (Strg+P) und "Als PDF speichern"                                                        |

Exportiert wird nur, was du sehen darfst. Gesperrte Unterseiten fehlen im Export.

Ein Markdown-Export lässt sich wieder in Jotion importieren.

## Vollständige Sicherung

Export und Import sind für einzelne Seiten und Umzüge gedacht. Eine vollständige Sicherung des Servers mit allen Workspaces, Rechten, Verlauf und Dateien leistet der Dienst `backup`, siehe [Sicherungen](Sicherungen).
