## D. Integrationskonzept

### D.1 Generisches Framework
**Connector-Interface (`packages/integrations-sdk`)**
```
ConnectorDefinition {
  type, displayName, icon, version
  configSchema: Zod (nicht geheim), secretSchema: Zod (geheim)
  authKind: 'basic' | 'token' | 'oauth2' | 'none'
  capabilities: { kinds: [...], incremental: bool, write: bool, webhooks: bool }
  testConnection(ctx): Result<{ accountLabel }>
  discoverSources(ctx): ExternalSource[]
  pull(ctx, source, cursor): AsyncIterable<ExternalRecord | Tombstone> + newCursor
  push?(ctx, source, change)            // für spätere bidirektionale Connectoren
  oauth?: { authorizeUrl, scopes, exchange, refresh }
}
ExternalRecord { externalId, version, updatedAt, kind, fields: Record<string, TypedValue>, raw? }
```
- `ctx` liefert: entschlüsselte Secrets, `SafeHttpClient` (mit Timeout, Retry mit Exponential Backoff + Jitter, Rate-Limit pro Connection, Respekt von `Retry-After`), Logger mit Redaction, AbortSignal.
- **Standard-Felder pro Kind** (Normalisierung): Event `{title, description, start, end, allDay, location, organizer, url, categories, status}`, Task `{title, description, due, completed, priority, categories, course/subject?}`, File `{name, path, size, mime, modifiedAt, downloadUrl}`.
- **Mapping-Engine**: Nutzer wählt Ziel-DB (bestehend oder "neue DB mit Vorschlag anlegen"), ordnet Felder Properties zu. Transformationen: `text→select` (Option per Name, optional Auto-Anlage), `datetime→date` (Zeitzone), `bool→checkbox`, `bool→status (mapping)`, `string→url`, Template-String (`{{subject}}: {{title}}`).
- **Ownership pro Feld**:
  - `remote`: Remote-Wert gewinnt, außer lokal geändert und Policy = preserve (siehe unten).
  - `local_preserve` (Default): Drei-Wege-Vergleich: `base = external_field_state.last_synced_value`, `local = aktueller Wert`, `remote = neuer Wert`. Wenn `local == base` → Remote übernehmen. Wenn `local != base` und `remote == base` → nichts tun. Wenn beide geändert → lokale Änderung behalten, Konflikt protokollieren (`sync_conflicts`), UI zeigt Hinweis mit "Remote übernehmen".
  - `once`: nur beim Anlegen setzen, danach nie überschrieben.
  - Nicht gemappte Properties werden vom Sync niemals berührt. Der Seiteninhalt (Editor) wird nur beim Anlegen befüllt (Beschreibung), danach nie überschrieben.
- **Dedupe**: Upsert ausschließlich über `external_entities` mit Unique-Constraint; Verarbeitung pro Connection serialisiert (BullMQ-Job-Id = connectionId, Concurrency 1, plus PostgreSQL Advisory Lock). Jede Record-Verarbeitung in eigener Transaktion: Zeile anlegen + `external_entities` schreiben atomar. Bei Abbruch ist der Run idempotent wiederholbar.
- **Löschungen**: Remote gelöscht → `remote_deleted_at` setzen und Policy: `mark` (Default, Property "Sync-Status = Entfernt"), `archive` oder `trash`. Niemals Hard Delete.
- **Lokale Löschung** einer synchronisierten Zeile → Entity bleibt als "suppressed", wird nicht neu angelegt.
- **Fehlerbehandlung**: Fehler pro Record werden gesammelt, Run läuft weiter; Auth-Fehler setzen Connection auf `error` und stoppen den Zeitplan bis Nutzeraktion; nach 5 aufeinanderfolgenden Fehlern Pause + Benachrichtigung.

### D.2 IServ-Anbindung
**Was über IServ öffentlich bekannt ist (zu verifizieren, Annahme A5)**
| Schnittstelle | Zweck | Status / Annahme |
|---|---|---|
| CalDAV (Kalender-Modul) | Termine lesen (und schreiben) mit Standard-Clients wie Thunderbird, iOS, DAVx⁵ | IServ dokumentiert CalDAV-Anbindung für das Kalendermodul. Genaue URL (typisch unter `https://<server>/caldav/...`) per Discovery (`/.well-known/caldav`, PROPFIND current-user-principal) ermitteln, nicht hart codieren. |
| iCalendar-Export / Abo-Link | Read-only Kalenderfeed | Je nach Version/Konfiguration als Export bzw. Abo verfügbar; vom Nutzer als URL einfügbar. |
| CardDAV | Adressbuch | Für Jotion nicht erforderlich, später optional (Person-/Kontakt-DB). |
| WebDAV (Dateien) | Zugriff auf eigene/Gruppen-Dateien | Von IServ für Dateizugriff angeboten (Admin kann deaktivieren). Für Datei-Import/Verlinkung (Phase 11). |
| IMAP/SMTP | E-Mail | Möglich, nicht im Scope. |
| OAuth2/OpenID Connect (IServ als Identity Provider) | SSO-Login in Jotion | Nur wenn der Schuladmin Jotion als Anwendung registriert. Nutzbar als Login-Provider, nicht als Daten-API. |
| Modul "Aufgaben" | Hausaufgaben, Abgaben | **Keine öffentlich dokumentierte Drittanbieter-API bekannt.** Wird nicht durch Scraping oder Umgehung angebunden. Optionen siehe unten. |

