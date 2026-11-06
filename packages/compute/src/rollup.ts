import { compare, equal, isEmpty, type DateVal, type Value } from '@jotion/formula';
import type { PropertyType, ResultType, RollupAggregation } from '@jotion/shared';

/** Ergebnistyp eines Rollups aus Aggregation und Typ des Ziel-Properties. */
export function rollupResultType(agg: RollupAggregation, _targetType: PropertyType): ResultType {
  switch (agg) {
    case 'show_original':
    case 'show_unique':
      return 'list';
    case 'earliest_date':
    case 'latest_date':
    case 'date_range':
      return 'date';
    default:
      return 'number';
  }
}

/** Welche Aggregationen zu welchem Ziel-Typ passen (für die Oberfläche und die Prüfung). */
export function rollupAggregationsFor(type: PropertyType): RollupAggregation[] {
  const base: RollupAggregation[] = [
    'show_original',
    'show_unique',
    'count_all',
    'count_values',
    'count_unique',
    'count_empty',
    'count_not_empty',
    'percent_empty',
    'percent_not_empty',
  ];
  switch (type) {
    case 'number':
    case 'unique_id':
    case 'formula':
    case 'rollup':
      return [...base, 'sum', 'average', 'median', 'min', 'max', 'range'];
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return [...base, 'earliest_date', 'latest_date', 'date_range'];
    case 'checkbox':
      return [...base, 'checked', 'unchecked', 'percent_checked', 'percent_unchecked'];
    default:
      return base;
  }
}

const isDateVal = (v: Value): v is DateVal =>
  !!v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'date';

/**
 * Aggregiert die Werte der verknüpften Zeilen (je Zeile ein Wert, Listen werden für
 * Anzeige und Zählung von Werten aufgelöst).
 */
export function aggregate(agg: RollupAggregation, perRow: Value[]): Value {
  const flat = perRow.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => !isEmpty(v));
  const rows = perRow.length;
  const emptyRows = perRow.filter((v) => isEmpty(v) || v === false).length;
  const pct = (n: number) => (rows ? Math.round((n / rows) * 10_000) / 100 : 0);
  const nums = flat.filter((v): v is number => typeof v === 'number');
  const dates = flat.filter(isDateVal);
  const unique = flat.filter((x, i) => flat.findIndex((y) => equal(x, y)) === i);
  switch (agg) {
    case 'show_original':
      return flat;
    case 'show_unique':
      return unique;
    case 'count_all':
      return rows;
    case 'count_values':
      return flat.length;
    case 'count_unique':
      return unique.length;
    case 'count_empty':
      return perRow.filter((v) => isEmpty(v)).length;
    case 'count_not_empty':
      return perRow.filter((v) => !isEmpty(v)).length;
    case 'percent_empty':
      return pct(perRow.filter((v) => isEmpty(v)).length);
    case 'percent_not_empty':
      return pct(perRow.filter((v) => !isEmpty(v)).length);
    case 'sum':
      return nums.length ? round(nums.reduce((s, x) => s + x, 0)) : null;
    case 'average':
      return nums.length ? round(nums.reduce((s, x) => s + x, 0) / nums.length) : null;
    case 'median': {
      if (!nums.length) return null;
      const s = [...nums].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m]! : round((s[m - 1]! + s[m]!) / 2);
    }
    case 'min':
      return nums.length ? Math.min(...nums) : null;
    case 'max':
      return nums.length ? Math.max(...nums) : null;
    case 'range':
      return nums.length ? round(Math.max(...nums) - Math.min(...nums)) : null;
    case 'earliest_date':
      return dates.length ? [...dates].sort(compare)[0]! : null;
    case 'latest_date': {
      if (!dates.length) return null;
      const last = dates.reduce((a, b) => ((b.end ?? b.start) > (a.end ?? a.start) ? b : a));
      return { ...last, start: last.end ?? last.start, end: null };
    }
    case 'date_range': {
      if (!dates.length) return null;
      const start = Math.min(...dates.map((d) => d.start));
      const end = Math.max(...dates.map((d) => d.end ?? d.start));
      return {
        kind: 'date',
        start,
        end: end === start ? null : end,
        hasTime: dates.some((d) => d.hasTime),
      };
    }
    case 'checked':
      return perRow.filter((v) => v === true).length;
    case 'unchecked':
      return rows - perRow.filter((v) => v === true).length;
    case 'percent_checked':
      return pct(perRow.filter((v) => v === true).length);
    case 'percent_unchecked':
      return pct(emptyRows);
  }
}

/** Rundet Gleitkomma-Artefakte weg (0.1 + 0.2 = 0.3). */
const round = (n: number) => Number(n.toPrecision(15));
