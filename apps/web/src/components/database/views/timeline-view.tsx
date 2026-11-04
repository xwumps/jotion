'use client';

import {
  EMPTY_GROUP,
  TIMELINE_ZOOMS,
  type DatabaseDto,
  type DateValue,
  type MemberDto,
  type PropertyDto,
  type RowDto,
  type TimelineZoom,
  type ViewConfig,
  type ViewDto,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageIcon } from '../../page/page-icon';
import { ValueDisplay } from '../cells';
import type { DatabaseActions } from '../use-database';
import { useGroupLabels } from './board-view';
import { cardProperties } from './card';
import {
  addDays,
  dayNum,
  dayStr,
  instantPos,
  isWeekend,
  movedValues,
  rowSpan,
  today,
} from './dates';
import { buildGroups, useRangeRows } from './use-views';

interface Props {
  db: DatabaseDto;
  view: ViewDto;
  search: string;
  members: MemberDto[];
  actions: DatabaseActions;
  editable: boolean;
  onOpenRow: (rowId: string) => void;
  saveConfig: (patch: Partial<ViewConfig>) => void;
}

/** Pixel je Tag und sichtbare Tage je Zoomstufe. */
const SCALE: Record<TimelineZoom, { px: number; days: number }> = {
  hours: { px: 960, days: 4 },
  day: { px: 80, days: 42 },
  week: { px: 32, days: 120 },
  bi_week: { px: 18, days: 180 },
  month: { px: 6, days: 400 },
  quarter: { px: 2.5, days: 800 },
  year: { px: 1, days: 1500 },
};
const ROW_H = 36;
const HEAD_H = 48;

interface Drag {
  rowId: string;
  edge: 'move' | 'start' | 'end';
  startX: number;
  dx: number;
}

/** Gruppenschlüssel für die Zeitleiste (Optionen, Personen, Checkbox, Text). */
function clientKeys(row: RowDto, prop: PropertyDto): string[] {
  if (prop.type === 'title') return [row.title || EMPTY_GROUP];
  if (prop.type === 'created_by') return [row.createdById];
  if (prop.type === 'last_edited_by') return [row.lastEditedById];
  const v = row.values[prop.id];
  if (prop.type === 'checkbox') return [v === true ? 'true' : 'false'];
  if (Array.isArray(v)) return v.length ? (v as string[]) : [EMPTY_GROUP];
  return typeof v === 'string' && v ? [v] : [EMPTY_GROUP];
}

