import { FormulaError, type Node } from './ast';
import { ArgError, ArgTypeError, BUILTINS, plus, truthy, type EvalEnv } from './builtins';
import { parse } from './parser';
import {
  compare,
  elementType,
  equal,
  isList,
  isPage,
  listOf,
  typeName,
  type PageVal,
  type Type,
  type Value,
} from './values';

/** Funktionen mit eigener Auswertung (Bedingungen, Variablen, Listenfunktionen mit current). */
const SPECIAL: Record<string, { min: number; max: number; doc: string }> = {
  prop: { min: 1, max: 2, doc: 'Wert eines Properties: prop("Name")' },
  if: { min: 3, max: 3, doc: 'if(Bedingung, dann, sonst)' },
  ifs: { min: 3, max: Infinity, doc: 'ifs(Bedingung1, Wert1, Bedingung2, Wert2, ..., sonst)' },
  and: { min: 2, max: Infinity, doc: 'Alle Bedingungen wahr?' },
  or: { min: 2, max: Infinity, doc: 'Mindestens eine Bedingung wahr?' },
  let: { min: 3, max: 3, doc: 'let(name, Wert, Ausdruck)' },
  lets: { min: 3, max: Infinity, doc: 'lets(a, Wert1, b, Wert2, ..., Ausdruck)' },
  map: { min: 2, max: 2, doc: 'Jeden Eintrag umwandeln: map(liste, current * 2)' },
  filter: { min: 2, max: 2, doc: 'Einträge filtern: filter(liste, current > 2)' },
  find: { min: 2, max: 2, doc: 'Ersten passenden Eintrag finden' },
  findIndex: { min: 2, max: 2, doc: 'Position des ersten passenden Eintrags' },
  some: { min: 2, max: 2, doc: 'Passt mindestens ein Eintrag?' },
  every: { min: 2, max: 2, doc: 'Passen alle Einträge?' },
};
const LIST_LAMBDA = new Set(['map', 'filter', 'find', 'findIndex', 'some', 'every']);

/** Alle Funktionen mit Kurzbeschreibung (Autocomplete im Editor). */
export const FUNCTIONS: { name: string; doc: string }[] = [
  ...Object.entries(SPECIAL).map(([name, s]) => ({ name, doc: s.doc })),
  ...Object.entries(BUILTINS).map(([name, b]) => ({ name, doc: b.doc })),
].sort((a, b) => a.name.localeCompare(b.name));

export const CONSTANTS: Record<string, Value> = { pi: Math.PI, e: Math.E };

const MAX_STEPS = 500_000;

// ---------------------------------------------------------------- Typprüfung

export interface CheckContext {
  /** Typen der Properties nach Name */
  props: Record<string, Type>;
}

export interface CheckResult {
  type: Type;
  /** Referenzierte Property-Namen (Abhängigkeiten) */
  refs: string[];
  /** Verwendet now() oder today() */
  volatile: boolean;
}

