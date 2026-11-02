'use client';

import type { PageDto } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { FileText, ImageIcon, Plus, SmilePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { coverStyle } from '@/lib/covers';
import { pageHref } from '@/lib/format';
import { useChildren, usePage, usePageActions } from '@/lib/hooks';
import { CoverPicker } from './cover-picker';
import { IconPicker } from './icon-picker';
import { PageIcon } from './page-icon';
import { PageTopbar } from './page-topbar';
import { TitleEditor } from './title-editor';

export function PageView({ pageId }: { pageId: string }) {
  const t = useTranslations('page');
  const query = usePage(pageId);

  useEffect(() => {
    if (query.data) document.title = `${query.data.title || t('untitledTitle')} | Jotion`;
  }, [query.data, t]);

  if (query.isError) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 text-center"
        data-testid="page-not-found"
      >
        <FileText className="size-10 text-fg-subtle" />
        <h1 className="text-[18px] font-semibold">{t('notFound')}</h1>
        <p className="max-w-sm text-[14px] text-fg-muted">{t('notFoundHint')}</p>
      </div>
    );
  }
  if (!query.data) return <div className="h-full" aria-busy="true" />;
  return <PageBody key={query.data.id} page={query.data} />;
}

function PageBody({ page }: { page: PageDto }) {
  const t = useTranslations('page');
  const ws = page.workspaceId;
  const router = useRouter();
  const actions = usePageActions(ws);
  const locked = !!page.settings.locked;
  const editable = !page.deletedAt && !locked;
  const font = page.settings.font ?? 'default';
  const children = useChildren(page.id, true);
  const [coverHover, setCoverHover] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="flex min-h-full flex-col">
      <PageTopbar page={page} />
      {page.deletedAt && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-center gap-3 bg-[var(--c-red)] px-4 py-2 text-[14px] text-white"
          data-testid="trash-banner"
        >
          {t('inTrash')}
          <button
            type="button"
            onClick={() => actions.restore.mutate(page.id)}
            className="rounded-md border border-white/60 px-2 py-0.5 hover:bg-white/15"
          >
            {t('restore')}
          </button>
          <button
            type="button"
            onClick={() =>
              actions.deletePermanently.mutate(page.id, {
                onSuccess: () => router.push(`/w/${ws}`),
              })
            }
            className="rounded-md border border-white/60 px-2 py-0.5 hover:bg-white/15"
          >
            {t('deletePermanently')}
          </button>
        </div>
      )}
      {page.archivedAt && !page.deletedAt && (
        <div
          role="status"
          className="flex items-center justify-center gap-3 bg-[var(--cb-yellow)] px-4 py-2 text-[14px] text-fg"
        >
          {t('archivedBanner')}
          <button
            type="button"
            onClick={() => actions.archive.mutate({ id: page.id, archived: false })}
            className="rounded-md border border-border px-2 py-0.5 hover:bg-hover"
          >
            {t('unarchive')}
          </button>
        </div>
      )}

      {page.cover && (
        <div
          className="group relative h-[30vh] min-h-[160px] w-full"
          style={coverStyle(page.cover)}
          onMouseEnter={() => setCoverHover(true)}
          onMouseLeave={() => setCoverHover(false)}
          data-testid="page-cover"
        >
          {editable && (
            <div
              className={cn(
                'absolute bottom-3 right-3 flex gap-1 transition-opacity',
                coverHover ? 'opacity-100' : 'opacity-0 focus-within:opacity-100',
              )}
            >
              <CoverPicker
                workspaceId={ws}
                onSelect={(cover) => actions.update.mutate({ id: page.id, cover })}
              >
                <button
                  type="button"
                  className="rounded-md bg-bg-elevated/90 px-2 py-1 text-[12px] text-fg-muted shadow-sm hover:bg-bg-elevated"
                >
                  {t('changeCover')}
                </button>
              </CoverPicker>
            </div>
          )}
        </div>
      )}

      <div
        className={cn(
          'mx-auto w-full flex-1 px-6 pb-[30vh] sm:px-24',
          page.settings.fullWidth ? 'max-w-none' : 'max-w-[900px]',
          font === 'serif' && 'font-serif',
          font === 'mono' && 'font-mono',
          page.settings.smallText ? 'text-[14px]' : 'text-[16px]',
        )}
      >
        <div
          className={cn(
            'group/header relative',
            page.cover ? (page.icon ? '-mt-[42px]' : 'pt-6') : page.icon ? 'pt-16' : 'pt-24',
          )}
        >
          {page.icon && (
            <IconPicker
              workspaceId={ws}
              hasIcon
              onSelect={(icon) => editable && actions.update.mutate({ id: page.id, icon })}
            >
              <button
                type="button"
                disabled={!editable}
                aria-label={t('changeIcon')}
                className="mb-2 flex size-[78px] items-center justify-center rounded-lg hover:bg-hover disabled:hover:bg-transparent"
                data-testid="page-icon"
              >
                <PageIcon icon={page.icon} size={72} />
              </button>
            </IconPicker>
          )}
          {editable && (
            <div className="flex h-7 gap-1 text-[14px] text-fg-subtle opacity-0 transition-opacity focus-within:opacity-100 group-hover/header:opacity-100">
              {!page.icon && (
                <IconPicker
                  workspaceId={ws}
                  hasIcon={false}
                  onSelect={(icon) => actions.update.mutate({ id: page.id, icon })}
                >
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-md px-1.5 hover:bg-hover"
                  >
                    <SmilePlus className="size-4" />
                    {t('addIcon')}
                  </button>
                </IconPicker>
              )}
              {!page.cover && (
                <button
                  type="button"
                  onClick={() =>
                    actions.update.mutate({
                      id: page.id,
                      cover: { type: 'gradient', value: 'ocean' },
                    })
                  }
                  className="flex items-center gap-1.5 rounded-md px-1.5 hover:bg-hover"
                >
                  <ImageIcon className="size-4" />
                  {t('addCover')}
                </button>
              )}
            </div>
          )}
          <TitleEditor
            ref={titleRef}
            value={page.title}
            readOnly={!editable}
            placeholder={t('untitled')}
            onSave={(title) => actions.update.mutate({ id: page.id, title })}
          />
        </div>

        <section className="mt-6" aria-label={t('subpages')}>
          {children.data?.map((c) => (
            <Link
              key={c.id}
              href={pageHref(ws, c.id)}
              className="flex h-[30px] items-center gap-2 rounded-md px-1 text-fg underline decoration-border underline-offset-4 hover:bg-hover"
              data-testid="subpage-link"
            >
              <PageIcon icon={c.icon} size={18} />
              <span className="truncate">{c.title || t('untitled')}</span>
            </Link>
          ))}
          {editable && (
            <button
              type="button"
              onClick={() => actions.create.mutate({ parentId: page.id })}
              className="mt-1 flex h-[30px] items-center gap-2 rounded-md px-1 text-[14px] text-fg-subtle hover:bg-hover"
            >
              <Plus className="size-4" />
              {t('addSubpage')}
            </button>
          )}
          <p className="mt-8 rounded-md border border-dashed border-border px-4 py-3 text-[14px] text-fg-subtle">
            {t('editorComingSoon')}
          </p>
        </section>
      </div>
    </div>
  );
}
