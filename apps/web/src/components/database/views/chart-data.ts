import {
  EMPTY_GROUP,
  type ChartConfig,
  type ChartDataDto,
  type DatabaseDto,
  type GroupBy,
  type MemberDto,
  type OptionColor,
  type PropertyDto,
} from '@jotion/shared';
import { optionsOf } from '../property-meta';
import { groupLabel } from './use-views';

/** Aufbereitete Reihen für ECharts: Kategorien (X), Serien mit Werten, Farben. */
export interface ChartSeries {
  key: string;
  label: string;
  color: string | null;
  values: number[];
}
export interface PreparedChart {
  categories: { key: string; label: string; color: string | null }[];
  series: ChartSeries[];
}

export const PALETTES: Record<string, string[]> = {
  jotion: [
    '#2383e2',
    '#e16259',
    '#4dab9a',
    '#d9730d',
    '#9065b0',
    '#cb912f',
    '#c14c8a',
    '#64473a',
    '#787774',
    '#0b6e99',
  ],
  pastel: [
    '#8ab4f8',
    '#f6aea9',
    '#a8dab5',
    '#fdd663',
    '#d7aefb',
    '#fcad70',
    '#aecbfa',
    '#e6c9a8',
    '#c5cae9',
    '#b2dfdb',
  ],
  vivid: [
    '#0057ff',
    '#ff3b30',
    '#00b386',
    '#ff9500',
    '#af52de',
    '#ffcc00',
    '#ff2d55',
    '#5ac8fa',
    '#34c759',
    '#5856d6',
  ],
  mono: ['#37352f', '#55534e', '#73726e', '#91908c', '#afaeaa', '#cdccc8'],
};

/** Optionsfarben (Notion-Farbtöne, gut lesbar in hell und dunkel). */
export const OPTION_HEX: Record<OptionColor, string> = {
  default: '#9b9a97',
  gray: '#787774',
  brown: '#9f6b53',
  orange: '#d9730d',
  yellow: '#cb912f',
  green: '#448361',
  blue: '#337ea9',
  purple: '#9065b0',
  pink: '#c14c8a',
  red: '#d44c47',
};

interface Labels {
  empty: (p: PropertyDto) => string;
  checked: string;
  unchecked: string;
  week: (day: string) => string;
}

function axisBy(axis: NonNullable<ChartConfig['x']>): GroupBy {
  return {
    propertyId: axis.propertyId,
    hideEmpty: false,
    dateBucket: axis.dateBucket,
    numberInterval: axis.numberInterval,
    sort: 'manual',
    order: [],
    hidden: [],
    collapsed: [],
  };
}

/** Reihenfolge von Schlüsseln: Optionen in ihrer Reihenfolge, sonst Datum/Zahl/Text sortiert. */
function orderKeys(prop: PropertyDto | undefined, keys: string[]): string[] {
  if (!prop) return keys;
  const opts = optionsOf(prop).map((o) => o.id);
  if (opts.length) {
    const rank = (k: string) =>
      k === EMPTY_GROUP ? -1 : opts.indexOf(k) === -1 ? 1e6 : opts.indexOf(k);
    return [...keys].sort((a, b) => rank(a) - rank(b));
  }
  const num = keys.every((k) => k === EMPTY_GROUP || !Number.isNaN(Number(k)));
  return [...keys].sort((a, b) => {
    if (a === EMPTY_GROUP) return 1;
    if (b === EMPTY_GROUP) return -1;
    return num ? Number(a) - Number(b) : a.localeCompare(b);
  });
}

export function prepareChart(
  db: DatabaseDto,
  cfg: ChartConfig,
  data: ChartDataDto,
  members: MemberDto[],
  locale: string,
  labels: Labels,
): PreparedChart {
  const xProp = cfg.x ? db.properties.find((p) => p.id === cfg.x!.propertyId) : undefined;
  const sProp = cfg.series ? db.properties.find((p) => p.id === cfg.series!.propertyId) : undefined;
  let points = data.points;
  if (cfg.hideEmpty) points = points.filter((p) => p.x !== EMPTY_GROUP && p.series !== EMPTY_GROUP);

  const label = (prop: PropertyDto | undefined, axis: ChartConfig['x'], key: string) =>
    prop && axis ? groupLabel(prop, axisBy(axis), key, members, locale, labels) : key;
  const colorOf = (prop: PropertyDto | undefined, key: string): string | null => {
    if (!prop || !cfg.display.optionColors) return null;
    const o = optionsOf(prop).find((x) => x.id === key);
    return o ? OPTION_HEX[o.color] : null;
  };

  let xKeys = orderKeys(xProp, [...new Set(points.map((p) => p.x))]);
  const sKeys = orderKeys(sProp, [...new Set(points.map((p) => p.series))]);
  const value = (x: string, s: string) =>
    points.find((p) => p.x === x && p.series === s)?.value ?? 0;
  const totalOf = (x: string) => sKeys.reduce((n, s) => n + value(x, s), 0);

  // Sortierung nach Y und Top-N (über die Summe aller Serien)
  if (cfg.sort === 'y_asc' || cfg.sort === 'y_desc') {
    xKeys = [...xKeys].sort((a, b) =>
      cfg.sort === 'y_asc' ? totalOf(a) - totalOf(b) : totalOf(b) - totalOf(a),
    );
  } else if (cfg.sort === 'x_desc') xKeys = [...xKeys].reverse();
  if (cfg.topN) {
    const top = [...xKeys].sort((a, b) => totalOf(b) - totalOf(a)).slice(0, cfg.topN);
    xKeys = xKeys.filter((k) => top.includes(k));
  }

  const series: ChartSeries[] = sKeys.map((s) => {
    let values = xKeys.map((x) => value(x, s));
    if (cfg.cumulative) {
      let acc = 0;
      values = values.map((v) => (acc += v));
    }
    return {
      key: s,
      label: s === '' ? (cfg.y.measure === 'count' ? '' : '') : label(sProp, cfg.series, s),
      color: colorOf(sProp, s),
      values,
    };
  });
  // Gestapelt 100 %: Anteile je X
  if (cfg.stack === 'percent') {
    const totals = xKeys.map((_, i) => series.reduce((n, s) => n + s.values[i]!, 0));
    for (const s of series)
      s.values = s.values.map((v, i) => (totals[i] ? Math.round((v / totals[i]!) * 1000) / 10 : 0));
  }
  return {
    categories: xKeys.map((k) => ({
      key: k,
      label: label(xProp, cfg.x, k),
      color: colorOf(xProp, k),
    })),
    series,
  };
}
