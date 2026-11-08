'use client';

import {
  CREATABLE_VIEW_TYPES,
  operatorsFor,
  type DatabaseDto,
  type FilterGroup,
  type ViewDto,
  type ViewType,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import {
  ArrowUpDown,
  Copy,
  Database as DatabaseIcon,
  Eye,
  ListFilter,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Table2,
  Trash2,
  WrapText,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { pageHref } from '@/lib/format';
import { usePageActions } from '@/lib/hooks';
import { PageIcon } from '../page/page-icon';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/menu';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { countConditions, FilterEditor, SortEditor } from './filter-editor';
import { RowPeek } from './row-peek';
import { NewRowButton } from './row-templates-menu';
import { AutomationsButton } from './automations';
import { orderedProperties, TableView } from './table-view';
import { BoardView } from './views/board-view';
import { CalendarView } from './views/calendar-view';
import { ChartView } from './views/chart-view';
import { ListGalleryView } from './views/list-gallery';
import { TimelineView } from './views/timeline-view';
import { VIEW_ICONS, ViewSettings } from './views/view-settings';
import {
  useCalculations,
  useDatabase,
  useDatabaseActions,
  useFlatRows,
  useMembers,
  useRows,
} from './use-database';

const viewKey = (id: string) => `jotion:db-view:${id}`;

/**
 * Datenbank mit Ansichten-Tabs, Werkzeugleiste (Filter, Sortierung, Suche, Spalten) und
 * Table View. mode "page" für Full-Page-Datenbanken, "inline" für den Block im Editor.
 */
export function DatabaseView({
  databaseId,
  mode,
  editable = true,
}: {
  databaseId: string;
  mode: 'page' | 'inline';
  editable?: boolean;
}) {
  const t = useTranslations('database');
  const q = useDatabase(databaseId);
  if (q.isError)
    return (
      <div
        className="flex items-center gap-2 py-2 text-[14px] text-fg-subtle"
        data-testid="database-no-access"
      >
        <Lock className="size-4" />
        {t('noAccess')}
      </div>
    );
  if (!q.data) return <div className="h-24" aria-busy="true" />;
  return <DatabaseBody db={q.data} mode={mode} editable={editable && q.data.canEdit} />;
}

function DatabaseBody({
  db,
  mode,
  editable,
}: {
  db: DatabaseDto;
  mode: 'page' | 'inline';
  editable: boolean;
}) {
  const t = useTranslations('database');
  const [viewId, setViewId] = useState<string | null>(null);
  useEffect(() => {
    try {
      setViewId(localStorage.getItem(viewKey(db.id)));
    } catch {
      /* ohne Speicher */
    }
  }, [db.id]);
  const view: ViewDto | undefined = db.views.find((v) => v.id === viewId) ?? db.views[0];
  const selectView = (id: string) => {
    setViewId(id);
    try {
      localStorage.setItem(viewKey(db.id), id);
    } catch {
      /* ohne Speicher */
    }
  };

  const tv = useTranslations('views');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(h);
  }, [search]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [peek, setPeek] = useState<string | null>(null);

  const members = useMembers(db.workspaceId);
  const actions = useDatabaseActions(db);
  const rowsQ = useRows(db, view, debounced, { enabled: !view || view.type === 'table' });
  const { rows, total } = useFlatRows(rowsQ.data);
  const calc = useCalculations(db, view, debounced);
  const canEditStructure = editable;
  const canEditSchema = editable && !db.sourceMissing;
  const pageActions = usePageActions(db.workspaceId);

  if (!view) return null;
  const cfg = view.config;
  const props = orderedProperties(db, cfg);
  const saveConfig = (patch: Partial<typeof cfg>) =>
    actions.updateView.mutate({ id: view.id, config: patch });
  const filterBy = (propertyId: string) => {
    const prop = db.properties.find((p) => p.id === propertyId);
    if (!prop || !operatorsFor(prop.type).length) return;
    const root: FilterGroup = cfg.filter ?? { type: 'group', op: 'and', children: [] };
    saveConfig({
      filter: {
        ...root,
        children: [
          ...root.children,
          {
            type: 'condition',
            propertyId,
            operator: operatorsFor(prop.type)[0]!,
            value: prop.type === 'checkbox' ? true : undefined,
          },
        ],
      },
    });
    setFilterOpen(true);
  };
  const filterCount = countConditions(cfg.filter);
  const viewProps = {
    db,
    view,
    search: debounced,
    members: members.data ?? [],
    actions,
    editable,
    onOpenRow: setPeek,
    saveConfig: (patch: Partial<typeof cfg>) => saveConfig(patch),
  };
  const setLock = (locked: boolean) =>
    pageActions.update.mutate(
      { id: db.id, settings: { locked } },
      { onSuccess: () => void actions.refreshDb() },
    );

  return (
    <div
      className={cn('flex min-w-0 flex-col', mode === 'inline' && 'my-2')}
      data-testid="database-view"
    >
      {mode === 'inline' && (
        <InlineHeader
          db={db}
          editable={editable}
          onRename={(title) => pageActions.update.mutate({ id: db.id, title })}
        />
      )}
      {db.sourceMissing ? (
        <div
          className="flex items-center gap-2 rounded-md bg-hover px-3 py-3 text-[14px] text-fg-muted"
          data-testid="database-source-missing"
        >
          <Lock className="size-4" />
          {t('sourceMissing')}
        </div>
      ) : (
        <>
          <div className="flex min-h-[38px] flex-wrap items-center gap-1 border-b border-border">
            <ViewTabs
              db={db}
              current={view}
              editable={canEditStructure}
              onSelect={selectView}
              actions={actions}
            />
            <div className="ml-auto flex items-center gap-0.5 text-fg-muted">
              <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex h-7 items-center gap-1 rounded-md px-1.5 text-[14px] hover:bg-hover',
                      filterCount > 0 && 'text-accent',
                    )}
                    data-testid="filter-button"
                  >
                    <ListFilter className="size-4" />
                    <span className="hidden sm:inline">{t('toolbar.filter')}</span>
                    {filterCount > 0 && <span className="text-[12px]">{filterCount}</span>}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="p-0">
                  <FilterEditor
                    props={props}
                    members={members.data ?? []}
                    filter={cfg.filter}
                    onChange={(filter) => saveConfig({ filter })}
                  />
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex h-7 items-center gap-1 rounded-md px-1.5 text-[14px] hover:bg-hover',
                      cfg.sorts.length > 0 && 'text-accent',
                    )}
                    data-testid="sort-button"
                  >
                    <ArrowUpDown className="size-4" />
                    <span className="hidden sm:inline">{t('toolbar.sort')}</span>
                    {cfg.sorts.length > 0 && (
                      <span className="text-[12px]">{cfg.sorts.length}</span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="p-0">
                  <SortEditor
                    props={props}
                    sorts={cfg.sorts}
                    onChange={(sorts) => saveConfig({ sorts })}
                  />
                </PopoverContent>
              </Popover>
              {searchOpen || search ? (
                <div className="flex h-7 items-center gap-1 rounded-md border border-border px-1.5">
                  <Search className="size-3.5" />
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onBlur={() => !search && setSearchOpen(false)}
                    onKeyDown={(e) => e.key === 'Escape' && (setSearch(''), setSearchOpen(false))}
                    placeholder={t('toolbar.searchPlaceholder')}
                    aria-label={t('toolbar.search')}
                    className="w-[140px] bg-transparent text-[14px] text-fg outline-none"
                    data-testid="database-search"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      aria-label={t('toolbar.clearSearch')}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  aria-label={t('toolbar.search')}
                  className="flex h-7 items-center rounded-md px-1.5 hover:bg-hover"
                  data-testid="search-button"
                >
                  <Search className="size-4" />
                </button>
              )}
              {db.locked && (
                <span
                  className="flex h-7 items-center gap-1 px-1 text-[12px] text-fg-subtle"
                  title={tv('lockedHint')}
                  data-testid="database-locked"
                >
                  <Lock className="size-3.5" />
                  <span className="hidden sm:inline">{tv('locked')}</span>
                </span>
              )}
              <ViewSettings
                db={db}
                view={view}
                editable={canEditStructure}
                onLayout={(type) =>
                  actions.updateView.mutate({
                    id: view.id,
                    type: type as Exclude<ViewType, 'chart'>,
                  })
                }
                saveConfig={saveConfig}
                onLock={setLock}
              />
              {view.type === 'table' && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={t('toolbar.properties')}
                      className="flex h-7 items-center rounded-md px-1.5 hover:bg-hover"
                      data-testid="properties-button"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[260px] p-1">
                    <div className="px-2 pb-1 pt-1.5 text-[12px] font-medium text-fg-subtle">
                      {t('toolbar.properties')}
                    </div>
                    {props.map((p) => {
                      const vis =
                        p.type === 'title' ||
                        cfg.properties.find((x) => x.id === p.id)?.visible !== false;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={p.type === 'title'}
                          onClick={() =>
                            saveConfig({
                              properties: props.map((x) => {
                                const cur = cfg.properties.find((c) => c.id === x.id);
                                return {
                                  id: x.id,
                                  visible: x.id === p.id ? !vis : (cur?.visible ?? true),
                                  ...(cur?.width ? { width: cur.width } : {}),
                                };
                              }),
                            })
                          }
                          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover disabled:opacity-60"
                          data-testid="toggle-property"
                          data-property={p.name}
                        >
                          <span className="flex-1 truncate">{p.name}</span>
                          <Eye
                            className={cn('size-4', vis ? 'text-fg' : 'text-fg-subtle opacity-40')}
                          />
                        </button>
                      );
                    })}
                    <div className="my-1 h-px bg-border" />
                    <button
                      type="button"
                      onClick={() => saveConfig({ wrapCells: !cfg.wrapCells })}
                      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
                    >
                      <WrapText className="size-4" />
                      <span className="flex-1">{t('toolbar.wrap')}</span>
                      {cfg.wrapCells && <span className="text-fg-subtle">✓</span>}
                    </button>
                  </PopoverContent>
                </Popover>
              )}
              {editable && <AutomationsButton db={db} />}
              {editable && <NewRowButton db={db} actions={actions} onOpen={setPeek} />}
            </div>
          </div>
          {view.type === 'board' ? (
            <BoardView {...viewProps} canEditSchema={canEditSchema} />
          ) : view.type === 'list' || view.type === 'gallery' ? (
            <ListGalleryView {...viewProps} layout={view.type} />
          ) : view.type === 'calendar' ? (
            <CalendarView {...viewProps} />
          ) : view.type === 'timeline' ? (
            <TimelineView {...viewProps} />
          ) : view.type === 'chart' ? (
            <ChartView {...viewProps} />
          ) : (
            <TableView
              db={db}
              view={view}
              rows={rows}
              total={total}
              hasNextPage={Boolean(rowsQ.hasNextPage)}
              fetchNextPage={() => void rowsQ.fetchNextPage()}
              loading={rowsQ.isFetching}
              calculations={calc.data ?? {}}
              ctx={{ workspaceId: db.workspaceId, members: members.data ?? [], actions, editable }}
              actions={actions}
              canEditSchema={canEditSchema}
              onOpenRow={setPeek}
              maxHeight={mode === 'page' ? 'calc(100vh - 220px)' : '520px'}
              onFilterBy={filterBy}
            />
          )}
        </>
      )}
      {peek && (
        <RowPeek databaseId={db.id} dataId={db.dataId} rowId={peek} onClose={() => setPeek(null)} />
      )}
    </div>
  );
}

