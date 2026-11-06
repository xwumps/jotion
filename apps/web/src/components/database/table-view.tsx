'use client';

import {
  calculationsFor,
  effectiveType,
  type CalculationFn,
  type CreatablePropertyType,
  type DatabaseDto,
  type PropertyDto,
  type RowDto,
  type ViewConfig,
  type ViewDto,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GripVertical, Maximize2, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { ValueEditor, type CellContext } from './cells';
import { formatInstant, formatNumber, PROPERTY_ICONS } from './property-meta';
import { ComputedSetupDialog, type ComputedType } from './computed-setup';
import { PropertyMenu, TypeList } from './property-menu';
import type { DatabaseActions } from './use-database';

const ROW_HEIGHT = 34;
const GUTTER = 44;
const DEFAULT_WIDTH = 180;
const TITLE_WIDTH = 280;

/** Spaltenreihenfolge der Ansicht: konfigurierte zuerst, neue am Ende, Titel immer vorne. */
export function orderedProperties(db: DatabaseDto, cfg: ViewConfig): PropertyDto[] {
  const byId = new Map(db.properties.map((p) => [p.id, p]));
  const order = cfg.properties.map((p) => p.id).filter((id) => byId.has(id));
  for (const p of db.properties) if (!order.includes(p.id)) order.push(p.id);
  const title = db.properties.find((p) => p.type === 'title');
  const ids = title ? [title.id, ...order.filter((id) => id !== title.id)] : order;
  return ids.map((id) => byId.get(id)!);
}

interface Props {
  db: DatabaseDto;
  view: ViewDto;
  rows: RowDto[];
  total: number;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  loading: boolean;
  calculations: Record<string, number | string | null>;
  ctx: CellContext;
  actions: DatabaseActions;
  canEditSchema: boolean;
  onOpenRow: (rowId: string) => void;
  /** Feste Höhe des Scrollbereichs (Full-Page) oder begrenzte Höhe (Inline) */
  maxHeight: string;
  onFilterBy: (propertyId: string) => void;
}

export function TableView({
  db,
  view,
  rows,
  total,
  hasNextPage,
  fetchNextPage,
  loading,
  calculations,
  ctx,
  actions,
  canEditSchema,
  onOpenRow,
  maxHeight,
  onFilterBy,
}: Props) {
  const t = useTranslations('database');
  const cfg = view.config;
  const props = useMemo(() => orderedProperties(db, cfg), [db, cfg]);
  const visibility = new Map(cfg.properties.map((p) => [p.id, p]));
  const visible = props.filter(
    (p) => p.type === 'title' || visibility.get(p.id)?.visible !== false,
  );
  const frozenIds = visible.slice(0, cfg.frozenColumns).map((p) => p.id);
  const manualOrder = cfg.sorts.length === 0;

  const saveConfig = (patch: Partial<ViewConfig>) =>
    actions.updateView.mutate({ id: view.id, config: patch });
  /** Spalten-Einstellungen der Ansicht (Reihenfolge, Sichtbarkeit, Breite) neu schreiben */
  const saveColumns = (
    order: string[],
    patch: (id: string) => Partial<{ visible: boolean; width: number }> = () => ({}),
  ) =>
    saveConfig({
      properties: order.map((id) => {
        const cur = visibility.get(id);
        return {
          id,
          visible: cur?.visible ?? true,
          ...(cur?.width ? { width: cur.width } : {}),
          ...patch(id),
        };
      }),
    });

  const [sizing, setSizing] = useState<ColumnSizingState>({});
  useEffect(() => setSizing({}), [view.id]);

  const columns = useMemo<ColumnDef<RowDto>[]>(
    () =>
      visible.map((p) => ({
        id: p.id,
        size: visibility.get(p.id)?.width ?? (p.type === 'title' ? TITLE_WIDTH : DEFAULT_WIDTH),
        minSize: 80,
        maxSize: 1200,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible.map((p) => p.id).join(), cfg.properties],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    state: { columnSizing: sizing, columnPinning: { left: frozenIds } },
    onColumnSizingChange: setSizing,
  });

  // Breite ändern: eigener Ziehgriff (TanStacks Handler rechnet die Breite in einem
  // React-Updater aus, der bei gebündelten Updates zu spät läuft). Gespeichert beim Loslassen.
  const [resizing, setResizing] = useState<string | null>(null);
  const startResize = (columnId: string, clientX: number) => {
    const startWidth = table.getColumn(columnId)?.getSize() ?? DEFAULT_WIDTH;
    let width = startWidth;
    setResizing(columnId);
    const move = (e: PointerEvent) => {
      width = Math.min(1200, Math.max(80, Math.round(startWidth + e.clientX - clientX)));
      setSizing((s) => ({ ...s, [columnId]: width }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setResizing(null);
      if (width !== startWidth)
        saveColumns(
          props.map((p) => p.id),
          (id) => (id === columnId ? { width } : {}),
        );
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (hasNextPage && !loading && lastIndex >= rows.length - 30) fetchNextPage();
  }, [lastIndex, rows.length, hasNextPage, loading, fetchNextPage]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    // Auswahl auf vorhandene Zeilen beschränken
    setSelected((s) => {
      const ids = new Set(rows.map((r) => r.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [rows]);

  const cols = table.getVisibleLeafColumns();
  const totalWidth = GUTTER + cols.reduce((n, c) => n + c.getSize(), 0) + 40;
  const pinnedLeft = (id: string) => {
    const c = table.getColumn(id);
    return c?.getIsPinned() === 'left' ? GUTTER + c.getStart('left') : null;
  };

  // Spalten ziehen (natives Drag-and-drop im Kopf)
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dragRow, setDragRow] = useState<string | null>(null);
  const dropColumn = (targetId: string) => {
    if (!dragCol || dragCol === targetId) return;
    const order = props.map((p) => p.id).filter((id) => id !== dragCol);
    const title = props.find((p) => p.type === 'title')?.id;
    if (dragCol === title) return;
    const at = order.indexOf(targetId);
    const from = props.findIndex((p) => p.id === dragCol);
    const to = props.findIndex((p) => p.id === targetId);
    order.splice(Math.max(1, from < to ? at + 1 : at), 0, dragCol);
    saveColumns(order);
  };
  const dropRow = (targetId: string) => {
    if (!dragRow || dragRow === targetId || !manualOrder) return;
    const from = rows.findIndex((r) => r.id === dragRow);
    const to = rows.findIndex((r) => r.id === targetId);
    actions.moveRow.mutate(
      from < to ? { rowId: dragRow, afterId: targetId } : { rowId: dragRow, beforeId: targetId },
    );
  };

  const [setup, setSetup] = useState<{
    type: ComputedType;
    prop?: PropertyDto;
    after?: string | null;
  } | null>(null);
  const addColumn = (type: CreatablePropertyType, afterPropertyId?: string | null) => {
    // Relation, Rollup und Formel brauchen erst Einstellungen
    if (type === 'relation' || type === 'rollup' || type === 'formula')
      return setSetup({ type, after: afterPropertyId ?? props.at(-1)?.id ?? null });
    actions.createProperty.mutate({
      name: t(`types.${type}`),
      type,
      viewId: view.id,
      afterPropertyId: afterPropertyId ?? props.at(-1)?.id ?? null,
    });
  };
  const submitSetup = (config: Record<string, unknown>) => {
    if (!setup) return;
    const done = { onSuccess: () => setSetup(null) };
    if (setup.prop) actions.updateProperty.mutate({ id: setup.prop.id, config }, done);
    else
      actions.createProperty.mutate(
        {
          name: t(`types.${setup.type}`),
          type: setup.type,
          config,
          viewId: view.id,
          afterPropertyId: setup.after ?? null,
        },
        done,
      );
  };

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <div className="flex min-w-0 flex-col" data-testid="table-view">
      {setup && (
        <ComputedSetupDialog
          db={db}
          type={setup.type}
          prop={setup.prop}
          members={ctx.members}
          sampleRows={rows.slice(0, 1)}
          onClose={() => setSetup(null)}
          onSubmit={submitSetup}
        />
      )}
      {selected.size > 0 && (
        <div
          className="mb-1 flex h-8 items-center gap-2 rounded-md bg-hover px-2 text-[13px]"
          role="toolbar"
        >
          <span>{t('table.selected', { count: selected.size })}</span>
          {ctx.editable && (
            <button
              type="button"
              onClick={() => {
                actions.trashRows.mutate([...selected]);
                setSelected(new Set());
              }}
              className="rounded-md px-2 py-0.5 text-[var(--c-red)] hover:bg-active"
              data-testid="delete-rows"
            >
              {t('table.deleteRows')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto rounded-md px-2 py-0.5 text-fg-muted hover:bg-active"
          >
            {t('table.clearSelection')}
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="relative overflow-auto border-t border-border"
        style={{ maxHeight }}
        role="grid"
        aria-rowcount={total + 1}
        aria-colcount={cols.length}
        data-testid="table-scroll"
      >
        <div style={{ width: totalWidth, minWidth: '100%' }}>
          {/* Kopfzeile */}
          <div
            className="sticky top-0 z-20 flex h-[34px] border-b border-border bg-bg text-[14px] text-fg-muted"
            role="row"
          >
            <div
              className="sticky left-0 z-30 flex shrink-0 items-center justify-center bg-bg"
              style={{ width: GUTTER }}
            >
              <input
                type="checkbox"
                aria-label={t('table.selectAll')}
                checked={allSelected}
                onChange={() =>
                  setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                }
                className="opacity-40 hover:opacity-100 checked:opacity-100"
              />
            </div>
            {cols.map((col) => {
              const prop = visible.find((p) => p.id === col.id)!;
              const Icon = PROPERTY_ICONS[prop.type];
              const left = pinnedLeft(col.id);
              return (
                <div
                  key={col.id}
                  role="columnheader"
                  className={cn(
                    'group/header relative flex shrink-0 items-center border-r border-border bg-bg',
                    left !== null && 'sticky z-30',
                    dragCol && dragCol !== col.id && 'data-[over=true]:bg-hover',
                  )}
                  style={{ width: col.getSize(), left: left ?? undefined }}
                  onDragOver={(e) => dragCol && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropColumn(col.id);
                    setDragCol(null);
                  }}
                  data-testid="column-header"
                  data-property={prop.name}
                >
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left hover:bg-hover"
                        // Nur die Beschriftung ist ziehbar, damit der Griff zum Breiteändern frei bleibt
                        draggable={prop.type !== 'title'}
                        onDragStart={(e) => {
                          setDragCol(col.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', col.id);
                        }}
                        onDragEnd={() => setDragCol(null)}
                        data-testid="column-label"
                      >
                        <Icon className="size-3.5 shrink-0 opacity-70" />
                        <span className="truncate">{prop.name}</span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0" sideOffset={2}>
                      <PropertyMenu
                        prop={prop}
                        canEditSchema={canEditSchema}
                        frozen={frozenIds.includes(prop.id)}
                        actions={{
                          rename: (name) => actions.updateProperty.mutate({ id: prop.id, name }),
                          changeType: (type) =>
                            actions.updateProperty.mutate({ id: prop.id, type }),
                          updateConfig: (config) =>
                            actions.updateProperty.mutate({ id: prop.id, config }),
                          sort: (direction) =>
                            saveConfig({ sorts: [{ propertyId: prop.id, direction }] }),
                          filter: () => onFilterBy(prop.id),
                          hide: () =>
                            saveColumns(
                              props.map((p) => p.id),
                              (id) => (id === prop.id ? { visible: false } : {}),
                            ),
                          freeze: () => {
                            const i = visible.findIndex((p) => p.id === prop.id);
                            saveConfig({ frozenColumns: frozenIds.includes(prop.id) ? i : i + 1 });
                          },
                          insert: (side) => {
                            const i = props.findIndex((p) => p.id === prop.id);
                            addColumn(
                              'text',
                              side === 'right' ? prop.id : (props[i - 1]?.id ?? null),
                            );
                          },
                          remove: () => {
                            if (
                              window.confirm(t('propertyMenu.confirmDelete', { name: prop.name }))
                            )
                              actions.deleteProperty.mutate(prop.id);
                          },
                          undoConversion: () => actions.undoConversion.mutate(prop.id),
                          configure: () => setSetup({ type: prop.type as ComputedType, prop }),
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  <div
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startResize(col.id, e.clientX);
                    }}
                    onDoubleClick={() => setSizing((s) => ({ ...s, [col.id]: DEFAULT_WIDTH }))}
                    className={cn(
                      'absolute right-0 top-0 z-10 h-full w-[5px] cursor-col-resize',
                      resizing === col.id ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                    role="separator"
                    aria-label={t('table.resize')}
                    data-testid="column-resizer"
                  />
                </div>
              );
            })}
            {canEditSchema && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('table.addProperty')}
                    className="flex w-10 shrink-0 items-center justify-center hover:bg-hover"
                    data-testid="add-property"
                  >
                    <Plus className="size-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-0" align="end">
                  <div className="px-3 pt-2 text-[12px] font-medium text-fg-subtle">
                    {t('table.propertyType')}
                  </div>
                  <TypeList onPick={(type) => addColumn(type)} />
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Zeilen (virtualisiert) */}
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((item) => {
              const row = rows[item.index]!;
              const isSel = selected.has(row.id);
              return (
                <div
                  key={row.id}
                  role="row"
                  aria-rowindex={item.index + 2}
                  data-index={item.index}
                  ref={cfg.wrapCells ? virtualizer.measureElement : undefined}
                  className={cn(
                    'group/row absolute left-0 flex w-full border-b border-border',
                    isSel ? 'bg-[var(--cb-blue)]' : 'bg-bg hover:bg-hover',
                  )}
                  style={{ transform: `translateY(${item.start}px)`, minHeight: ROW_HEIGHT }}
                  onDragOver={(e) => dragRow && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropRow(row.id);
                    setDragRow(null);
                  }}
                  data-testid="table-row"
                  data-row-id={row.id}
                >
                  <div
                    className={cn(
                      'sticky left-0 z-10 flex shrink-0 items-center justify-end gap-0.5 pr-1',
                      isSel ? 'bg-[var(--cb-blue)]' : 'bg-bg group-hover/row:bg-hover',
                    )}
                    style={{ width: GUTTER }}
                  >
                    {ctx.editable && manualOrder && (
                      <span
                        draggable
                        onDragStart={(e) => {
                          setDragRow(row.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', row.id);
                        }}
                        onDragEnd={() => setDragRow(null)}
                        className="cursor-grab text-fg-subtle opacity-0 group-hover/row:opacity-100"
                        aria-label={t('table.dragRow')}
                        data-testid="row-handle"
                      >
                        <GripVertical className="size-4" />
                      </span>
                    )}
                    <input
                      type="checkbox"
                      checked={isSel}
                      aria-label={t('table.selectRow')}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(row.id)) n.delete(row.id);
                          else n.add(row.id);
                          return n;
                        })
                      }
                      className={cn('opacity-0 group-hover/row:opacity-60', isSel && 'opacity-100')}
                      data-testid="row-select"
                    />
                  </div>
                  {cols.map((col) => {
                    const prop = visible.find((p) => p.id === col.id)!;
                    const left = pinnedLeft(col.id);
                    return (
                      <div
                        key={col.id}
                        role="gridcell"
                        className={cn(
                          'relative shrink-0 border-r border-border',
                          left !== null &&
                            cn(
                              'sticky z-10',
                              isSel ? 'bg-[var(--cb-blue)]' : 'bg-bg group-hover/row:bg-hover',
                            ),
                        )}
                        style={{ width: col.getSize(), left: left ?? undefined }}
                      >
                        <ValueEditor
                          prop={prop}
                          row={row}
                          ctx={ctx}
                          variant="cell"
                          wrap={cfg.wrapCells}
                        >
                          {prop.type === 'title' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenRow(row.id);
                              }}
                              className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md border border-border bg-bg-elevated px-1.5 py-0.5 text-[12px] text-fg-muted opacity-0 shadow-sm hover:bg-hover group-hover/row:opacity-100"
                              data-testid="open-row"
                            >
                              <Maximize2 className="size-3" />
                              {t('table.open')}
                            </button>
                          )}
                        </ValueEditor>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {ctx.editable && (
            <button
              type="button"
              onClick={() => actions.createRow.mutate({})}
              className="flex h-[34px] w-full items-center gap-1.5 border-b border-border px-3 text-[14px] text-fg-subtle hover:bg-hover"
              style={{ paddingLeft: GUTTER + 8 }}
              data-testid="add-row"
            >
              <Plus className="size-4" />
              {t('table.newRow')}
            </button>
          )}

          {/* Berechnungen */}
          <div className="flex h-[34px] text-[12px] text-fg-subtle" role="row">
            <div className="sticky left-0 shrink-0 bg-bg" style={{ width: GUTTER }} />
            {cols.map((col) => {
              const prop = visible.find((p) => p.id === col.id)!;
              const left = pinnedLeft(col.id);
              return (
                <div
                  key={col.id}
                  className={cn('shrink-0', left !== null && 'sticky z-10 bg-bg')}
                  style={{ width: col.getSize(), left: left ?? undefined }}
                >
                  <CalculationCell
                    prop={prop}
                    fn={cfg.calculations[prop.id]}
                    value={calculations[prop.id]}
                    onChange={(fn) => {
                      const next = { ...cfg.calculations };
                      if (fn) next[prop.id] = fn;
                      else delete next[prop.id];
                      saveConfig({ calculations: next });
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {rows.length === 0 && !loading && (
          <div
            className="px-3 py-6 text-center text-[14px] text-fg-subtle"
            style={{ paddingLeft: GUTTER }}
          >
            {t('table.noRows')}
          </div>
        )}
      </div>
      <div className="px-2 pt-1 text-[12px] text-fg-subtle" data-testid="row-count">
        {t('table.count', { count: total })}
      </div>
    </div>
  );
}

function CalculationCell({
  prop,
  fn,
  value,
  onChange,
}: {
  prop: PropertyDto;
  fn: CalculationFn | undefined;
  value: number | string | null | undefined;
  onChange: (fn: CalculationFn | null) => void;
}) {
  const t = useTranslations('database');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const valid =
    fn && calculationsFor(effectiveType(prop.type, prop.config)).includes(fn) ? fn : undefined;
  const display = (() => {
    if (!valid || value === undefined) return null;
    if (value === null) return '';
    const n = Number(value);
    if (valid.startsWith('percent'))
      return `${formatNumber(Math.round(n * 10) / 10, undefined, locale)} %`;
    if (valid === 'earliest_date' || valid === 'latest_date')
      return formatInstant(new Date(n).toISOString(), locale, 'short');
    if (valid === 'date_range') return t('calc.days', { count: Math.round(n / 86_400_000) });
    if (
      prop.type === 'number' &&
      ['sum', 'average', 'median', 'min', 'max', 'range'].includes(valid)
    )
      return formatNumber(Math.round(n * 100) / 100, prop.config as never, locale);
    return formatNumber(n, undefined, locale);
  })();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group/calc flex h-full w-full items-center justify-end gap-1 px-2 hover:bg-hover"
          data-testid="calculation"
          data-property={prop.name}
        >
          {valid ? (
            <>
              <span className="uppercase tracking-wide">{t(`calc.short.${valid}`)}</span>
              <span className="font-medium text-fg">{display}</span>
            </>
          ) : (
            <span className="opacity-0 group-hover/calc:opacity-100">{t('calc.calculate')}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[320px] w-[200px] overflow-y-auto p-1" align="end">
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
          className="flex h-8 w-full items-center rounded-md px-2 text-left text-[14px] hover:bg-hover"
        >
          {t('calc.none')}
        </button>
        {calculationsFor(effectiveType(prop.type, prop.config)).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              onChange(c);
              setOpen(false);
            }}
            className={cn(
              'flex h-8 w-full items-center rounded-md px-2 text-left text-[14px] hover:bg-hover',
              c === valid && 'bg-hover',
            )}
            data-testid={`calc-${c}`}
          >
            {t(`calc.fn.${c}`)}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
