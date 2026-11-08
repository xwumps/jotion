# Berechtigungsmatrix

Generiert aus `apps/api/test/sharing.test.ts` (`JOTION_WRITE_MATRIX=1`). HTTP-Status für ein
Mitglied mit der jeweiligen Stufe auf einer Team-Seite: 2xx erlaubt, 403 sichtbar aber nicht
erlaubt, 404 unsichtbar.

| Aktion | full | edit | comment | view | none |
|---|---|---|---|---|---|
| Seite lesen | 200 | 200 | 200 | 200 | 404 |
| Inhalt lesen | 200 | 200 | 200 | 200 | 404 |
| In Suche gefunden | 200 | 200 | 200 | 200 | 404 |
| Titel ändern | 200 | 200 | 403 | 403 | 404 |
| Unterseite anlegen | 201 | 201 | 403 | 403 | 404 |
| Zeile lesen (Datenbank darunter) | 200 | 200 | 200 | 200 | 404 |
| Zeile anlegen (Datenbank darunter) | 201 | 201 | 403 | 403 | 404 |
| Freigabe ändern | 200 | 403 | 403 | 403 | 404 |
| Lese-Link erzeugen | 201 | 403 | 403 | 403 | 404 |
| In den Papierkorb | 204 | 204 | 403 | 403 | 404 |
