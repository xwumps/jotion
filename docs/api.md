# REST-API

Jotion hat eine JSON-API unter `<JOTION_PUBLIC_URL>/api`. Die Oberfläche benutzt dieselbe API.
Für Skripte und andere Programme gibt es persönliche API-Tokens (Phase 12).

## Anmeldung mit API-Token

1. In Jotion: Einstellungen → Konto → API-Tokens → Token erstellen.
2. Das Token (beginnt mit `jtn_`) wird nur einmal angezeigt. Es wie ein Passwort aufbewahren.
3. Bei jeder Anfrage mitsenden:

```bash
curl -H "Authorization: Bearer jtn_…" https://jotion.example.de/api/auth/me
```

Regeln:

- Ein Token handelt mit den Rechten seines Kontos (Workspaces, Freigaben, Zugriffsstufen).
- **Nur lesen**: `GET`-Anfragen und die Abfragen von Datenbanken, die einen Filter per `POST`
  mitschicken (`/query`, `/calculate`, `/chart`, `/groups`). Alles andere wird mit 403 abgelehnt.
- **Lesen und schreiben**: alle Anfragen, die das Konto auch in der Oberfläche darf.
- Nie mit Token: Konto und Anmeldung (`/api/auth/*`, außer `GET /api/auth/me`), Token-Verwaltung
  (`/api/me/tokens`), Admin-Bereich (`/api/admin/*`) und die Anmeldung bei Integrationen.
- Höchstens 600 Anfragen je Minute und Token (danach Status 429).
- Abgelaufene oder widerrufene Tokens und Tokens deaktivierter Konten liefern 401.
- Gespeichert wird nur ein SHA-256-Hash. Ein verlorenes Token lässt sich nicht wiederherstellen,
  nur widerrufen und neu anlegen.

## Antworten und Fehler

Antworten sind JSON. Fehler haben die Form `{"error": {"code": "<code>", "message": "<Text>"}}`
(bei ungültigen Eingaben zusätzlich `details`) mit diesen Statuscodes:

| Status | Code | Bedeutung |
|---|---|---|
| 400 | `bad_request` | Anfrage nicht ausführbar |
| 401 | `unauthenticated` | nicht angemeldet, Token ungültig |
| 403 | `forbidden` | angemeldet, aber nicht erlaubt (z. B. lesendes Token, Stufe "ansehen") |
| 404 | `not_found` | nicht vorhanden oder kein Lesezugriff (Existenz wird nicht verraten) |
| 409 | `conflict` | Zustand passt nicht (z. B. Seite im Papierkorb) |
| 422 | `validation_failed` | Eingabe ungültig (`details` nennt die Felder) |
| 429 | `rate_limited` | zu viele Anfragen |

IDs sind UUIDs. Zeitpunkte sind ISO 8601 in UTC.

## Wichtige Endpunkte

### Konto und Workspaces

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/auth/me` | eigenes Konto und Workspaces |
| GET | `/api/workspaces/{ws}/sidebar` | Seitenbaum (Team, privat, mit mir geteilt) |
| GET | `/api/workspaces/{ws}/search?q=` | Schnellsuche über Titel |
| GET | `/api/workspaces/{ws}/search/content?q=` | Volltextsuche |
| GET | `/api/workspaces/{ws}/members` | Mitglieder |

### Seiten

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/api/workspaces/{ws}/pages` | Seite anlegen (`title`, `scope` `TEAM`/`PRIVATE`, `parentId`) |
| GET | `/api/pages/{id}` | Seite mit Rechten und Pfad |
| PATCH | `/api/pages/{id}` | Titel, Symbol, Titelbild, Einstellungen |
| GET | `/api/pages/{id}/children` | Unterseiten |
| GET | `/api/pages/{id}/content` | Inhalt als ProseMirror-JSON |
| GET | `/api/pages/{id}/export?format=markdown\|html` | Export (Phase 12) |
| POST | `/api/pages/{id}/move` | verschieben |
| DELETE | `/api/pages/{id}` | in den Papierkorb |
| GET | `/api/pages/{id}/comments` | Kommentare |
| POST | `/api/pages/{id}/comments` | kommentieren (`body`, optional `blockId`, `threadId`) |
| GET | `/api/pages/{id}/history` | Versionen |

### Datenbanken

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/api/workspaces/{ws}/databases` | Datenbank anlegen |
| GET | `/api/databases/{id}` | Schema, Properties, Ansichten |
| POST | `/api/databases/{id}/query` | Zeilen abfragen (`filter`, `sorts`, `limit`, `cursor`) |
| POST | `/api/databases/{id}/rows` | Zeile anlegen (`title`, `values` je Property-ID) |
| GET | `/api/databases/{id}/rows/{rowId}` | Zeile |
| PATCH | `/api/databases/{id}/rows/{rowId}/properties` | Werte ändern (`values`) |
| POST | `/api/databases/{id}/rows/trash` | Zeilen in den Papierkorb (`rowIds`) |
| GET | `/api/databases/{id}/export.csv` | Export als CSV (Phase 12) |

### Import (Phase 12)

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/api/workspaces/{ws}/import` | Datei hochladen (multipart, Feld `file`): `.md`, `.csv` oder `.zip` (Notion-Export oder Markdown-Ordner); Formularfelder `scope`, `parentId` |

## Beispiele

Zeile in eine Datenbank schreiben (Token mit Schreibrecht):

```bash
curl -X POST https://jotion.example.de/api/databases/<db-id>/rows \
  -H "Authorization: Bearer $JOTION_TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "Milch kaufen"}'
```

Alle Zeilen lesen:

```bash
curl -X POST https://jotion.example.de/api/databases/<db-id>/query \
  -H "Authorization: Bearer $JOTION_TOKEN" -H "Content-Type: application/json" -d '{}'
```

Seite als Markdown sichern:

```bash
curl -H "Authorization: Bearer $JOTION_TOKEN" \
  "https://jotion.example.de/api/pages/<id>/export?format=markdown" -o seite.zip
```
