'use client';

import type { PageDto, PageSettings } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { Archive, Link2, Lock, MoreHorizontal, Star, Trash2, Type } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { toast } from 'sonner';
import { pageHref, relativeTime } from '@/lib/format';
import { usePageActions } from '@/lib/hooks';
import { IconButton } from '../ui/icon-button';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '../ui/menu';
import { Tooltip } from '../ui/tooltip';
import { PageIcon } from './page-icon';

const FONTS = ['default', 'serif', 'mono'] as const;

export function PageTopbar({ page }: { page: PageDto }) {
  const t = useTranslations('page');
  const tc = useTranslations('common');
  const locale = useLocale();
  const ws = page.workspaceId;
  const { update, favorite, archive, trash } = usePageActions(ws);
  const setSetting = (patch: PageSettings) => update.mutate({ id: page.id, settings: patch });
  const crumbs = [...page.breadcrumbs, { id: page.id, title: page.title, icon: page.icon }];

  const copyLink = async () => {
    await navigator.clipboard.writeText(
      new URL(pageHref(ws, page.id), window.location.origin).toString(),
    );
    toast.success(t('linkCopied'));
  };

  return (
    <header className="sticky top-0 z-10 flex h-11 items-center gap-2 bg-bg/95 px-3 backdrop-blur print:hidden">
      <nav aria-label={t('breadcrumbs')} className="flex min-w-0 flex-1 items-center text-[14px]">
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex min-w-0 items-center">
            {i > 0 && <span className="px-1 text-fg-subtle">/</span>}
            <Link
              href={pageHref(ws, c.id)}
              className={cn(
                'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-hover',
                i === crumbs.length - 1 ? 'text-fg' : 'text-fg-muted',
              )}
              aria-current={i === crumbs.length - 1 ? 'page' : undefined}
            >
              <PageIcon icon={c.icon} size={16} />
              <span className="max-w-[180px] truncate">{c.title || tc('untitled')}</span>
            </Link>
          </span>
        ))}
        {page.settings.locked && (
          <span className="ml-2 flex items-center gap-1 text-[12px] text-fg-subtle">
            <Lock className="size-3" />
            {t('locked')}
          </span>
        )}
      </nav>
      <span className="hidden text-[13px] text-fg-subtle sm:inline">
        {t('edited', { time: relativeTime(page.lastEditedAt, locale) })}
      </span>
      {!page.deletedAt && (
        <>
          <Tooltip label={page.isFavorite ? t('unfavorite') : t('favorite')}>
            <IconButton
              aria-label={page.isFavorite ? t('unfavorite') : t('favorite')}
              aria-pressed={page.isFavorite}
              onClick={() => favorite.mutate({ id: page.id, on: !page.isFavorite })}
              className="size-7"
            >
              <Star
                className={cn(page.isFavorite && 'fill-[var(--c-yellow)] text-[var(--c-yellow)]')}
              />
            </IconButton>
          </Tooltip>
          <Menu>
            <MenuTrigger asChild>
              <IconButton aria-label={t('menu')} className="size-7">
                <MoreHorizontal />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end" className="w-[260px]">
              <MenuLabel>{t('style')}</MenuLabel>
              <div className="grid grid-cols-3 gap-1 px-1 pb-1">
                {FONTS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setSetting({ font: f })}
                    className={cn(
                      'flex flex-col items-center rounded-md py-1.5 hover:bg-hover',
                      (page.settings.font ?? 'default') === f && 'bg-active text-accent',
                    )}
                  >
                    <span
                      className={cn(
                        'text-[22px] leading-tight',
                        f === 'serif' && 'font-serif',
                        f === 'mono' && 'font-mono',
                      )}
                    >
                      Ag
                    </span>
                    <span className="text-[12px] text-fg-muted">{t(`font.${f}`)}</span>
                  </button>
                ))}
              </div>
              <MenuCheckboxItem
                icon={Type}
                checked={!!page.settings.smallText}
                onCheckedChange={(v) => setSetting({ smallText: v })}
              >
                {t('smallText')}
              </MenuCheckboxItem>
              <MenuCheckboxItem
                checked={!!page.settings.fullWidth}
                onCheckedChange={(v) => setSetting({ fullWidth: v })}
              >
                {t('fullWidth')}
              </MenuCheckboxItem>
              <MenuCheckboxItem
                icon={Lock}
                checked={!!page.settings.locked}
                onCheckedChange={(v) => setSetting({ locked: v })}
              >
                {t('lock')}
              </MenuCheckboxItem>
              <MenuSeparator />
              <MenuItem icon={Link2} onSelect={() => void copyLink()}>
                {t('copyLink')}
              </MenuItem>
              <MenuItem
                icon={Archive}
                onSelect={() => archive.mutate({ id: page.id, archived: !page.archivedAt })}
              >
                {page.archivedAt ? t('unarchive') : t('archive')}
              </MenuItem>
              <MenuItem icon={Trash2} destructive onSelect={() => trash.mutate(page.id)}>
                {t('trash')}
              </MenuItem>
              <MenuSeparator />
              <div className="px-2 py-1 text-[12px] leading-relaxed text-fg-subtle">
                {t('createdBy', {
                  name: page.createdBy.name,
                  time: relativeTime(page.createdAt, locale),
                })}
                <br />
                {t('editedBy', {
                  name: page.lastEditedBy.name,
                  time: relativeTime(page.lastEditedAt, locale),
                })}
              </div>
            </MenuContent>
          </Menu>
        </>
      )}
    </header>
  );
}
