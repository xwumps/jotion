'use client';

import type { SearchResultDto } from '@jotion/shared';
import { useQuery } from '@tanstack/react-query';
import * as D from '@radix-ui/react-dialog';
import { cn } from '@jotion/ui';
import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { pageHref, relativeTime } from '@/lib/format';
import { closeQuickSearch, openQuickSearch, useQuickSearch } from '@/lib/quick-search-store';
import { PageIcon } from '../page/page-icon';

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
  const results = useQuery({
    queryKey: ['search', ws, q],
    queryFn: () => apiGet<SearchResultDto[]>(`/workspaces/${ws}/search?q=${encodeURIComponent(q)}`),
    enabled: state.open,
    placeholderData: (prev) => prev,
  });
  const items = results.data ?? [];

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
    }
  }, [state.open]);
  useEffect(() => setIndex(0), [q]);

  const choose = (r: SearchResultDto) => {
    if (state.open && state.mode === 'pick') closeQuickSearch(r.id);
    else {
      closeQuickSearch();
      router.push(pageHref(ws, r.id));
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
