import { FormulaError, type BinOp, type Node } from './ast';

/** Grenzen gegen bösartige oder versehentlich riesige Formeln. */
export const MAX_FORMULA_LENGTH = 10_000;
const MAX_DEPTH = 200;

type TokType = 'num' | 'str' | 'ident' | 'op' | 'eof';
interface Tok {
  t: TokType;
  v: string;
  start: number;
  end: number;
}

const OPS = [
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '<',
  '>',
  '!',
  '?',
  ':',
  '(',
  ')',
  '[',
  ']',
  ',',
  '.',
];

export function tokenize(src: string): Tok[] {
  if (src.length > MAX_FORMULA_LENGTH) throw new FormulaError('Formel ist zu lang', 0, src.length);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // Kommentare /* ... */ (wie Notion)
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) throw new FormulaError('Kommentar wird nicht geschlossen', i, src.length);
      i = end + 2;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: m[0], start: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== q) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1]!;
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new FormulaError('Text wird nicht geschlossen', i, src.length);
      out.push({ t: 'str', v: s, start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_À-ɏ]/.test(c)) {
      const m = /^[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*/.exec(src.slice(i))!;
      out.push({ t: 'ident', v: m[0], start: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new FormulaError(`Unerwartetes Zeichen "${c}"`, i, i + 1);
    out.push({ t: 'op', v: op, start: i, end: i + op.length });
    i += op.length;
  }
  out.push({ t: 'eof', v: '', start: src.length, end: src.length });
  return out;
}

/** Bindungsstärke der Binäroperatoren (größer = stärker). */
const BIN: Record<string, { p: number; op: BinOp; right?: boolean }> = {
  '||': { p: 1, op: '||' },
  or: { p: 1, op: '||' },
  '&&': { p: 2, op: '&&' },
  and: { p: 2, op: '&&' },
  '==': { p: 3, op: '==' },
  '!=': { p: 3, op: '!=' },
  '<': { p: 4, op: '<' },
  '<=': { p: 4, op: '<=' },
  '>': { p: 4, op: '>' },
  '>=': { p: 4, op: '>=' },
  '+': { p: 5, op: '+' },
  '-': { p: 5, op: '-' },
  '*': { p: 6, op: '*' },
  '/': { p: 6, op: '/' },
  '%': { p: 6, op: '%' },
  '^': { p: 8, op: '^', right: true },
};
const UNARY_P = 7;
const TERNARY_P = 0;

/** Parst eine Formel zu einem Syntaxbaum (Pratt-Parser). Wirft FormulaError mit Position. */
export function parse(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;
  let depth = 0;
  const peek = () => toks[pos]!;
  const next = () => toks[pos++]!;
  const isOp = (v: string) => peek().t === 'op' && peek().v === v;
  const expect = (v: string) => {
    const t = peek();
    if (t.t !== 'op' || t.v !== v)
      throw new FormulaError(
        t.t === 'eof' ? `"${v}" fehlt am Ende` : `"${v}" erwartet, gefunden "${t.v}"`,
        t.start,
        t.t === 'eof' ? t.end : Math.max(t.end, t.start + 1),
      );
    return next();
  };

  const args = (): Node[] => {
    expect('(');
    const out: Node[] = [];
    if (!isOp(')')) {
      do out.push(expr(TERNARY_P));
      while (isOp(',') && next());
    }
    expect(')');
    return out;
  };

  const primary = (): Node => {
    const t = next();
    if (t.t === 'num') return { k: 'num', v: Number(t.v), start: t.start, end: t.end };
    if (t.t === 'str') return { k: 'str', v: t.v, start: t.start, end: t.end };
    if (t.t === 'ident') {
      if (t.v === 'true' || t.v === 'false')
        return { k: 'bool', v: t.v === 'true', start: t.start, end: t.end };
      if (t.v === 'not') {
        const arg = expr(UNARY_P);
        return { k: 'unary', op: '!', arg, start: t.start, end: arg.end };
      }
      if (isOp('(')) {
        const a = args();
        return {
          k: 'call',
          name: t.v,
          args: a,
          method: false,
          nameSpan: { start: t.start, end: t.end },
          start: t.start,
          end: toks[pos - 1]!.end,
        };
      }
      return { k: 'ident', name: t.v, start: t.start, end: t.end };
    }
    if (t.t === 'op') {
      if (t.v === '(') {
        const e = expr(TERNARY_P);
        const close = expect(')');
        return { ...e, start: t.start, end: close.end };
      }
      if (t.v === '[') {
        const items: Node[] = [];
        if (!isOp(']')) {
          do items.push(expr(TERNARY_P));
          while (isOp(',') && next());
        }
        const close = expect(']');
        return { k: 'list', items, start: t.start, end: close.end };
      }
      if (t.v === '-' || t.v === '!') {
        const arg = expr(UNARY_P);
        // Negative Zahlenliterale direkt falten
        if (t.v === '-' && arg.k === 'num')
          return { k: 'num', v: -arg.v, start: t.start, end: arg.end };
        return { k: 'unary', op: t.v, arg, start: t.start, end: arg.end };
      }
    }
    throw new FormulaError(
      t.t === 'eof' ? 'Formel endet unerwartet' : `Unerwartet: "${t.v}"`,
      t.start,
      t.t === 'eof' ? t.end : Math.max(t.end, t.start + 1),
    );
  };

  const postfix = (left: Node): Node => {
    // Methodenaufrufe: a.f(b) = f(a, b)
    while (isOp('.')) {
      next();
      const name = next();
      if (name.t !== 'ident')
        throw new FormulaError('Name einer Funktion erwartet', name.start, name.end);
      const a = isOp('(') ? args() : [];
      left = {
        k: 'call',
        name: name.v,
        args: [left, ...a],
        method: true,
        nameSpan: { start: name.start, end: name.end },
        start: left.start,
        end: toks[pos - 1]!.end,
      };
    }
    return left;
  };

  function expr(minP: number): Node {
    if (++depth > MAX_DEPTH)
      throw new FormulaError('Formel ist zu tief verschachtelt', peek().start, peek().end);
    let left = postfix(primary());
    for (;;) {
      const t = peek();
      if (t.t === 'op' && t.v === '?' && minP <= TERNARY_P) {
        next();
        const a = expr(TERNARY_P);
        expect(':');
        const b = expr(TERNARY_P);
        left = { k: 'cond', c: left, t: a, f: b, start: left.start, end: b.end };
        continue;
      }
      const key = t.t === 'op' || (t.t === 'ident' && (t.v === 'and' || t.v === 'or')) ? t.v : '';
      const b = BIN[key];
      if (!b || b.p < minP) break;
      next();
      const right = expr(b.right ? b.p : b.p + 1);
      left = { k: 'bin', op: b.op, l: left, r: right, start: left.start, end: right.end };
    }
    depth--;
    return left;
  }

  const root = expr(TERNARY_P);
  const rest = peek();
  if (rest.t !== 'eof') throw new FormulaError(`Unerwartet: "${rest.v}"`, rest.start, rest.end);
  return root;
}
