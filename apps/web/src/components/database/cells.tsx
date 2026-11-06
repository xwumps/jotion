'use client';

import {
  isReadonlyType,
  type DateValue,
  type FileValue,
  type MemberDto,
  type NumberConfig,
  type PropertyDto,
  type RowDto,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import { Check, ExternalLink, Paperclip, Plus, Trash2, Upload, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api-client';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover';
import {
  cellValue,
  formatDate,
  formatInstant,
  formatNumber,
  optionsOf,
  optionStyle,
  uniqueIdLabel,
} from './property-meta';
import { ComputedDisplay, RelationDisplay, RelationEditor } from './computed-cells';
import type { DatabaseActions } from './use-database';

export interface CellContext {
  workspaceId: string;
  members: MemberDto[];
  actions: DatabaseActions;
  editable: boolean;
}

const memberName = (members: MemberDto[], id: string) =>
  members.find((m) => m.userId === id)?.name ?? '?';

export function OptionChip({
  name,
  color,
  onRemove,
}: {
  name: string;
  color?: Parameters<typeof optionStyle>[0];
  onRemove?: () => void;
}) {
  return (
    <span
      className="inline-flex h-5 max-w-full shrink-0 items-center gap-1 truncate rounded-[3px] px-1.5 text-[13px] leading-5"
      style={optionStyle(color)}
    >
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="x"
          className="opacity-60 hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

function PersonChip({ name }: { name: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px]">
      <span className="flex size-5 items-center justify-center rounded-full bg-active text-[11px] font-medium uppercase">
        {name.slice(0, 1)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Anzeige eines Werts (ohne Bearbeitung). */
export function ValueDisplay({
  prop,
  row,
  members,
  wrap,
}: {
  prop: PropertyDto;
  row: RowDto;
  members: MemberDto[];
  wrap?: boolean;
}) {
  const locale = useLocale();
  if (prop.type === 'relation') return <RelationDisplay prop={prop} row={row} wrap={wrap} />;
  if (prop.type === 'formula' || prop.type === 'rollup')
    return <ComputedDisplay prop={prop} value={row.values[prop.id] as never} wrap={wrap} />;
  const v = cellValue(row, prop);
  const cfg = prop.config as Record<string, unknown>;
  const textCls = cn('min-w-0', wrap ? 'whitespace-pre-wrap break-words' : 'truncate');
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0))
    return prop.type === 'checkbox' ? <CheckboxBox checked={false} /> : null;
  switch (prop.type) {
    case 'title':
    case 'text':
    case 'phone':
      return <span className={textCls}>{String(v)}</span>;
    case 'url':
      return (
        <a
          href={/^https?:\/\//i.test(String(v)) ? String(v) : `https://${String(v)}`}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={cn(textCls, 'underline decoration-border underline-offset-2')}
          onClick={(e) => e.stopPropagation()}
        >
          {String(v)}
        </a>
      );
    case 'email':
      return (
        <a
          href={`mailto:${String(v)}`}
          className={cn(textCls, 'underline decoration-border underline-offset-2')}
          onClick={(e) => e.stopPropagation()}
        >
          {String(v)}
        </a>
      );
    case 'number':
      return (
        <span className="ml-auto truncate tabular-nums">
          {formatNumber(v as number, prop.config as NumberConfig, locale)}
        </span>
      );
    case 'unique_id':
      return <span className="truncate tabular-nums">{uniqueIdLabel(prop, v as number)}</span>;
    case 'select':
    case 'status': {
      const o = optionsOf(prop).find((x) => x.id === v);
      return o ? <OptionChip name={o.name} color={o.color} /> : null;
    }
    case 'multi_select': {
      const opts = optionsOf(prop);
      return (
        <span className={cn('flex min-w-0 gap-1', wrap ? 'flex-wrap' : 'overflow-hidden')}>
          {(v as string[]).map((id) => {
            const o = opts.find((x) => x.id === id);
            return o ? <OptionChip key={id} name={o.name} color={o.color} /> : null;
          })}
        </span>
      );
    }
    case 'person':
      return (
        <span className={cn('flex min-w-0 gap-2', wrap ? 'flex-wrap' : 'overflow-hidden')}>
          {(v as string[]).map((id) => (
            <PersonChip key={id} name={memberName(members, id)} />
          ))}
        </span>
      );
    case 'created_by':
    case 'last_edited_by':
      return <PersonChip name={memberName(members, String(v))} />;
    case 'checkbox':
      return <CheckboxBox checked={v === true} />;
    case 'date':
      return (
        <span className={textCls}>
          {formatDate(v as DateValue, locale, cfg as { dateFormat?: string; timeFormat?: string })}
        </span>
      );
    case 'created_time':
    case 'last_edited_time':
      return (
        <span className={textCls}>
          {formatInstant(String(v), locale, cfg.dateFormat as string | undefined)}
        </span>
      );
    case 'files':
      return (
        <span className={cn('flex min-w-0 gap-1', wrap ? 'flex-wrap' : 'overflow-hidden')}>
          {(v as FileValue[]).map((f, i) => (
            <span
              key={i}
              className="inline-flex shrink-0 items-center gap-1 rounded-[3px] bg-active px-1.5 text-[13px]"
            >
              <Paperclip className="size-3" />
              {f.name}
            </span>
          ))}
        </span>
      );
    default:
      return null;
  }
}

function CheckboxBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[3px] border',
        checked ? 'border-accent bg-accent text-white' : 'border-fg-subtle',
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

const INLINE_TYPES = ['title', 'text', 'number', 'url', 'email', 'phone'];

/**
 * Wert mit Bearbeitung: Klick öffnet je nach Typ ein Eingabefeld oder ein Auswahlfenster.
 * variant "cell" für Tabellenzellen, "panel" für den Properties-Bereich einer Zeile.
 */
export function ValueEditor({
  prop,
  row,
  ctx,
  variant,
  wrap,
  children,
}: {
  prop: PropertyDto;
  row: RowDto;
  ctx: CellContext;
  variant: 'cell' | 'panel';
  wrap?: boolean;
  /** Zusätzliche Elemente in der Anzeige (z. B. "Öffnen" beim Titel) */
  children?: ReactNode;
}) {
  const t = useTranslations('database');
  const [editing, setEditing] = useState(false);
  const readonly = !ctx.editable || isReadonlyType(prop.type);
  const save = (value: unknown) =>
    prop.type === 'title'
      ? ctx.actions.updateRow.mutate({ rowId: row.id, title: String(value ?? '') })
      : ctx.actions.updateRow.mutate({ rowId: row.id, values: { [prop.id]: value } });

  const base = cn(
    'group/cell relative flex w-full items-center gap-1 text-left text-[14px]',
    variant === 'cell'
      ? 'h-full min-h-[33px] px-2 py-1.5'
      : 'min-h-[32px] rounded-md px-2 py-1 hover:bg-hover',
    wrap ? 'items-start' : '',
  );
  const display = (
    <ValueDisplay prop={prop} row={row} members={ctx.members} wrap={wrap || variant === 'panel'} />
  );
  const empty =
    variant === 'panel' &&
    (cellValue(row, prop) === null ||
      cellValue(row, prop) === '' ||
      (Array.isArray(cellValue(row, prop)) && (cellValue(row, prop) as unknown[]).length === 0));

  if (prop.type === 'checkbox') {
    return (
      <div className={base}>
        <button
          type="button"
          role="checkbox"
          aria-checked={row.values[prop.id] === true}
          aria-label={prop.name}
          disabled={readonly}
          onClick={() => save(!(row.values[prop.id] === true))}
          className="rounded-sm"
          data-testid="cell-checkbox"
        >
          {display}
        </button>
      </div>
    );
  }

  if (readonly) {
    return (
      <div className={base} data-testid="cell" data-property={prop.name}>
        {display}
        {children}
      </div>
    );
  }

  if (INLINE_TYPES.includes(prop.type) && editing) {
    return (
      <InlineInput
        prop={prop}
        initial={cellValue(row, prop)}
        variant={variant}
        onDone={(value, commit) => {
          setEditing(false);
          if (commit) save(value);
        }}
      />
    );
  }

  const trigger = (
    <div
      role="button"
      tabIndex={0}
      className={cn(base, 'cursor-pointer')}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          setEditing(true);
        }
      }}
      data-testid="cell"
      data-property={prop.name}
    >
      {display}
      {empty && <span className="text-fg-subtle">{t('empty')}</span>}
      {children}
    </div>
  );

  if (INLINE_TYPES.includes(prop.type)) return trigger;

  return (
    <Popover open={editing} onOpenChange={setEditing}>
      <PopoverAnchor asChild>{trigger}</PopoverAnchor>
      <PopoverContent
        className="w-[300px] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        data-testid="cell-popover"
      >
        {prop.type === 'relation' && (
          <RelationEditor prop={prop} row={row} onSave={(ids) => save(ids)} />
        )}
        {(prop.type === 'select' || prop.type === 'multi_select' || prop.type === 'status') && (
          <SelectEditor prop={prop} row={row} ctx={ctx} onClose={() => setEditing(false)} />
        )}
        {prop.type === 'date' && (
          <DateEditor
            value={(row.values[prop.id] as DateValue | undefined) ?? null}
            onSave={save}
          />
        )}
        {prop.type === 'person' && (
          <PersonEditor
            value={(row.values[prop.id] as string[] | undefined) ?? []}
            members={ctx.members}
            onSave={save}
          />
        )}
        {prop.type === 'files' && (
          <FilesEditor
            value={(row.values[prop.id] as FileValue[] | undefined) ?? []}
            workspaceId={ctx.workspaceId}
            onSave={save}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function InlineInput({
  prop,
  initial,
  variant,
  onDone,
}: {
  prop: PropertyDto;
  initial: unknown;
  variant: 'cell' | 'panel';
  onDone: (value: unknown, commit: boolean) => void;
}) {
  const [draft, setDraft] = useState(
    initial === null || initial === undefined ? '' : String(initial),
  );
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (!commit) return onDone(null, false);
    if (prop.type === 'number') {
      const s = draft.trim().replace(',', '.');
      if (s === '') return onDone(null, initial !== null);
      const n = Number(s);
      return onDone(Number.isFinite(n) ? n : initial, Number.isFinite(n) && n !== initial);
    }
    const value = prop.type === 'title' ? draft : draft.trim() === '' ? null : draft;
    onDone(value, (value ?? '') !== (initial ?? ''));
  };
  return (
    <textarea
      ref={ref}
      value={draft}
      rows={1}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      inputMode={prop.type === 'number' ? 'decimal' : undefined}
      className={cn(
        'block w-full resize-none bg-bg-elevated text-[14px] outline-none',
        variant === 'cell'
          ? 'relative z-10 min-h-[33px] px-2 py-1.5 shadow-popover'
          : 'min-h-[32px] rounded-md px-2 py-1 shadow-popover',
        prop.type === 'number' && 'text-right tabular-nums',
      )}
      data-testid="cell-input"
    />
  );
}

function SelectEditor({
  prop,
  row,
  ctx,
  onClose,
}: {
  prop: PropertyDto;
  row: RowDto;
  ctx: CellContext;
  onClose: () => void;
}) {
  const t = useTranslations('database');
  const [q, setQ] = useState('');
  const multi = prop.type === 'multi_select';
  const options = optionsOf(prop);
  const raw = row.values[prop.id];
  const selected: string[] = multi
    ? ((raw as string[] | undefined) ?? [])
    : raw
      ? [String(raw)]
      : [];
  const filtered = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = options.some((o) => o.name.toLowerCase() === q.trim().toLowerCase());

  const setValue = (ids: string[]) =>
    ctx.actions.updateRow.mutate({
      rowId: row.id,
      values: { [prop.id]: multi ? ids : (ids[0] ?? null) },
    });
  const toggle = (id: string) => {
    if (multi)
      setValue(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else {
      setValue(selected[0] === id ? [] : [id]);
      onClose();
    }
  };
  const create = () => {
    const name = q.trim();
    if (!name || prop.type === 'status') return;
    const colors = [
      'gray',
      'brown',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'pink',
      'red',
    ] as const;
    const option = { id: crypto.randomUUID(), name, color: colors[options.length % colors.length] };
    ctx.actions.updateProperty.mutate(
      { id: prop.id, config: { ...prop.config, options: [...options, option] } },
      { onSuccess: () => setValue(multi ? [...selected, option.id] : [option.id]) },
    );
    setQ('');
    if (!multi) onClose();
  };
  const groups =
    prop.type === 'status'
      ? (['todo', 'in_progress', 'complete'] as const).map((g) => ({
          key: g,
          label: t(`statusGroups.${g}`),
          options: filtered.filter((o) => o.group === g),
        }))
      : [{ key: 'all', label: '', options: filtered }];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-hover px-2 py-1.5">
        {selected.map((id) => {
          const o = options.find((x) => x.id === id);
          return o ? (
            <OptionChip key={id} name={o.name} color={o.color} onRemove={() => toggle(id)} />
          ) : null;
        })}
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filtered[0] && (exact || prop.type === 'status')) toggle(filtered[0].id);
              else if (!exact) create();
            }
          }}
          placeholder={prop.type === 'status' ? t('searchOption') : t('searchOrCreate')}
          className="min-w-[80px] flex-1 bg-transparent text-[14px] outline-none"
          data-testid="option-search"
        />
      </div>
      <div className="max-h-[260px] overflow-y-auto p-1">
        {groups.map((g) => (
          <div key={g.key}>
            {g.label && (
              <div className="px-2 pb-1 pt-1.5 text-[12px] text-fg-subtle">{g.label}</div>
            )}
            {g.options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => toggle(o.id)}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
                data-testid="option"
              >
                <OptionChip name={o.name} color={o.color} />
                {selected.includes(o.id) && <Check className="ml-auto size-4 text-fg-muted" />}
              </button>
            ))}
          </div>
        ))}
        {q.trim() && !exact && prop.type !== 'status' && (
          <button
            type="button"
            onClick={create}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
          >
            <Plus className="size-4" />
            {t('createOption')} <OptionChip name={q.trim()} />
          </button>
        )}
        {!filtered.length && !q.trim() && (
          <div className="px-2 py-1.5 text-[13px] text-fg-subtle">{t('noOptions')}</div>
        )}
      </div>
    </div>
  );
}

function localInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function DateEditor({ value, onSave }: { value: DateValue | null; onSave: (v: unknown) => void }) {
  const t = useTranslations('database');
  const [hasTime, setHasTime] = useState(value?.hasTime ?? false);
  const [withEnd, setWithEnd] = useState(Boolean(value?.end));
  const toInput = (s: string | null | undefined) =>
    !s ? '' : hasTime ? (s.length > 10 ? localInput(s) : `${s}T09:00`) : s.slice(0, 10);
  const [start, setStart] = useState(toInput(value?.start));
  const [end, setEnd] = useState(toInput(value?.end));
  useEffect(() => {
    setStart((s) => convert(s, hasTime));
    setEnd((s) => convert(s, hasTime));
  }, [hasTime]);

  const commit = (s: string, e: string, time: boolean, endOn: boolean) => {
    if (!s) return onSave(null);
    const fmt = (x: string) => (time ? new Date(x).toISOString() : x);
    const endVal = endOn && e ? fmt(e) : null;
    const startVal = fmt(s);
    // Ende vor Beginn: Ende verwerfen statt Fehler
    const okEnd = endVal && new Date(endVal) >= new Date(startVal) ? endVal : null;
    onSave({
      start: startVal,
      end: okEnd,
      hasTime: time,
      timeZone: time ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
    });
  };
  const type = hasTime ? 'datetime-local' : 'date';
  return (
    <div className="flex flex-col gap-2 p-3 text-[14px]" data-testid="date-editor">
      <input
        type={type}
        value={start}
        aria-label={t('startDate')}
        onChange={(e) => {
          setStart(e.target.value);
          commit(e.target.value, end, hasTime, withEnd);
        }}
        className="h-8 rounded-md border border-border bg-bg px-2"
        data-testid="date-start"
      />
      {withEnd && (
        <input
          type={type}
          value={end}
          aria-label={t('endDate')}
          onChange={(e) => {
            setEnd(e.target.value);
            commit(start, e.target.value, hasTime, true);
          }}
          className="h-8 rounded-md border border-border bg-bg px-2"
        />
      )}
      <label className="flex items-center justify-between gap-2">
        {t('endDate')}
        <input
          type="checkbox"
          checked={withEnd}
          onChange={(e) => {
            setWithEnd(e.target.checked);
            commit(start, end, hasTime, e.target.checked);
          }}
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        {t('includeTime')}
        <input
          type="checkbox"
          checked={hasTime}
          onChange={(e) => {
            const time = e.target.checked;
            setHasTime(time);
            commit(convert(start, time), convert(end, time), time, withEnd);
          }}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          setStart('');
          setEnd('');
          onSave(null);
        }}
        className="flex h-8 items-center gap-2 rounded-md px-1 text-left text-fg-muted hover:bg-hover"
      >
        <Trash2 className="size-4" />
        {t('clear')}
      </button>
    </div>
  );
}

