'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  EMPTY_GROUP,
  OPTION_COLORS,
  type DatabaseDto,
  type GroupBy,
  type GroupMove,
  type MemberDto,
  type PropertyDto,
  type RowDto,
  type ViewConfig,
  type ViewDto,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useLoadMore } from '@/lib/use-load-more';
import { toast } from 'sonner';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../../ui/menu';
import { OptionChip } from '../cells';
import { formatInstant, optionsOf, optionStyle } from '../property-meta';
import type { DatabaseActions } from '../use-database';
import { AUTO_SCROLL } from './calendar-view';
import { Card, cardProperties, type CardPreview, type CardSize } from './card';
import {
  buildGroups,
  canDragBetweenGroups,
  countsByKey,
  subCounts,
  useGroupCalculation,
  useGroupCounts,
  useGroupRows,
  useMoveRow,
  valueForGroup,
  type GroupInfo,
} from './use-views';

export interface BoardProps {
  db: DatabaseDto;
  view: ViewDto;
  search: string;
  members: MemberDto[];
  actions: DatabaseActions;
  editable: boolean;
  canEditSchema: boolean;
  onOpenRow: (rowId: string) => void;
  saveConfig: (patch: Partial<ViewConfig>) => void;
}

const WIDTH: Record<CardSize, number> = { small: 220, medium: 260, large: 320 };

interface DragData {
  type: 'card';
  row: RowDto;
  key: string;
  sub: string | null;
}
interface DropData {
  type: 'card' | 'column';
  key: string;
  sub: string | null;
  rowId?: string;
  lastId?: string | null;
}

/** Laufende Verschiebung: Karte sofort am Ziel zeigen, bis die Daten neu geladen sind. */
interface Pending {
  row: RowDto;
  fromKey: string;
  fromSub: string | null;
  toKey: string;
  toSub: string | null;
  afterId?: string | null;
  beforeId?: string | null;
}

export function useGroupLabels() {
  const t = useTranslations('views');
  return useMemo(
    () => ({
      empty: (p: PropertyDto) => t('emptyGroup', { name: p.name }),
      checked: t('checked'),
      unchecked: t('unchecked'),
      week: (day: string) => t('weekOf', { day }),
    }),
    [t],
  );
}

