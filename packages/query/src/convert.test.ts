import { randomUUID } from 'node:crypto';
import { CREATABLE_PROPERTY_TYPES, validatePropertyValue, type PropertyType } from '@jotion/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canConvert, convertProperty } from './convert';

const ctx = {
  newId: () => randomUUID(),
  userName: (id: string) => (id === U1 ? 'Anna' : undefined),
};
const U1 = '01900000-0000-7000-8000-0000000000aa';
const A = '01900000-0000-7000-8000-00000000000a';
const B = '01900000-0000-7000-8000-00000000000b';
const selectCfg = {
  options: [
    { id: A, name: 'Rot', color: 'red' },
    { id: B, name: 'Blau', color: 'blue' },
  ],
};

const rows = (vals: unknown[]) => vals.map((value, i) => ({ rowId: `r${i}`, value }));
const conv = (from: PropertyType, fromConfig: unknown, to: PropertyType, vals: unknown[]) =>
  convertProperty(
    { from: { type: from, config: fromConfig }, to: { type: to }, values: rows(vals) },
    ctx,
  );

describe('Property-Typwechsel', () => {
  it('Text nach Select erzeugt Optionen (ohne Dubletten, Groß-/Kleinschreibung egal)', () => {
    const r = conv('text', {}, 'select', ['Rot', 'blau', 'rot', null, '  ']);
    const opts = (r.config as { options: { id: string; name: string }[] }).options;
    expect(opts.map((o) => o.name)).toEqual(['Rot', 'blau']);
    expect(r.values.map((v) => v.value)).toEqual([
      opts[0]!.id,
      opts[1]!.id,
      opts[0]!.id,
      null,
      null,
    ]);
  });

  it('Text nach Multi-Select trennt an Kommas', () => {
    const r = conv('text', {}, 'multi_select', ['a, b', 'b']);
    const opts = (r.config as { options: { id: string; name: string }[] }).options;
    expect(opts.map((o) => o.name)).toEqual(['a', 'b']);
    expect(r.values[0]!.value).toEqual([opts[0]!.id, opts[1]!.id]);
  });

  it('Select, Multi-Select und Status behalten Options-IDs und Farben', () => {
    const m = conv('select', selectCfg, 'multi_select', [A, null]);
    expect(m.config).toEqual(selectCfg);
    expect(m.values.map((v) => v.value)).toEqual([[A], []]);
    const s = conv('multi_select', selectCfg, 'status', [[B, A]]);
    expect(
      (s.config as { options: { id: string; group: string }[] }).options.map((o) => o.group),
    ).toEqual(['todo', 'todo']);
    expect(s.values[0]!.value).toBe(B);
    const back = conv('select', selectCfg, 'text', [A, B, null]);
    expect(back.values.map((v) => v.value)).toEqual(['Rot', 'Blau', null]);
  });

  it('Status ohne Optionen bekommt die drei Standard-Status', () => {
    const r = conv('number', {}, 'status', [null]);
    expect((r.config as { options: unknown[] }).options).toHaveLength(3);
  });

  it('Text nach Zahl liest deutsche und englische Schreibweise', () => {
    const r = conv('text', {}, 'number', ['3,5', '1.234,5', '1,234.5', '12 €', 'abc', '-7']);
    expect(r.values.map((v) => v.value)).toEqual([3.5, 1234.5, 1234.5, 12, null, -7]);
  });

  it('Zahl, Checkbox und Text untereinander', () => {
    expect(conv('number', {}, 'checkbox', [0, 2, null]).values.map((v) => v.value)).toEqual([
      false,
      true,
      false,
    ]);
    expect(conv('checkbox', {}, 'number', [true, false]).values.map((v) => v.value)).toEqual([
      1, 0,
    ]);
    expect(conv('text', {}, 'checkbox', ['ja', 'nein', 'X']).values.map((v) => v.value)).toEqual([
      true,
      false,
      true,
    ]);
    expect(conv('number', { format: 'euro', precision: 2 }, 'text', [2.5]).values[0]!.value).toBe(
      '2.5',
    );
  });

  it('Text nach Datum und zurück', () => {
    const r = conv('text', {}, 'date', ['2026-11-03', '3.11.2026', 'morgen', '2026-11-03 10:30']);
    expect(r.values.map((v) => (v.value as { start: string } | null)?.start ?? null)).toEqual([
      '2026-11-03',
      '2026-11-03',
      null,
      '2026-11-03T10:30:00.000Z',
    ]);
    expect(
      conv('date', {}, 'text', [{ start: '2026-11-03', end: null, hasTime: false, timeZone: null }])
        .values[0]!.value,
    ).toBe('2026-11-03');
  });

  it('Erstellt von wird zu Person, Erstellt am zu Datum, URL zu Datei', () => {
    expect(conv('created_by', {}, 'person', [U1]).values[0]!.value).toEqual([U1]);
    expect(conv('created_by', {}, 'text', [U1]).values[0]!.value).toBe('Anna');
    expect(
      (
        conv('created_time', {}, 'date', ['2026-11-03T10:00:00.000Z']).values[0]!.value as {
          hasTime: boolean;
        }
      ).hasTime,
    ).toBe(true);
    expect(conv('url', {}, 'files', ['https://x.test/a.pdf']).values[0]!.value).toHaveLength(1);
  });

  it('URL-, E-Mail- und Telefon-Ziel verwerfen ungültige Texte', () => {
    expect(conv('text', {}, 'email', ['a@b.de', 'keine mail']).values.map((v) => v.value)).toEqual([
      'a@b.de',
      null,
    ]);
  });

  it('Titel und Phase-6-Typen sind nicht konvertierbar', () => {
    expect(canConvert('title', 'text')).toBe(false);
    expect(canConvert('text', 'formula')).toBe(false);
    expect(() => conv('title', {}, 'text', [])).toThrow();
  });

  it('Eigenschaft: jedes Ergebnis besteht die Validierung des Zieltyps', () => {
    const valueFor = (t: PropertyType): fc.Arbitrary<unknown> => {
      switch (t) {
        case 'text':
        case 'url':
        case 'email':
        case 'phone':
          return fc.option(fc.string({ maxLength: 30 }));
        case 'number':
          return fc.option(fc.double({ noNaN: true, noDefaultInfinity: true }));
        case 'select':
        case 'status':
          return fc.option(fc.constantFrom(A, B));
        case 'multi_select':
          return fc.subarray([A, B]);
        case 'checkbox':
          return fc.boolean();
        case 'person':
          return fc.subarray([U1]);
        case 'date':
          return fc.option(
            fc
              .date({
                min: new Date('2000-01-01'),
                max: new Date('2100-01-01'),
                noInvalidDate: true,
              })
              .map((d) => ({
                start: d.toISOString().slice(0, 10),
                end: null,
                hasTime: false,
                timeZone: null,
              })),
          );
        default:
          return fc.constant(null);
      }
    };
    const types = CREATABLE_PROPERTY_TYPES.filter(
      (t) =>
        ![
          'created_time',
          'created_by',
          'last_edited_time',
          'last_edited_by',
          'unique_id',
          'files',
        ].includes(t),
    );
    fc.assert(
      fc.property(
        fc.constantFrom(...types),
        fc.constantFrom(...CREATABLE_PROPERTY_TYPES),
        fc.integer({ min: 0, max: 20 }),
        (from, to, seed) => {
          if (!canConvert(from, to)) return;
          const cfg =
            from === 'status'
              ? { options: selectCfg.options.map((o) => ({ ...o, group: 'todo' })) }
              : from === 'select' || from === 'multi_select'
                ? selectCfg
                : {};
          const vals = fc.sample(valueFor(from), { numRuns: 8, seed });
          const r = convertProperty(
            { from: { type: from, config: cfg }, to: { type: to }, values: rows(vals) },
            ctx,
          );
          expect(r.values).toHaveLength(vals.length);
          for (const v of r.values) {
            if (v.value === null) continue;
            expect(validatePropertyValue({ id: 'x', type: to, config: r.config }, v.value)).toEqual(
              v.value,
            );
          }
        },
      ),
      { numRuns: 400 },
    );
  });
});
