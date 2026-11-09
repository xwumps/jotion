# REST-API

Jotion hat eine JSON-API unter `<JOTION_PUBLIC_URL>/api`. Die Oberfläche benutzt dieselbe API. Für Skripte, Kurzbefehle auf dem Handy oder andere Programme gibt es persönliche API-Tokens.

Die vollständige Referenz steht in [`docs/api.md`](https://github.com/xwumps/jotion/blob/main/docs/api.md).

## Token anlegen

1. Einstellungen → **Konto** → **API-Tokens**.
2. Name eingeben, Recht wählen (**nur lesen** oder **lesen und schreiben**), optional ein Ablaufdatum.
3. Das Token beginnt mit `jtn_` und wird **nur einmal** angezeigt. Wie ein Passwort aufbewahren.

Bei jeder Anfrage mitsenden:

```bash
curl -H "Authorization: Bearer jtn_…" https://jotion.example.org/api/auth/me
```

## Regeln

- Ein Token handelt mit den Rechten deines Kontos: dieselben Workspaces, Seiten und Zugriffsstufen.
- **Nur lesen** erlaubt ausschließlich `GET`-Anfragen. Abfragen von Datenbankzeilen (`POST …/query`) brauchen deshalb derzeit ein Token mit Schreibrecht.
- Nie mit Token erreichbar: Anmeldung und Konto (außer `GET /api/auth/me`), Token-Verwaltung, Admin-Bereich, Anmeldung bei Integrationen. Ein gestohlenes Token kann also weder das Passwort ändern noch neue Tokens anlegen.
- Höchstens 600 Anfragen pro Minute und Token.
- Widerrufen jederzeit unter Einstellungen → Konto. Wird ein Konto gesperrt, werden seine Tokens gelöscht.

## Beispiele

Zeile in eine Datenbank schreiben:

```bash
curl -X POST https://jotion.example.org/api/databases/<db-id>/rows \
  -H "Authorization: Bearer $JOTION_TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "Milch kaufen"}'
```

Alle Zeilen lesen:

```bash
curl -X POST https://jotion.example.org/api/databases/<db-id>/query \
  -H "Authorization: Bearer $JOTION_TOKEN" -H "Content-Type: application/json" -d '{}'
```

Seite samt Unterseiten als Markdown herunterladen:

```bash
curl -H "Authorization: Bearer $JOTION_TOKEN" \
  "https://jotion.example.org/api/pages/<id>/export?format=markdown" -o seite.zip
```

Die ID einer Seite oder Datenbank steht in der Adresszeile: `…/w/<workspace-id>/p/<seiten-id>`.

## Antworten und Fehler

Antworten sind JSON. Fehler haben die Form `{"error": {"code": "…", "message": "…"}}`.

| Status | Bedeutung                                                    |
| ------ | ------------------------------------------------------------ |
| 401    | nicht angemeldet, Token ungültig oder abgelaufen             |
| 403    | nicht erlaubt (zum Beispiel lesendes Token, Stufe "ansehen") |
| 404    | nicht vorhanden oder kein Zugriff                            |
| 422    | Eingabe ungültig (`details` nennt die Felder)                |
| 429    | zu viele Anfragen                                            |