function InlineHeader({
  db,
  editable,
  onRename,
}: {
  db: DatabaseDto;
  editable: boolean;
  onRename: (title: string) => void;
}) {
  const t = useTranslations('database');
  const [draft, setDraft] = useState(db.title);
  useEffect(() => setDraft(db.title), [db.title]);
  const title = db.source && !db.title ? db.source.title : draft;
  return (
    <div className="flex items-center gap-2 pb-1">
      <PageIcon icon={db.icon ?? db.source?.icon ?? null} size={22} />
      {editable && !(db.source && !db.title) ? (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== db.title && onRename(draft)}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          placeholder={t('untitled')}
          aria-label={t('title')}
          className="min-w-0 flex-1 bg-transparent text-[20px] font-semibold outline-none placeholder:text-fg-subtle"
          data-testid="database-title"
        />
      ) : (
        <span className="truncate text-[20px] font-semibold">{title || t('untitled')}</span>
      )}
      {db.source && (
        <Link
          href={pageHref(db.workspaceId, db.source.id)}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-fg-subtle hover:bg-hover"
          data-testid="linked-source"
        >
          <DatabaseIcon className="size-3.5" />
          {t('linkedFrom', { title: db.source.title || t('untitled') })}
        </Link>
      )}
      {!db.source && (
        <Link
          href={pageHref(db.workspaceId, db.id)}
          className="flex shrink-0 items-center rounded-md p-1 text-fg-subtle hover:bg-hover"
          aria-label={t('openFullPage')}
        >
          <Table2 className="size-4" />
        </Link>
      )}
    </div>
  );
}