/** Prüft Syntax, Funktionen, Argumentanzahl, Properties und Typen. Wirft FormulaError. */
export function check(src: string, ctx: CheckContext): CheckResult {
  const ast = parse(src);
  const refs = new Set<string>();
  let volatile = false;

  const fail = (n: { start: number; end: number }, msg: string): never => {
    throw new FormulaError(msg, n.start, n.end, 'type');
  };

  function infer(n: Node, scope: Map<string, Type>): Type {
    switch (n.k) {
      case 'num':
        return 'number';
      case 'str':
        return 'text';
      case 'bool':
        return 'boolean';
      case 'list': {
        const ts = n.items.map((i) => infer(i, scope));
        const first = ts.find((t) => t !== 'empty' && t !== 'any');
        return listOf(
          first && ts.every((t) => sameType(t, first) || t === 'empty' || t === 'any')
            ? first
            : 'any',
        );
      }
      case 'ident': {
        const t = scope.get(n.name);
        if (t) return t;
        if (n.name in CONSTANTS) return 'number';
        return fail(n, `Unbekannter Name "${n.name}"`);
      }
      case 'unary': {
        const t = infer(n.arg, scope);
        if (n.op === '-' && !numberLike(t))
          fail(n, `"-" braucht eine Zahl, bekommt ${typeName(t)}`);
        return n.op === '-' ? 'number' : 'boolean';
      }
      case 'cond': {
        infer(n.c, scope);
        return unify(infer(n.t, scope), infer(n.f, scope));
      }
      case 'bin': {
        const l = infer(n.l, scope);
        const r = infer(n.r, scope);
        switch (n.op) {
          case '+':
            if (isList(l) && isList(r)) return l;
            if (l === 'text' || r === 'text') return 'text';
            if (!numberLike(l) || !numberLike(r))
              fail(
                n,
                `"+" geht nur mit Zahlen oder Text, nicht mit ${typeName(numberLike(l) ? r : l)}`,
              );
            return 'number';
          case '-':
          case '*':
          case '/':
          case '%':
          case '^':
            if (!numberLike(l) || !numberLike(r))
              fail(n, `"${n.op}" braucht Zahlen, bekommt ${typeName(numberLike(l) ? r : l)}`);
            return 'number';
          case '<':
          case '<=':
          case '>':
          case '>=':
            if (!comparable(l, r))
              fail(n, `${typeName(l)} und ${typeName(r)} lassen sich nicht vergleichen`);
            return 'boolean';
          default:
            return 'boolean';
        }
      }
      case 'call':
        return inferCall(n, scope);
    }
  }

  function inferCall(n: Extract<Node, { k: 'call' }>, scope: Map<string, Type>): Type {
    const special = SPECIAL[n.name];
    const builtin = BUILTINS[n.name];
    const def = special ?? builtin;
    if (!def) return fail(n.nameSpan, `Unbekannte Funktion "${n.name}"`);
    if (n.args.length < def.min || n.args.length > def.max)
      fail(
        n.nameSpan,
        def.min === def.max
          ? `"${n.name}" erwartet ${def.min} Argument${def.min === 1 ? '' : 'e'}, bekommt ${n.args.length}`
          : `"${n.name}" erwartet ${def.min} bis ${def.max === Infinity ? 'beliebig viele' : def.max} Argumente, bekommt ${n.args.length}`,
      );
    if (builtin?.volatile) volatile = true;

    switch (n.name) {
      case 'prop': {
        // prop("Name") oder seite.prop("Name")
        const nameArg = n.method ? n.args[1] : n.args[0];
        if (!nameArg || nameArg.k !== 'str')
          return fail(n, 'prop erwartet den Namen als Text in Anführungszeichen');
        if (n.method) {
          const on = infer(n.args[0]!, scope);
          if (isList(on) && (on.list === 'page' || on.list === 'any')) return listOf('any');
          if (on !== 'page' && on !== 'any' && on !== 'empty')
            fail(n.args[0]!, `prop() geht nur auf Seiten, nicht auf ${typeName(on)}`);
          return 'any';
        }
        if (n.args.length !== 1) fail(n, 'prop erwartet genau einen Namen');
        const t = ctx.props[nameArg.v];
        if (!t) return fail(nameArg, `Unbekanntes Property "${nameArg.v}"`);
        refs.add(nameArg.v);
        return t;
      }
      case 'if':
        infer(n.args[0]!, scope);
        return unify(infer(n.args[1]!, scope), infer(n.args[2]!, scope));
      case 'ifs': {
        if (n.args.length % 2 === 0)
          fail(n, 'ifs braucht Paare aus Bedingung und Wert und am Ende einen Sonst-Wert');
        let t: Type = 'empty';
        for (let i = 0; i < n.args.length - 1; i += 2) {
          infer(n.args[i]!, scope);
          t = unify(t, infer(n.args[i + 1]!, scope));
        }
        return unify(t, infer(n.args.at(-1)!, scope));
      }
      case 'and':
      case 'or':
        n.args.forEach((a) => infer(a, scope));
        return 'boolean';
      case 'let':
      case 'lets': {
        if (n.args.length % 2 === 0)
          fail(n, `${n.name} braucht Paare aus Name und Wert und am Ende einen Ausdruck`);
        const inner = new Map(scope);
        for (let i = 0; i < n.args.length - 1; i += 2) {
          const id = n.args[i]!;
          if (id.k !== 'ident') fail(id, 'Name einer Variablen erwartet');
          inner.set((id as { name: string }).name, infer(n.args[i + 1]!, inner));
        }
        return infer(n.args.at(-1)!, inner);
      }
    }
    if (LIST_LAMBDA.has(n.name)) {
      const lt = infer(n.args[0]!, scope);
      if (!isList(lt) && lt !== 'any' && lt !== 'empty')
        fail(n.args[0]!, `${n.name} braucht eine Liste, bekommt ${typeName(lt)}`);
      const inner = new Map(scope);
      inner.set('current', elementType(lt));
      inner.set('index', 'number');
      const bt = infer(n.args[1]!, inner);
      switch (n.name) {
        case 'map':
          return listOf(bt);
        case 'filter':
          return isList(lt) ? lt : listOf('any');
        case 'find':
          return elementType(lt);
        case 'findIndex':
          return 'number';
        default:
          return 'boolean';
      }
    }
    const argTypes = n.args.map((a) => infer(a, scope));
    try {
      return builtin!.type(argTypes);
    } catch (err) {
      if (err instanceof ArgTypeError) {
        const a = n.args[err.index] ?? n;
        return fail(a, `${n.name}: Argument ${err.index + 1} ${err.message}`);
      }
      throw err;
    }
  }

  const type = infer(ast, new Map());
  return { type, refs: [...refs], volatile };
}

