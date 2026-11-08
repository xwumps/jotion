'use client';

import type { AgendaItemDto, DatabaseDto, ViewDto, Widget, WidgetType } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { AlertCircle, CalendarClock, ExternalLink, FileText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { pageHref } from '@/lib/format';
import { useFavorites, useRecent } from '@/lib/hooks';
import { PageIcon } from '../page/page-icon';
import { RowPeek } from '../database/row-peek';
import { formatDate } from '../database/property-meta';
import { useDatabase, useDatabaseActions, useMembers } from '../database/use-database';
import { BoardView } from '../database/views/board-view';
import { CalendarView } from '../database/views/calendar-view';
import { ChartView } from '../database/views/chart-view';
import { useAgenda } from './use-dashboard';

/** Welche Ansichtstypen ein Widget zeigen kann */
export const WIDGET_VIEW_TYPES: Partial<Record<WidgetType, ViewDto['type'][]>> = {
  board: ['board'],
  chart: ['chart'],
  kpi: ['chart'],
  calendar: ['calendar'],
};

export function WidgetBody({
  ws,
  widget,
  editing,
  onChange,
}: {
  ws: string;
  widget: Widget;
  editing: boolean;
  onChange: (w: Widget) => void;
}) {
  switch (widget.type) {
    case 'upcoming':
    case 'overdue':
      return <AgendaWidget ws={ws} widget={widget} />;
    case 'recent':
      return <RecentWidget ws={ws} />;
    case 'favorites':
      return <FavoritesWidget ws={ws} />;
    case 'note':
      return <NoteWidget widget={widget} onChange={onChange} />;
    case 'links':
      return <LinksWidget widget={widget} editing={editing} />;
    default:
      return <ViewWidget widget={widget} />;
  }
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-2 text-center text-[13px] text-fg-subtle">
      {children}
    </div>
  );
}

