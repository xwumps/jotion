'use client';

import type { DatabaseDto, Recurrence, RowDto, RowTemplateDto } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FileText, MoreHorizontal, Plus, Repeat, Star, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '@/lib/api-client';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import type { DatabaseActions } from './use-database';

const key = (dbId: string) => ['rowTemplates', dbId] as const;
const selectCls =
  'h-7 rounded-md border border-border bg-bg px-1.5 text-[13px] outline-none focus:border-accent';

/**
 * Phase 9: "Neu" mit Zeilen-Vorlagen: Zeile aus Vorlage anlegen, Vorlagen bearbeiten (öffnet die
 * Vorlage im Peek), Standardvorlage, Wiederholung, neue Vorlage, löschen.
 */
export function NewRowButton({
  db,
  actions,
  onOpen,
}: {
  db: DatabaseDto;
  actions: DatabaseActions;
  onOpen: (rowId: string) => void;
}) {
  const t = useTranslations('database');
  const tt = useTranslations('templates');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const templates = useQuery({
    queryKey: key(db.id),
    queryFn: () => apiGet<RowTemplateDto[]>(`/databases/${db.id}/templates`),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: key(db.id) });
  const create = (templateId?: string) =>
    actions.createRow.mutate(templateId ? { templateId } : {}, {
      onSuccess: (row: RowDto) => onOpen(row.id),
    });
  const newTemplate = useMutation({
    mutationFn: () =>
      apiPost<RowTemplateDto>(`/databases/${db.id}/templates`, { title: tt('newTemplateTitle') }),
    onSuccess: (tpl) => {
      refresh();
      setOpen(false);
      onOpen(tpl.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = templates.data ?? [];
  const hasDefault = list.some((x) => x.isDefault);

  return (
    <div className="ml-1 flex h-7 items-stretch overflow-hidden rounded-md bg-accent text-white">
      <button
        type="button"
        onClick={() => create()}
        className="flex items-center gap-1 px-2 text-[14px] font-medium hover:bg-accent-hover"
        data-testid="new-row"
      >
        <Plus className="size-4" />
        {t('toolbar.new')}
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={tt('menu')}
            className="flex items-center border-l border-white/30 px-1 hover:bg-accent-hover"
            data-testid="new-row-menu"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[300px] p-1 text-fg">
          <div className="px-2 pb-1 pt-1.5 text-[12px] font-medium text-fg-subtle">
            {tt('rowTemplates')}
          </div>
          {list.map((tpl) => (
            <TemplateItem
              key={tpl.id}
              db={db}
              tpl={tpl}
              onUse={() => {
                setOpen(false);
                create(tpl.id);
              }}
              onEdit={() => {
                setOpen(false);
                onOpen(tpl.id);
              }}
              onChanged={refresh}
            />
          ))}
          {list.length === 0 && (
            <p className="px-2 py-1.5 text-[13px] text-fg-muted">{tt('noRowTemplates')}</p>
          )}
          {hasDefault && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                create('none');
              }}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
              data-testid="new-row-empty"
            >
              <FileText className="size-4 text-fg-muted" />
              {tt('emptyRow')}
            </button>
          )}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => newTemplate.mutate()}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
            data-testid="new-row-template"
          >
            <Plus className="size-4 text-fg-muted" />
            {tt('newTemplate')}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TemplateItem({
  db,
  tpl,
  onUse,
  onEdit,
  onChanged,
}: {
  db: DatabaseDto;
  tpl: RowTemplateDto;
  onUse: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const tt = useTranslations('templates');
  const f = useFormatter();
  const [menu, setMenu] = useState(false);
  const [repeat, setRepeat] = useState<Recurrence | null>(tpl.recurrence);
  const patch = useMutation({
    mutationFn: (body: object) => apiPatch(`/databases/${db.id}/templates/${tpl.id}`, body),
    onSuccess: onChanged,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/databases/${db.id}/templates/${tpl.id}`),
    onSuccess: onChanged,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const days = [1, 2, 3, 4, 5, 6, 7];
  return (
    <div
      className="group flex items-center rounded-md hover:bg-hover"
      data-testid="row-template"
      data-title={tpl.title}
    >
      <button
        type="button"
        onClick={onUse}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left text-[14px]"
      >
        <span className="shrink-0">
          {tpl.icon?.type === 'emoji' ? (
            tpl.icon.value
          ) : (
            <FileText className="size-4 text-fg-muted" />
          )}
        </span>
        <span className="truncate">{tpl.title || tt('untitled')}</span>
        {tpl.isDefault && (
          <span
            className="shrink-0 rounded bg-active px-1 text-[11px] text-fg-muted"
            data-testid="row-template-default"
          >
            {tt('default')}
          </span>
        )}
        {tpl.recurrence && (
          <Repeat className="size-3.5 shrink-0 text-fg-subtle" aria-label={tt('repeats')} />
        )}
      </button>
      <Popover open={menu} onOpenChange={setMenu}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={tt('options')}
            className="mr-1 rounded p-1 text-fg-subtle opacity-0 hover:bg-active group-hover:opacity-100 data-[state=open]:opacity-100"
            data-testid="row-template-options"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="right" className="w-[260px] p-1">
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              onEdit();
            }}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
            data-testid="row-template-edit"
          >
            <FileText className="size-4 text-fg-muted" />
            {tt('edit')}
          </button>
          <button
            type="button"
            onClick={() => patch.mutate({ isDefault: !tpl.isDefault })}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
            data-testid="row-template-set-default"
          >
            <Star className="size-4 text-fg-muted" />
            {tpl.isDefault ? tt('unsetDefault') : tt('setDefault')}
          </button>
          <div className="my-1 h-px bg-border" />
          <div className="flex flex-col gap-1.5 px-2 py-1 text-[13px]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!repeat}
                onChange={(e) =>
                  setRepeat(
                    e.target.checked
                      ? { every: 'week', time: '07:00', weekday: 1, monthday: 1 }
                      : null,
                  )
                }
                data-testid="row-template-repeat"
              />
              {tt('repeat')}
            </label>
            {repeat && (
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  className={selectCls}
                  value={repeat.every}
                  onChange={(e) =>
                    setRepeat({ ...repeat, every: e.target.value as Recurrence['every'] })
                  }
                >
                  {(['day', 'week', 'month'] as const).map((x) => (
                    <option key={x} value={x}>
                      {tt(`every.${x}`)}
                    </option>
                  ))}
                </select>
                {repeat.every === 'week' && (
                  <select
                    className={selectCls}
                    value={repeat.weekday}
                    onChange={(e) => setRepeat({ ...repeat, weekday: Number(e.target.value) })}
                  >
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {f.dateTime(new Date(Date.UTC(2024, 0, d)), {
                          weekday: 'long',
                          timeZone: 'UTC',
                        })}
                      </option>
                    ))}
                  </select>
                )}
                {repeat.every === 'month' && (
                  <select
                    className={selectCls}
                    value={repeat.monthday}
                    onChange={(e) => setRepeat({ ...repeat, monthday: Number(e.target.value) })}
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}.
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="time"
                  className={selectCls}
                  value={repeat.time}
                  onChange={(e) => setRepeat({ ...repeat, time: e.target.value })}
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => patch.mutate({ recurrence: repeat })}
              className="h-7 self-start rounded-md border border-border px-2 hover:bg-hover"
              data-testid="row-template-repeat-save"
            >
              {tt('saveRepeat')}
            </button>
            {tpl.nextRunAt && (
              <span className="text-[12px] text-fg-subtle">
                {tt('nextRun', { date: new Date(tpl.nextRunAt) })}
              </span>
            )}
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => remove.mutate()}
            className={cn(
              'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] text-[var(--c-red)] hover:bg-hover',
            )}
            data-testid="row-template-delete"
          >
            <Trash2 className="size-4" />
            {tt('delete')}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
