import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FormulaError } from './ast';
import { check, evaluate } from './engine';
import { parse } from './parser';
import { listOf, type Type } from './values';

/** Fuzzing: Parser, Typprüfer und Interpreter werfen nur FormulaError und terminieren. */

const TOKENS = [
  '1',
  '2.5',
  '-',
  '+',
  '*',
  '/',
  '%',
  '^',
  '(',
  ')',
  '[',
  ']',
  ',',
  '.',
  '?',
  ':',
  '!',
  '&&',
  '||',
  '==',
  '!=',
  '<',
  '>=',
  '"a"',
  "'b'",
  'true',
  'false',
  'not',
  'and',
  'or',
  'prop("Zahl")',
  'prop("Text")',
  'prop("Liste")',
  'if',
  'map',
  'filter',
  'current',
  'index',
  'let',
  'x',
  'length',
  'sum',
  'upper',
  'dateAdd',
  'today()',
  '"days"',
  ' ',
  '/*',
  '*/',
  '\\',
  '"',
];
const types: Record<string, Type> = { Zahl: 'number', Text: 'text', Liste: listOf('number') };
const props = { Zahl: 5, Text: 'abc', Liste: [1, 2, 3] };

function onlyFormulaErrors(f: () => unknown) {
  try {
    f();
  } catch (err) {
    if (!(err instanceof FormulaError)) throw err;
  }
}

describe('Fuzzing', () => {
  it('beliebige Tokenfolgen: nur FormulaError, Positionen im Text', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...TOKENS), { maxLength: 30 }), (toks) => {
        const src = toks.join('');
        try {
          parse(src);
        } catch (err) {
          expect(err).toBeInstanceOf(FormulaError);
          const e = err as FormulaError;
          expect(e.start).toBeGreaterThanOrEqual(0);
          expect(e.end).toBeLessThanOrEqual(src.length);
          return;
        }
        onlyFormulaErrors(() => check(src, { props: types }));
        onlyFormulaErrors(() => evaluate(src, { props, now: 0, timeZone: 'UTC' }));
      }),
      { numRuns: 3000, seed: 1 },
    );
  });

  it('beliebige Zeichen: nur FormulaError', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (src) => {
        onlyFormulaErrors(() => evaluate(src, { props, now: 0 }));
      }),
      { numRuns: 3000, seed: 2 },
    );
  });

  it('Arithmetik stimmt mit JavaScript überein (Vorrang und Klammern)', () => {
    type E = { src: string; js: string };
    const leaf = fc.integer({ min: 0, max: 50 }).map((n) => ({ src: String(n), js: String(n) }));
    const expr: fc.Arbitrary<E> = fc.letrec<{ e: E }>((tie) => ({
      e: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        leaf,
        fc
          .tuple(tie('e'), fc.constantFrom('+', '-', '*'), tie('e'))
          .map(([a, op, b]) => ({ src: `${a.src} ${op} ${b.src}`, js: `${a.js} ${op} ${b.js}` })),
        tie('e').map((a) => ({ src: `(${a.src})`, js: `(${a.js})` })),
      ),
    })).e;
    fc.assert(
      fc.property(expr, (e) => {
        const want = new Function(`return ${e.js}`)() as number;
        expect(evaluate(e.src, { props: {} })).toBe(want === 0 ? 0 : want);
      }),
      { numRuns: 1000, seed: 3 },
    );
  });

  it('sehr tiefe Verschachtelung wird abgelehnt statt den Stack zu sprengen', () => {
    expect(() => parse('('.repeat(5000) + '1' + ')'.repeat(5000))).toThrow(FormulaError);
    expect(() => parse('-'.repeat(5000) + '1')).toThrow(FormulaError);
    expect(() => parse('1' + ' + 1'.repeat(2000))).not.toThrow();
  });
});
