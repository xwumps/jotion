'use client';

import {
  EMPTY_GROUP,
  effectiveType,
  type CalculationFn,
  type CalculationResultDto,
  type DatabaseDto,
  type GroupBy,
  type GroupsResultDto,
  type MemberDto,
  type MoveRowInput,
  type OptionColor,
  type PropertyDto,
  type RowDto,
  type RowQueryResultDto,
  type ViewDto,
} from '@jotion/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiPost, errorMessage } from '@/lib/api-client';
import { formatDay, formatNumber, optionsOf } from '../property-meta';
import { dbKeys, invalidateRows, PAGE_SIZE, timeZone } from '../use-database';

/**
 * Daten für Board, Liste, Galerie, Kalender und Zeitleiste (Phase 5).
 * Alle Schlüssel beginnen mit dbKeys.rows(dataId), damit Echtzeit-Ereignisse sie neu laden.
 */

const base = (db: DatabaseDto, view: ViewDto) => [...dbKeys.rows(db.dataId), db.id, view.id];

export function useGroupCounts(db: DatabaseDto, view: ViewDto, search: string, enabled = true) {
  return useQuery({
    queryKey: [...base(db, view), 'groups', search, view.config.groupBy, view.config.subGroupBy],
    enabled: enabled && !db.sourceMissing && Boolean(view.config.groupBy),
    queryFn: () =>
      apiPost<GroupsResultDto>(`/databases/${db.id}/groups`, {
        viewId: view.id,
        search: search || undefined,
        timeZone: timeZone(),
      }),
    placeholderData: (prev) => prev,
  });
}

/** Zeilen einer Gruppe (und Untergruppe), seitenweise. */
export function useGroupRows(
  db: DatabaseDto,
  view: ViewDto,
  search: string,
  group: string | undefined,
  subGroup: string | undefined,
  opts: { preview?: boolean; enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: [
      ...base(db, view),
      'group',
      group ?? null,
      subGroup ?? null,
      search,
      Boolean(opts.preview),
      view.config.groupBy,
      view.config.subGroupBy,
    ],
    enabled: opts.enabled !== false && !db.sourceMissing,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiPost<RowQueryResultDto>(`/databases/${db.id}/query`, {
        viewId: view.id,
        search: search || undefined,
        cursor: pageParam,
        limit: PAGE_SIZE,
        timeZone: timeZone(),
        group,
        subGroup,
        ...(opts.preview ? { preview: true } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: (prev) => prev,
  });
}

/** Alle Zeilen, deren Datum den Zeitraum berührt (Kalender, Zeitleiste). Höchstens 2.000. */
export function useRangeRows(
  db: DatabaseDto,
  view: ViewDto,
  search: string,
  range: {
    startPropertyId: string;
    endPropertyId?: string | null;
    from: string;
    to: string;
  } | null,
) {
  return useQuery({
    queryKey: [...base(db, view), 'range', search, range],
    enabled: Boolean(range) && !db.sourceMissing,
    queryFn: async () => {
      const rows: RowDto[] = [];
      let cursor: string | null = null;
      do {
        const res: RowQueryResultDto = await apiPost<RowQueryResultDto>(
          `/databases/${db.id}/query`,
          {
            viewId: view.id,
            search: search || undefined,
            cursor,
            limit: 200,
            timeZone: timeZone(),
            dateRange: range,
          },
        );
        rows.push(...res.rows);
        cursor = res.nextCursor;
      } while (cursor && rows.length < 2000);
      return rows;
    },
    placeholderData: (prev) => prev,
  });
}

/** Berechnung über eine Gruppe (Spaltenfuß im Board). */
export function useGroupCalculation(
  db: DatabaseDto,
  view: ViewDto,
  search: string,
  group: string,
  subGroup: string | undefined,
  calc: { propertyId: string; fn: CalculationFn } | null,
) {
  return useQuery({
    queryKey: [
      ...dbKeys.calc(db.dataId),
      db.id,
      view.id,
      'group',
      group,
      subGroup ?? null,
      search,
      calc,
    ],
    enabled: Boolean(calc) && !db.sourceMissing,
    queryFn: () =>
      apiPost<CalculationResultDto>(`/databases/${db.id}/calculate`, {
        viewId: view.id,
        search: search || undefined,
        timeZone: timeZone(),
        group,
        subGroup,
        calculations: { [calc!.propertyId]: calc!.fn },
      }),
    placeholderData: (prev) => prev,
  });
}

/** Karte verschieben (Gruppe und/oder Position) oder Datum ändern; danach alles neu laden. */
export function useMoveRow(db: DatabaseDto) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rowId, ...input }: MoveRowInput & { rowId: string }) =>
      apiPost<RowDto>(`/databases/${db.id}/rows/${rowId}/move`, {
        ...input,
        timeZone: timeZone(),
      }),
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: async () => {
      invalidateRows(qc, db.dataId);
      await qc.refetchQueries({ queryKey: dbKeys.rows(db.dataId), type: 'active' });
    },
  });
}

// ---------------------------------------------------------------- Gruppen aufbereiten

