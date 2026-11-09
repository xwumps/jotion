# Fehlerbehebung

## Erste Schritte bei Problemen

Zustand aller Dienste:

```bash
docker compose ps
```

Protokolle eines Dienstes (zum Beispiel `api`, `web`, `worker`, `migrate`, `backup`):

```bash
docker compose logs --tail 100 api
```

Als Admin zeigt Einstellungen → Server, ob Datenbank, Redis und Hintergrund-Dienst erreichbar sind.

## Anmelden geht, aber Speichern schlägt fehl ("Fremder Ursprung")

Die Adresse im Browser passt nicht zu `JOTION_PUBLIC_URL`. Schreibende Anfragen werden aus Sicherheitsgründen nur vom eingetragenen Ursprung angenommen, und auch die Echtzeit-Bearbeitung hängt daran. `JOTION_PUBLIC_URL` in der `.env` auf genau die Adresse setzen, die im Browser steht (mit Schema und Port, ohne `/` am Ende), dann `docker compose up -d`.

## Seite lädt, aber der Editor bleibt bei "Verbinde …"

Gleiche Ursache wie oben, oder ein eigener Reverse Proxy leitet WebSockets nicht weiter. Der Pfad `/collab` braucht WebSocket-Upgrade, `/api/workspaces/<id>/events` Server-Sent Events ohne Pufferung.

## Port 8080 ist schon belegt

In der `.env` `JOTION_HTTP_PORT` (und `JOTION_PUBLIC_URL`) auf einen freien Port ändern, dann `docker compose up -d`.

## `migrate` startet nicht, Jotion bleibt aus

```bash
docker compose logs migrate
```

Meist ist die Datenbank nicht erreichbar oder eine Migration ist an alten Daten gescheitert. Bitte mit dem Protokoll ein [Issue](https://github.com/xwumps/jotion/issues) anlegen. Notfalls die Sicherung vor dem Update einspielen ([Updates](Updates#zurück-auf-die-alte-version)).

## Eigener Build scheitert

- **Zertifikatsfehler bei `pnpm install`**: Ein Proxy im Netz bricht TLS auf. Siehe [Installation](Installation#build-hinter-einem-tls-abfangenden-proxy).
- **`toomanyrequests` beim Laden von `node:22-alpine`**: Docker Hub begrenzt anonyme Downloads. Später erneut versuchen, bei Docker Hub anmelden (`docker login`) oder auf fertige Images wechseln.
- **Speicher voll**: Alte Build-Daten entfernen mit `docker builder prune`.

## Sicherung fehlgeschlagen

Einstellungen → Server zeigt die Fehlermeldung, Details in `docker compose logs backup`. Häufig ist der Speicher voll. Mit `bash scripts/backup.sh` lässt sich die Sicherung von Hand wiederholen.

## Wiederherstellen: "passt zu keinem Master Key"

Die Sicherung wurde mit einem anderen `JOTION_MASTER_KEY` erstellt. Den Schlüssel von damals in `JOTION_MASTER_KEY_PREVIOUS` eintragen (kommagetrennt, mehrere möglich) und erneut versuchen. Ohne diesen Schlüssel lässt sich die Sicherung nicht öffnen.

## Integration: "Adresse nicht erlaubt" bei einem Server im eigenen Netz

Jotion ruft aus Sicherheitsgründen nur öffentliche Adressen ab. Server im eigenen Netz (zum Beispiel eine Nextcloud zu Hause) in `JOTION_SSRF_ALLOWLIST` eintragen. Siehe [Integrationen](Integrationen).

## Google, Microsoft oder Dropbox: Fehler bei der Rückleitung (redirect_uri)

Die Rückleitungs-URL bei der OAuth-App muss exakt `<JOTION_PUBLIC_URL>/api/integrations/oauth/callback` lauten, also mit derselben Adresse wie in der `.env`.

## Telegram-Bot meldet einen Fehler

Für den Bot ist vermutlich ein Webhook gesetzt. Jotion fragt Nachrichten selbst ab und braucht keinen. Webhook entfernen: `https://api.telegram.org/bot<TOKEN>/deleteWebhook` im Browser aufrufen.

## Passwort vergessen

Ein Owner des Workspace erzeugt unter Einstellungen → Mitglieder einen Link zum Zurücksetzen. Einen Versand per E-Mail gibt es noch nicht.
