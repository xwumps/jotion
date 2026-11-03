import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  calculationsFor,
  CREATABLE_PROPERTY_TYPES,
  filterSchema,
  isEmptyValue,
  operatorsFor,
  parsePropertyConfig,
  PROPERTY_TYPES,
  PropertyValueError,
  validatePropertyValue,
  viewConfigSchema,
  type PropertyLike,
  type PropertyType,
} from './contracts-database';

const OPT_A = '01900000-0000-7000-8000-00000000000a';
const OPT_B = '01900000-0000-7000-8000-00000000000b';
const USER = '01900000-0000-7000-8000-0000000000aa';
const options = [
  { id: OPT_A, name: 'A', color: 'red' },
  { id: OPT_B, name: 'B', color: 'blue' },
];

const p = (type: PropertyType, config: unknown = {}): PropertyLike => ({
  id: '01900000-0000-7000-8000-000000000001',
  type,
  config,
});
const ok = (prop: PropertyLike, v: unknown) => validatePropertyValue(prop, v);
const bad = (prop: PropertyLike, v: unknown) =>
  expect(() => validatePropertyValue(prop, v)).toThrow(PropertyValueError);

describe('Property-Konfiguration', () => {
  it('ergänzt Standardwerte und lehnt Unbekanntes ab', () => {
    expect(parsePropertyConfig('number', {})).toEqual({ format: 'number', precision: null });
    expect(parsePropertyConfig('unique_id', {})).toEqual({ prefix: null, nextValue: 1 });
    expect(() => parsePropertyConfig('text', { evil: true })).toThrow();
    expect(() =>
      parsePropertyConfig('select', {
        options: [
          { id: OPT_A, name: 'x' },
          { id: OPT_B, name: 'X' },
        ],
      }),
    ).toThrow();
    expect(() => parsePropertyConfig('status', { options: [] })).toThrow();
  });

  it('hat für jeden Typ ein Schema und Operatoren bzw. Berechnungen', () => {
    for (const t of PROPERTY_TYPES) {
      expect(calculationsFor(t)).toContain('count_all');
      if (CREATABLE_PROPERTY_TYPES.includes(t as never))
        expect(operatorsFor(t).length).toBeGreaterThan(0);
    }
  });
});

