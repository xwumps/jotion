# Sicherungen

Der Dienst `backup` sichert jeden Tag Datenbank und hochgeladene Dateien in ein Archiv im Docker-Volume `backups`. Sicherungen entstehen außerdem vor jedem Update und auf Knopfdruck.

## Was gesichert wird

Ein Archiv `jotion-<Datum>-<Uhrzeit>-<Anlass>.tar` enthält:

- die komplette Datenbank (`pg_dump`),
- alle hochgeladenen Dateien,
- ein Manifest mit Jotion-Version (Stand der Datenbank-Migrationen) und Prüfsummen.

Anlass ist `auto` (täglich), `manual` (von Hand) oder `pre-update` (vor einem Update).

## Verschlüsselung

Sicherungen sind standardmäßig verschlüsselt. Der Schlüssel wird aus dem `JOTION_MASTER_KEY` abgeleitet (AES-256, mit Schutz gegen Manipulation). Kopien auf einem NAS, einer USB-Platte oder in der Cloud sind ohne den Master Key wertlos.

Das bedeutet auch: **Ohne den Master Key von damals lässt sich eine Sicherung nicht einspielen.** Deshalb den Master Key getrennt von den Sicherungen aufbewahren.

Abschalten mit `JOTION_BACKUP_ENCRYPT=false` in der `.env`.

## Aufbewahrung

Ältere Sicherungen werden automatisch gelöscht. Behalten werden:

- je Tag die neueste, für 7 Tage (`JOTION_BACKUP_KEEP_DAILY`),
- je Woche die neueste, für 4 Wochen (`JOTION_BACKUP_KEEP_WEEKLY`),
- die letzten 3 vor Updates (`JOTION_BACKUP_KEEP_PRE_UPDATE`),
- die letzten 5 von Hand angelegten (`JOTION_BACKUP_KEEP_MANUAL`).

## Sofort sichern

Auf der Kommandozeile im Projektordner:

```bash
bash scripts/backup.sh
```

Oder in Jotion als Admin: Einstellungen → Server → "Jetzt sichern". Dort steht auch die Liste der Sicherungen und ob die letzte geklappt hat.

## Sicherungen extern ablegen

Das Volume `backups` liegt auf demselben Rechner wie Jotion. Gegen Festplattenausfall hilft nur eine Kopie woanders, zum Beispiel per Bind-Mount auf ein NAS oder durch regelmäßiges Kopieren:

```bash
docker run --rm -v jotion_backups:/b -v "$PWD":/out alpine sh -c 'cp /b/jotion-*.tar /out/'
```

## Sicherung prüfen

Prüft, ob eine Sicherung vollständig ist und sich entschlüsseln lässt, ohne etwas zu ändern (Jotion läuft weiter):

```bash
bash scripts/restore.sh latest --verify
```

Alle Sicherungen anzeigen:

```bash
bash scripts/restore.sh --list
```

## Wiederherstellen

```bash
bash scripts/restore.sh latest
```

oder mit dem Namen einer Sicherung (`scripts/restore.sh jotion-20261109-031500-auto.tar`) oder dem Pfad zu einer Datei auf dem Host (wird zuerst ins Volume kopiert).

Ablauf: Jotion wird angehalten, Datenbank und Dateien werden durch den Stand der Sicherung **ersetzt**, dann startet Jotion wieder. Spätere Änderungen gehen dabei verloren.

Schutz:

- Prüfsummen werden vor dem Einspielen kontrolliert.
- Eine Sicherung einer neueren Jotion-Version wird abgelehnt. Erst Jotion aktualisieren.
- Eine Sicherung einer älteren Version wird eingespielt; beim Start bringen die Migrationen sie auf den aktuellen Stand.
- Passt kein Master Key (aktueller oder einer aus `JOTION_MASTER_KEY_PREVIOUS`), bricht der Vorgang ab, bevor etwas geändert wird.

## Umzug auf einen neuen Server

1. Auf dem alten Server sichern (`bash scripts/backup.sh`) und das Archiv kopieren.
2. Auf dem neuen Server Jotion installieren ([Installation](Installation)) und dabei **dieselbe `.env`** verwenden (mindestens denselben `JOTION_MASTER_KEY`).
3. `bash scripts/restore.sh /pfad/zur/jotion-….tar`