export function TimelineView({
  db,
  view,
  search,
  members,
  actions,
  editable,
  onOpenRow,
  saveConfig,
}: Props) {
  const t = useTranslations('views');
  const td = useTranslations('database');
  const locale = useLocale();
  const labels = useGroupLabels();
  const tl = {
    startPropertyId: null,
    endPropertyId: null,
    zoom: 'week' as TimelineZoom,
    showTable: true,
    tableWidth: 280,
    ...view.config.timeline,
  };
  const startProp = db.properties.find((p) => p.id === tl.startPropertyId);
  const endProp = db.properties.find((p) => p.id === tl.endPropertyId) ?? null;
  const scale = SCALE[tl.zoom];
  const [anchor, setAnchor] = useState(today);
  const from = addDays(anchor, -Math.floor(scale.days / 3));
  const to = addDays(from, scale.days);
  const q = useRangeRows(
    db,
    view,
    search,
    startProp
      ? { startPropertyId: startProp.id, endPropertyId: endProp?.id ?? null, from, to }
      : null,
  );
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, setPending] = useState<Map<string, Record<string, DateValue>>>(new Map());
  const scroller = useRef<HTMLDivElement>(null);
  const fromN = dayNum(from);
  const px = scale.px;
  const width = scale.days * px;
  const nowPos = instantPos(new Date().toISOString());

  // Beim Öffnen und nach dem Springen "Heute" bzw. den Anker links ins Bild holen
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, (dayNum(anchor) - fromN) * px - 80);
  }, [anchor, fromN, px]);

  const rows = useMemo(
    () =>
      (q.data ?? []).map((r) => {
        const p = pending.get(r.id);
        return p ? { ...r, values: { ...r.values, ...p } } : r;
      }),
    [q.data, pending],
  );

  // Gruppen (optional)
  const by = view.config.groupBy;
  const groupProp = by ? db.properties.find((p) => p.id === by.propertyId) : undefined;
  const sections = useMemo(() => {
    if (!by || !groupProp) return [{ key: '', label: '', rows }];
    const counts = new Map<string, number>();
    const byKey = new Map<string, RowDto[]>();
    for (const r of rows)
      for (const k of clientKeys(r, groupProp)) {
        counts.set(k, (counts.get(k) ?? 0) + 1);
        byKey.set(k, [...(byKey.get(k) ?? []), r]);
      }
    return buildGroups(groupProp, by, counts, members, locale, labels)
      .filter((g) => !g.hidden && (g.count > 0 || !by.hideEmpty))
      .map((g) => ({ key: g.key, label: g.label, rows: byKey.get(g.key) ?? [] }));
  }, [rows, by, groupProp, members, locale, labels]);

  if (!startProp)
    return (
      <div className="py-8 text-center text-[14px] text-fg-subtle" data-testid="timeline-no-date">
        {t('chooseDate')}
      </div>
    );

  const canEdit = editable && startProp.type === 'date' && (!endProp || endProp.type === 'date');
  const unit = tl.zoom === 'hours' ? 1 / 24 : 1;
  const deltaOf = (dx: number) => Math.round(dx / px / unit) * unit;

  const commit = (row: RowDto, d: Drag) => {
    const delta = deltaOf(d.dx);
    if (!delta) return;
    const days = Math.trunc(delta);
    const ms = Math.round((delta - days) * 86_400_000);
    const values = movedValues(row, startProp, endProp, d.edge, days, ms);
    if (!values) return;
    setPending((m) => new Map(m).set(row.id, values));
    actions.updateRow.mutate(
      { rowId: row.id, values },
      {
        onSettled: () =>
          setTimeout(
            () =>
              setPending((m) => {
                const n = new Map(m);
                n.delete(row.id);
                return n;
              }),
            600,
          ),
      },
    );
  };

  const onPointerDown = (e: React.PointerEvent, row: RowDto, edge: Drag['edge']) => {
    if (!canEdit || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start: Drag = { rowId: row.id, edge, startX: e.clientX, dx: 0 };
    setDrag(start);
    let moved = false;
    let last = start;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.startX;
      if (Math.abs(dx) > 3) moved = true;
      last = { ...start, dx };
      setDrag(last);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      if (moved) commit(row, last);
      else if (edge === 'move') onOpenRow(row.id);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const step = (n: number) => setAnchor((a) => addDays(a, Math.round((n * scale.days) / 3)));
  const cardProps = cardProperties(db, view.config).slice(0, 2);
  const tableW = tl.showTable ? tl.tableWidth : 0;

  return (
    <div className="flex flex-col gap-2 pt-2" data-testid="timeline">
      <div className="flex items-center gap-1 text-[14px]">
        <select
          value={tl.zoom}
          onChange={(e) =>
            saveConfig({
              timeline: { ...tl, zoom: e.target.value as TimelineZoom } as ViewConfig['timeline'],
            })
          }
          className="h-7 rounded-md border border-border bg-bg px-1 text-[13px]"
          aria-label={t('zoom')}
          data-testid="timeline-zoom"
        >
          {TIMELINE_ZOOMS.map((z) => (
            <option key={z} value={z}>
              {t(`zooms.${z}`)}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={t('previous')}
            className="rounded-md p-1 hover:bg-hover"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setAnchor(today())}
            className="h-7 rounded-md px-2 hover:bg-hover"
            data-testid="timeline-today"
          >
            {t('today')}
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t('next')}
            className="rounded-md p-1 hover:bg-hover"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex overflow-hidden rounded-md border border-border">
        {tl.showTable && (
          <div
            className="shrink-0 border-r border-border"
            style={{ width: tableW }}
            data-testid="timeline-table"
          >
            <div
              className="flex items-end border-b border-border px-2 pb-1 text-[12px] text-fg-subtle"
              style={{ height: HEAD_H }}
            >
              {td('title')}
            </div>
            {sections.map((s) => (
              <div key={s.key}>
                {s.label && (
                  <div
                    className="flex h-8 items-center bg-hover/40 px-2 text-[13px] font-medium"
                    data-testid="timeline-group"
                  >
                    {s.label}
                  </div>
                )}
                {s.rows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onOpenRow(r.id)}
                    className="flex w-full items-center gap-1.5 border-b border-border/50 px-2 text-left text-[14px] hover:bg-hover"
                    style={{ height: ROW_H }}
                  >
                    {r.icon && <PageIcon icon={r.icon} size={14} />}
                    <span className={cn('truncate', !r.title && 'text-fg-subtle')}>
                      {r.title || td('untitled')}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        <div
          ref={scroller}
          className="relative min-w-0 flex-1 overflow-x-auto"
          data-testid="timeline-scroll"
        >
          <div className="relative" style={{ width }}>
            <Header fromN={fromN} days={scale.days} px={px} zoom={tl.zoom} locale={locale} />
            {/* Wochenenden und Heute-Linie */}
            {px >= 18 &&
              Array.from({ length: scale.days }, (_, i) => dayStr(fromN + i))
                .filter(isWeekend)
                .map((d) => (
                  <div
                    key={d}
                    className="pointer-events-none absolute bottom-0 bg-hover/50"
                    style={{ top: HEAD_H, left: (dayNum(d) - fromN) * px, width: px }}
                  />
                ))}
            {nowPos >= fromN && nowPos <= fromN + scale.days && (
              <div
                className="pointer-events-none absolute bottom-0 z-10 w-px bg-[var(--c-red)]"
                style={{ top: HEAD_H - 6, left: (nowPos - fromN) * px }}
                data-testid="timeline-today-line"
              />
            )}
            {sections.map((s) => (
              <div key={s.key}>
                {s.label && <div className="h-8 border-b border-border/50 bg-hover/40" />}
                {s.rows.map((r) => {
                  const span = rowSpan(r, startProp, endProp);
                  if (!span) return <div key={r.id} style={{ height: ROW_H }} />;
                  const d = drag?.rowId === r.id ? drag : null;
                  const shift = d ? deltaOf(d.dx) * px : 0;
                  let left = (span.start - fromN) * px;
                  let w = Math.max((span.end - span.start) * px, 8);
                  if (d?.edge === 'move') left += shift;
                  if (d?.edge === 'start') {
                    left += shift;
                    w = Math.max(8, w - shift);
                  }
                  if (d?.edge === 'end') w = Math.max(8, w + shift);
                  return (
                    <div
                      key={r.id}
                      className="relative border-b border-border/50"
                      style={{ height: ROW_H }}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onPointerDown={(e) => onPointerDown(e, r, 'move')}
                        onKeyDown={(e) => e.key === 'Enter' && onOpenRow(r.id)}
                        className={cn(
                          'absolute top-1.5 flex h-6 items-center gap-1 overflow-hidden whitespace-nowrap rounded-md border border-border bg-bg-elevated px-2 text-[12px] shadow-sm hover:bg-hover',
                          canEdit ? 'cursor-grab' : 'cursor-pointer',
                          d && 'cursor-grabbing shadow-popover',
                        )}
                        style={{ left, width: w }}
                        data-testid="timeline-bar"
                        data-row={r.id}
                      >
                        {canEdit && (
                          <span
                            onPointerDown={(e) => onPointerDown(e, r, 'start')}
                            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
                            data-testid="timeline-resize-start"
                          />
                        )}
                        <span className="truncate font-medium">{r.title || td('untitled')}</span>
                        {cardProps.map((p) => (
                          <span
                            key={p.id}
                            className="flex items-center text-fg-muted [&_*]:text-[11px]"
                          >
                            <ValueDisplay prop={p} row={r} members={members} />
                          </span>
                        ))}
                        {canEdit && (
                          <span
                            onPointerDown={(e) => onPointerDown(e, r, 'end')}
                            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                            data-testid="timeline-resize-end"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Zeitachse: obere Zeile Monate (bzw. Tage bei Stunden), untere Zeile Einheiten der Zoomstufe. */
function Header({
  fromN,
  days,
  px,
  zoom,
  locale,
}: {
  fromN: number;
  days: number;
  px: number;
  zoom: TimelineZoom;
  locale: string;
}) {
  const top: { left: number; label: string }[] = [];
  const bottom: { left: number; label: string }[] = [];
  for (let i = 0; i < days; i++) {
    const d = dayStr(fromN + i);
    const date = new Date(`${d}T00:00:00Z`);
    const left = i * px;
    if (zoom === 'hours') {
      top.push({
        left,
        label: date.toLocaleDateString(locale, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        }),
      });
      for (let h = 0; h < 24; h += 2) bottom.push({ left: left + (h / 24) * px, label: `${h}:00` });
      continue;
    }
    if (date.getUTCDate() === 1 || i === 0)
      top.push({
        left,
        label: date.toLocaleDateString(locale, {
          month: px >= 2 ? 'long' : 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }),
      });
    if (zoom === 'day' || zoom === 'week' || zoom === 'bi_week') {
      if (px >= 18 || date.getUTCDay() === 1)
        bottom.push({ left, label: String(date.getUTCDate()) });
    } else if (zoom === 'month' && date.getUTCDay() === 1)
      bottom.push({ left, label: String(date.getUTCDate()) });
  }
  return (
    <div
      className="sticky top-0 z-10 border-b border-border bg-bg text-[11px] text-fg-subtle"
      style={{ height: HEAD_H }}
    >
      {top.map((x) => (
        <span
          key={`t${x.left}`}
          className="absolute top-1 whitespace-nowrap border-l border-border pl-1 font-medium text-fg-muted"
          style={{ left: x.left }}
        >
          {x.label}
        </span>
      ))}
      {bottom.map((x) => (
        <span
          key={`b${x.left}`}
          className="absolute bottom-1 whitespace-nowrap pl-1"
          style={{ left: x.left }}
        >
          {x.label}
        </span>
      ))}
    </div>
  );
}
