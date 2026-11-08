'use client';

import { jotionExtensions } from '@jotion/editor';
import type { PageDto, PageVersionDetailDto, PageVersionDto } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiGet, apiPost, errorMessage } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { Dialog, DialogContent } from '../ui/dialog';

/** Phase 10: Seitenhistorie mit Vorschau, Vergleich zur vorherigen Version und Wiederherstellen. */
export function HistoryDialog({
  page,
  open,
  onOpenChange,
}: {
  page: PageDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('history');
  const f = useFormatter();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'preview' | 'diff'>('preview');
  const versions = useQuery({
    queryKey: ['history', page.id],
    queryFn: () => apiGet<PageVersionDto[]>(`/pages/${page.id}/history`),
    enabled: open,
  });
  const current = selected ?? versions.data?.[0]?.id ?? null;
  const detail = useQuery({
    queryKey: ['history', page.id, current],
    queryFn: () => apiGet<PageVersionDetailDto>(`/pages/${page.id}/history/${current}`),
    enabled: open && !!current,
  });
  const restore = useMutation({
    mutationFn: (id: string) => apiPost(`/pages/${page.id}/history/${id}/restore`),
    onSuccess: () => {
      toast.success(t('restored'));
      void qc.invalidateQueries({ queryKey: ['history', page.id] });
      void qc.invalidateQueries({ queryKey: qk.page(page.id) });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  useEffect(() => {
    if (!open) setSelected(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('title')} className="max-w-[960px]">
        <div className="flex h-[70vh] min-h-0 gap-3" data-testid="history-dialog">
          <ul className="w-[240px] shrink-0 overflow-y-auto border-r border-border pr-2">
            {versions.data?.length === 0 && (
              <li className="p-2 text-[13px] text-fg-muted">{t('empty')}</li>
            )}
            {versions.data?.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setSelected(v.id)}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-left hover:bg-hover',
                    v.id === current && 'bg-active',
                  )}
                  data-testid="history-version"
                >
                  <span className="block text-[13px]">
                    {f.dateTime(new Date(v.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                  <span className="block truncate text-[12px] text-fg-muted">
                    {v.reason === 'restore'
                      ? t('beforeRestore')
                      : (v.createdBy?.name ?? t('system'))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex rounded-md border border-border p-0.5 text-[13px]">
                {(['preview', 'diff'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn('rounded px-2 py-0.5', mode === m && 'bg-active')}
                    data-testid={`history-mode-${m}`}
                  >
                    {t(m)}
                  </button>
                ))}
              </div>
              {page.canEdit && current && (
                <button
                  type="button"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(current)}
                  className="ml-auto h-7 rounded-md bg-accent px-3 text-[13px] text-white disabled:opacity-50"
                  data-testid="history-restore"
                >
                  {t('restore')}
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border p-4">
              {detail.data &&
                (mode === 'preview' ? (
                  <VersionPreview detail={detail.data} />
                ) : (
                  <VersionDiff detail={detail.data} />
                ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VersionPreview({ detail }: { detail: PageVersionDetailDto }) {
  const extensions = useMemo(() => jotionExtensions(), []);
  const editor = useEditor(
    {
      extensions,
      editable: false,
      immediatelyRender: false,
      content: detail.doc as object,
      editorProps: { attributes: { class: 'jt-editor', 'data-testid': 'history-preview' } },
    },
    [detail.version.id],
  );
  return (
    <>
      <h2 className="mb-3 text-[24px] font-bold">{detail.version.title}</h2>
      <EditorContent editor={editor} />
    </>
  );
}

function VersionDiff({ detail }: { detail: PageVersionDetailDto }) {
  const t = useTranslations('history');
  const changes = detail.diff.filter((d) => d.status !== 'same');
  if (!changes.length) return <p className="text-[13px] text-fg-muted">{t('noChanges')}</p>;
  return (
    <ul className="flex flex-col gap-1 text-[14px]" data-testid="history-diff">
      {detail.diff.map((d) => (
        <li
          key={`${d.id}-${d.status}`}
          data-status={d.status}
          className={cn(
            'rounded px-2 py-1',
            d.status === 'added' && 'bg-[var(--cb-green)]',
            d.status === 'removed' && 'bg-[var(--cb-red)] line-through',
            d.status === 'changed' && 'bg-[var(--cb-yellow)]',
            d.status === 'same' && 'text-fg-subtle',
          )}
        >
          {d.status === 'changed' && d.before !== null && (
            <span className="mr-2 text-fg-muted line-through">{d.before}</span>
          )}
          {d.status === 'removed' ? d.before : d.text || ' '}
        </li>
      ))}
    </ul>
  );
}