export function BoardView(props: BoardProps) {
  const { db, view, search, members, editable, canEditSchema, saveConfig } = props;
  const t = useTranslations('views');
  const locale = useLocale();
  const cfg = view.config;
  const by = cfg.groupBy;
  const prop = by ? db.properties.find((p) => p.id === by.propertyId) : undefined;
  const subBy = cfg.subGroupBy;
  const subProp = subBy ? db.properties.find((p) => p.id === subBy.propertyId) : undefined;
  const labels = useGroupLabels();
  const counts = useGroupCounts(db, view, search, Boolean(prop));
  const move = useMoveRow(db);
  const [pending, setPending] = useState<Pending | null>(null);
  const [active, setActive] = useState<DragData | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  if (!by || !prop)
    return (
      <div className="py-8 text-center text-[14px] text-fg-subtle" data-testid="board-no-group">
        {t('chooseGroup')}
      </div>
    );

  const subCountMap = subCounts(counts.data);
  const lanes: (GroupInfo | null)[] =
    subBy && subProp
      ? buildGroups(subProp, subBy, subCountMap, members, locale, labels).filter((g) => !g.hidden)
      : [null];
  // Zähler sofort an eine laufende Verschiebung anpassen
  const countMap = countsByKey(counts.data);
  if (pending && pending.fromKey !== pending.toKey) {
    countMap.set(pending.fromKey, Math.max(0, (countMap.get(pending.fromKey) ?? 0) - 1));
    countMap.set(pending.toKey, (countMap.get(pending.toKey) ?? 0) + 1);
  }
  const groups = buildGroups(prop, by, countMap, members, locale, labels);
  const visible = groups.filter((g) => !g.hidden);
  const hidden = groups.filter((g) => g.hidden && !(by.hideEmpty && g.count === 0));
  const board = {
    cardPreview: 'none',
    cardSize: 'medium',
    previewPropertyId: null,
    fitImage: false,
    colorColumns: true,
    columnCalculation: null,
    ...cfg.board,
  } as const;
  const width = WIDTH[board.cardSize as CardSize];
  const draggable = editable && canDragBetweenGroups(prop);

  const saveGroupBy = (patch: Partial<GroupBy>) => saveConfig({ groupBy: { ...by, ...patch } });
  const saveSubGroupBy = (patch: Partial<GroupBy>) =>
    subBy && saveConfig({ subGroupBy: { ...subBy, ...patch } });

  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as DragData | { type: 'column-head' } | undefined;
    if (d?.type === 'card') setActive(d);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const a = e.active.data.current as DragData | { type: 'column-head'; key: string } | undefined;
    const o = e.over?.data.current as DropData | { type: 'column-head'; key: string } | undefined;
    if (!a || !o) return;
    if (a.type === 'column-head') {
      // Spalten umsortieren
      if (o.type !== 'column-head' && o.type !== 'column') return;
      const keys = groups.map((g) => g.key);
      const from = keys.indexOf(a.key);
      const to = keys.indexOf(o.key);
      if (from < 0 || to < 0 || from === to) return;
      keys.splice(to, 0, keys.splice(from, 1)[0]!);
      saveGroupBy({ order: keys, sort: 'manual' });
      return;
    }
    // Karte auf einen Spaltenkopf: in diese Spalte (gleiche Swimlane), Platz bleibt
    const target: DropData =
      o.type === 'column-head' ? { type: 'column', key: o.key, sub: a.sub, lastId: null } : o;
    return dropCard(e, a, target);
  };

  const dropCard = (e: DragEndEvent, a: DragData, o: DropData) => {
    const moves: GroupMove[] = [];
    if (o.key !== a.key) {
      if (!canDragBetweenGroups(prop)) return void toast.error(t('cannotMove'));
      moves.push({ propertyId: prop.id, from: a.key, to: o.key });
    }
    if (subProp && o.sub !== null && a.sub !== null && o.sub !== a.sub) {
      if (!canDragBetweenGroups(subProp)) return void toast.error(t('cannotMove'));
      moves.push({ propertyId: subProp.id, from: a.sub, to: o.sub });
    }
    // Reihenfolge nur ohne Sortierung der Ansicht (sonst bestimmt die Sortierung den Platz)
    let afterId: string | null | undefined;
    let beforeId: string | null | undefined;
    if (!cfg.sorts.length) {
      if (o.type === 'card' && o.rowId) {
        if (o.rowId === a.row.id) {
          if (!moves.length) return;
        } else {
          const overRect = e.over!.rect;
          const activeRect = e.active.rect.current.translated;
          const below =
            activeRect &&
            activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2;
          if (below) afterId = o.rowId;
          else beforeId = o.rowId;
        }
      } else if (o.type === 'column' && o.lastId && o.lastId !== a.row.id) afterId = o.lastId;
    }
    if (!moves.length && !afterId && !beforeId) return;
    const p: Pending = {
      row: a.row,
      fromKey: a.key,
      fromSub: a.sub,
      toKey: o.key,
      toSub: o.sub,
      afterId,
      beforeId,
    };
    setPending(p);
    move.mutate(
      { rowId: a.row.id, afterId, beforeId, ...(moves.length ? { groups: moves } : {}) },
      { onSettled: () => setPending((cur) => (cur === p ? null : cur)) },
    );
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
      autoScroll={AUTO_SCROLL}
    >
      <div className="overflow-x-auto pb-4" data-testid="board">
        <div className="flex min-w-max flex-col gap-2 pt-2">
          {/* Spaltenköpfe */}
          <div className="flex gap-3">
            {visible.map((g) => (
              <ColumnHead
                key={g.key}
                group={g}
                prop={prop}
                width={width}
                editable={editable}
                canEditSchema={canEditSchema}
                actions={props.actions}
                onHide={() => saveGroupBy({ hidden: [...by.hidden, g.key] })}
                calc={
                  !subBy && board.columnCalculation?.propertyId
                    ? (board.columnCalculation as { propertyId: string; fn: never })
                    : null
                }
                db={db}
                view={view}
                search={search}
                colored={board.colorColumns}
              />
            ))}
            {editable &&
              canEditSchema &&
              ['select', 'status', 'multi_select'].includes(prop.type) && (
                <AddGroup prop={prop} actions={props.actions} />
              )}
            {hidden.length > 0 && (
              <HiddenGroups
                groups={hidden}
                onShow={(k) =>
                  saveGroupBy({ hidden: by.hidden.filter((x) => x !== k), hideEmpty: by.hideEmpty })
                }
              />
            )}
          </div>
          {lanes.map((lane) => {
            const collapsed = lane ? (subBy?.collapsed ?? []).includes(lane.key) : false;
            return (
              <div
                key={lane?.key ?? 'all'}
                className="flex flex-col gap-1"
                data-testid={lane ? 'swimlane' : undefined}
              >
                {lane && (
                  <button
                    type="button"
                    onClick={() =>
                      saveSubGroupBy({
                        collapsed: collapsed
                          ? (subBy?.collapsed ?? []).filter((k) => k !== lane.key)
                          : [...(subBy?.collapsed ?? []), lane.key],
                      })
                    }
                    className="flex h-8 w-fit items-center gap-1.5 rounded-md px-1 text-[14px] hover:bg-hover"
                    aria-expanded={!collapsed}
                  >
                    {collapsed ? (
                      <ChevronRight className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                    <GroupChip group={lane} />
                    <span className="text-[12px] text-fg-subtle">{lane.count}</span>
                  </button>
                )}
                {!collapsed && (
                  <div className="flex gap-3">
                    {visible.map((g) => (
                      <BoardColumn
                        key={g.key}
                        {...props}
                        prop={prop}
                        subProp={subProp ?? null}
                        group={g}
                        lane={lane}
                        width={width}
                        preview={board.cardPreview as CardPreview}
                        previewPropertyId={board.previewPropertyId}
                        fit={board.fitImage}
                        size={board.cardSize as CardSize}
                        draggable={draggable}
                        pending={pending}
                        activeId={active?.row.id ?? null}
                        colored={board.colorColumns}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <DragOverlay>
        {active && (
          <div style={{ width }} className="rotate-1 shadow-popover">
            <Card
              db={db}
              row={active.row}
              props={cardProperties(db, cfg)}
              members={members}
              preview={board.cardPreview as CardPreview}
              previewPropertyId={board.previewPropertyId}
              fit={board.fitImage}
              size={board.cardSize as CardSize}
              onOpen={() => {}}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** Heller Spaltenhintergrund in Optionsfarbe. */
const columnTint = (color: string) =>
  color === 'default'
    ? 'color-mix(in srgb, var(--active) 45%, transparent)'
    : `color-mix(in srgb, var(--cb-${color}) 45%, transparent)`;

function GroupChip({ group }: { group: GroupInfo }) {
  if (group.optionId) return <OptionChip name={group.label} color={group.color ?? 'default'} />;
  return (
    <span
      className={cn(
        'truncate text-[14px] font-medium',
        group.key === EMPTY_GROUP && 'text-fg-muted',
      )}
    >
      {group.label}
    </span>
  );
}

function ColumnHead({
  db,
  view,
  search,
  group,
  prop,
  width,
  editable,
  canEditSchema,
  actions,
  onHide,
  calc,
  colored,
}: {
  db: DatabaseDto;
  view: ViewDto;
  search: string;
  group: GroupInfo;
  prop: PropertyDto;
  width: number;
  editable: boolean;
  canEditSchema: boolean;
  actions: DatabaseActions;
  onHide: () => void;
  calc: { propertyId: string; fn: never } | null;
  colored: boolean;
}) {
  const t = useTranslations('views');
  const locale = useLocale();
  const [renaming, setRenaming] = useState(false);
  const drag = useDraggable({
    id: `head:${group.key}`,
    data: { type: 'column-head', key: group.key },
    disabled: !editable,
  });
  const drop = useDroppable({
    id: `headdrop:${group.key}`,
    data: { type: 'column-head', key: group.key },
  });
  const calcQ = useGroupCalculation(db, view, search, group.key, undefined, calc);
  const calcValue = calc ? calcQ.data?.[calc.propertyId] : undefined;
  const isDateCalc = calc && ['earliest_date', 'latest_date'].includes(calc.fn);
  const editOption = (patch: { name?: string; color?: string }) => {
    const options = optionsOf(prop).map((o) => (o.id === group.optionId ? { ...o, ...patch } : o));
    actions.updateProperty.mutate({ id: prop.id, config: { ...(prop.config as object), options } });
  };
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      style={{ width, ...(colored && group.color ? { background: columnTint(group.color) } : {}) }}
      className={cn(
        'group/head flex h-9 shrink-0 items-center gap-1.5 rounded-md px-1.5',
        drop.isOver && 'ring-2 ring-accent',
        drag.isDragging && 'opacity-50',
      )}
      data-testid="board-column-head"
      data-group={group.key}
    >
      <span {...drag.attributes} {...drag.listeners} className="flex min-w-0 items-center gap-1.5">
        {renaming ? (
          <input
            autoFocus
            defaultValue={group.label}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== group.label) editOption({ name });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            className="h-6 w-[140px] rounded border border-accent bg-bg px-1 text-[14px] outline-none"
            aria-label={t('renameGroup')}
          />
        ) : (
          <GroupChip group={group} />
        )}
      </span>
      <span className="text-[12px] text-fg-subtle" data-testid="column-count">
        {group.count}
      </span>
      {calc && calcValue !== undefined && calcValue !== null && (
        <span className="truncate text-[12px] text-fg-subtle" data-testid="column-calc">
          {isDateCalc
            ? formatInstant(new Date(Number(calcValue)).toISOString(), locale, 'short')
            : Number(calcValue).toLocaleString(locale, { maximumFractionDigits: 2 })}
        </span>
      )}
      {editable && (
        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label={t('groupMenu')}
              className="ml-auto rounded p-0.5 text-fg-subtle opacity-0 hover:bg-hover focus:opacity-100 group-hover/head:opacity-100"
              data-testid="column-menu"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={EyeOff} onSelect={onHide}>
              {t('hideGroup')}
            </MenuItem>
            {group.optionId && canEditSchema && (
              <>
                <MenuItem icon={Pencil} onSelect={() => setRenaming(true)}>
                  {t('renameGroup')}
                </MenuItem>
                <MenuSeparator />
                <MenuLabel>
                  <span className="flex items-center gap-1.5">
                    <Palette className="size-3.5" />
                    {t('color')}
                  </span>
                </MenuLabel>
                <div className="grid grid-cols-5 gap-1 px-2 pb-1.5">
                  {OPTION_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      onClick={() => editOption({ color: c })}
                      className={cn(
                        'size-5 rounded border border-border',
                        group.color === c && 'ring-2 ring-accent',
                      )}
                      style={optionStyle(c)}
                    />
                  ))}
                </div>
              </>
            )}
          </MenuContent>
        </Menu>
      )}
    </div>
  );
}

function AddGroup({ prop, actions }: { prop: PropertyDto; actions: DatabaseActions }) {
  const t = useTranslations('views');
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-[200px] shrink-0 items-center gap-1 rounded-md px-2 text-[14px] text-fg-subtle hover:bg-hover"
        data-testid="add-group"
      >
        <Plus className="size-4" />
        {t('addGroup')}
      </button>
    );
  return (
    <input
      autoFocus
      placeholder={t('groupName')}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
        if (e.key !== 'Enter') return;
        const name = e.currentTarget.value.trim();
        if (!name) return;
        const options = optionsOf(prop);
        const color = OPTION_COLORS[(options.length + 1) % OPTION_COLORS.length]!;
        actions.updateProperty.mutate({
          id: prop.id,
          config: {
            ...(prop.config as object),
            options: [
              ...options,
              {
                id: crypto.randomUUID(),
                name,
                color,
                ...(prop.type === 'status' ? { group: 'todo' } : {}),
              },
            ],
          },
        });
        setOpen(false);
      }}
      className="h-9 w-[200px] shrink-0 rounded-md border border-accent bg-bg px-2 text-[14px] outline-none"
      data-testid="add-group-input"
    />
  );
}

function HiddenGroups({ groups, onShow }: { groups: GroupInfo[]; onShow: (key: string) => void }) {
  const t = useTranslations('views');
  return (
    <div className="flex w-[220px] shrink-0 flex-col gap-0.5" data-testid="hidden-groups">
      <div className="flex h-9 items-center px-1.5 text-[12px] font-medium text-fg-subtle">
        {t('hiddenGroups')}
      </div>
      {groups.map((g) => (
        <button
          key={g.key}
          type="button"
          onClick={() => onShow(g.key)}
          className="group/hid flex h-8 items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-hover"
          aria-label={t('showGroup', { name: g.label })}
        >
          <GroupChip group={g} />
          <span className="text-[12px] text-fg-subtle">{g.count}</span>
          <Eye className="ml-auto size-3.5 text-fg-subtle opacity-0 group-hover/hid:opacity-100" />
        </button>
      ))}
    </div>
  );
}

function BoardColumn({
  db,
  view,
  search,
  members,
  actions,
  editable,
  onOpenRow,
  prop,
  subProp,
  group,
  lane,
  width,
  preview,
  previewPropertyId,
  fit,
  size,
  draggable,
  pending,
  activeId,
  colored,
}: BoardProps & {
  prop: PropertyDto;
  subProp: PropertyDto | null;
  group: GroupInfo;
  lane: GroupInfo | null;
  width: number;
  preview: CardPreview;
  previewPropertyId: string | null;
  fit: boolean;
  size: CardSize;
  draggable: boolean;
  pending: Pending | null;
  activeId: string | null;
  colored: boolean;
}) {
  const t = useTranslations('views');
  const sub = lane?.key ?? null;
  const q = useGroupRows(db, view, search, group.key, sub ?? undefined, {
    preview: preview === 'content',
  });
  const loaded = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  // Optimistische Verschiebung anwenden
  const rows = useMemo(() => {
    if (!pending) return loaded;
    let out = loaded.filter((r) => r.id !== pending.row.id);
    if (pending.toKey === group.key && pending.toSub === sub) {
      let i = out.length;
      if (pending.afterId) i = out.findIndex((r) => r.id === pending.afterId) + 1 || out.length;
      else if (pending.beforeId) {
        const b = out.findIndex((r) => r.id === pending.beforeId);
        i = b === -1 ? out.length : b;
      }
      out = [...out.slice(0, i), pending.row, ...out.slice(i)];
    }
    return out;
  }, [loaded, pending, group.key, sub]);
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${group.key}:${sub ?? ''}`,
    data: {
      type: 'column',
      key: group.key,
      sub,
      lastId: rows.at(-1)?.id ?? null,
    } satisfies DropData,
  });
  const cardProps = cardProperties(db, view.config);

  // Nachladen, sobald das Ende der Spalte sichtbar wird
  const sentinel = useLoadMore(q);

  const newCard = () => {
    const values: Record<string, unknown> = {};
    let title: string | undefined;
    const put = (p: PropertyDto, key: string) => {
      if (p.type === 'title') title = key === EMPTY_GROUP ? '' : key;
      const v = valueForGroup(p, key);
      if (v !== undefined && p.type !== 'title') values[p.id] = v;
    };
    put(prop, group.key);
    if (subProp && sub) put(subProp, sub);
    actions.createRow.mutate(
      { title, values, afterId: rows.at(-1)?.id },
      { onSuccess: (row) => onOpenRow(row.id) },
    );
  };

  return (
    <div
      ref={setNodeRef}
      style={{ width, ...(colored && group.color ? { background: columnTint(group.color) } : {}) }}
      className={cn(
        'flex min-h-[60px] shrink-0 flex-col gap-1.5 rounded-md p-1',
        colored && group.color ? '' : 'bg-hover/40',
        isOver && 'ring-2 ring-accent/60',
      )}
      data-testid="board-column"
      data-group={group.key}
      data-lane={sub ?? undefined}
    >
      {rows.map((row) => (
        <DraggableCard
          key={row.id}
          db={db}
          row={row}
          props={cardProps}
          members={members}
          preview={preview}
          previewPropertyId={previewPropertyId}
          fit={fit}
          size={size}
          onOpen={() => onOpenRow(row.id)}
          groupKey={group.key}
          sub={sub}
          draggable={draggable}
          hiddenWhileDragging={activeId === row.id}
        />
      ))}
      {q.hasNextPage && (
        <div ref={sentinel}>
          <button
            type="button"
            onClick={() => void q.fetchNextPage()}
            className="h-7 w-full rounded-md text-[12px] text-fg-subtle hover:bg-hover"
          >
            {t('loadMore')}
          </button>
        </div>
      )}
      {editable && (
        <button
          type="button"
          onClick={newCard}
          className="flex h-8 items-center gap-1 rounded-md px-1.5 text-[14px] text-fg-subtle hover:bg-hover"
          data-testid="board-new-card"
        >
          <Plus className="size-4" />
          {t('new')}
        </button>
      )}
    </div>
  );
}

function DraggableCard({
  groupKey,
  sub,
  draggable,
  hiddenWhileDragging,
  ...card
}: Parameters<typeof Card>[0] & {
  groupKey: string;
  sub: string | null;
  draggable: boolean;
  hiddenWhileDragging: boolean;
}) {
  const drag = useDraggable({
    id: `card:${card.row.id}:${groupKey}:${sub ?? ''}`,
    data: { type: 'card', row: card.row, key: groupKey, sub } satisfies DragData,
    disabled: !draggable,
  });
  const drop = useDroppable({
    id: `cardDrop:${card.row.id}:${groupKey}:${sub ?? ''}`,
    data: { type: 'card', key: groupKey, sub, rowId: card.row.id } satisfies DropData,
  });
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      {...drag.attributes}
      {...drag.listeners}
      role={undefined}
      tabIndex={undefined}
      className={cn(
        'relative',
        drop.isOver &&
          !drag.isDragging &&
          'before:absolute before:-top-1 before:left-0 before:right-0 before:h-0.5 before:rounded before:bg-accent',
      )}
    >
      <Card {...card} dragging={hiddenWhileDragging} />
    </div>
  );
}