function ViewTabs({
  db,
  current,
  editable,
  onSelect,
  actions,
}: {
  db: DatabaseDto;
  current: ViewDto;
  editable: boolean;
  onSelect: (id: string) => void;
  actions: ReturnType<typeof useDatabaseActions>;
}) {
  const t = useTranslations('database');
  const tv = useTranslations('views');
  const [renaming, setRenaming] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const views = useMemo(() => db.views, [db.views]);
  return (
    <div
      role="tablist"
      aria-label={t('views.label')}
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
    >
      {views.map((v) => {
        const active = v.id === current.id;
        if (renaming === v.id)
          return (
            <input
              key={v.id}
              ref={inputRef}
              autoFocus
              defaultValue={v.name}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== v.name) actions.updateView.mutate({ id: v.id, name });
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
              className="h-7 w-[120px] rounded-md border border-accent bg-bg px-1.5 text-[14px] outline-none"
              aria-label={t('views.rename')}
            />
          );
        return (
          <div
            key={v.id}
            className={cn(
              'group/tab flex h-[38px] shrink-0 items-center border-b-2',
              active ? 'border-fg' : 'border-transparent',
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(v.id)}
              onDoubleClick={() => editable && setRenaming(v.id)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[14px] hover:bg-hover',
                active ? 'font-medium text-fg' : 'text-fg-muted',
              )}
              data-testid="view-tab"
            >
              <ViewIcon type={v.type} />
              {v.name}
            </button>
            {editable && active && !db.locked && (
              <Menu>
                <MenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('views.menu')}
                    className="rounded-md p-0.5 text-fg-subtle hover:bg-hover"
                    data-testid="view-menu"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem icon={Pencil} onSelect={() => setRenaming(v.id)}>
                    {t('views.rename')}
                  </MenuItem>
                  <MenuItem
                    icon={Copy}
                    onSelect={() =>
                      actions.createView.mutate(
                        { name: `${v.name} (2)`, duplicateOf: v.id, afterId: v.id },
                        { onSuccess: (nv) => onSelect(nv.id) },
                      )
                    }
                  >
                    {t('views.duplicate')}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    icon={Trash2}
                    destructive
                    disabled={views.length <= 1}
                    onSelect={() => actions.deleteView.mutate(v.id)}
                  >
                    {t('views.delete')}
                  </MenuItem>
                </MenuContent>
              </Menu>
            )}
          </div>
        );
      })}
      {editable && !db.locked && (
        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label={t('views.add')}
              className="ml-0.5 flex h-7 shrink-0 items-center rounded-md px-1 text-fg-subtle hover:bg-hover"
              data-testid="add-view"
            >
              <Plus className="size-4" />
            </button>
          </MenuTrigger>
          <MenuContent>
            {CREATABLE_VIEW_TYPES.map((type) => (
              <MenuItem
                key={type}
                icon={VIEW_ICONS[type]}
                onSelect={() =>
                  actions.createView.mutate(
                    { name: tv(`layouts.${type}`), type },
                    { onSuccess: (v) => onSelect(v.id) },
                  )
                }
                data-testid="add-view-type"
                data-layout={type}
              >
                {tv(`layouts.${type}`)}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      )}
    </div>
  );
}

function ViewIcon({ type }: { type: ViewType }) {
  const Icon = VIEW_ICONS[type] ?? Table2;
  return <Icon className="size-4" />;
}
