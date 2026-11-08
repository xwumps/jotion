'use client';

import * as D from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronsRight, Maximize2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRef } from 'react';
import { pageHref } from '@/lib/format';
import { usePage, usePageActions } from '@/lib/hooks';
import { PageEditor, type PageEditorHandle } from '../editor/page-editor';
import { SaveIndicator, SaveStatusProvider } from '../editor/save-status';
import { PageIcon } from '../page/page-icon';
import { TitleEditor } from '../page/title-editor';
import { RowProperties } from './row-properties';
import { invalidateRows } from './use-database';

/**
 * Zeile als Seitenleiste (Peek): Titel, Properties und derselbe Editor wie in der Seitenansicht.
 * Inhalte werden genauso gespeichert (Yjs, Speichern vor Bestätigung).
 */
export function RowPeek({
  databaseId,
  dataId,
  rowId,
  onClose,
}: {
  databaseId: string;
  dataId: string;
  rowId: string;
  onClose: () => void;
}) {
  const t = useTranslations('database');
  const tp = useTranslations('page');
  const tt = useTranslations('templates');
  const page = usePage(rowId);
  const qc = useQueryClient();
  const editorRef = useRef<PageEditorHandle>(null);
  const actions = usePageActions(page.data?.workspaceId ?? '');
  const editable = Boolean(page.data && !page.data.deletedAt && !page.data.settings.locked);

  return (
    <D.Root open onOpenChange={(o) => !o && onClose()} modal={false}>
      <D.Portal>
        <D.Content
          className="fixed bottom-0 right-0 top-0 z-40 flex w-[min(640px,100vw)] flex-col border-l border-border bg-bg shadow-popover outline-none"
          onInteractOutside={(e) => {
            // Klicks in Popovers (Zelleneditoren) schließen den Peek nicht
            const target = e.target as HTMLElement | null;
            if (target?.closest('[data-radix-popper-content-wrapper]')) e.preventDefault();
          }}
          aria-describedby={undefined}
          data-testid="row-peek"
        >
          <SaveStatusProvider>
            <div className="flex h-11 shrink-0 items-center gap-1 px-2">
              <D.Close
                className="rounded-md p-1.5 text-fg-muted hover:bg-hover"
                aria-label={t('peek.close')}
              >
                <ChevronsRight className="size-4" />
              </D.Close>
              {page.data && (
                <Link
                  href={pageHref(page.data.workspaceId, rowId)}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-fg-muted hover:bg-hover"
                  data-testid="peek-open-page"
                >
                  <Maximize2 className="size-3.5" />
                  {t('peek.openPage')}
                </Link>
              )}
              {page.data?.kind === 'ROW_TEMPLATE' && (
                <span
                  className="rounded bg-[var(--cb-purple)] px-1.5 py-0.5 text-[12px] font-medium text-[var(--c-purple)]"
                  data-testid="peek-template-badge"
                >
                  {tt('badge')}
                </span>
              )}
              <div className="ml-auto">
                <SaveIndicator />
              </div>
            </div>
            <D.Title className="sr-only">{page.data?.title || tp('untitled')}</D.Title>
            <div className="flex-1 overflow-y-auto px-6 pb-24 sm:px-12">
              {page.data ? (
                <>
                  {page.data.icon && (
                    <div className="pt-4">
                      <PageIcon icon={page.data.icon} size={48} />
                    </div>
                  )}
                  <div className="pt-6">
                    <TitleEditor
                      value={page.data.title}
                      readOnly={!editable}
                      placeholder={tp('untitled')}
                      onSave={(title) =>
                        actions.update.mutate(
                          { id: rowId, title },
                          { onSuccess: () => invalidateRows(qc, dataId) },
                        )
                      }
                      onEnter={() => editorRef.current?.focusStart()}
                    />
                  </div>
                  <RowProperties databaseId={databaseId} rowId={rowId} editable={editable} />
                  <PageEditor key={rowId} ref={editorRef} page={page.data} editable={editable} />
                </>
              ) : (
                <div aria-busy="true" className="h-40" />
              )}
            </div>
          </SaveStatusProvider>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
