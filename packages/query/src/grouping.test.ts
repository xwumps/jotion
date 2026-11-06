import { describe, expect, it } from 'vitest';
import { EMPTY_GROUP } from '@jotion/shared';
import {
  bucketStart,
  GroupMoveError,
  numberKey,
  rowDayRange,
  rowGroupKeys,
  valueForGroupMove,
  type GroupSpec,
} from './grouping';
import type { QueryProperty, RowRecord } from './types';

const prop = (type: QueryProperty['type']): QueryProperty => ({
  id: `p-${type}`,
  type,
  config: {},
});
const row = (values: RowRecord['values'], extra: Partial<RowRecord> = {}): RowRecord => ({
  id: 'r',
  title: '',
  position: 'a0',
  createdAt: '2026-03-29T00:30:00Z',
  createdById: 'u1',
  lastEditedAt: '2026-03-29T00:30:00Z',
  lastEditedById: 'u2',
  values,
  ...extra,
});
const spec = (p: QueryProperty, dateBucket: GroupSpec['dateBucket'] = 'day'): GroupSpec => ({
  prop: p,
  dateBucket,
  numberInterval: 10,
});

describe('Grouping-Engine', () => {
  it('beginnt Wochen am Montag, auch über Monats- und Jahresgrenzen', () => {
    expect(bucketStart('2026-11-04', 'week')).toBe('2026-11-02');
    expect(bucketStart('2026-11-08', 'week')).toBe('2026-11-02'); // Sonntag
    expect(bucketStart('2026-11-09', 'week')).toBe('2026-11-09'); // Montag
    expect(bucketStart('2027-01-01', 'week')).toBe('2026-12-28');
    expect(bucketStart('2026-11-04', 'month')).toBe('2026-11-01');
    expect(bucketStart('2026-11-04', 'quarter')).toBe('2026-10-01');
    expect(bucketStart('2026-03-31', 'quarter')).toBe('2026-01-01');
    expect(bucketStart('2026-04-01', 'quarter')).toBe('2026-04-01');
    expect(bucketStart('2026-11-04', 'year')).toBe('2026-01-01');
  });

  it('ordnet Zeitpunkte an DST-Grenzen dem Tag in der Zeitzone des Betrachters zu', () => {
    const p = prop('date');
    // 29.03.2026: Umstellung auf Sommerzeit in Berlin (02:00 -> 03:00)
    const r = row({
      [p.id]: { start: '2026-03-29T22:30:00Z', end: null, hasTime: true, timeZone: null },
    });
    expect(rowGroupKeys(r, spec(p), 'Europe/Berlin')).toEqual(['2026-03-30']);
    expect(rowGroupKeys(r, spec(p), 'UTC')).toEqual(['2026-03-29']);
    expect(rowGroupKeys(r, spec(p), 'America/Los_Angeles')).toEqual(['2026-03-29']);
    // 25.10.2026: Rückstellung, 00:30 UTC ist 02:30 MESZ bzw. später 01:30 MEZ, gleicher Tag
    const r2 = row({
      [p.id]: { start: '2026-10-25T00:30:00Z', end: null, hasTime: true, timeZone: null },
    });
    expect(rowGroupKeys(r2, spec(p, 'week'), 'Europe/Berlin')).toEqual(['2026-10-19']);
    // Ganztägige Daten hängen nicht von der Zeitzone ab
    const r3 = row({ [p.id]: { start: '2026-03-29', end: null, hasTime: false, timeZone: null } });
    expect(rowGroupKeys(r3, spec(p), 'Asia/Tokyo')).toEqual(['2026-03-29']);
    expect(rowGroupKeys(r3, spec(p), 'America/Los_Angeles')).toEqual(['2026-03-29']);
  });

  it('erzeugt Schlüssel je Typ und EMPTY_GROUP für leere Werte', () => {
    expect(rowGroupKeys(row({}), spec(prop('select')), 'UTC')).toEqual([EMPTY_GROUP]);
    expect(
      rowGroupKeys(row({ 'p-multi_select': ['a', 'b', 'a'] }), spec(prop('multi_select')), 'UTC'),
    ).toEqual(['a', 'b']);
    expect(rowGroupKeys(row({}), spec(prop('checkbox')), 'UTC')).toEqual(['false']);
    expect(rowGroupKeys(row({}), spec(prop('created_by')), 'UTC')).toEqual(['u1']);
    expect(rowGroupKeys(row({ 'p-number': -0.5 }), spec(prop('number')), 'UTC')).toEqual(['-10']);
    expect(rowGroupKeys(row({}, { title: 'Hallo' }), spec(prop('title')), 'UTC')).toEqual([
      'Hallo',
    ]);
    expect(numberKey(0.3, 0.1)).toBe(String(Math.floor(0.3 / 0.1) * 0.1));
    expect(numberKey(-0, 10)).toBe('0');
  });

  it('liefert den Tagesbereich eines Datums mit und ohne Ende', () => {
    const p = prop('date');
    const r = row({
      [p.id]: { start: '2026-11-02', end: '2026-11-05', hasTime: false, timeZone: null },
    });
    expect(rowDayRange(r, p, null, 'UTC')).toEqual(['2026-11-02', '2026-11-05']);
    expect(rowDayRange(row({}), p, null, 'UTC')).toBeNull();
    expect(rowDayRange(r, prop('created_time'), null, 'Europe/Berlin')).toEqual([
      '2026-03-29',
      '2026-03-29',
    ]);
  });
});

