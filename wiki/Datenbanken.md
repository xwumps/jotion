# Datenbanken

Eine Datenbank ist eine Sammlung von Einträgen (Zeilen) mit Eigenschaften (Properties). Jede Zeile ist zugleich eine Seite mit eigenem Inhalt.

## Anlegen

- `/datenbank ganzseitig`: eigene Seite, erscheint als Unterseite in der Seitenleiste.
- `/datenbank`: eingebettet in eine Seite.
- `/verknüpfte datenbank`: zeigt eine bestehende Datenbank mit eigenen Ansichten an einer weiteren Stelle.

Eine Zeile öffnet sich per Klick als Seitenleiste (rechts) oder als volle Seite. Oben stehen die Properties, darunter der Inhalt.

## Property-Typen

| Typ                                            | Hinweise                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| Titel                                          | Name der Zeile                                                       |
| Text, URL, E-Mail, Telefon                     |                                                                      |
| Zahl                                           | Formate: Zahl, Tausender, Prozent, Euro, Dollar, Pfund, Yen, Franken |
| Auswahl, Mehrfachauswahl                       | Optionen direkt in der Zelle anlegen, umbenennen, einfärben          |
| Status                                         | Optionen in den Gruppen "Zu erledigen", "In Bearbeitung", "Erledigt" |
| Datum                                          | Einzeln oder Zeitraum, mit oder ohne Uhrzeit, Zeitzone               |
| Person                                         | Mitglieder des Workspace                                             |
| Checkbox                                       |                                                                      |
| Dateien                                        | Links und hochgeladene Bilder                                        |
| Erstellt am / von, Zuletzt bearbeitet am / von | automatisch                                                          |
| ID                                             | fortlaufende Nummer mit Präfix, zum Beispiel `AUF-12`                |
| Relation                                       | Verknüpfung zu Zeilen einer (anderen) Datenbank                      |
| Rollup                                         | Auswertung über verknüpfte Zeilen                                    |
| Formel                                         | berechneter Wert                                                     |
| Button                                         | löst eine Automatisierung aus                                        |

Der Typ eines Properties lässt sich ändern. Werte werden dabei umgewandelt (zum Beispiel Text in Auswahl mit neuen Optionen), und die Änderung lässt sich rückgängig machen.

## Ansichten

Jede Datenbank kann mehrere Ansichten als Tabs haben, jede mit eigenen Filtern, Sortierungen und sichtbaren Properties. Neue Ansicht über "+" neben den Tabs.

| Ansicht        | Besonderheiten                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tabelle**    | Spalten ziehen, Breite ändern, fixieren, ausblenden; Zeilen von Hand sortieren; schnell auch bei 50.000 Zeilen                                                          |
| **Board**      | Kanban nach Status, Auswahl, Person, Datum und mehr; Karten zwischen Spalten ziehen; Swimlanes (Untergruppen); Kartenvorschau mit Bild; Zähler und Berechnung je Spalte |
| **Liste**      | kompakt, optional gruppiert                                                                                                                                             |
| **Galerie**    | Kartenraster mit Vorschau                                                                                                                                               |
| **Kalender**   | Monat oder Woche, mehrtägige Einträge als Balken, Einträge auf andere Tage ziehen                                                                                       |
| **Zeitleiste** | Zoom von Stunden bis Jahr, Balken verschieben und in der Länge ziehen, Gruppierung                                                                                      |
| **Diagramm**   | siehe unten                                                                                                                                                             |

**Sperren** (Ansichtseinstellungen): Properties und Ansichten sind fest, Einträge bleiben bearbeitbar.

## Filtern, sortieren, berechnen

- Filter mit UND/ODER und verschachtelten Gruppen, Datumsfilter auch relativ ("in den nächsten 7 Tagen").
- Mehrstufige Sortierung, Suche innerhalb der Ansicht.
- Berechnungen unter jeder Spalte: Anzahl, leere, eindeutige Werte, Summe, Durchschnitt, Median, Minimum, Maximum, Spannweite, frühestes und spätestes Datum, Anteil angehakt und andere.

## Relationen und Rollups

- Eine **Relation** verknüpft Zeilen mit Zeilen einer anderen (oder derselben) Datenbank, zum Beispiel Aufgaben mit Projekten. Zweiseitig legt sie in der Zieldatenbank automatisch das Gegenstück an. Begrenzung auf "eine Seite" möglich.
- Ein **Rollup** wertet ein Property der verknüpften Zeilen aus: zählen, summieren, Durchschnitt, frühestes Datum, Anteil erledigt und mehr.

## Formeln

Die Formelsprache entspricht Notion Formulas 2.0. Beispiele:

```
prop("Preis") * prop("Menge")
if(prop("Erledigt"), "✓", "offen")
dateBetween(prop("Fällig"), now(), "days")
prop("Tags").map(current.upper()).join(", ")
prop("Aufgaben").filter(current.prop("Erledigt")).length()
```

Es gibt Operatoren, `if`/`ifs`, `let`/`lets`, Listenfunktionen (`map`, `filter`, `find`, `some`, `every` mit `current` und `index`), Mathe-, Text- (auch reguläre Ausdrücke) und Datumsfunktionen sowie Zugriff auf Properties verknüpfter Zeilen. Der Editor schlägt Funktionen und Properties vor, zeigt Fehler mit Position und eine Vorschau für eine Zeile.

Formeln mit `now()` oder `today()` werden stündlich neu berechnet. Datumsfunktionen rechnen in der Zeitzone aus `JOTION_TIMEZONE`.

## Diagramme

Ansicht **Diagramm** oder Block `/diagramm` in einer Seite:

- Balken (vertikal, horizontal, gestapelt), Linie, Fläche, Kreis, Ring, Punkte, Fortschritt, Kennzahl mit Vergleich zum Vorzeitraum.
- X-Achse und Serie aus jedem gruppierbaren Property (Datum nach Tag, Woche, Monat, Quartal, Jahr), Wert als Anzahl, Summe, Durchschnitt und mehr.
- Filter der Ansicht gelten, Zeitraum wählbar (letzte 30 Tage, dieses Jahr und andere).
- Klick auf einen Balken oder ein Segment zeigt die zugehörigen Zeilen.

## Dashboard

Die Startseite eines Workspace ist ein Dashboard, persönlich oder für alle geteilt. Widgets: Anstehend und Überfällig (aus allen Datenbanken mit Datum), Board, Diagramm, Kalender, Kennzahl, zuletzt besucht, Favoriten, Schnellnotiz, Links. Widgets lassen sich frei verschieben und in der Größe ändern.