function AgendaWidget({ ws, widget }: { ws: string; widget: Widget }) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const q = useAgenda(ws, widget.days);
  const items = (widget.type === 'overdue' ? q.data?.overdue : q.data?.upcoming) ?? [];
  if (q.data && !items.length)
    return <Empty>{t(widget.type === 'overdue' ? 'noOverdue' : 'noUpcoming')}</Empty>;
  return (
    <ul className="flex flex-col" data-testid={`agenda-${widget.type}`}>
      {items.map((i: AgendaItemDto) => (
        <li key={`${i.rowId}-${i.propertyName}`}>
          <Link
            href={pageHref(ws, i.rowId)}
            className="flex min-h-9 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-hover"
            data-testid="agenda-item"
          >
            {widget.type === 'overdue' ? (
              <AlertCircle className="size-4 shrink-0 text-[var(--c-red)]" />
            ) : (
              <CalendarClock className="size-4 shrink-0 text-fg-subtle" />
            )}
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-[14px]', !i.title && 'text-fg-subtle')}>
                {i.title || t('untitled')}
              </span>
              <span className="block truncate text-[12px] text-fg-subtle">
                {i.databaseTitle} · {i.propertyName}
              </span>
            </span>
            <span
              className={cn(
                'shrink-0 text-[12px]',
                widget.type === 'overdue' ? 'text-[var(--c-red)]' : 'text-fg-muted',
              )}
            >
              {formatDate(i.date, locale, { dateFormat: 'short' })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RecentWidget({ ws }: { ws: string }) {
  const t = useTranslations('dashboard');
  const recent = useRecent(ws);
  if (recent.data && !recent.data.length) return <Empty>{t('noRecent')}</Empty>;
  return (
    <ul>
      {recent.data?.slice(0, 20).map((p) => (
        <li key={p.id}>
          <Link
            href={pageHref(ws, p.id)}
            className="flex h-8 items-center gap-2 rounded-md px-1.5 text-[14px] hover:bg-hover"
          >
            <PageIcon icon={p.icon} />
            <span className="truncate">{p.title || t('untitled')}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function FavoritesWidget({ ws }: { ws: string }) {
  const t = useTranslations('dashboard');
  const fav = useFavorites(ws);
  if (fav.data && !fav.data.length) return <Empty>{t('noFavorites')}</Empty>;
  return (
    <ul>
      {fav.data?.map((p) => (
        <li key={p.id}>
          <Link
            href={pageHref(ws, p.id)}
            className="flex h-8 items-center gap-2 rounded-md px-1.5 text-[14px] hover:bg-hover"
          >
            <PageIcon icon={p.icon} />
            <span className="truncate">{p.title || t('untitled')}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NoteWidget({ widget, onChange }: { widget: Widget; onChange: (w: Widget) => void }) {
  const t = useTranslations('dashboard');
  const [text, setText] = useState(widget.text);
  const latest = useRef(widget);
  latest.current = widget;
  useEffect(() => setText(widget.text), [widget.text]);
  useEffect(() => {
    if (text === latest.current.text) return;
    const h = setTimeout(() => onChange({ ...latest.current, text }), 600);
    return () => clearTimeout(h);
  }, [text, onChange]);
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      maxLength={5000}
      placeholder={t('notePlaceholder')}
      aria-label={t('types.note')}
      className="h-full w-full resize-none bg-transparent text-[14px] outline-none placeholder:text-fg-subtle"
      data-testid="note-widget"
    />
  );
}

function LinksWidget({ widget, editing }: { widget: Widget; editing: boolean }) {
  const t = useTranslations('dashboard');
  if (!widget.links.length) return <Empty>{editing ? t('linksHintEdit') : t('noLinks')}</Empty>;
  return (
    <ul>
      {widget.links.map((l, i) => {
        const internal = l.url.startsWith('/');
        return (
          <li key={i}>
            <a
              href={l.url}
              {...(internal ? {} : { target: '_blank', rel: 'noopener noreferrer nofollow' })}
              className="flex h-8 items-center gap-2 rounded-md px-1.5 text-[14px] hover:bg-hover"
            >
              {internal ? (
                <FileText className="size-4 text-fg-subtle" />
              ) : (
                <ExternalLink className="size-4 text-fg-subtle" />
              )}
              <span className="truncate">{l.title || l.url}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** Board, Diagramm, KPI oder Kalender einer Datenbank-Ansicht. */
function ViewWidget({ widget }: { widget: Widget }) {
  const t = useTranslations('dashboard');
  const q = useDatabase(widget.databaseId ?? '');
  if (!widget.databaseId || !widget.viewId) return <Empty>{t('chooseView')}</Empty>;
  if (q.isError) return <Empty>{t('noAccess')}</Empty>;
  if (!q.data) return null;
  const view = q.data.views.find((v) => v.id === widget.viewId);
  if (!view) return <Empty>{t('viewMissing')}</Empty>;
  return <ViewWidgetBody db={q.data} view={view} type={widget.type} />;
}

function ViewWidgetBody({ db, view, type }: { db: DatabaseDto; view: ViewDto; type: WidgetType }) {
  const members = useMembers(db.workspaceId);
  const actions = useDatabaseActions(db);
  const [peek, setPeek] = useState<string | null>(null);
  const common = {
    db,
    view,
    search: '',
    members: members.data ?? [],
    actions,
    editable: db.canEdit,
    onOpenRow: setPeek,
    saveConfig: () => {},
  };
  return (
    <div className="h-full" onMouseDown={(e) => e.stopPropagation()}>
      {type === 'chart' || type === 'kpi' ? (
        <ChartView {...common} editable={false} embedded height={type === 'kpi' ? 140 : 240} />
      ) : type === 'board' ? (
        <BoardView {...common} canEditSchema={false} />
      ) : (
        <CalendarView
          {...common}
          saveConfig={(patch) => actions.updateView.mutate({ id: view.id, config: patch })}
        />
      )}
      {peek && (
        <RowPeek databaseId={db.id} dataId={db.dataId} rowId={peek} onClose={() => setPeek(null)} />
      )}
    </div>
  );
}
