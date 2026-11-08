'use client';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  WIDGET_TYPES,
  type DashboardScope,
  type DatabaseSearchResultDto,
  type Widget,
  type WidgetType,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import { useQuery } from '@tanstack/react-query';
import { Check, GripVertical, LayoutGrid, Pencil, Plus, Settings2, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout';
import { apiGet } from '@/lib/api-client';
import { useDatabase } from '../database/use-database';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/menu';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useDashboard, useSaveDashboard } from './use-dashboard';
import { WIDGET_VIEW_TYPES, WidgetBody } from './widgets';

const Grid = WidthProvider(Responsive);

const SIZE: Record<WidgetType, { w: number; h: number }> = {
  upcoming: { w: 6, h: 6 },
  overdue: { w: 6, h: 6 },
  board: { w: 12, h: 9 },
  chart: { w: 6, h: 8 },
  calendar: { w: 12, h: 10 },
  kpi: { w: 3, h: 4 },
  recent: { w: 6, h: 6 },
  favorites: { w: 6, h: 6 },
  note: { w: 4, h: 5 },
  links: { w: 4, h: 5 },
};

/**
 * Dashboard der Startseite: Widgets im 12-Spalten-Raster (auf schmalen Bildschirmen eine Spalte),
 * im Bearbeiten-Modus verschiebbar und in der Größe änderbar. Persönlich oder geteilt.
 */
export function Dashboard({ ws }: { ws: string }) {
  const t = useTranslations('dashboard');
  const [scope, setScope] = useState<DashboardScope>('personal');
  const q = useDashboard(ws, scope);
  const save = useSaveDashboard(ws, scope);
  const [editing, setEditing] = useState(false);
  const widgets = useMemo(() => q.data?.widgets ?? [], [q.data?.widgets]);
  const canEdit = q.data?.canEdit ?? false;

  const persist = useCallback((next: Widget[]) => save.mutate(next), [save]);
  const update = useCallback(
    (w: Widget) => persist(widgets.map((x) => (x.id === w.id ? w : x))),
    [persist, widgets],
  );

  const onLayout = (layout: Layout[]) => {
    if (!editing) return;
    const byId = new Map(layout.map((l) => [l.i, l]));
    let changed = false;
    const next = widgets.map((w) => {
      const l = byId.get(w.id);
      if (!l || (l.x === w.x && l.y === w.y && l.w === w.w && l.h === w.h)) return w;
      changed = true;
      return { ...w, x: l.x, y: l.y, w: l.w, h: l.h };
    });
    if (changed) persist(next);
  };

  const add = (type: WidgetType) => {
    const y = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
    const widget: Widget = {
      id: `${type}-${crypto.randomUUID().slice(0, 8)}`,
      type,
      title: '',
      x: 0,
      y,
      ...SIZE[type],
      databaseId: null,
      viewId: null,
      days: 14,
      text: '',
      links: [],
    };
    persist([...widgets, widget]);
  };

  const layouts = {
    lg: widgets.map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: 2, minH: 2 })),
  };

  return (
    <section className="mt-10" aria-labelledby="dashboard-title" data-testid="dashboard">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2
          id="dashboard-title"
          className="flex items-center gap-1.5 text-[13px] font-medium text-fg-muted"
        >
          <LayoutGrid className="size-3.5" />
          {t('title')}
        </h2>
        <div className="flex rounded-md border border-border p-0.5 text-[13px]" role="tablist">
          {(['personal', 'shared'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              onClick={() => {
                setScope(s);
                setEditing(false);
              }}
              className={cn('h-6 rounded px-2', scope === s ? 'bg-active' : 'hover:bg-hover')}
              data-testid={`dashboard-${s}`}
            >
              {t(`scopes.${s}`)}
            </button>
          ))}
        </div>
        {canEdit && (
          <div className="ml-auto flex items-center gap-1">
            {editing && (
              <Menu>
                <MenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-7 items-center gap-1 rounded-md px-2 text-[13px] hover:bg-hover"
                    data-testid="add-widget"
                  >
                    <Plus className="size-4" />
                    {t('addWidget')}
                  </button>
                </MenuTrigger>
                <MenuContent>
                  {WIDGET_TYPES.map((type) => (
                    <MenuItem
                      key={type}
                      onSelect={() => add(type)}
                      data-testid="add-widget-type"
                      data-type={type}
                    >
                      {t(`types.${type}`)}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            )}
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              className={cn(
                'flex h-7 items-center gap-1 rounded-md px-2 text-[13px]',
                editing ? 'bg-accent text-white hover:bg-accent-hover' : 'hover:bg-hover',
              )}
              data-testid="edit-dashboard"
            >
              {editing ? <Check className="size-4" /> : <Pencil className="size-3.5" />}
              {editing ? t('done') : t('edit')}
            </button>
          </div>
        )}
      </div>
      {q.data && !widgets.length && (
        <p className="py-6 text-center text-[14px] text-fg-subtle">
          {canEdit ? t('emptyEdit') : t('empty')}
        </p>
      )}
      <Grid
        className="-mx-2"
        layouts={layouts}
        breakpoints={{ lg: 640, sm: 0 }}
        cols={{ lg: 12, sm: 1 }}
        rowHeight={40}
        margin={[12, 12]}
        isDraggable={editing}
        isResizable={editing}
        draggableHandle=".jt-widget-handle"
        onLayoutChange={(l) => onLayout(l)}
        compactType="vertical"
      >
        {widgets.map((w) => (
          <div
            key={w.id}
            className={cn(
              'flex flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated',
              editing && 'ring-1 ring-accent/30',
            )}
            data-testid="widget"
            data-type={w.type}
          >
            <div className="flex h-9 shrink-0 items-center gap-1 px-3">
              {editing && (
                <span
                  className="jt-widget-handle -ml-1 cursor-grab text-fg-subtle"
                  aria-label={t('move')}
                  data-testid="widget-handle"
                >
                  <GripVertical className="size-4" />
                </span>
              )}
              <span className="truncate text-[13px] font-medium text-fg-muted">
                {w.title || t(`types.${w.type}`)}
              </span>
              {editing && (
                <div className="ml-auto flex items-center">
                  <WidgetSettings ws={ws} widget={w} onChange={update} />
                  <button
                    type="button"
                    onClick={() => persist(widgets.filter((x) => x.id !== w.id))}
                    aria-label={t('remove')}
                    className="rounded p-1 text-fg-subtle hover:bg-hover"
                    data-testid="remove-widget"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
              <WidgetBody ws={ws} widget={w} editing={editing} onChange={update} />
            </div>
          </div>
        ))}
      </Grid>
    </section>
  );
}

const inputCls =
  'h-8 w-full rounded-md border border-border bg-bg px-2 text-[14px] outline-none focus:border-accent';

/** Einstellungen eines Widgets: Titel, Datenbank und Ansicht, Tage, Links. */
function WidgetSettings({
  ws,
  widget,
  onChange,
}: {
  ws: string;
  widget: Widget;
  onChange: (w: Widget) => void;
}) {
  const t = useTranslations('dashboard');
  const [title, setTitle] = useState(widget.title);
  const viewTypes = WIDGET_VIEW_TYPES[widget.type];
  const [q, setQ] = useState('');
  const dbs = useQuery({
    queryKey: ['dbSearch', ws, q],
    queryFn: () =>
      apiGet<DatabaseSearchResultDto[]>(`/workspaces/${ws}/databases?q=${encodeURIComponent(q)}`),
    enabled: Boolean(viewTypes),
  });
  const db = useDatabase(widget.databaseId ?? '');
  const views = (db.data?.views ?? []).filter((v) => viewTypes?.includes(v.type));
  const [link, setLink] = useState({ title: '', url: '' });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('settings')}
          className="rounded p-1 text-fg-subtle hover:bg-hover"
          data-testid="widget-settings"
        >
          <Settings2 className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-[300px] flex-col gap-3 p-3">
        <label className="flex flex-col gap-1 text-[13px] text-fg-muted">
          {t('widgetTitle')}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== widget.title && onChange({ ...widget, title })}
            placeholder={t(`types.${widget.type}`)}
            className={inputCls}
          />
        </label>
        {viewTypes && (
          <>
            <label className="flex flex-col gap-1 text-[13px] text-fg-muted">
              {t('database')}
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('searchDatabase')}
                className={inputCls}
                data-testid="widget-db-search"
              />
            </label>
            <div className="max-h-[140px] overflow-y-auto rounded-md border border-border p-1">
              {(dbs.data ?? []).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onChange({ ...widget, databaseId: d.id, viewId: null })}
                  className={cn(
                    'flex h-8 w-full items-center rounded-md px-2 text-left text-[14px] hover:bg-hover',
                    widget.databaseId === d.id && 'bg-active',
                  )}
                  data-testid="widget-db-option"
                  data-title={d.title}
                >
                  <span className="truncate">{d.title || t('untitled')}</span>
                </button>
              ))}
            </div>
            {widget.databaseId && (
              <label className="flex flex-col gap-1 text-[13px] text-fg-muted">
                {t('view')}
                <select
                  value={widget.viewId ?? ''}
                  onChange={(e) => onChange({ ...widget, viewId: e.target.value || null })}
                  className={inputCls}
                  data-testid="widget-view"
                >
                  <option value="">{views.length ? t('choose') : t('noMatchingView')}</option>
                  {views.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        {(widget.type === 'upcoming' || widget.type === 'overdue') && (
          <label className="flex flex-col gap-1 text-[13px] text-fg-muted">
            {t('days')}
            <select
              value={widget.days}
              onChange={(e) => onChange({ ...widget, days: Number(e.target.value) })}
              className={inputCls}
            >
              {[7, 14, 30, 90].map((d) => (
                <option key={d} value={d}>
                  {t('daysValue', { count: d })}
                </option>
              ))}
            </select>
          </label>
        )}
        {widget.type === 'links' && (
          <div className="flex flex-col gap-2 text-[13px]">
            {widget.links.map((l, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="flex-1 truncate">{l.title || l.url}</span>
                <button
                  type="button"
                  aria-label={t('remove')}
                  onClick={() =>
                    onChange({ ...widget, links: widget.links.filter((_, j) => j !== i) })
                  }
                  className="rounded p-1 text-fg-subtle hover:bg-hover"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <input
              value={link.title}
              onChange={(e) => setLink({ ...link, title: e.target.value })}
              placeholder={t('linkTitle')}
              className={inputCls}
              data-testid="link-title"
            />
            <input
              value={link.url}
              onChange={(e) => setLink({ ...link, url: e.target.value })}
              placeholder="https://"
              className={inputCls}
              data-testid="link-url"
            />
            <button
              type="button"
              disabled={!/^https?:\/\/\S+|^\/\S*/i.test(link.url.trim())}
              onClick={() => {
                onChange({
                  ...widget,
                  links: [...widget.links, { title: link.title.trim(), url: link.url.trim() }],
                });
                setLink({ title: '', url: '' });
              }}
              className="h-8 rounded-md bg-accent px-2 text-white disabled:opacity-50"
              data-testid="link-add"
            >
              {t('addLink')}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