const numberLike = (t: Type) => t === 'number' || t === 'any' || t === 'empty' || t === 'boolean';
const sameType = (a: Type, b: Type): boolean =>
  isList(a) && isList(b) ? sameType(a.list, b.list) : a === b;
function unify(a: Type, b: Type): Type {
  if (a === 'empty') return b;
  if (b === 'empty') return a;
  if (sameType(a, b)) return a;
  if (isList(a) && isList(b)) return listOf('any');
  return 'any';
}
function comparable(a: Type, b: Type): boolean {
  if (a === 'any' || b === 'any' || a === 'empty' || b === 'empty') return true;
  return sameType(a, b) && (a === 'number' || a === 'text' || a === 'date' || a === 'boolean');
}

// ---------------------------------------------------------------- Auswertung

export interface PropValue {
  value: Value;
}

export interface EvalContext {
  /** Werte der Properties dieser Zeile nach Name */
  props: Record<string, Value>;
  /** Properties einer verknüpften Seite: seite.prop("Name") */
  pageProp?: (page: PageVal, name: string) => Value;
  /** Diese Zeile (für id()) */
  self?: PageVal;
  now?: number;
  timeZone?: string;
}

/** Wertet eine Formel aus. Laufzeitfehler (z. B. ungültiger regulärer Ausdruck) als FormulaError. */
export function evaluate(src: string | Node, ctx: EvalContext): Value {
  const ast = typeof src === 'string' ? parse(src) : src;
  const env: EvalEnv = { now: ctx.now ?? Date.now(), timeZone: ctx.timeZone ?? 'UTC' };
  let steps = 0;

  const fail = (n: { start: number; end: number }, msg: string): never => {
    throw new FormulaError(msg, n.start, n.end, 'runtime');
  };

  function ev(n: Node, scope: Map<string, Value>): Value {
    if (++steps > MAX_STEPS) fail(n, 'Formel braucht zu viele Rechenschritte');
    switch (n.k) {
      case 'num':
      case 'str':
      case 'bool':
        return n.v;
      case 'list':
        return n.items.map((i) => ev(i, scope));
      case 'ident':
        if (scope.has(n.name)) return scope.get(n.name)!;
        if (n.name in CONSTANTS) return CONSTANTS[n.name]!;
        return fail(n, `Unbekannter Name "${n.name}"`);
      case 'unary': {
        const v = ev(n.arg, scope);
        if (n.op === '!') return !truthy(v);
        if (v === null) return null;
        if (typeof v !== 'number') return fail(n, '"-" braucht eine Zahl');
        return -v;
      }
      case 'cond':
        return truthy(ev(n.c, scope)) ? ev(n.t, scope) : ev(n.f, scope);
      case 'bin': {
        if (n.op === '&&') return truthy(ev(n.l, scope)) && truthy(ev(n.r, scope));
        if (n.op === '||') return truthy(ev(n.l, scope)) || truthy(ev(n.r, scope));
        const l = ev(n.l, scope);
        const r = ev(n.r, scope);
        switch (n.op) {
          case '+':
            return wrap(n, () => plus(l, r, env));
          case '==':
            return equal(l, r);
          case '!=':
            return !equal(l, r);
          case '<':
            return l !== null && r !== null && compare(l, r) < 0;
          case '<=':
            return l !== null && r !== null && compare(l, r) <= 0;
          case '>':
            return l !== null && r !== null && compare(l, r) > 0;
          case '>=':
            return l !== null && r !== null && compare(l, r) >= 0;
        }
        if (l === null && r === null) return null;
        const a = toNum(n.l, l);
        const b = toNum(n.r, r);
        const res =
          n.op === '-'
            ? a - b
            : n.op === '*'
              ? a * b
              : n.op === '/'
                ? a / b
                : n.op === '%'
                  ? a % b
                  : Math.pow(a, b);
        return Number.isFinite(res) ? res : null;
      }
      case 'call':
        return call(n, scope);
    }
  }

  const toNum = (n: Node, v: Value): number => {
    if (v === null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return fail(n, 'Zahl erwartet');
  };

  const wrap = (n: { start: number; end: number }, f: () => Value): Value => {
    try {
      return f();
    } catch (err) {
      if (err instanceof ArgError) fail(n, err.message);
      throw err;
    }
  };

  function call(n: Extract<Node, { k: 'call' }>, scope: Map<string, Value>): Value {
    const a = n.args;
    switch (n.name) {
      case 'prop': {
        if (n.method) {
          const page = ev(a[0]!, scope);
          const name = a[1]!.k === 'str' ? a[1]!.v : String(ev(a[1]!, scope));
          if (Array.isArray(page))
            return page.map((p) => (isPage(p) ? (ctx.pageProp?.(p, name) ?? null) : null));
          return isPage(page) ? (ctx.pageProp?.(page, name) ?? null) : null;
        }
        const name = a[0]!.k === 'str' ? a[0]!.v : String(ev(a[0]!, scope));
        if (!(name in ctx.props)) fail(a[0]!, `Unbekanntes Property "${name}"`);
        return ctx.props[name] ?? null;
      }
      case 'if':
        return truthy(ev(a[0]!, scope)) ? ev(a[1]!, scope) : ev(a[2]!, scope);
      case 'ifs': {
        for (let i = 0; i < a.length - 1; i += 2)
          if (truthy(ev(a[i]!, scope))) return ev(a[i + 1]!, scope);
        return ev(a.at(-1)!, scope);
      }
      case 'and':
        return a.every((x) => truthy(ev(x, scope)));
      case 'or':
        return a.some((x) => truthy(ev(x, scope)));
      case 'let':
      case 'lets': {
        const inner = new Map(scope);
        for (let i = 0; i < a.length - 1; i += 2) {
          const id = a[i]!;
          if (id.k !== 'ident') fail(id, 'Name einer Variablen erwartet');
          inner.set((id as { name: string }).name, ev(a[i + 1]!, inner));
        }
        return ev(a.at(-1)!, inner);
      }
      case 'id':
        if (a.length === 0) return ctx.self?.id ?? null;
        break;
    }
    if (LIST_LAMBDA.has(n.name)) {
      const raw = ev(a[0]!, scope);
      const items = raw === null ? [] : Array.isArray(raw) ? raw : [raw];
      const inner = new Map(scope);
      const run = (x: Value, i: number) => {
        inner.set('current', x);
        inner.set('index', i);
        return ev(a[1]!, inner);
      };
      switch (n.name) {
        case 'map':
          return items.map(run);
        case 'filter':
          return items.filter((x, i) => truthy(run(x, i)));
        case 'find':
          return items.find((x, i) => truthy(run(x, i))) ?? null;
        case 'findIndex':
          return items.findIndex((x, i) => truthy(run(x, i)));
        case 'some':
          return items.some((x, i) => truthy(run(x, i)));
        case 'every':
          return items.every((x, i) => truthy(run(x, i)));
      }
    }
    const b = BUILTINS[n.name];
    if (!b) return fail(n.nameSpan, `Unbekannte Funktion "${n.name}"`);
    if (a.length < b.min || a.length > b.max)
      fail(n.nameSpan, `Falsche Anzahl Argumente für "${n.name}"`);
    const values = a.map((x) => ev(x, scope));
    return wrap(n, () => b.impl(values, env));
  }

  return ev(ast, new Map());
}

/** Prüfen und auswerten in einem Schritt (Tests, Vorschau). */
export function run(
  src: string,
  ctx: EvalContext & { types?: Record<string, Type> } = { props: {} },
): Value {
  if (ctx.types) check(src, { props: ctx.types });
  return evaluate(src, ctx);
}
