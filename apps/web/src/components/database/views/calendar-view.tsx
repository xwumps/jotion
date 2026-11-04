'use client';

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import type {
  DatabaseDto,
  DateValue,
  MemberDto,
  RowDto,
  ViewConfig,
  ViewDto,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { PageIcon } from '../../page/page-icon';
import { ValueDisplay } from '../cells';
import type { DatabaseActions } from '../use-database';
import { cardProperties } from './card';
import {
  addDays,
  dayNum,
  isWeekend,
  movedValues,
  newDateValue,
  rowSpan,
  today,
  weekStart,
} from './dates';
import { useRangeRows } from './use-views';

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

const LANE_H = 24;
/** Nur ganz am Rand automatisch scrollen (Standard: 20 % der Höhe, springt beim Ziehen weg) */
export const AUTO_SCROLL = { threshold: { x: 0.05, y: 0.05 }, acceleration: 6 };
const MAX_LANES_MONTH = 4;

interface Segment {
  row: RowDto;
  /** Spaltenindex (sichtbare Tage) und Breite in Spalten */
  col: number;
  span: number;
  lane: number;
  startsBefore: boolean;
  endsAfter: boolean;
  startDay: string;
}

/** Ordnet Einträge einer Woche überschneidungsfrei Zeilen (Lanes) zu. */
function layoutWeek(
  days: string[],
  items: { row: RowDto; startDay: string; endDay: string }[],
): Segment[] {
  const first = days[0]!;
  const last = days.at(-1)!;
  const inWeek = items
    .filter((i) => i.startDay <= last && i.endDay >= first)
    .sort(
      (a, b) =>
        a.startDay.localeCompare(b.startDay) ||
        dayNum(b.endDay) - dayNum(b.startDay) - (dayNum(a.endDay) - dayNum(a.startDay)),
    );
  const lanes: number[][] = [];
  const out: Segment[] = [];
  for (const i of inWeek) {
    const fromIdx = days.findIndex((d) => d >= i.startDay);
    let toIdx = -1;
    for (let k = days.length - 1; k >= 0; k--)
      if (days[k]! <= i.endDay) {
        toIdx = k;
        break;
      }
    if (fromIdx === -1 || toIdx < fromIdx) continue; // nur an ausgeblendeten Tagen
    let lane = 0;
    while (lanes[lane]?.some((c) => c >= fromIdx && c <= toIdx)) lane++;
    (lanes[lane] ??= []).push(
      ...Array.from({ length: toIdx - fromIdx + 1 }, (_, k) => fromIdx + k),
    );
    out.push({
      row: i.row,
      col: fromIdx,
      span: toIdx - fromIdx + 1,
      lane,
      startsBefore: i.startDay < first,
      endsAfter: i.endDay > last,
      startDay: i.startDay,
    });
  }
  return out;
}

export function CalendarView({
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
  const locale = useLocale();
  const cal = { datePropertyId: null, mode: 'month', showWeekends: true, ...view.config.calendar };
  const prop = db.properties.find((p) => p.id === cal.datePropertyId);
  const [anchor, setAnchor] = useState(today);
  const [pending, setPending] = useState<Map<string, Record<string, DateValue>>>(new Map());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const month = cal.mode === 'month';
  const firstOfMonth = `${anchor.slice(0, 7)}-01`;
  const gridStart = weekStart(month ? firstOfMonth : anchor);
  const lastOfMonth = addDays(addMonthsDay(firstOfMonth, 1), -1);
  const weeksCount = month ? (dayNum(weekStart(lastOfMonth)) - dayNum(gridStart)) / 7 + 1 : 1;
  const allDays = Array.from({ length: weeksCount * 7 }, (_, i) => addDays(gridStart, i));
  const weeks = Array.from({ length: weeksCount }, (_, w) =>
    allDays.slice(w * 7, w * 7 + 7).filter((d) => cal.showWeekends || !isWeekend(d)),
  );
  const range = prop ? { startPropertyId: prop.id, from: allDays[0]!, to: allDays.at(-1)! } : null;
  const q = useRangeRows(db, view, search, range);
  const cardProps = cardProperties(db, view.config).slice(0, 3);

  const items = useMemo(() => {
    if (!prop) return [];
    return (q.data ?? []).flatMap((row) => {
      const p = pending.get(row.id);
      const r = p ? { ...row, values: { ...row.values, ...p } } : row;
      const s = rowSpan(r, prop, null);
      return s ? [{ row: r, startDay: s.startDay, endDay: s.endDay }] : [];
    });
  }, [q.data, prop, pending]);

  if (!prop)
    return (
      <div className="py-8 text-center text-[14px] text-fg-subtle" data-testid="calendar-no-date">
        {t('chooseDate')}
      </div>
    );

  const draggable = editable && prop.type === 'date';
  const move = (row: RowDto, fromDay: string, toDay: string) => {
    const delta = dayNum(toDay) - dayNum(fromDay);
    if (!delta) return;
    const values = movedValues(row, prop, null, 'move', delta);
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
  const onDragEnd = (e: DragEndEvent) => {
    const a = e.active.data.current as { row: RowDto; startDay: string } | undefined;
    const o = e.over?.data.current as { day: string } | undefined;
    if (a && o) move(a.row, a.startDay, o.day);
  };
  const create = (day: string) =>
    actions.createRow.mutate(
      { values: { [prop.id]: newDateValue(day) } },
      { onSuccess: (row) => onOpenRow(row.id) },
    );

  const step = (n: number) => setAnchor((a) => (month ? addMonthsDay(a, n) : addDays(a, 7 * n)));
  const title = month
    ? new Date(`${firstOfMonth}T00:00:00Z`).toLocaleDateString(locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : `${fmt(allDays[0]!, locale)} – ${fmt(allDays[6]!, locale, true)}`;
  const nowDay = today();
  const cols = cal.showWeekends ? 7 : 5;

  return (
    <div className="flex flex-col gap-2 pt-2" data-testid="calendar">
      <div className="flex items-center gap-2">
        <span className="text-[16px] font-semibold" data-testid="calendar-title">
          {title}
        </span>
        <div className="ml-auto flex items-center gap-1 text-[14px]">
          <div className="flex rounded-md border border-border p-0.5">
            {(['month', 'week'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() =>
                  saveConfig({ calendar: { ...cal, mode: m } as ViewConfig['calendar'] })
                }
                className={cn(
                  'h-6 rounded px-2 text-[13px]',
                  cal.mode === m ? 'bg-active' : 'hover:bg-hover',
                )}
                data-testid={`calendar-${m}`}
              >
                {t(`calendarModes.${m}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={t('previous')}
            className="rounded-md p-1 hover:bg-hover"
            data-testid="calendar-prev"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setAnchor(today())}
            className="h-7 rounded-md px-2 hover:bg-hover"
          >
            {t('today')}
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t('next')}
            className="rounded-md p-1 hover:bg-hover"
            data-testid="calendar-next"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div
        className="grid text-[12px] text-fg-subtle"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {weeks[0]!.map((d) => (
          <div key={d} className="px-1.5 pb-1">
            {new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, {
              weekday: 'short',
              timeZone: 'UTC',
            })}
          </div>
        ))}
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd} autoScroll={AUTO_SCROLL}>
        <div className="overflow-hidden rounded-md border border-border">
          {weeks.map((days, w) => {
            const segs = layoutWeek(days, items);
            const maxLane = segs.reduce((m, s) => Math.max(m, s.lane + 1), 0);
            const shownLanes = month ? Math.min(maxLane, MAX_LANES_MONTH) : maxLane;
            const height = 28 + Math.max(shownLanes, month ? 3 : 6) * LANE_H + 6;
            return (
              <div
                key={w}
                className="relative border-b border-border last:border-b-0"
                style={{ height }}
              >
                <div
                  className="absolute inset-0 grid"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                >
                  {days.map((d) => (
                    <DayCell
                      key={d}
                      day={d}
                      label={Number(d.slice(8))}
                      outside={month && d.slice(0, 7) !== anchor.slice(0, 7)}
                      isToday={d === nowDay}
                      editable={editable}
                      onCreate={() => create(d)}
                      hiddenCount={
                        month
                          ? segs.filter(
                              (s) =>
                                s.lane >= MAX_LANES_MONTH &&
                                s.col <= days.indexOf(d) &&
                                s.col + s.span > days.indexOf(d),
                            ).length
                          : 0
                      }
                      moreLabel={(n) => t('more', { count: n })}
                    />
                  ))}
                </div>
                {segs
                  .filter((s) => !month || s.lane < MAX_LANES_MONTH)
                  .map((s) => (
                    <EventBar
                      key={`${s.row.id}-${w}`}
                      seg={s}
                      cols={cols}
                      draggable={draggable}
                      onOpen={() => onOpenRow(s.row.id)}
                    >
                      {cardProps.length > 0 && !month && (
                        <span className="ml-1 hidden items-center gap-1 truncate text-fg-muted sm:flex [&_*]:text-[11px]">
                          {cardProps.map((p) => (
                            <ValueDisplay key={p.id} prop={p} row={s.row} members={members} />
                          ))}
                        </span>
                      )}
                    </EventBar>
                  ))}
              </div>
            );
          })}
        </div>
      </DndContext>
    </div>
  );
}

function fmt(day: string, locale: string, year = false) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

function addMonthsDay(day: string, n: number): string {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function DayCell({
  day,
  label,
  outside,
  isToday,
  editable,
  onCreate,
  hiddenCount,
  moreLabel,
}: {
  day: string;
  label: number;
  outside: boolean;
  isToday: boolean;
  editable: boolean;
  onCreate: () => void;
  hiddenCount: number;
  moreLabel: (n: number) => string;
}) {
  const t = useTranslations('views');
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}`, data: { day } });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group/day relative border-r border-border last:border-r-0',
        outside && 'bg-hover/40',
        isOver && 'bg-accent/10',
      )}
      data-testid="calendar-day"
      data-day={day}
    >
      <div className="flex h-7 items-center justify-end gap-1 px-1.5">
        {editable && (
          <button
            type="button"
            onClick={onCreate}
            aria-label={t('newOn', { day })}
            className="mr-auto rounded p-0.5 text-fg-subtle opacity-0 hover:bg-hover focus:opacity-100 group-hover/day:opacity-100"
            data-testid="calendar-new"
          >
            <Plus className="size-3.5" />
          </button>
        )}
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full text-[12px]',
            outside ? 'text-fg-subtle' : 'text-fg-muted',
            isToday && 'bg-[var(--c-red)] font-semibold text-white',
          )}
        >
          {label}
        </span>
      </div>
      {hiddenCount > 0 && (
        <div className="absolute bottom-0.5 left-1.5 text-[11px] text-fg-subtle">
          {moreLabel(hiddenCount)}
        </div>
      )}
    </div>
  );
}

function EventBar({
  seg,
  cols,
  draggable,
  onOpen,
  children,
}: {
  seg: Segment;
  cols: number;
  draggable: boolean;
  onOpen: () => void;
  children?: React.ReactNode;
}) {
  const t = useTranslations('database');
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({
    id: `event:${seg.row.id}:${seg.col}:${seg.lane}`,
    data: { row: seg.row, startDay: seg.startDay },
    disabled: !draggable,
  });
  const style: React.CSSProperties = {
    top: 28 + seg.lane * LANE_H,
    left: `calc(${(seg.col / cols) * 100}% + 4px)`,
    width: `calc(${(seg.span / cols) * 100}% - 8px)`,
    height: LANE_H - 3,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    zIndex: isDragging ? 20 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      style={style}
      className={cn(
        'absolute flex cursor-pointer items-center gap-1 overflow-hidden whitespace-nowrap border border-border bg-bg-elevated px-1.5 text-[12px] shadow-sm hover:bg-hover',
        seg.startsBefore ? 'rounded-l-none border-l-0' : 'rounded-l-md',
        seg.endsAfter ? 'rounded-r-none border-r-0' : 'rounded-r-md',
        isDragging && 'opacity-80 shadow-popover',
      )}
      data-testid="calendar-event"
      data-row={seg.row.id}
    >
      {seg.row.icon && <PageIcon icon={seg.row.icon} size={12} />}
      <span className={cn('truncate font-medium', !seg.row.title && 'text-fg-subtle')}>
        {seg.row.title || t('untitled')}
      </span>
      {children}
    </div>
  );
}