describe('Gruppenwechsel beim Ziehen', () => {
  const tz = 'Europe/Berlin';
  it('setzt Optionen, Checkbox, Zahl und Text auf die Zielgruppe', () => {
    expect(valueForGroupMove(row({}), spec(prop('select')), EMPTY_GROUP, 'o1', tz)).toEqual({
      kind: 'value',
      value: 'o1',
    });
    expect(valueForGroupMove(row({}), spec(prop('status')), 'o1', EMPTY_GROUP, tz)).toEqual({
      kind: 'value',
      value: null,
    });
    expect(valueForGroupMove(row({}), spec(prop('checkbox')), 'false', 'true', tz)).toEqual({
      kind: 'value',
      value: true,
    });
    expect(valueForGroupMove(row({}), spec(prop('number')), '0', '20', tz)).toEqual({
      kind: 'value',
      value: 20,
    });
    expect(valueForGroupMove(row({}), spec(prop('title')), 'a', 'b', tz)).toEqual({
      kind: 'title',
      value: 'b',
    });
  });

  it('tauscht bei Mehrfachauswahl nur die gezogene Option', () => {
    const r = row({ 'p-multi_select': ['a', 'b'] });
    expect(valueForGroupMove(r, spec(prop('multi_select')), 'a', 'c', tz)).toEqual({
      kind: 'value',
      value: ['b', 'c'],
    });
    expect(valueForGroupMove(r, spec(prop('multi_select')), 'a', 'b', tz)).toEqual({
      kind: 'value',
      value: ['b'],
    });
  });

  it('verschiebt Datum samt Ende und Uhrzeit auf den Zieltag', () => {
    const p = prop('date');
    const allDay = row({
      [p.id]: { start: '2026-11-04', end: '2026-11-06', hasTime: false, timeZone: null },
    });
    expect(valueForGroupMove(allDay, spec(p, 'week'), '2026-11-02', '2026-11-16', tz)).toEqual({
      kind: 'value',
      value: { start: '2026-11-16', end: '2026-11-18', hasTime: false, timeZone: null },
    });
    const timed = row({
      [p.id]: { start: '2026-11-04T09:30:00.000Z', end: null, hasTime: true, timeZone: null },
    });
    const res = valueForGroupMove(timed, spec(p), '2026-11-04', '2026-11-05', tz);
    expect(res).toEqual({
      kind: 'value',
      value: { start: '2026-11-05T09:30:00.000Z', end: null, hasTime: true, timeZone: null },
    });
  });

  it('lehnt schreibgeschützte Gruppen ab', () => {
    expect(() => valueForGroupMove(row({}), spec(prop('created_by')), 'u1', 'u2', tz)).toThrow(
      GroupMoveError,
    );
  });
});
