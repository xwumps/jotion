import { check, FormulaError, resultTypeOf, type Type } from '@jotion/formula';
import type { ResultType } from '@jotion/shared';
import { formulaType, type ComputeProperty } from './convert';

export interface FormulaAnalysis {
  resultType: ResultType;
  error: string | null;
  volatile: boolean;
  /** IDs der referenzierten Properties */
  refs: string[];
  /** Fehlerposition für den Editor */
  errorAt?: { start: number; end: number };
}

/** Typen aller Properties nach Namen (ohne das Property selbst). */
export function propTypes(props: ComputeProperty[], selfId?: string): Record<string, Type> {
  const out: Record<string, Type> = {};
  for (const p of props) if (p.id !== selfId) out[p.name] = formulaType(p);
  return out;
}

/** Prüft eine Formel gegen die Properties der Datenbank (inklusive Zyklen über andere Formeln). */
export function analyzeFormula(
  expression: string,
  props: ComputeProperty[],
  selfId?: string,
): FormulaAnalysis {
  try {
    const r = check(expression, { props: propTypes(props, selfId) });
    const byName = new Map(props.map((p) => [p.name, p]));
    const refs = r.refs.map((n) => byName.get(n)!.id);
    if (selfId && reachesSelf(selfId, refs, props)) {
      return {
        resultType: 'empty',
        error: 'Die Formel verweist über andere Formeln auf sich selbst',
        volatile: false,
        refs,
      };
    }
    return { resultType: resultTypeOf(r.type), error: null, volatile: r.volatile, refs };
  } catch (err) {
    if (err instanceof FormulaError)
      return {
        resultType: 'empty',
        error: err.message,
        volatile: false,
        refs: [],
        errorAt: { start: err.start, end: err.end },
      };
    throw err;
  }
}

/** Referenzen einer gespeicherten Formel (Namen auflösen, bei Fehlern keine). */
export function formulaRefs(p: ComputeProperty, props: ComputeProperty[]): string[] {
  if (p.type !== 'formula') return [];
  try {
    const r = check(String(p.config.expression ?? ''), { props: propTypes(props, p.id) });
    const byName = new Map(props.map((x) => [x.name, x.id]));
    return r.refs.map((n) => byName.get(n)!).filter(Boolean);
  } catch {
    return [];
  }
}

function reachesSelf(selfId: string, start: string[], props: ComputeProperty[]): boolean {
  const byId = new Map(props.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === selfId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = byId.get(id);
    if (p) stack.push(...formulaRefs(p, props));
  }
  return false;
}

/**
 * Berechnungsreihenfolge innerhalb einer Zeile: Rollups zuerst (hängen nur von anderen Zeilen ab),
 * dann Formeln topologisch nach ihren Referenzen. Formeln in Zyklen werden ausgelassen.
 */
export function computeOrder(props: ComputeProperty[]): ComputeProperty[] {
  const computed = props.filter((p) => p.type === 'formula' || p.type === 'rollup');
  const rollups = computed.filter((p) => p.type === 'rollup');
  const formulas = computed.filter((p) => p.type === 'formula');
  const deps = new Map(formulas.map((f) => [f.id, formulaRefs(f, props)]));
  const done = new Set(rollups.map((r) => r.id));
  const out = [...rollups];
  let progress = true;
  while (progress) {
    progress = false;
    for (const f of formulas) {
      if (done.has(f.id)) continue;
      const ready = deps.get(f.id)!.every((d) => done.has(d) || !deps.has(d));
      if (ready) {
        out.push(f);
        done.add(f.id);
        progress = true;
      }
    }
  }
  return out;
}
