'use client';

import type { PageDto } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { FileText, ImageIcon, SmilePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { coverStyle } from '@/lib/covers';
import { usePage, usePageActions } from '@/lib/hooks';
import { PageEditor, type PageEditorHandle } from '../editor/page-editor';
import { SaveStatusProvider } from '../editor/save-status';
import { clearLocalCopy } from '../editor/collab-client';
import { CoverPicker } from './cover-picker';
import { IconPicker } from './icon-picker';
import { PageIcon } from './page-icon';
import { PageTopbar } from './page-topbar';
import { TitleEditor } from './title-editor';
import { DatabaseView } from '../database/database-view';
import { RowProperties } from '../database/row-properties';

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
  return (
    <SaveStatusProvider>
      <PageBody key={query.data.id} page={query.data} />
    </SaveStatusProvider>
  );
}

function PageBody({ page }: { page: PageDto }) {
  const t = useTranslations('page');
  const ws = page.workspaceId;
  const router = useRouter();
  const actions = usePageActions(ws);
  const locked = !!page.settings.locked;
  // Phase 10: ansehen und kommentieren sind schreibgeschützt
  const editable = !page.deletedAt && !locked && page.canEdit;
  const font = page.settings.font ?? 'default';
  const [coverHover, setCoverHover] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<PageEditorHandle>(null);

  // Strg/Cmd+P öffnet die Druckansicht (gleiche Daten, statisch, mit Druckoptionen)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        router.push(`/print/${page.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, page.id]);

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
                onSuccess: () => {
                  // Lokale Kopie im Browser mit entfernen
                  void clearLocalCopy(page.id);
                  router.push(`/w/${ws}`);
                },
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
        data-editor-area
        className={cn(
          'mx-auto w-full flex-1 px-6 pb-[30vh] sm:px-24',
          page.settings.fullWidth || page.kind === 'DATABASE' ? 'max-w-none' : 'max-w-[900px]',
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
            onEnter={() => editorRef.current?.focusStart()}
          />
        </div>

        {page.kind === 'DATABASE_ROW' && page.databaseId && (
          <RowProperties databaseId={page.databaseId} rowId={page.id} editable={editable} />
        )}
        <div className="mt-2">
          {page.kind === 'DATABASE' ? (
            <DatabaseView databaseId={page.id} mode="page" editable={!page.deletedAt} />
          ) : (
            <PageEditor ref={editorRef} page={page} editable={editable} />
          )}
        </div>
      </div>
    </div>
  );
}