export interface GroupInfo {
  key: string;
  label: string;
  color: OptionColor | null;
  count: number;
  hidden: boolean;
  /** Option der Gruppe (umbenennen, einfärben) */
  optionId: string | null;
}

interface Labels {
  empty: (prop: PropertyDto) => string;
  checked: string;
  unchecked: string;
  week: (day: string) => string;
}

const OPTION_TYPES = ['select', 'status', 'multi_select'];

export function groupLabel(
  original: PropertyDto,
  by: GroupBy,
  key: string,
  members: MemberDto[],
  locale: string,
  l: Labels,
): string {
  if (key === EMPTY_GROUP) return l.empty(original);
  // Formeln und Rollups gruppieren nach ihrem Ergebnistyp
  const prop = { ...original, type: effectiveType(original.type, original.config) };
  switch (prop.type) {
    case 'select':
    case 'status':
    case 'multi_select':
      return optionsOf(prop).find((o) => o.id === key)?.name ?? '?';
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return members.find((m) => m.userId === key)?.name ?? '?';
    case 'checkbox':
      return key === 'true' ? l.checked : l.unchecked;
    case 'number': {
      const n = Number(key);
      const cfg = prop.config as Parameters<typeof formatNumber>[1];
      return `${formatNumber(n, cfg, locale)} – ${formatNumber(n + by.numberInterval, cfg, locale)}`;
    }
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const d = new Date(`${key}T00:00:00Z`);
      switch (by.dateBucket) {
        case 'year':
          return String(d.getUTCFullYear());
        case 'month':
          return d.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
        case 'week':
          return l.week(formatDay(key, locale, 'short'));
        default:
          return formatDay(key, locale);
      }
    }
    default:
      return key;
  }
}

/**
 * Gruppen in Anzeigereihenfolge: Optionen in ihrer Reihenfolge (leer zuerst), sonst die
 * vorhandenen Schlüssel sortiert; manuelle Reihenfolge und Ausblenden aus der Ansicht.
 */
export function buildGroups(
  original: PropertyDto,
  by: GroupBy,
  counts: Map<string, number>,
  members: MemberDto[],
  locale: string,
  labels: Labels,
): GroupInfo[] {
  const prop = { ...original, type: effectiveType(original.type, original.config) };
  const options = OPTION_TYPES.includes(prop.type) ? optionsOf(prop) : [];
  let keys: string[];
  if (options.length || OPTION_TYPES.includes(prop.type))
    keys = [EMPTY_GROUP, ...options.map((o) => o.id)];
  else if (prop.type === 'checkbox') keys = ['false', 'true'];
  else {
    const present = [...counts.keys()].filter((k) => k !== EMPTY_GROUP);
    const numeric = prop.type === 'number';
    present.sort((a, b) => (numeric ? Number(a) - Number(b) : a.localeCompare(b)));
    keys = [EMPTY_GROUP, ...present];
  }
  const all = keys.map((key) => {
    const opt = options.find((o) => o.id === key);
    return {
      key,
      label: groupLabel(original, by, key, members, locale, labels),
      color: opt?.color ?? null,
      count: counts.get(key) ?? 0,
      hidden: by.hidden.includes(key) || (by.hideEmpty && (counts.get(key) ?? 0) === 0),
      optionId: opt?.id ?? null,
    };
  });
  if (by.sort === 'manual' && by.order.length) {
    const pos = (k: string) => {
      const i = by.order.indexOf(k);
      return i === -1 ? by.order.length + keys.indexOf(k) : i;
    };
    all.sort((a, b) => pos(a.key) - pos(b.key));
  } else if (by.sort !== 'manual') {
    all.sort((a, b) => a.label.localeCompare(b.label, locale, { numeric: true }));
    if (by.sort === 'desc') all.reverse();
  }
  return all;
}

export function countsByKey(
  res: GroupsResultDto | undefined,
  subKey?: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of res?.counts ?? []) {
    if (subKey !== undefined && c.subKey !== subKey) continue;
    out.set(c.key, (out.get(c.key) ?? 0) + c.count);
  }
  return out;
}

export function subCounts(res: GroupsResultDto | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of res?.counts ?? [])
    if (c.subKey !== null) out.set(c.subKey, (out.get(c.subKey) ?? 0) + c.count);
  return out;
}

/** Wert für eine neue Zeile in einer Gruppe ("+ Neu" in einer Spalte). */
export function valueForGroup(prop: PropertyDto, key: string): unknown {
  if (key === EMPTY_GROUP) return undefined;
  switch (prop.type) {
    case 'select':
    case 'status':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return key;
    case 'multi_select':
    case 'person':
      return [key];
    case 'checkbox':
      return key === 'true';
    case 'number':
      return Number(key);
    case 'date':
      return { start: key };
    default:
      return undefined;
  }
}

/** Kann eine Karte durch Ziehen in eine andere Gruppe dieses Properties wechseln? */
export const canDragBetweenGroups = (prop: PropertyDto) =>
  ![
    'created_time',
    'created_by',
    'last_edited_time',
    'last_edited_by',
    'unique_id',
    'formula',
    'rollup',
  ].includes(prop.type);
