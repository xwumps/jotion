# Integrationen

Integrationen holen Termine, Aufgaben, Mails, Dateien und Nachrichten aus anderen Diensten als Zeilen in eine Jotion-Datenbank und halten sie aktuell. Jede Person verbindet ihre eigenen Konten.

## Verbindung anlegen

1. Einstellungen → **Integrationen** → "Hinzufügen" und Dienst wählen.
2. Zugangsdaten eingeben (oder bei Google, Microsoft und Dropbox anmelden) und "Verbindung testen".
3. Je Quelle (Kalender, Aufgabenliste, Ordner …) eine Ziel-Datenbank wählen oder neu anlegen lassen.
4. **Mapping**: welches Feld in welches Property kommt, mit Vorschau der ersten 10 Einträge. Vorlagen wie `{{categories}}: {{title}}` sind möglich.
5. Synchronisierung alle 15 Minuten bis 24 Stunden oder nur von Hand ("Jetzt synchronisieren").

## Wie synchronisiert wird

- **Nur lesend**: Jotion holt Daten, schreibt aber nie zurück.
- **Keine Dubletten**: Einträge werden über ihre ID beim Dienst wiedererkannt.
- **Lokale Änderungen**: je Feld einstellbar, ob die Quelle gewinnt, deine Änderung erhalten bleibt oder der Wert nur einmal übernommen wird. Widersprüche erscheinen als Konflikt mit "Quelle übernehmen" oder "Lokal behalten".
- **Gelöscht in der Quelle**: Zeile nur als entfernt markieren, archivieren oder in den Papierkorb legen (einstellbar). Beim Trennen einer Verbindung bleiben die Zeilen erhalten oder werden archiviert, gelöscht werden sie nie.
- **Verlauf** zeigt jeden Lauf mit Zahlen und Fehlern je Eintrag.
- Bei falschen Zugangsdaten geht die Verbindung auf "Fehler" und pausiert, bis neue Daten gespeichert sind. Nach 5 Fehlschlägen in Folge pausiert sie ebenfalls.
- Zugangsdaten liegen verschlüsselt mit dem `JOTION_MASTER_KEY` in der Datenbank.

## Dienste

### Kalender und Aufgaben

| Dienst               | Anmeldung                                                                                 | Hinweise                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **iCal-Feed**        | Adresse (`https://`, `webcal://`), optional Benutzer und Passwort                         | z. B. Schulferien, Abfallkalender, Feeds anderer Programme                                 |
| **CalDAV**           | Server-Adresse, Benutzer, Passwort                                                        | Termine und Aufgaben (VTODO), z. B. Radicale, Baïkal, mailbox.org                          |
| **IServ**            | Adresse der Schule, IServ-Konto                                                           | Kalender und Aufgaben über CalDAV. Ein Test gegen eine echte IServ-Instanz steht noch aus. |
| **Apple iCloud**     | Apple-ID und **app-spezifisches Passwort** (appleid.apple.com → Anmeldung und Sicherheit) | Kalender und Erinnerungen                                                                  |
| **Nextcloud**        | Adresse, Benutzer, **App-Passwort** (Nextcloud → Einstellungen → Sicherheit)              | Kalender, Aufgaben und Dateien eines Ordners                                               |
| **Google Kalender**  | Google-Anmeldung                                                                          | siehe OAuth unten                                                                          |
| **Outlook-Kalender** | Microsoft-Anmeldung                                                                       | Microsoft 365 und Outlook.com                                                              |

Wiederholte Termine werden als Einzeltermine oder als eine Zeile übernommen (einstellbar), Zeitzonen und ganztägige Termine bleiben korrekt.

### Mails

| Dienst                      | Was                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| **Gmail**                   | Posteingang oder markierte Nachrichten (Betreff, Absender, Datum, Vorschau, gelesen), höchstens 200 |
| **Outlook / Microsoft 365** | Posteingang der letzten 30 Tage                                                                     |

