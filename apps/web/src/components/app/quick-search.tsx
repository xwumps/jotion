'use client';

import type { ContentSearchResultDto, SearchResultDto } from '@jotion/shared';
import { useQuery } from '@tanstack/react-query';
import * as D from '@radix-ui/react-dialog';
import { cn } from '@jotion/ui';
import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { apiGet } from '@/lib/api-client';
import { pageHref, relativeTime } from '@/lib/format';
import { closeQuickSearch, openQuickSearch, useQuickSearch } from '@/lib/quick-search-store';
import { PageIcon } from '../page/page-icon';
import { useMe } from './providers';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Schnellsuche über Seitentitel (Strg/Cmd+K). Dient auch als Seitenauswahl für Links. */
export function QuickSearch({ ws }: { ws: string }) {
  const t = useTranslations('search');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const state = useQuickSearch();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const q = useDebounced(query, 120);
  const me = useMe();
  const tf = useTranslations('contentSearch');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const picking = state.open && state.mode === 'pick';
  // Seitenauswahl: nur Titel; Suche: Volltext über Titel und Inhalt mit Filtern
  const params = new URLSearchParams({ q });
  if (filters.scope !== 'all') params.set('scope', filters.scope);
  if (filters.titleOnly) params.set('titleOnly', 'true');
  if (filters.mine) params.set('createdBy', me.user.id);
  if (filters.sort !== 'relevance') params.set('sort', filters.sort);
  if (filters.edited !== 'any') {
    const d = new Date();
    d.setDate(d.getDate() - (filters.edited === '7d' ? 7 : 30));
    params.set('editedAfter', d.toISOString().slice(0, 10));
  }
  const results = useQuery({
    queryKey: ['search', ws, picking ? `pick:${q}` : params.toString()],
    queryFn: () =>
      picking
        ? apiGet<SearchResultDto[]>(`/workspaces/${ws}/search?q=${encodeURIComponent(q)}`)
        : apiGet<ContentSearchResultDto[]>(`/workspaces/${ws}/search/content?${params.toString()}`),
    enabled: state.open,
    placeholderData: (prev) => prev,
  });
  const items: (SearchResultDto & Partial<ContentSearchResultDto>)[] = results.data ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // Im Editor mit markiertem Text gehört Strg+K dem Link-Dialog
        const inEditor = (e.target as HTMLElement | null)?.closest?.('.ProseMirror');
        if (inEditor && window.getSelection()?.toString()) return;
        e.preventDefault();
        openQuickSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (state.open) {
      setQuery('');
      setIndex(0);
      setFilters(NO_FILTERS);
    }
  }, [state.open]);
  useEffect(() => setIndex(0), [q]);

  const choose = (r: SearchResultDto & Partial<ContentSearchResultDto>) => {
    if (state.open && state.mode === 'pick') closeQuickSearch(r.id);
    else {
      closeQuickSearch();
      router.push(`${pageHref(ws, r.id)}${r.blockId ? `#${encodeURIComponent(r.blockId)}` : ''}`);
    }
  };

  return (
    <D.Root open={state.open} onOpenChange={(o) => !o && closeQuickSearch()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content
          className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-xl bg-bg-elevated text-fg shadow-popover outline-none"
          aria-describedby={undefined}
        >
          <D.Title className="sr-only">
            {state.open && state.mode === 'pick' ? t('pickTitle') : t('title')}
          </D.Title>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 text-fg-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setIndex((i) => Math.min(i + 1, items.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter' && items[index]) {
                  e.preventDefault();
                  choose(items[index]);
                }
              }}
              placeholder={
                state.open && state.mode === 'pick' ? t('pickPlaceholder') : t('placeholder')
              }
              className="h-12 flex-1 bg-transparent text-[16px] outline-none placeholder:text-fg-subtle"
              data-testid="quick-search-input"
              role="combobox"
              aria-expanded
              aria-controls="quick-search-results"
            />
          </div>
          {!picking && (
            <div
              className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2 text-[12px]"
              data-testid="search-filters"
            >
              <Chip
                active={filters.titleOnly}
                onClick={() => setFilters((f) => ({ ...f, titleOnly: !f.titleOnly }))}
              >
                {tf('titleOnly')}
              </Chip>
              <Chip
                active={filters.mine}
                onClick={() => setFilters((f) => ({ ...f, mine: !f.mine }))}
              >
                {tf('createdByMe')}
              </Chip>
              <Select
                label={tf('scope')}
                value={filters.scope}
                options={(['all', 'private', 'team'] as const).map((v) => [v, tf(`scopes.${v}`)])}
                onChange={(scope) => setFilters((f) => ({ ...f, scope }))}
              />
              <Select
                label={tf('edited')}
                value={filters.edited}
                options={(['any', '7d', '30d'] as const).map((v) => [v, tf(`editedRange.${v}`)])}
                onChange={(edited) => setFilters((f) => ({ ...f, edited }))}
              />
              <Select
                label={tf('sort')}
                value={filters.sort}
                options={(['relevance', 'edited'] as const).map((v) => [v, tf(`sorts.${v}`)])}
                onChange={(sort) => setFilters((f) => ({ ...f, sort }))}
              />
            </div>
          )}
          <div
            id="quick-search-results"
            role="listbox"
            className="max-h-[50vh] overflow-y-auto p-1"
          >
            <div className="px-3 pb-1 pt-2 text-[12px] font-medium text-fg-subtle">
              {q ? t('results') : t('recent')}
            </div>
            {items.map((r, i) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={i === index}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(r)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left',
                  i === index && 'bg-hover',
                )}
                data-testid="quick-search-result"
              >
                <PageIcon icon={r.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{r.title || tc('untitled')}</span>
                  {r.path && (
                    <span className="block truncate text-[12px] text-fg-subtle">{r.path}</span>
                  )}
                  {r.snippet && (
                    <span
                      className="mt-0.5 line-clamp-2 block text-[12px] text-fg-muted"
                      data-testid="search-snippet"
                    >
                      <Highlighted text={r.snippet} ranges={r.highlights ?? []} />
                    </span>
                  )}
                </span>
                <span className="text-[12px] text-fg-subtle">
                  {relativeTime(r.lastEditedAt, locale)}
                </span>
              </button>
            ))}
            {results.isSuccess && items.length === 0 && (
              <p className="px-3 py-6 text-center text-[14px] text-fg-subtle">{t('empty')}</p>
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

interface Filters {
  scope: 'all' | 'private' | 'team';
  titleOnly: boolean;
  mine: boolean;
  edited: 'any' | '7d' | '30d';
  sort: 'relevance' | 'edited';
}
const NO_FILTERS: Filters = {
  scope: 'all',
  titleOnly: false,
  mine: false,
  edited: 'any',
  sort: 'relevance',
};

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 hover:bg-hover',
        active ? 'border-accent text-accent' : 'border-border text-fg-muted',
      )}
    >
      {children}
    </button>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <select
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-full border border-border bg-transparent px-2 py-0.5 text-fg-muted outline-none hover:bg-hover"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v} className="bg-bg-elevated text-fg">
          {l}
        </option>
      ))}
    </select>
  );
}

function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: ReactNode[] = [];
  let last = 0;
  ranges.forEach(([s, e], i) => {
    if (s > last) parts.push(text.slice(last, s));
    parts.push(
      <mark key={i} className="rounded-sm bg-[var(--cb-yellow)] px-px text-fg">
        {text.slice(s, e)}
      </mark>,
    );
    last = e;
  });
  parts.push(text.slice(last));
  return <>{parts}</>;
}
