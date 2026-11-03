'use client';

import { TRASH_RETENTION_DAYS, type PageTreeNodeDto, type TrashItemDto } from '@jotion/shared';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@jotion/ui';
import { ArchiveRestore, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { pageHref, relativeTime } from '@/lib/format';
import { usePageActions } from '@/lib/hooks';
import { qk } from '@/lib/query-keys';
import { PageIcon } from '../page/page-icon';
import { Dialog, DialogContent } from '../ui/dialog';
import { IconButton } from '../ui/icon-button';
import { Tooltip } from '../ui/tooltip';

export function TrashDialog({
  ws,
  open,
  onOpenChange,
}: {
  ws: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useTranslations('trash');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [tab, setTab] = useState<'trash' | 'archive'>('trash');
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const actions = usePageActions(ws);
  const trash = useQuery({
    queryKey: qk.trash(ws),
    queryFn: () => apiGet<TrashItemDto[]>(`/workspaces/${ws}/trash`),
    enabled: open,
  });
  const archive = useQuery({
    queryKey: qk.archive(ws),
    queryFn: () => apiGet<PageTreeNodeDto[]>(`/workspaces/${ws}/archive`),
    enabled: open && tab === 'archive',
  });
  const q = query.trim().toLowerCase();
  const match = (title: string) => !q || title.toLowerCase().includes(q);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('title')} className="max-w-[520px]">
        <div className="mb-3 flex gap-1">
          {(['trash', 'archive'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'h-7 rounded-md px-2.5 text-[13px]',
                tab === id ? 'bg-active font-medium text-fg' : 'text-fg-muted hover:bg-hover',
              )}
            >
              {t(id === 'trash' ? 'tabTrash' : 'tabArchive')}
            </button>
          ))}
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-8 w-full rounded-md bg-hover pl-8 pr-2 text-[14px] outline-none placeholder:text-fg-subtle focus:ring-2 focus:ring-accent/30"
          />
        </label>
        <div className="mt-2 max-h-[50vh] overflow-y-auto">
          {tab === 'trash' &&
            (trash.data?.filter((i) => match(i.title)) ?? []).map((item) => (
              <div
                key={item.id}
                className="group flex min-h-10 items-center gap-2 rounded-md px-2 py-1 hover:bg-hover"
                data-testid="trash-item"
              >
                <PageIcon icon={item.icon} />
                <Link
                  href={pageHref(ws, item.id)}
                  onClick={() => onOpenChange(false)}
                  className="min-w-0 flex-1"
                >
                  <div className="truncate text-[14px]">{item.title || tc('untitled')}</div>
                  <div className="truncate text-[12px] text-fg-subtle">
                    {t('deletedInfo', {
                      time: relativeTime(item.deletedAt, locale),
                      name: item.deletedBy ?? '',
                    })}
                    {item.parentTitle
                      ? ` · ${t('inParent', { title: item.parentTitle || tc('untitled') })}`
                      : ''}
                  </div>
                </Link>
                <Tooltip label={t('restore')}>
                  <IconButton
                    aria-label={t('restore')}
                    onClick={() => actions.restore.mutate(item.id)}
                  >
                    <RotateCcw />
                  </IconButton>
                </Tooltip>
                {item.canDeletePermanently &&
                  (confirmId === item.id ? (
                    <button
                      type="button"
                      onClick={() =>
                        actions.deletePermanently.mutate(item.id, {
                          onSuccess: () => setConfirmId(null),
                        })
                      }
                      className="h-6 rounded-[5px] bg-[var(--c-red)] px-2 text-[12px] font-medium text-white"
                    >
                      {t('confirmDelete')}
                    </button>
                  ) : (
                    <Tooltip label={t('deletePermanently')}>
                      <IconButton
                        aria-label={t('deletePermanently')}
                        onClick={() => setConfirmId(item.id)}
                      >
                        <Trash2 />
                      </IconButton>
                    </Tooltip>
                  ))}
              </div>
            ))}
          {tab === 'trash' && trash.data?.length === 0 && (
            <p className="py-8 text-center text-[14px] text-fg-subtle">{t('empty')}</p>
          )}
          {tab === 'archive' &&
            (archive.data?.filter((i) => match(i.title)) ?? []).map((item) => (
              <div
                key={item.id}
                className="flex h-10 items-center gap-2 rounded-md px-2 hover:bg-hover"
              >
                <PageIcon icon={item.icon} />
                <Link
                  href={pageHref(ws, item.id)}
                  onClick={() => onOpenChange(false)}
                  className="min-w-0 flex-1 truncate text-[14px]"
                >
                  {item.title || tc('untitled')}
                </Link>
                <Tooltip label={t('unarchive')}>
                  <IconButton
                    aria-label={t('unarchive')}
                    onClick={() => actions.archive.mutate({ id: item.id, archived: false })}
                  >
                    <ArchiveRestore />
                  </IconButton>
                </Tooltip>
              </div>
            ))}
          {tab === 'archive' && archive.data?.length === 0 && (
            <p className="py-8 text-center text-[14px] text-fg-subtle">{t('archiveEmpty')}</p>
          )}
        </div>
        {tab === 'trash' && (
          <p className="mt-3 border-t border-border pt-3 text-[12px] text-fg-subtle">
            {t('autoPurge', { days: TRASH_RETENTION_DAYS })}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