Es werden nur Metadaten übernommen, keine Mail-Inhalte und keine Anhänge.

### Dateien

| Dienst                                      | Was                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| **Google Drive**, **OneDrive**, **Dropbox** | Dateien eines Ordners als Zeilen (Name, Pfad, Größe, Typ, geändert, Link) |
| **WebDAV**                                  | beliebiger WebDAV-Ordner, zum Beispiel IServ-Dateien                      |
| **Nextcloud**                               | Dateien eines Ordners                                                     |

Auch hier nur Metadaten, keine Dateiinhalte.

### Telegram

1. Bei Telegram mit **@BotFather** einen Bot anlegen und das Token kopieren.
2. In Jotion eine Telegram-Verbindung anlegen, Token eintragen und die **erlaubten Absender** (Benutzername oder Nutzer-ID) angeben.
3. Nachrichten erlaubter Absender an den Bot werden zu Zeilen, zum Beispiel als schnelle Aufgaben-Inbox. Nachrichten anderer werden verworfen.

Jotion fragt neue Nachrichten selbst ab und braucht dafür keine öffentliche Adresse. Umgekehrt kann eine [Automatisierung](Vorlagen-und-Automatisierungen) über denselben Bot Nachrichten senden.

## OAuth-Apps für Google, Microsoft und Dropbox

Weil Jotion selbst gehostet ist, braucht jede Instanz eigene OAuth-Apps. Das richtet einmal der Admin ein. Ohne App ist der Dienst in der Auswahl ausgegraut.

Rückleitungs-URL (überall exakt so eintragen):

```
<JOTION_PUBLIC_URL>/api/integrations/oauth/callback
```

**Google** (console.cloud.google.com → APIs und Dienste)

1. Google Calendar API, Gmail API und Google Drive API aktivieren.
2. OAuth-Zustimmungsbildschirm mit den Bereichen `calendar.readonly`, `gmail.readonly`, `drive.metadata.readonly`. Im Testmodus die eigenen Konten als Testnutzer eintragen (für den privaten Gebrauch ausreichend).
3. Anmeldedaten → OAuth-Client-ID → Typ "Webanwendung", Rückleitungs-URL eintragen.
4. In der `.env`: `JOTION_GOOGLE_CLIENT_ID`, `JOTION_GOOGLE_CLIENT_SECRET`.

**Microsoft** (entra.microsoft.com → App-Registrierungen)

1. Neue Registrierung, Plattform "Web" mit der Rückleitungs-URL.
2. Delegierte API-Berechtigungen: `Calendars.Read`, `Mail.Read`, `Files.Read`, `offline_access`, `User.Read`.
3. Zertifikate und Geheimnisse → neuer geheimer Clientschlüssel.
4. In der `.env`: `JOTION_MICROSOFT_CLIENT_ID`, `JOTION_MICROSOFT_CLIENT_SECRET` und `JOTION_MICROSOFT_TENANT` (`common` für private und Organisationskonten, `consumers`, `organizations` oder eine Mandanten-ID).

**Dropbox** (dropbox.com/developers/apps)

1. App mit Zugriff "Full Dropbox" oder "App folder".
2. Berechtigungen `account_info.read` und `files.metadata.read`, Redirect-URI eintragen.
3. In der `.env`: `JOTION_DROPBOX_CLIENT_ID` (Secret optional).

Danach `docker compose up -d`. Abgelaufene Zugriffe erneuert Jotion selbst. Widerruft jemand die Freigabe beim Anbieter, zeigt die Verbindung "Neu anmelden".

## Server im eigenen Netz

Aus Sicherheitsgründen ruft Jotion nur öffentliche Adressen ab. Eine Nextcloud, ein CalDAV-Server oder ein iCal-Feed im Heimnetz muss in der `.env` freigegeben werden:

```
JOTION_SSRF_ALLOWLIST=nextcloud.lan,192.168.1.0/24
```