function convert(s: string, toTime: boolean): string {
  if (!s) return '';
  if (toTime) return s.length === 10 ? `${s}T09:00` : s;
  return s.slice(0, 10);
}

function PersonEditor({
  value,
  members,
  onSave,
}: {
  value: string[];
  members: MemberDto[];
  onSave: (v: unknown) => void;
}) {
  const t = useTranslations('database');
  const [q, setQ] = useState('');
  const list = members.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('searchPeople')}
        className="border-b border-border bg-hover px-3 py-2 text-[14px] outline-none"
      />
      <div className="max-h-[240px] overflow-y-auto p-1">
        {list.map((m) => {
          const on = value.includes(m.userId);
          return (
            <button
              key={m.userId}
              type="button"
              onClick={() =>
                onSave(on ? value.filter((x) => x !== m.userId) : [...value, m.userId])
              }
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
              data-testid="person-option"
            >
              <PersonChip name={m.name} />
              {on && <Check className="ml-auto size-4 text-fg-muted" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilesEditor({
  value,
  workspaceId,
  onSave,
}: {
  value: FileValue[];
  workspaceId: string;
  onSave: (v: unknown) => void;
}) {
  const t = useTranslations('database');
  const [url, setUrl] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const addLink = () => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) return toast.error(t('invalidUrl'));
    onSave([...value, { type: 'external', url: u, name: u.split('/').pop() || u }]);
    setUrl('');
  };
  const upload = async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    try {
      const f = await api<{ id: string }>(`/workspaces/${workspaceId}/files`, {
        method: 'POST',
        body,
      });
      onSave([...value, { type: 'file', fileId: f.id, name: file.name.slice(0, 255) }]);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="flex flex-col gap-1 p-2 text-[14px]">
      {value.map((f, i) => (
        <div key={i} className="flex h-8 items-center gap-2 rounded-md px-1 hover:bg-hover">
          <Paperclip className="size-4 text-fg-muted" />
          <a
            href={f.type === 'external' ? f.url : `/api/files/${f.fileId}`}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="flex-1 truncate"
          >
            {f.name}
          </a>
          <ExternalLink className="size-3.5 text-fg-subtle" />
          <button
            type="button"
            aria-label={t('remove')}
            onClick={() => onSave(value.filter((_, j) => j !== i))}
            className="rounded p-0.5 hover:bg-active"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex gap-1">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addLink()}
          placeholder={t('pasteLink')}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2"
        />
        <button type="button" onClick={addLink} className="rounded-md px-2 hover:bg-hover">
          {t('add')}
        </button>
      </div>
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className="flex h-8 items-center gap-2 rounded-md px-1 text-fg-muted hover:bg-hover"
      >
        <Upload className="size-4" />
        {t('uploadImage')}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
