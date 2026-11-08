'use client';

import type { InboxDto, NotificationDto } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, CheckCheck, Inbox, MessageSquare } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiGet, apiPost } from '@/lib/api-client';
import { pageHref, relativeTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

/** Phase 10: Posteingang (Erwähnungen in Seiten und Kommentaren, Antworten). */
export function InboxButton({ ws }: { ws: string }) {
  const t = useTranslations('inbox');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const inbox = useQuery({
    queryKey: qk.inbox(ws),
    queryFn: () => apiGet<InboxDto>(`/workspaces/${ws}/inbox`),
    refetchInterval: 120_000,
  });
  const read = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) =>
      apiPost(`/workspaces/${ws}/inbox/read`, body),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.inbox(ws) }),
  });
  const unread = inbox.data?.unread ?? 0;
  const items = inbox.data?.items ?? [];

  const openItem = (n: NotificationDto) => {
    if (!n.readAt) read.mutate({ ids: [n.id] });
    setOpen(false);
    if (!n.page) return;
    const hash = n.threadId ? `#comment-${n.threadId}` : n.blockId ? `#${n.blockId}` : '';
    router.push(`${pageHref(ws, n.page.id)}${hash}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[14px] text-fg-muted transition-colors hover:bg-hover"
          data-testid="nav-inbox"
        >
          <Inbox className="size-[18px] shrink-0 opacity-80" />
          <span className="truncate">{t('title')}</span>
          {unread > 0 && (
            <span
              className="ml-auto rounded-full bg-[var(--c-red)] px-1.5 text-[11px] font-medium text-white"
              data-testid="inbox-unread"
              aria-label={t('unread', { count: unread })}
            >
              {unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="flex max-h-[70vh] w-[360px] flex-col p-0 text-fg"
        data-testid="inbox-panel"
      >
        <div className="flex items-center border-b border-border px-3 py-2">
          <span className="text-[14px] font-medium">{t('title')}</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => read.mutate({ all: true })}
              className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-fg-muted hover:bg-hover"
              data-testid="inbox-read-all"
            >
              <CheckCheck className="size-3.5" />
              {t('readAll')}
            </button>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1">
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-[13px] text-fg-muted">{t('empty')}</li>
          )}
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => openItem(n)}
                className={cn(
                  'flex w-full gap-2 rounded-md px-2 py-2 text-left hover:bg-hover',
                  !n.readAt && 'bg-accent/5',
                )}
                data-testid="inbox-item"
                data-type={n.type}
                data-read={n.readAt ? 'true' : 'false'}
              >
                {n.type === 'mention_page' || n.type === 'mention_comment' ? (
                  <AtSign className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                ) : (
                  <MessageSquare className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px]">
                    {t(`type.${n.type}`, {
                      actor: n.actor?.name ?? t('someone'),
                      page: n.page?.title || t('untitled'),
                    })}
                  </span>
                  {n.excerpt && (
                    <span className="mt-0.5 line-clamp-2 block text-[12px] text-fg-muted">
                      {n.excerpt}
                    </span>
                  )}
                  <span className="mt-0.5 block text-[11px] text-fg-subtle">
                    {relativeTime(n.createdAt, locale)}
                  </span>
                </span>
                {!n.readAt && (
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