Hinweise: 2FA am IServ-Konto kann Basic-Auth für DAV verhindern; ob App-Passwörter angeboten werden, ist instanzabhängig (offene Frage). Admins können Module und DAV-Zugriff deaktivieren.

**IServ-Connector (Komposition)**
- `config`: `baseUrl` (Pflicht, validiert, z. B. `https://s5069.schuzldock.de` nur als Platzhalter im UI), `username`, Auswahl der Quellen.
- `secrets`: Passwort bzw. App-Passwort/Token (verschlüsselt).
- `testConnection`: 1) HTTPS erreichbar, Zertifikat gültig; 2) CalDAV-Discovery; 3) Authentifizierter PROPFIND; Ergebnis: Kontoname, gefundene Kalender, erkannte Fähigkeiten (CalDAV ja/nein, WebDAV ja/nein, VTODO in Kalendern ja/nein).
- **Quellen**:
  1. CalDAV-Kalender (VEVENT → Kind Event; VTODO, falls vorhanden → Kind Task). Inkrementell via `sync-collection` (RFC 6578) wenn unterstützt, sonst `ctag`/`etag`-Vergleich.
  2. iCal-Feed-URL (Fallback, read-only, Vollabgleich mit Hash pro UID).
  3. Aufgaben: nur über eine offiziell vorhandene Exportmöglichkeit der Zielinstanz (z. B. falls Aufgaben in einem Kalender/Feed erscheinen) oder über **manuellen Datei-Import** (CSV/ICS) mit derselben Mapping-Engine und External-ID (UID/stabile Spalte). Wenn eine offizielle API künftig verfügbar ist, wird ein zusätzlicher Source-Typ ergänzt, ohne Kernänderung.
- **External ID**: `UID` + bei wiederkehrenden Terminen `RECURRENCE-ID` (Expansion konfigurierbar: Serie als eine Zeile oder Instanzen im Zeitfenster -30/+180 Tage). Fallback bei fehlender UID: SHA-256 über Quelle + DTSTART + SUMMARY (markiert als "schwache ID").
- **Mapping-Beispiel (Default-Vorschlag)**: SUMMARY → Title, DTSTART/DTEND/DUE → Date (Bereich), CATEGORIES bzw. abgeleitetes Fach → Select "Fach" (Auto-Optionen), DESCRIPTION → Seiteninhalt bei Anlage, LOCATION → Text, STATUS/COMPLETED → Checkbox/Status, URL → URL, zusätzlich System-Properties "Quelle" und "Sync-Status".
- **UI**: Einstellungen → Integrationen → IServ: Serveradresse, Benutzername, Passwort/Token, "Verbindung testen", Quellen-Auswahl, Ziel-DB + Mapping-Editor mit Vorschau (erste 10 Datensätze), Sync an/aus, Intervall (15 min bis 24 h), "Jetzt synchronisieren", letzte Synchronisation + Statistik, Fehlerliste mit Details, Konfliktliste, "Verbindung trennen" (Optionen: synchronisierte Zeilen behalten (Default) oder archivieren).
- **Rechtliches/Datenschutz**: Hinweis im UI, dass Schuldaten verarbeitet werden; Daten verlassen die eigene Instanz nicht.

### D.3 Weitere Connectoren (konzeptionell, Phase 11)
| Dienst | Protokoll | Auth | Kinds |
|---|---|---|---|
| Apple Kalender / iCloud | CalDAV (`caldav.icloud.com`) | Apple-ID + app-spezifisches Passwort | Event, Task (Erinnerungen via VTODO, eingeschränkt) |
| Nextcloud | CalDAV, CardDAV, WebDAV | App-Passwort / Login Flow v2 | Event, Task, File |
| Google Calendar, Gmail, Drive | REST APIs | OAuth 2.0 (eigene Client-ID durch Admin, da self-hosted) | Event, Message (read-only), File |
| Microsoft Outlook, OneDrive | Microsoft Graph, Delta Queries | OAuth 2.0 (Entra-App durch Admin) | Event, Message, File |
| Dropbox | API v2, `list_folder/continue` | OAuth 2.0 PKCE | File |
| Telegram | Bot API (Long Polling, kein öffentlicher Webhook nötig) | Bot-Token | Message (z. B. "Nachricht → Inbox-DB", Benachrichtigungen ausgehend) |
OAuth-Callback-URL wird aus `JOTION_PUBLIC_URL` gebildet (`/api/integrations/oauth/callback`). Tokens verschlüsselt, Erneuerung bei Bedarf im Sync (API oder Worker). Umgesetzt in Phase 11, siehe Roadmap und ADR 110 bis 118.

---

