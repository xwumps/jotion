'use client';

import { cn } from '@jotion/ui';
import { useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiPost, errorMessage } from '@/lib/api-client';
import { pageHref } from '@/lib/format';
import { invalidateTree } from '@/lib/hooks';
import { Dialog, DialogContent } from '../ui/dialog';

interface ImportResult {
  rootIds: string[];
  pages: number;
  databases: number;
  rows: number;
  images: number;
  warnings: string[];
}

/** Phase 12: Import von Markdown, CSV und Notion-Export (ZIP). */
export function ImportDialog({
  ws,
  open,
  onOpenChange,
}: {
  ws: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('import');
  const qc = useQueryClient();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [scope, setScope] = useState<'TEAM' | 'PRIVATE'>('TEAM');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await apiPost<ImportResult>(`/workspaces/${ws}/import?scope=${scope}`, form);
      invalidateTree(qc, ws);
      toast.success(
        t('done', { pages: r.pages, databases: r.databases, rows: r.rows, images: r.images }),
        r.warnings.length ? { description: r.warnings.slice(0, 3).join(' · ') } : undefined,
      );
      onOpenChange(false);
      setFile(null);
      if (r.rootIds[0]) router.push(pageHref(ws, r.rootIds[0]));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('title')} description={t('description')} className="max-w-[480px]">
        <div className="flex flex-col gap-3" data-testid="import-dialog">
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
            className={cn(
              'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-8 text-[14px] text-fg-muted hover:bg-hover',
              drag && 'border-accent bg-accent/5',
            )}
          >
            <FileUp className="size-6" />
            {file ? (
              <span className="font-medium text-fg" data-testid="import-file-name">
                {file.name}
              </span>
            ) : (
              t('choose')
            )}
            <span className="text-[12px] text-fg-subtle">{t('formats')}</span>
          </button>
          <input
            ref={input}
            type="file"
            accept=".md,.markdown,.csv,.zip,.txt"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-testid="import-file"
          />
          <label className="flex items-center gap-2 text-[14px]">
            {t('scope')}
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'TEAM' | 'PRIVATE')}
              className="h-8 rounded-md border border-border bg-bg px-2 text-[14px]"
            >
              <option value="TEAM">{t('team')}</option>
              <option value="PRIVATE">{t('private')}</option>
            </select>
          </label>
          <p className="text-[12px] text-fg-subtle">{t('notionHint')}</p>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!file || busy}
              onClick={() => void run()}
              className="h-8 rounded-md bg-accent px-3 text-[14px] font-medium text-white disabled:opacity-50"
              data-testid="import-run"
            >
              {busy ? t('running') : t('run')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