describe('Property-Werte je Typ', () => {
  it('Text: normalisiert leere Werte, begrenzt die Länge', () => {
    expect(ok(p('text'), 'Hallo')).toBe('Hallo');
    expect(ok(p('text'), '   ')).toBeNull();
    expect(ok(p('text'), null)).toBeNull();
    bad(p('text'), 'x'.repeat(10_001));
    bad(p('text'), 5);
  });

  it('Zahl: nur endliche Zahlen', () => {
    expect(ok(p('number'), 3.5)).toBe(3.5);
    expect(ok(p('number'), null)).toBeNull();
    bad(p('number'), '3');
    bad(p('number'), Number.NaN);
    bad(p('number'), Number.POSITIVE_INFINITY);
  });

  it('Select und Status: nur vorhandene Optionen', () => {
    expect(ok(p('select', { options }), OPT_A)).toBe(OPT_A);
    expect(ok(p('select', { options }), OPT_A.toUpperCase())).toBe(OPT_A);
    bad(p('select', { options }), '01900000-0000-7000-8000-0000000000ff');
    const status = { options: options.map((o) => ({ ...o, group: 'todo' })) };
    expect(ok(p('status', status), OPT_B)).toBe(OPT_B);
  });

  it('Multi-Select: entfernt Dubletten, prüft jede Option', () => {
    expect(ok(p('multi_select', { options }), [OPT_A, OPT_A, OPT_B])).toEqual([OPT_A, OPT_B]);
    bad(p('multi_select', { options }), [OPT_A, USER]);
    bad(p('multi_select', { options }), OPT_A);
  });

  it('Datum: ganztägig oder mit Uhrzeit, Ende nicht vor Beginn', () => {
    expect(ok(p('date'), { start: '2026-11-03' })).toEqual({
      start: '2026-11-03',
      end: null,
      hasTime: false,
      timeZone: null,
    });
    expect(
      ok(p('date'), {
        start: '2026-11-03T10:00:00+01:00',
        end: '2026-11-03T12:00Z',
        hasTime: true,
      }),
    ).toMatchObject({ hasTime: true });
    bad(p('date'), { start: '2026-02-30' });
    bad(p('date'), { start: '2026-11-03', end: '2026-11-01' });
    bad(p('date'), { start: '2026-11-03T10:00', hasTime: true });
    bad(p('date'), { start: '2026-11-03', extra: 1 });
  });

  it('Person, Checkbox, URL, E-Mail, Telefon, Dateien', () => {
    expect(ok(p('person'), [USER, USER])).toEqual([USER]);
    bad(p('person'), ['keine-id']);
    expect(ok(p('checkbox'), true)).toBe(true);
    bad(p('checkbox'), 'true');
    expect(ok(p('url'), ' https://x.test ')).toBe('https://x.test');
    expect(ok(p('email'), 'a@b.de')).toBe('a@b.de');
    bad(p('email'), 'kein-at');
    expect(ok(p('phone'), '+49 (0) 30 123-45')).toBe('+49 (0) 30 123-45');
    bad(p('phone'), 'ruf mich an');
    expect(
      ok(p('files'), [{ type: 'external', url: 'https://x.test/a.pdf', name: 'a.pdf' }]),
    ).toHaveLength(1);
    bad(p('files'), [{ type: 'external', url: 'javascript:alert(1)', name: 'x' }]);
  });

  it('berechnete Typen sind schreibgeschützt', () => {
    for (const t of [
      'created_time',
      'created_by',
      'last_edited_time',
      'last_edited_by',
      'unique_id',
    ] as const)
      bad(p(t), 'x');
  });

  it('Eigenschaft: gültige Werte bleiben nach erneuter Validierung gleich (idempotent)', () => {
    const arbs: [PropertyLike, fc.Arbitrary<unknown>][] = [
      [p('text'), fc.option(fc.string({ maxLength: 50 }))],
      [p('number'), fc.option(fc.double({ noNaN: true, noDefaultInfinity: true }))],
      [p('select', { options }), fc.option(fc.constantFrom(OPT_A, OPT_B))],
      [p('multi_select', { options }), fc.subarray([OPT_A, OPT_B])],
      [p('checkbox'), fc.boolean()],
      [
        p('date'),
        fc
          .date({ min: new Date('1900-01-01'), max: new Date('2200-01-01'), noInvalidDate: true })
          .map((d) => ({ start: d.toISOString().slice(0, 10) })),
      ],
      [p('person'), fc.array(fc.uuid({ version: 7 }), { maxLength: 5 })],
    ];
    for (const [prop, arb] of arbs) {
      fc.assert(
        fc.property(arb, (v) => {
          const once = ok(prop, v);
          expect(ok(prop, once)).toEqual(once);
        }),
        { numRuns: 200 },
      );
    }
  });

  it('Eigenschaft: zufällige Eingaben werden validiert oder sauber abgelehnt', () => {
    fc.assert(
      fc.property(fc.constantFrom(...CREATABLE_PROPERTY_TYPES), fc.anything(), (type, v) => {
        const prop = p(
          type,
          type === 'status'
            ? { options: [{ ...options[0], group: 'todo' }] }
            : { options: type.includes('select') ? options : undefined },
        );
        try {
          const out = validatePropertyValue(
            {
              ...prop,
              config:
                type === 'select' || type === 'multi_select' || type === 'status'
                  ? prop.config
                  : {},
            },
            v,
          );
          // Ergebnis ist leer oder ein Wert, den isEmptyValue korrekt einordnet
          expect(typeof isEmptyValue(type, out)).toBe('boolean');
        } catch (err) {
          expect(err).toBeInstanceOf(PropertyValueError);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe('Filter und Ansichten', () => {
  const cond = { type: 'condition', propertyId: OPT_A, operator: 'contains', value: 'x' };
  it('erlaubt Gruppen bis Tiefe 3', () => {
    const g = (children: unknown[]) => ({ type: 'group', op: 'and', children });
    expect(filterSchema.safeParse(g([cond, g([cond, g([cond])])])).success).toBe(true);
    expect(filterSchema.safeParse(g([g([g([g([cond])])])])).success).toBe(false);
    expect(filterSchema.safeParse(g([{ ...cond, operator: 'drop_table' }])).success).toBe(false);
  });

  it('füllt die Ansichtskonfiguration mit Standardwerten', () => {
    const c = viewConfigSchema.parse({});
    expect(c).toMatchObject({ filter: null, sorts: [], properties: [], frozenColumns: 1 });
    expect(viewConfigSchema.safeParse({ calculations: { x: 'sum' } }).success).toBe(true);
    expect(viewConfigSchema.safeParse({ calculations: { x: 'evil' } }).success).toBe(false);
  });
});
