'use client';

import type { TemplateDto } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiGet, apiPost, errorMessage } from '@/lib/api-client';
import { pageHref } from '@/lib/format';
import { invalidateTree } from '@/lib/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { PageIcon } from '../page/page-icon';
import { Dialog, DialogContent } from '../ui/dialog';

const CATEGORIES = ['all', 'productivity', 'school', 'knowledge', 'custom'] as const;

/** Phase 9: Vorlagen-Galerie (mitgelieferte und eigene Vorlagen). */
export function TemplateGallery({
  ws,
  open,
  onOpenChange,
}: {
  ws: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('templates');
  const router = useRouter();
  const qc = useQueryClient();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const [scope, setScope] = useState<'PRIVATE' | 'TEAM'>('PRIVATE');
  const list = useQuery({
    queryKey: ['templates', ws],
    queryFn: () => apiGet<TemplateDto[]>(`/workspaces/${ws}/templates`),
    enabled: open,
  });
  const use = useMutation({
    mutationFn: (tpl: TemplateDto) =>
      apiPost<{ id: string }>(`/workspaces/${ws}/templates/use`, { templateId: tpl.id, scope }),
    onSuccess: (res) => {
      onOpenChange(false);
      invalidateTree(qc, ws);
      router.push(pageHref(ws, res.id));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const items = (list.data ?? []).filter((x) => category === 'all' || x.category === category);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('gallery')}
        description={t('galleryDescription')}
        className="max-w-[760px]"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'h-7 rounded-md px-2.5 text-[13px]',
                category === c ? 'bg-active font-medium' : 'text-fg-muted hover:bg-hover',
              )}
            >
              {t(`categories.${c}`)}
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-fg-muted">
            {t('createIn')}
            <select
              className="h-7 rounded-md border border-border bg-bg px-1.5 text-[13px]"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'PRIVATE' | 'TEAM')}
              data-testid="template-scope"
            >
              <option value="PRIVATE">{t('private')}</option>
              <option value="TEAM">{t('team')}</option>
            </select>
          </label>
        </div>
        <div
          className="mt-3 grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2"
          data-testid="template-gallery"
        >
          {items.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              disabled={use.isPending}
              onClick={() => use.mutate(tpl)}
              className="flex items-start gap-3 rounded-lg border border-border p-3 text-left hover:bg-hover disabled:opacity-60"
              data-testid="template-card"
              data-title={tpl.title}
            >
              <span className="text-[24px] leading-none">
                <PageIcon icon={tpl.icon} size={24} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium">
                  {tpl.title || t('untitled')}
                </span>
                <span className="mt-0.5 block text-[12px] text-fg-muted">
                  {tpl.builtin
                    ? tpl.description
                    : t(tpl.scope === 'TEAM' ? 'ownTeam' : 'ownPrivate')}
                </span>
              </span>
            </button>
          ))}
          {list.data && items.length === 0 && (
            <p className="text-[13px] text-fg-muted">{t('noCustom')}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
