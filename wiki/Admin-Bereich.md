# Admin-Bereich

Instanz-Admins sehen in Jotion unter **Einstellungen → Server** den Zustand des Servers und verwalten Konten. Die Person, die Jotion eingerichtet hat, ist Admin. Weitere Admins ernennt ein Admin dort.

Instanz-Admin ist etwas anderes als Owner eines Workspace: Owner verwalten ihren Workspace (Mitglieder, Rollen, Einladungen), Admins den ganzen Server.

## Zustand

- Version und ob eine neue verfügbar ist ([Updates](Updates))
- Prüfungen: Datenbank, Redis, Hintergrund-Dienst
- Anzahl Konten, Workspaces, Seiten, Datenbanken, Dateien
- Speicher: Dateien und Datenbank

## Sicherungen

Liste der Sicherungen mit Anlass und Größe, Ergebnis der letzten Sicherung und "Jetzt sichern". Wiederherstellen geht bewusst nur auf der Kommandozeile, siehe [Sicherungen](Sicherungen).

## Konten

- **Admin-Recht** geben oder entziehen.
- **Sperren**: Die Person kann sich nicht mehr anmelden, laufende Sitzungen und ihre API-Tokens werden sofort beendet. Ihre Seiten bleiben erhalten. Entsperren macht das rückgängig (Tokens bleiben widerrufen).
- Das eigene Konto lässt sich nicht sperren oder herabstufen, und es bleibt immer mindestens ein aktiver Admin.

## Metriken für Prometheus

Mit `JOTION_METRICS_TOKEN=<geheimes Token>` in der `.env` liefert `/api/metrics` Kennzahlen im Prometheus-Format: Version, Laufzeit, Konten und aktive Sitzungen, Seiten, Datenbankzeilen, Dateien und Speicher, Integrationen nach Status, fehlgeschlagene Synchronisierungen, Zeit der letzten erfolgreichen Sicherung.

Beispiel für `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: jotion
    scheme: https
    metrics_path: /api/metrics
    authorization:
      credentials: <geheimes Token>
    static_configs:
      - targets: ['jotion.example.org']
```

Ohne Token antwortet der Endpunkt mit 404.
