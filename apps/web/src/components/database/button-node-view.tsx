'use client';

import type { AutomationDto } from '@jotion/shared';
import { ButtonBlock } from '@jotion/editor';
import { cn } from '@jotion/ui';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useQuery } from '@tanstack/react-query';
import { MousePointerClick, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiGet, apiPost, errorMessage } from '@/lib/api-client';
import { useEditorPage } from '../editor/editor-context';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { AutomationsDialog } from './automations';

/** Phase 9: Button-Block. Klick löst die zugeordnete Automatisierung aus (Auslöser "Button"). */
function ButtonNodeView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const t = useTranslations('automations');
  const { workspaceId } = useEditorPage();
  const automationId = node.attrs.automationId as string | null;
  const label = String(node.attrs.label ?? '');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(false);
  const editable = editor.isEditable;
  const automation = useQuery({
    queryKey: ['automation', automationId],
    queryFn: () => apiGet<AutomationDto>(`/automations/${automationId}`),
    enabled: !!automationId,
    retry: false,
  });
  const candidates = useQuery({
    queryKey: ['automations', workspaceId, 'none'],
    queryFn: () => apiGet<AutomationDto[]>(`/workspaces/${workspaceId}/automations`),
    enabled: editable,
  });
  const run = async () => {
    if (!automationId) return setDialog(true);
    setBusy(true);
    try {
      const r = await apiPost<{ queued: boolean; status: string | null }>(
        `/automations/${automationId}/run`,
      );
      if (r.status === 'failed') toast.error(t('runFailed'));
      else toast.success(t('runDone'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const text = label || automation.data?.name || t('buttonDefault');
  return (
    <NodeViewWrapper
      data-type="button"
      className={cn(
        'my-1 flex items-center gap-1',
        selected && 'ProseMirror-selectednode rounded-md',
      )}
      contentEditable={false}
    >
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-bg px-3 text-[14px] font-medium shadow-sm hover:bg-hover disabled:opacity-60"
        data-testid="button-block"
      >
        <MousePointerClick className="size-4 text-fg-muted" />
        {automationId ? text : t('setupButton')}
      </button>
      {editable && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t('buttonSettings')}
              className="rounded p-1 text-fg-subtle hover:bg-hover"
              data-testid="button-block-settings"
            >
              <Settings2 className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-[280px] flex-col gap-2 p-3 text-[13px]">
            <label className="flex flex-col gap-1 text-fg-muted">
              {t('buttonLabel')}
              <input
                defaultValue={label}
                onBlur={(e) => updateAttributes({ label: e.target.value.trim().slice(0, 60) })}
                className="h-8 rounded-md border border-border bg-bg px-2 text-fg outline-none focus:border-accent"
                data-testid="button-block-label"
              />
            </label>
            <label className="flex flex-col gap-1 text-fg-muted">
              {t('automation')}
              <select
                value={automationId ?? ''}
                onChange={(e) => updateAttributes({ automationId: e.target.value || null })}
                className="h-8 rounded-md border border-border bg-bg px-2 text-fg"
              >
                <option value="">{t('none')}</option>
                {(candidates.data ?? [])
                  .filter((a) => a.trigger.type === 'button')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setDialog(true)}
              className="h-8 rounded-md border border-border hover:bg-hover"
              data-testid="button-block-edit"
            >
              {automationId ? t('editAutomations') : t('createAutomation')}
            </button>
          </PopoverContent>
        </Popover>
      )}
      {dialog && (
        <AutomationsDialog
          workspaceId={workspaceId}
          db={null}
          open={dialog}
          onOpenChange={setDialog}
          {...(automationId
            ? {}
            : {
                initial: {
                  trigger: { type: 'button', propertyId: null },
                  name: label || t('buttonDefault'),
                },
              })}
          onSaved={(a) => {
            if (!automationId) updateAttributes({ automationId: a.id });
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

export const ButtonNode = ButtonBlock.extend({
  addNodeView: () =>
    ReactNodeViewRenderer(ButtonNodeView, {
      stopEvent: ({ event }) =>
        !(event.target as HTMLElement | null)?.closest?.('[data-drag-handle]'),
      ignoreMutation: () => true,
    }),
});
