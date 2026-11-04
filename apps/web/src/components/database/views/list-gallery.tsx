'use client';

import type { DatabaseDto, GroupBy, MemberDto, RowDto, ViewConfig, ViewDto } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { ChevronDown, ChevronRight, FileText, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef } from 'react';
import { PageIcon } from '../../page/page-icon';
import { ValueDisplay } from '../cells';
import { useRows, type DatabaseActions } from '../use-database';
import { useGroupLabels } from './board-view';
import { Card, cardProperties, type CardPreview, type CardSize } from './card';
import {
  buildGroups,
  countsByKey,
  useGroupCounts,
  useGroupRows,
  valueForGroup,
  type GroupInfo,
} from './use-views';

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

type Layout = 'list' | 'gallery';

/** Liste und Galerie: ohne Gruppierung eine Fläche, mit Gruppierung einklappbare Abschnitte. */
export function ListGalleryView(props: Props & { layout: Layout }) {
  const { db, view, search, members, saveConfig } = props;
  const locale = useLocale();
  const labels = useGroupLabels();
  const by = view.config.groupBy;
  const prop = by ? db.properties.find((p) => p.id === by.propertyId) : undefined;
  const counts = useGroupCounts(db, view, search, Boolean(prop));
  if (!by || !prop) return <Section {...props} group={null} />;
  const groups = buildGroups(prop, by, countsByKey(counts.data), members, locale, labels).filter(
    (g) => !g.hidden,
  );
  const toggle = (key: string) => {
    const collapsed = by.collapsed.includes(key)
      ? by.collapsed.filter((k) => k !== key)
      : [...by.collapsed, key];
    saveConfig({ groupBy: { ...by, collapsed } as GroupBy });
  };
  return (
    <div className="flex flex-col gap-3 pt-2" data-testid={`${props.layout}-groups`}>
      {groups.map((g) => (
        <div key={g.key} data-testid="view-group" data-group={g.key}>
          <button
            type="button"
            onClick={() => toggle(g.key)}
            aria-expanded={!by.collapsed.includes(g.key)}
            className="flex h-8 items-center gap-1.5 rounded-md px-1 text-[14px] font-medium hover:bg-hover"
          >
            {by.collapsed.includes(g.key) ? (
              <ChevronRight className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
            <span>{g.label}</span>
            <span className="text-[12px] font-normal text-fg-subtle">{g.count}</span>
          </button>
          {!by.collapsed.includes(g.key) && <Section {...props} group={g} />}
        </div>
      ))}
    </div>
  );
}

function Section({
  db,
  view,
  search,
  members,
  actions,
  editable,
  onOpenRow,
  layout,
  group,
}: Props & { layout: Layout; group: GroupInfo | null }) {
  const t = useTranslations('views');
  const flat = useRows(db, view, search, { preview: layout === 'gallery', enabled: !group });
  const grouped = useGroupRows(db, view, search, group?.key, undefined, {
    preview: layout === 'gallery',
    enabled: Boolean(group),
  });
  const q = group ? grouped : flat;
  const rows: RowDto[] = useMemo(() => q.data?.pages.flatMap((p) => p.rows) ?? [], [q.data]);
  const cfg = view.config;
  const props = cardProperties(db, cfg);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !q.hasNextPage) return;
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting) && !q.isFetchingNextPage) void q.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [q]);

  const newRow = () => {
    const prop = cfg.groupBy && db.properties.find((p) => p.id === cfg.groupBy!.propertyId);
    const v = prop && group ? valueForGroup(prop, group.key) : undefined;
    actions.createRow.mutate(
      {
        afterId: rows.at(-1)?.id,
        ...(prop && v !== undefined && prop.type !== 'title' ? { values: { [prop.id]: v } } : {}),
      },
      { onSuccess: (row) => onOpenRow(row.id) },
    );
  };

  const more = q.hasNextPage && (
    <div ref={sentinel} className="py-1">
      <button
        type="button"
        onClick={() => void q.fetchNextPage()}
        className="h-7 rounded-md px-2 text-[12px] text-fg-subtle hover:bg-hover"
      >
        {t('loadMore')}
      </button>
    </div>
  );
  const add = editable && (
    <button
      type="button"
      onClick={newRow}
      className="flex h-8 items-center gap-1 rounded-md px-1.5 text-[14px] text-fg-subtle hover:bg-hover"
      data-testid={`${layout}-new`}
    >
      <Plus className="size-4" />
      {t('new')}
    </button>
  );

  if (layout === 'gallery') {
    const g = {
      cardPreview: 'cover',
      cardSize: 'medium',
      previewPropertyId: null,
      fitImage: false,
      ...cfg.gallery,
    };
    const min = g.cardSize === 'small' ? 180 : g.cardSize === 'large' ? 320 : 240;
    return (
      <div className="pt-2" data-testid="gallery">
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}
        >
          {rows.map((row) => (
            <Card
              key={row.id}
              db={db}
              row={row}
              props={props}
              members={members}
              preview={g.cardPreview as CardPreview}
              previewPropertyId={g.previewPropertyId}
              fit={g.fitImage}
              size={g.cardSize as CardSize}
              onOpen={() => onOpenRow(row.id)}
            />
          ))}
        </div>
        {more}
        {add}
      </div>
    );
  }

  return (
    <div className="flex flex-col pt-1" data-testid="list">
      {rows.map((row) => (
        <div
          key={row.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpenRow(row.id)}
          onKeyDown={(e) => e.key === 'Enter' && onOpenRow(row.id)}
          className="flex min-h-[34px] cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-hover"
          data-testid="list-row"
          data-row={row.id}
        >
          {row.icon ? (
            <PageIcon icon={row.icon} size={16} />
          ) : (
            <FileText className="size-4 shrink-0 text-fg-subtle" />
          )}
          <span
            className={cn('min-w-0 flex-1 truncate text-[14px]', !row.title && 'text-fg-subtle')}
          >
            {row.title || t('untitled')}
          </span>
          <div className="flex max-w-[60%] shrink-0 items-center gap-3 overflow-hidden text-[12px] text-fg-muted">
            {props.map((p) => (
              <div
                key={p.id}
                className="flex max-w-[200px] items-center truncate [&_*]:text-[12px]"
                title={p.name}
              >
                <ValueDisplay prop={p} row={row} members={members} />
              </div>
            ))}
          </div>
        </div>
      ))}
      {more}
      {add}
    </div>
  );
}
