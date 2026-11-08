import {
  listOf,
  toText,
  type DateVal,
  type ResultType as FormulaResultType,
  type Type,
  type Value,
} from '@jotion/formula';
import type {
  ComputedItem,
  ComputedValue,
  DateValue,
  PropertyType,
  ResultType,
} from '@jotion/shared';

/** Property mit Namen und gespeicherter Konfiguration. */
export interface ComputeProperty {
  id: string;
  name: string;
  type: PropertyType;
  config: Record<string, unknown>;
}

/** Typ eines Properties in der Formelsprache. */
export function formulaType(p: ComputeProperty): Type {
  switch (p.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'select':
    case 'status':
      return 'text';
    case 'number':
    case 'unique_id':
      return 'number';
    case 'checkbox':
      return 'boolean';
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return 'date';
    case 'multi_select':
    case 'files':
      return listOf('text');
    case 'person':
      return listOf('person');
    case 'created_by':
    case 'last_edited_by':
      return 'person';
    case 'relation':
      return listOf('page');
    case 'formula':
    case 'rollup': {
      const rt = (p.config.resultType as ResultType | undefined) ?? 'empty';
      return rt === 'list' ? listOf('any') : rt;
    }
    case 'button':
      return 'empty';
  }
}

export const toResultType = (t: FormulaResultType): ResultType => t;

// ---------------------------------------------------------------- Werte

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function dateToApi(d: DateVal): DateValue {
  const f = (ms: number) => (d.hasTime ? new Date(ms).toISOString() : isoDay(ms));
  return {
    start: f(d.start),
    end: d.end === null ? null : f(d.end),
    hasTime: d.hasTime,
    timeZone: null,
  };
}

export function dateFromApi(v: DateValue): DateVal {
  const ms = (s: string) => (v.hasTime ? Date.parse(s) : Date.parse(`${s}T00:00:00Z`));
  return { kind: 'date', start: ms(v.start), end: v.end ? ms(v.end) : null, hasTime: v.hasTime };
}

/** Formelwert ins API-Format (Listen flach, nur endliche Zahlen). */
export function toComputed(v: Value): ComputedValue {
  if (v === null) return null;
  if (Array.isArray(v)) {
    const flat: ComputedItem[] = [];
    const walk = (x: Value) => {
      if (Array.isArray(x)) x.forEach(walk);
      else {
        const c = toComputed(x);
        if (c !== null && !Array.isArray(c)) flat.push(c);
      }
    };
    v.forEach(walk);
    return flat.slice(0, 1000);
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (v.kind === 'date') return dateToApi(v);
  if (v.kind === 'person') return { kind: 'person', id: v.id, name: v.name };
  return { kind: 'page', id: v.id, title: v.title };
}

/** API-Format zurück in einen Formelwert (gespeicherte Formel- und Rollup-Ergebnisse). */
export function fromComputed(v: ComputedValue | undefined): Value {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map((x) => fromComputed(x));
  if (typeof v !== 'object') return v;
  if ('kind' in v) {
    if (v.kind === 'person') return { kind: 'person', id: v.id, name: v.name, email: '' };
    return { kind: 'page', id: v.id, title: v.title };
  }
  return dateFromApi(v);
}

/** Typspalten für ein berechnetes Ergebnis. null = Eintrag löschen. */
export interface ComputedColumns {
  v_text: string | null;
  v_number: number | null;
  v_bool: boolean | null;
  v_date_start: Date | null;
  v_date_end: Date | null;
  v_date_has_time: boolean | null;
  v_json: ComputedValue;
}

export function computedColumns(
  resultType: ResultType,
  value: Value,
  timeZone: string,
): ComputedColumns | null {
  const json = toComputed(value);
  const isEmptyList = Array.isArray(json) && json.length === 0;
  // Wahrheitswerte immer speichern (Filter "ist nicht angehakt" braucht auch false)
  if (resultType === 'boolean') {
    return {
      v_text: null,
      v_number: null,
      v_bool: value === true,
      v_date_start: null,
      v_date_end: null,
      v_date_has_time: null,
      v_json: value === true,
    };
  }
  if (json === null || json === '' || isEmptyList) return null;
  const cols: ComputedColumns = {
    v_text: null,
    v_number: null,
    v_bool: null,
    v_date_start: null,
    v_date_end: null,
    v_date_has_time: null,
    v_json: json,
  };
  if (resultType === 'number' && typeof value === 'number') cols.v_number = value;
  else if (
    resultType === 'date' &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.kind === 'date'
  ) {
    cols.v_date_start = new Date(value.start);
    cols.v_date_end = value.end === null ? null : new Date(value.end);
    cols.v_date_has_time = value.hasTime;
  } else cols.v_text = toText(value, timeZone).slice(0, 10_000);
  return cols;
}
