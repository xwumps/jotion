# Vorlagen und Automatisierungen

## Seitenvorlagen

Seitenleiste → **Vorlagen** öffnet die Galerie. Mitgeliefert (auf Deutsch und Englisch):

Aufgaben, Stundenplan, Hausaufgaben-Tracker, Projekt-Roadmap, Notizen und Wiki.

Eine Vorlage legt Seiten samt Datenbanken, Ansichten und Beispielen an, wahlweise privat oder im Team. Platzhalter `@heute` und `@ersteller` werden dabei durch das Datum und dich ersetzt.

**Eigene Vorlage**: Seitenoptionen → "Als Vorlage". Sie erscheint danach in der Galerie.

## Zeilen-Vorlagen

In einer Datenbank öffnet der Pfeil neben **Neu** die Zeilen-Vorlagen:

- Vorlage anlegen und wie eine Zeile bearbeiten (Properties und Inhalt, zum Beispiel eine Checkliste).
- Eine Vorlage als **Standard** festlegen: "Neu" nutzt sie dann automatisch. "Leere Zeile" bleibt möglich.
- **Wiederholung**: täglich, wöchentlich oder monatlich zu einer Uhrzeit wird automatisch eine Zeile aus der Vorlage angelegt (zum Beispiel ein wöchentlicher Wochenplan).
- **Dynamische Werte** (in den Seiteneinstellungen der Vorlage): heute, jetzt, Ersteller.

## Automatisierungen

In einer Datenbank öffnet der **Blitz** in der Werkzeugleiste die Automatisierungen. Eine Automatisierung besteht aus:

**Wenn** (Auslöser)

- Zeile erstellt
- Property geändert (bestimmtes Property oder beliebiges)
- Zeitplan (täglich, wöchentlich, monatlich; optional für jede passende Zeile)
- Datum erreicht (mit Versatz in Tagen, zum Beispiel "1 Tag vor Fällig")
- Button geklickt

**Nur wenn** (optional): Bedingung mit demselben Filter-Editor wie in den Ansichten.

**Dann** (eine oder mehrere Aktionen)

- **Property setzen**, in dieser Zeile oder in verknüpften Zeilen. Werte: fester Wert, leeren, heute (± Tage), jetzt, auslösende Person, umschalten, Formel, Text mit Platzhaltern.
- **Zeile anlegen**, optional aus einer Zeilen-Vorlage und mit Verknüpfung zur auslösenden Zeile.
- **Webhook aufrufen**: POST mit JSON an eine Adresse, signiert mit HMAC-SHA256 im Header `X-Jotion-Signature`.
- **Telegram-Nachricht senden** über einen eigenen Telegram-Bot (siehe [Integrationen](Integrationen#telegram)).

Beispiel: _Wenn_ "Status" geändert, _nur wenn_ Status ist "Erledigt", _dann_ "Abgeschlossen am" auf heute setzen.

Automatisierungen laufen mit den Rechten der Person, die sie angelegt hat. Das **Protokoll** zeigt jede Ausführung mit Status und Ergebnis je Aktion. Ketten (eine Automatisierung löst die nächste aus) stoppen nach 5 Schritten, damit keine Endlosschleifen entstehen.

## Buttons

- **Button-Property** in einer Datenbank: ein Knopf in jeder Zeile, der eine Automatisierung mit Auslöser "Button geklickt" für diese Zeile startet.
- **Button-Block** in einer Seite (`/button`): startet eine Automatisierung einer gewählten Datenbank, zum Beispiel "Neue Besprechung anlegen".
