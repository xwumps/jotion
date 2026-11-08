import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseIcs, zonedToUtc } from './ical';
import { DEFAULT_SOURCE_OPTIONS, type DateField } from './sdk';

const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures/ics', name), 'utf8');
const NOW = Date.parse('2026-11-08T12:00:00Z');
const base = { sourceKey: 'src', timeZone: 'Europe/Berlin', now: NOW, options: DEFAULT_SOURCE_OPTIONS };

describe('parseIcs', () => {
  const records = parseIcs(fixture('school.ics'), base);
  const byId = (id: string) => records.find((r) => r.externalId === id)!;

  it('liest Termine mit Zeitzone und allen Feldern', () => {
    const r = byId('klausur-mathe@schule.example');
    expect(r.kind).toBe('event');
    expect(r.weakId).toBe(false);
    expect(r.fields).toMatchObject({
      title: 'Klausur Mathematik',
      description: 'Kapitel 3 bis 5, Taschenrechner erlaubt',
      date: { start: '2026-11-12T07:00:00.000Z', end: '2026-11-12T08:30:00.000Z', hasTime: true },
      allDay: false,
      location: 'Raum 204',
      organizer: 'Frau Müller',
      url: 'https://schule.example/termine/1',
      categories: ['Mathematik', 'Klausur'],
      status: 'confirmed',
    });
  });

  it('ganztägig: exklusives Ende wird zum letzten Tag, eintägig ohne Ende', () => {
    expect(byId('ferien@schule.example').fields.date).toEqual({
      start: '2026-12-21',
      end: '2027-01-04',
      hasTime: false,
    });
    expect(byId('wandertag@schule.example').fields.date).toEqual({
      start: '2026-11-20',
      end: null,
      hasTime: false,
    });
  });

  it('teilt Serien auf, beachtet EXDATE und verschobene Einzeltermine', () => {
    const series = records.filter((r) => r.externalId.startsWith('ag-robotik@'));
    expect(series).toHaveLength(9);
    expect(series.some((r) => r.externalId.includes('2026-11-03'))).toBe(false);
    const moved = byId('ag-robotik@schule.example#2026-11-10T13:00:00.000Z');
    expect(moved.fields.title).toBe('Robotik-AG (verschoben)');
    expect((moved.fields.date as DateField).start).toBe('2026-11-11T14:00:00.000Z');
    // Sommerzeit endet am 25.10.: vorher UTC+2, danach UTC+1
    expect((byId('ag-robotik@schule.example#2026-10-20T12:00:00.000Z').fields.date as DateField).start).toBe(
      '2026-10-20T12:00:00.000Z',
    );
    expect((byId('ag-robotik@schule.example#2026-10-27T13:00:00.000Z').fields.date as DateField).start).toBe(
      '2026-10-27T13:00:00.000Z',
    );
  });

  it('Serie als eine Zeile, wenn Aufteilen aus ist', () => {
    const one = parseIcs(fixture('school.ics'), {
      ...base,
      options: { ...DEFAULT_SOURCE_OPTIONS, expandRecurring: false },
    });
    const series = one.filter((r) => r.externalId.startsWith('ag-robotik@'));
    expect(series.map((r) => r.externalId)).toEqual(['ag-robotik@schule.example']);
  });

  it('Zeitfenster begrenzt Wiederholungen', () => {
    const narrow = parseIcs(fixture('school.ics'), {
      ...base,
      options: { ...DEFAULT_SOURCE_OPTIONS, windowPastDays: 0, windowFutureDays: 14 },
    });
    const ids = narrow.filter((r) => r.externalId.startsWith('ag-robotik@')).map((r) => r.externalId);
    expect(ids).toEqual([
      'ag-robotik@schule.example#2026-11-10T13:00:00.000Z',
      'ag-robotik@schule.example#2026-11-17T13:00:00.000Z',
    ]);
  });

  it('schwache ID ohne UID, stabil über mehrere Läufe', () => {
    const weak = records.filter((r) => r.weakId);
    expect(weak).toHaveLength(1);
    expect(weak[0]!.fields.date).toEqual({
      start: '2026-11-15T10:00:00.000Z',
      end: '2026-11-15T11:00:00.000Z',
      hasTime: true,
    });
    const again = parseIcs(fixture('school.ics'), base).filter((r) => r.weakId);
    expect(again[0]!.externalId).toBe(weak[0]!.externalId);
    const other = parseIcs(fixture('school.ics'), { ...base, sourceKey: 'andere' }).filter((r) => r.weakId);
    expect(other[0]!.externalId).not.toBe(weak[0]!.externalId);
  });

  it('Aufgaben: Fälligkeit, Erledigt, Priorität', () => {
    expect(byId('hausaufgabe-deutsch@schule.example')).toMatchObject({
      kind: 'task',
      fields: {
        title: 'Erörterung schreiben',
        due: '2026-11-13',
        date: { start: '2026-11-13', end: null, hasTime: false },
        completed: false,
        priority: 1,
        categories: ['Deutsch'],
      },
    });
    expect(byId('hausaufgabe-englisch@schule.example').fields).toMatchObject({
      completed: true,
      date: { start: '2026-11-01T12:00:00.000Z', end: '2026-11-05T12:00:00.000Z', hasTime: true },
    });
  });

  it('Version ändert sich nur mit dem Inhalt', () => {
    const again = parseIcs(fixture('school.ics'), base);
    expect(again.map((r) => r.version)).toEqual(records.map((r) => r.version));
    const changed = parseIcs(fixture('school.ics').replace('Raum 204', 'Raum 205'), base);
    const a = changed.find((r) => r.externalId === 'klausur-mathe@schule.example')!;
    expect(a.version).not.toBe(byId('klausur-mathe@schule.example').version);
  });

  it('Zeiten ohne Zone, IANA-Zonen ohne VTIMEZONE und eigene Zonen', () => {
    const r = parseIcs(fixture('floating.ics'), base);
    const start = (id: string) => (r.find((x) => x.externalId === id)!.fields.date as DateField).start;
    expect(start('floating-1')).toBe('2026-07-01T08:00:00.000Z');
    expect(start('iana-1')).toBe('2026-01-15T14:00:00.000Z');
    expect(start('custom-tz-1')).toBe('2026-01-15T06:00:00.000Z');
  });

  it('ungültige Daten ergeben einen Protokollfehler', () => {
    expect(() => parseIcs('BEGIN:VCALENDAR\nkaputt', base)).toThrow(/iCalendar/);
  });
});

describe('zonedToUtc', () => {
  it('rechnet Sommer- und Winterzeit um', () => {
    expect(new Date(zonedToUtc(2026, 3, 29, 3, 30, 0, 'Europe/Berlin')).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    expect(new Date(zonedToUtc(2026, 12, 1, 0, 0, 0, 'Europe/Berlin')).toISOString()).toBe(
      '2026-11-30T23:00:00.000Z',
    );
  });
});
