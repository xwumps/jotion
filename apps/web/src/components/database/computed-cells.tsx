'use client';

import type {
  ComputedItem,
  ComputedValue,
  DateValue,
  MemberDto,
  PropertyDto,
  RowDto,
  RowQueryResultDto,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check, FileText, Search, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiPost } from '@/lib/api-client';
import { PageIcon } from '../page/page-icon';
import { formatDate, formatNumber } from './property-meta';

/** Chip einer verknüpften Zeile. */
export function RelationChip({
  title,
  icon,
  onRemove,
}: {
  title: string;
  icon?: RowDto['icon'];
  onRemove?: () => void;
}) {
  const t = useTranslations('database');
  return (
    <span
      className="inline-flex h-5 max-w-full shrink-0 items-center gap-1 truncate rounded-[3px] text-[13px] leading-5 underline decoration-border underline-offset-2"
      data-testid="relation-chip"
    >
      {icon ? (
        <PageIcon icon={icon} size={13} />
      ) : (
        <FileText className="size-3.5 shrink-0 text-fg-subtle" />
      )}
      <span className="truncate">{title || t('untitled')}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('relation.remove', { title: title || t('untitled') })}
          className="opacity-60 hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

export function RelationDisplay({
  prop,
  row,
  wrap,
}: {
  prop: PropertyDto;
  row: RowDto;
  wrap?: boolean;
}) {
  const ids = (row.values[prop.id] as string[] | undefined) ?? [];
  if (!ids.length) return null;
  return (
    <span className={cn('flex min-w-0 gap-2', wrap ? 'flex-wrap' : 'overflow-hidden')}>
      {ids.map((id) => {
        const r = row.refs?.[id];
        return r ? <RelationChip key={id} title={r.title} icon={r.icon} /> : null;
      })}
    </span>
  );
}

function itemText(v: ComputedItem, locale: string): string {
  if (typeof v === 'number') return formatNumber(v, undefined, locale);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if ('kind' in v) return v.kind === 'person' ? v.name : v.title;
  return formatDate(v as DateValue, locale, {});
}

/** Ergebnis einer Formel oder eines Rollups (je nach Ergebnistyp). */
export function ComputedDisplay({
  prop,
  value,
  wrap,
}: {
  prop: PropertyDto;
  value: ComputedValue | undefined;
  wrap?: boolean;
  members?: MemberDto[];
}) {
  const locale = useLocale();
  const textCls = cn('min-w-0', wrap ? 'whitespace-pre-wrap break-words' : 'truncate');
  const cfg = prop.config as { resultType?: string; error?: string | null };
  if (cfg.error)
    return (
      <span
        className="truncate text-[12px] text-[var(--c-red)]"
        title={cfg.error}
        data-testid="formula-error"
      >
        ⚠ {cfg.error}
      </span>
    );
  if (value === null || value === undefined) return null;
  if (cfg.resultType === 'boolean' || typeof value === 'boolean')
    return (
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-[3px] border',
          value === true ? 'border-accent bg-accent text-white' : 'border-fg-subtle',
        )}
        role="img"
        aria-label={value === true ? '✓' : '✗'}
      >
        {value === true && <Check className="size-3" strokeWidth={3} />}
      </span>
    );
  if (typeof value === 'number')
    return (
      <span className="ml-auto truncate tabular-nums" data-testid="computed-value">
        {formatNumber(value, undefined, locale)}
      </span>
    );
  if (Array.isArray(value))
    return (
      <span
        className={cn('flex min-w-0 gap-1', wrap ? 'flex-wrap' : 'overflow-hidden')}
        data-testid="computed-value"
      >
        {value.map((x, i) =>
          typeof x === 'object' && 'kind' in x && x.kind === 'page' ? (
            <RelationChip key={i} title={x.title} />
          ) : (
            <span
              key={i}
              className="inline-flex h-5 shrink-0 items-center rounded-[3px] bg-active px-1.5 text-[13px]"
            >
              {itemText(x, locale)}
            </span>
          ),
        )}
      </span>
    );
  return (
    <span className={textCls} data-testid="computed-value">
      {itemText(value, locale)}
    </span>
  );
}

/** Zeilen der Zieldatenbank suchen und verknüpfen. */
export function RelationEditor({
  prop,
  row,
  onSave,
}: {
  prop: PropertyDto;
  row: RowDto;
  onSave: (ids: string[]) => void;
}) {
  const t = useTranslations('database');
  const cfg = prop.config as { targetDatabaseId: string; limit: 'one' | 'many' };
  const [ids, setIds] = useState<string[]>((row.values[prop.id] as string[] | undefined) ?? []);
  const [titles, setTitles] = useState<Record<string, { title: string; icon: RowDto['icon'] }>>(
    row.refs ?? {},
  );
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  const results = useQuery({
    queryKey: ['relationSearch', cfg.targetDatabaseId, debounced],
    queryFn: () =>
      apiPost<RowQueryResultDto>(`/databases/${cfg.targetDatabaseId}/query`, {
        search: debounced || undefined,
        limit: 20,
      }),
    placeholderData: (prev) => prev,
  });

  const toggle = (r: RowDto) => {
    setTitles((m) => ({ ...m, [r.id]: { title: r.title, icon: r.icon } }));
    const next = ids.includes(r.id)
      ? ids.filter((x) => x !== r.id)
      : cfg.limit === 'one'
        ? [r.id]
        : [...ids, r.id];
    setIds(next);
    onSave(next);
  };

  return (
    <div className="flex flex-col" data-testid="relation-editor">
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-border p-2">
          {ids.map((id) => (
            <RelationChip
              key={id}
              title={titles[id]?.title ?? ''}
              icon={titles[id]?.icon}
              onRemove={() => {
                const next = ids.filter((x) => x !== id);
                setIds(next);
                onSave(next);
              }}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 border-b border-border px-2">
        <Search className="size-3.5 text-fg-subtle" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('relation.search')}
          aria-label={t('relation.search')}
          className="h-9 flex-1 bg-transparent text-[14px] outline-none"
          data-testid="relation-search"
        />
      </div>
      <div className="max-h-[260px] overflow-y-auto p-1">
        {(results.data?.rows ?? []).map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => toggle(r)}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
            data-testid="relation-option"
          >
            {r.icon ? (
              <PageIcon icon={r.icon} size={14} />
            ) : (
              <FileText className="size-3.5 text-fg-subtle" />
            )}
            <span className={cn('flex-1 truncate', !r.title && 'text-fg-subtle')}>
              {r.title || t('untitled')}
            </span>
            {ids.includes(r.id) ? (
              <Check className="size-4 text-accent" />
            ) : (
              <ArrowUpRight className="size-3.5 opacity-0" />
            )}
          </button>
        ))}
        {results.data && results.data.rows.length === 0 && (
          <div className="px-2 py-2 text-[13px] text-fg-subtle">{t('relation.none')}</div>
        )}
      </div>
    </div>
  );
}
