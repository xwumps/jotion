'use client';

import { Clock, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { pageHref, relativeTime } from '@/lib/format';
import { usePageActions, useRecent } from '@/lib/hooks';
import { Dashboard } from '../dashboard/dashboard';
import { Greeting } from '../greeting';
import { PageIcon } from '../page/page-icon';
import { useMe } from './providers';

export function HomeView({ ws, status }: { ws: string; status: ReactNode }) {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const locale = useLocale();
  const me = useMe();
  const recent = useRecent(ws);
  const { create } = usePageActions(ws);

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-24 pt-[10vh] sm:px-12">
      <h1 className="text-center text-[32px] font-bold tracking-[-0.02em]">
        <Greeting />, {me.user.name.split(' ')[0]}
      </h1>

      <section className="mt-12" aria-labelledby="recent-title">
        <h2
          id="recent-title"
          className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-fg-muted"
        >
          <Clock className="size-3.5" />
          {t('recent')}
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {recent.data?.map((p) => (
            <Link
              key={p.id}
              href={pageHref(ws, p.id)}
              className="flex h-[136px] w-[144px] shrink-0 flex-col justify-between rounded-xl border border-border bg-bg-elevated p-3 transition-colors hover:bg-hover"
              data-testid="recent-card"
            >
              <PageIcon icon={p.icon} size={26} />
              <div>
                <div className="line-clamp-2 text-[14px] font-medium leading-snug">
                  {p.title || tc('untitled')}
                </div>
                <div className="mt-1 text-[12px] text-fg-subtle">
                  {relativeTime(p.visitedAt, locale)}
                </div>
              </div>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => create.mutate({ scope: 'PRIVATE' })}
            className="flex h-[136px] w-[144px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-[14px] text-fg-muted hover:bg-hover"
            data-testid="home-new-page"
          >
            <Plus className="size-5" />
            {t('newPage')}
          </button>
        </div>
        {recent.data?.length === 0 && (
          <p className="mt-1 text-[14px] text-fg-subtle">{t('recentEmpty')}</p>
        )}
      </section>

      <Dashboard ws={ws} />

      <div className="mt-12 max-w-sm">{status}</div>
    </div>
  );
}
