'use client';

import {
  type AutomationAction,
  type AutomationDto,
  type AutomationRunDto,
  type AutomationTrigger,
  type DatabaseDto,
  type DatabaseSearchResultDto,
  type FilterGroup,
  type MemberDto,
  type PropertyDto,
  type RowTemplateDto,
  type ValueSpec,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Copy, Plus, Trash2, Zap } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '@/lib/api-client';
import { Dialog, DialogContent } from '../ui/dialog';
import { inputClass } from '../ui/field';
import { FilterEditor } from './filter-editor';
import { optionsOf } from './property-meta';
import { useDatabase, useMembers } from './use-database';

const selectCls =
  'h-8 min-w-0 rounded-md border border-border bg-bg px-2 text-[13px] outline-none focus:border-accent';
const btn =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] hover:bg-hover disabled:opacity-50';
const primary =
  'h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50';

const listKey = (ws: string, dbId: string | null) => ['automations', ws, dbId ?? 'none'] as const;

/** Properties, die eine Aktion setzen kann */
const SETTABLE = [
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'person',
  'checkbox',
  'url',
  'email',
  'phone',
  'relation',
];

export function AutomationsButton({ db }: { db: DatabaseDto }) {
  const t = useTranslations('automations');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('title')}
        title={t('title')}
        className="flex h-7 items-center rounded-md px-1.5 text-fg-muted hover:bg-hover"
        data-testid="automations-button"
      >
        <Zap className="size-4" />
      </button>
      {open && (
        <AutomationsDialog
          workspaceId={db.workspaceId}
          db={db}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}

/** Liste und Editor der Automatisierungen einer Datenbank (oder ohne Datenbank für Button-Blöcke). */
export function AutomationsDialog({
  workspaceId,
  db,
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  workspaceId: string;
  db: DatabaseDto | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Direkt den Editor für eine neue Automatisierung mit diesem Auslöser öffnen */
  initial?: { trigger: AutomationTrigger; name?: string };
  onSaved?: (a: AutomationDto) => void;
}) {
  const t = useTranslations('automations');
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: listKey(workspaceId, db?.id ?? null),
    queryFn: () =>
      apiGet<AutomationDto[]>(
        `/workspaces/${workspaceId}/automations${db ? `?databaseId=${db.id}` : ''}`,
      ),
  });
  const [editing, setEditing] = useState<AutomationDto | 'new' | null>(initial ? 'new' : null);
  const [logFor, setLogFor] = useState<AutomationDto | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['automations', workspaceId] });
  const toggle = useMutation({
    mutationFn: (a: AutomationDto) => apiPatch(`/automations/${a.id}`, { enabled: !a.enabled }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={db ? t('titleFor', { name: db.title || t('untitled') }) : t('buttonTitle')}
        className="max-w-[720px]"
      >
        <div className="max-h-[72vh] overflow-y-auto pr-1" data-testid="automations-dialog">
          {editing ? (
            <AutomationEditor
              workspaceId={workspaceId}
              db={db}
              automation={editing === 'new' ? null : editing}
              initial={initial}
              onDone={(a) => {
                refresh();
                setEditing(null);
                if (a) onSaved?.(a);
              }}
            />
          ) : logFor ? (
            <RunLog automation={logFor} onBack={() => setLogFor(null)} />
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-fg-muted">{t('intro')}</p>
              {(list.data ?? []).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
                  data-testid="automation-item"
                  data-name={a.name}
                >
                  <Zap
                    className={cn(
                      'size-4 shrink-0',
                      a.enabled ? 'text-[var(--c-yellow)]' : 'text-fg-subtle',
                    )}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setEditing(a)}
                  >
                    <div className="truncate text-[14px] font-medium">{a.name}</div>
                    <div className="truncate text-[12px] text-fg-muted">
                      {t(`triggers.${a.trigger.type}`)} ·{' '}
                      {t('actionsCount', { n: a.actions.length })}
                    </div>
                  </button>
                  {a.lastRun && (
                    <button
                      type="button"
                      onClick={() => setLogFor(a)}
                      className={cn('rounded px-1.5 text-[12px]', statusColor(a.lastRun.status))}
                      data-testid="automation-last-run"
                    >
                      {t(`status.${a.lastRun.status}`)}
                    </button>
                  )}
                  <button
                    type="button"
                    className={btn}
                    onClick={() => setLogFor(a)}
                    data-testid="automation-log"
                  >
                    {t('log')}
                  </button>
                  <label className="inline-flex items-center gap-1 text-[12px] text-fg-muted">
                    <input
                      type="checkbox"
                      checked={a.enabled}
                      onChange={() => toggle.mutate(a)}
                      data-testid="automation-enabled"
                    />
                    {t('enabled')}
                  </label>
                </div>
              ))}
              {list.data?.length === 0 && (
                <p className="py-2 text-[13px] text-fg-subtle">{t('empty')}</p>
              )}
              <button
                type="button"
                className={cn(btn, 'self-start')}
                onClick={() => setEditing('new')}
                data-testid="automation-new"
              >
                <Plus className="size-4" />
                {t('new')}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const statusColor = (s: string) =>
  s === 'succeeded'
    ? 'bg-[var(--cb-green)] text-[var(--c-green)]'
    : s === 'failed' || s === 'stopped'
      ? 'bg-[var(--cb-red)] text-[var(--c-red)]'
      : 'bg-active text-fg-muted';

function RunLog({ automation, onBack }: { automation: AutomationDto; onBack: () => void }) {
  const t = useTranslations('automations');
  const f = useFormatter();
  const runs = useQuery({
    queryKey: ['automationRuns', automation.id],
    queryFn: () => apiGet<AutomationRunDto[]>(`/automations/${automation.id}/runs`),
    refetchInterval: 5000,
  });
  return (
    <div className="flex flex-col gap-2" data-testid="automation-runs">
      <button type="button" className={cn(btn, 'self-start')} onClick={onBack}>
        <ChevronLeft className="size-4" />
        {automation.name}
      </button>
      {(runs.data ?? []).map((r) => (
        <div
          key={r.id}
          className="rounded-md border border-border px-3 py-2 text-[13px]"
          data-testid="automation-run"
          data-status={r.status}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded px-1.5 text-[12px]', statusColor(r.status))}>
              {t(`status.${r.status}`)}
            </span>
            <span className="text-fg-muted">
              {f.dateTime(new Date(r.startedAt), { dateStyle: 'short', timeStyle: 'medium' })}
            </span>
            {r.rowTitle !== null && (
              <span className="truncate">· {r.rowTitle || t('untitled')}</span>
            )}
            {r.actorName && <span className="text-fg-muted">· {r.actorName}</span>}
            {r.chainDepth > 0 && (
              <span className="text-fg-subtle">· {t('depth', { n: r.chainDepth })}</span>
            )}
          </div>
          {r.error && <p className="mt-1 text-[var(--c-red)]">{r.error}</p>}
          {r.details.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-fg-muted">
              {r.details.map((d, i) => (
                <li key={i}>
                  {t(`actions.${d.action}`)}: {d.ok ? t('ok') : t('error')}
                  {d.message ? ` (${d.message})` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {runs.data?.length === 0 && <p className="text-[13px] text-fg-subtle">{t('noRuns')}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ Editor

function defaultAction(type: AutomationAction['type'], db: DatabaseDto | null): AutomationAction {
  if (type === 'webhook') return { type, url: 'https://', includeRow: true };
  if (type === 'create_row')
    return {
      type,
      databaseId: db?.id ?? '',
      templateId: null,
      title: '',
      values: {},
      linkPropertyId: null,
    };
  return {
    type: 'set_property',
    target: { kind: 'trigger' },
    propertyId: 'title',
    value: { kind: 'text', text: '' },
  };
}

function AutomationEditor({
  workspaceId,
  db,
  automation,
  initial,
  onDone,
}: {
  workspaceId: string;
  db: DatabaseDto | null;
  automation: AutomationDto | null;
  initial?: { trigger: AutomationTrigger; name?: string };
  onDone: (a: AutomationDto | null) => void;
}) {
  const t = useTranslations('automations');
  const members = useMembers(workspaceId);
  const [name, setName] = useState(automation?.name ?? initial?.name ?? '');
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    automation?.trigger ??
      initial?.trigger ??
      (db ? { type: 'row_created' } : { type: 'button', propertyId: null }),
  );
  const [conditions, setConditions] = useState<FilterGroup | null>(automation?.conditions ?? null);
  const [actions, setActions] = useState<AutomationAction[]>(
    automation?.actions ?? [defaultAction(db ? 'set_property' : 'create_row', db)],
  );
  const props = db?.properties ?? [];
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim() || t('untitled'), trigger, conditions, actions };
      return automation
        ? apiPatch<AutomationDto>(`/automations/${automation.id}`, body)
        : apiPost<AutomationDto>(`/workspaces/${workspaceId}/automations`, {
            ...body,
            databaseId: db?.id ?? null,
          });
    },
    onSuccess: (a) => {
      toast.success(t('saved'));
      onDone(a);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/automations/${automation!.id}`),
    onSuccess: () => onDone(null),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const triggers: AutomationTrigger['type'][] = db
    ? ['row_created', 'property_changed', 'date_reached', 'schedule', 'button']
    : ['button', 'schedule'];
  const rowContext =
    db &&
    (trigger.type !== 'schedule' || trigger.forEachRow) &&
    !(trigger.type === 'button' && !trigger.propertyId);

  return (
    <div className="flex flex-col gap-4" data-testid="automation-editor">
      <input
        className={inputClass}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('namePlaceholder')}
        data-testid="automation-name"
      />

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold">{t('when')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={selectCls}
            value={trigger.type}
            onChange={(e) =>
              setTrigger(newTrigger(e.target.value as AutomationTrigger['type'], props))
            }
            data-testid="automation-trigger"
          >
            {triggers.map((x) => (
              <option key={x} value={x}>
                {t(`triggers.${x}`)}
              </option>
            ))}
          </select>
          <TriggerFields trigger={trigger} props={props} onChange={setTrigger} hasDb={!!db} />
        </div>
      </section>

      {rowContext && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">{t('condition')}</h3>
          <div className="rounded-md border border-border p-2">
            <FilterEditor
              props={props}
              members={members.data ?? []}
              filter={conditions}
              onChange={setConditions}
            />
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold">{t('then')}</h3>
        {actions.map((a, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-md border border-border p-2"
            data-testid="automation-action"
          >
            <div className="flex items-center gap-2">
              <select
                className={selectCls}
                value={a.type}
                onChange={(e) =>
                  setActions(
                    actions.map((x, j) =>
                      j === i ? defaultAction(e.target.value as AutomationAction['type'], db) : x,
                    ),
                  )
                }
                data-testid="automation-action-type"
              >
                {(['set_property', 'create_row', 'webhook'] as const)
                  .filter((x) => x !== 'set_property' || rowContext)
                  .map((x) => (
                    <option key={x} value={x}>
                      {t(`actions.${x}`)}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className="ml-auto rounded p-1 text-fg-subtle hover:bg-hover"
                aria-label={t('removeAction')}
                onClick={() => setActions(actions.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <ActionFields
              action={a}
              db={db}
              workspaceId={workspaceId}
              members={members.data ?? []}
              onChange={(next) => setActions(actions.map((x, j) => (j === i ? next : x)))}
            />
          </div>
        ))}
        <button
          type="button"
          className={cn(btn, 'self-start')}
          onClick={() =>
            setActions([...actions, defaultAction(rowContext ? 'set_property' : 'create_row', db)])
          }
          data-testid="automation-add-action"
        >
          <Plus className="size-4" />
          {t('addAction')}
        </button>
      </section>

      {automation?.webhookSecret && (
        <div className="rounded-md bg-bg-secondary p-2 text-[12px]">
          <div className="text-fg-muted">{t('secret')}</div>
          <div className="flex items-center gap-2">
            <code className="truncate">{automation.webhookSecret}</code>
            <button
              type="button"
              className="rounded p-1 hover:bg-hover"
              aria-label={t('copy')}
              onClick={() => void navigator.clipboard.writeText(automation.webhookSecret!)}
            >
              <Copy className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {automation && (
          <button
            type="button"
            className={cn(btn, 'text-[var(--c-red)]')}
            onClick={() => remove.mutate()}
            data-testid="automation-delete"
          >
            {t('delete')}
          </button>
        )}
        <button type="button" className={cn(btn, 'ml-auto')} onClick={() => onDone(null)}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className={primary}
          onClick={() => save.mutate()}
          disabled={save.isPending || !actions.length}
          data-testid="automation-save"
        >
          {t('save')}
        </button>
      </div>
    </div>
  );
}

function newTrigger(type: AutomationTrigger['type'], props: PropertyDto[]): AutomationTrigger {
  switch (type) {
    case 'row_created':
      return { type };
    case 'property_changed':
      return { type, propertyId: props.find((p) => p.type === 'status')?.id ?? 'title' };
    case 'date_reached':
      return {
        type,
        propertyId: props.find((p) => p.type === 'date')?.id ?? '',
        offsetDays: 0,
        time: '08:00',
      };
    case 'schedule':
      return { type, every: 'day', time: '08:00', weekday: 1, monthday: 1, forEachRow: false };
    case 'button':
      return { type, propertyId: props.find((p) => p.type === 'button')?.id ?? null };
  }
}

function TriggerFields({
  trigger,
  props,
  onChange,
  hasDb,
}: {
  trigger: AutomationTrigger;
  props: PropertyDto[];
  onChange: (t: AutomationTrigger) => void;
  hasDb: boolean;
}) {
  const t = useTranslations('automations');
  const f = useFormatter();
  switch (trigger.type) {
    case 'property_changed':
      return (
        <select
          className={selectCls}
          value={trigger.propertyId}
          onChange={(e) => onChange({ ...trigger, propertyId: e.target.value })}
          data-testid="automation-trigger-property"
        >
          {props
            .filter(
              (p) =>
                ![
                  'formula',
                  'rollup',
                  'button',
                  'created_time',
                  'created_by',
                  'last_edited_time',
                  'last_edited_by',
                  'unique_id',
                ].includes(p.type),
            )
            .map((p) => (
              <option key={p.id} value={p.type === 'title' ? 'title' : p.id}>
                {p.name}
              </option>
            ))}
        </select>
      );
    case 'date_reached':
      return (
        <>
          <select
            className={selectCls}
            value={trigger.propertyId}
            onChange={(e) => onChange({ ...trigger, propertyId: e.target.value })}
          >
            {props
              .filter((p) => p.type === 'date')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <input
            type="number"
            className={cn(selectCls, 'w-16')}
            value={trigger.offsetDays}
            onChange={(e) => onChange({ ...trigger, offsetDays: Number(e.target.value) })}
            aria-label={t('offsetDays')}
          />
          <span className="text-[12px] text-fg-muted">{t('offsetDays')}</span>
          <input
            type="time"
            className={selectCls}
            value={trigger.time}
            onChange={(e) => onChange({ ...trigger, time: e.target.value })}
          />
        </>
      );
    case 'schedule':
      return (
        <>
          <select
            className={selectCls}
            value={trigger.every}
            onChange={(e) => onChange({ ...trigger, every: e.target.value as 'day' })}
          >
            {(['day', 'week', 'month'] as const).map((x) => (
              <option key={x} value={x}>
                {t(`every.${x}`)}
              </option>
            ))}
          </select>
          {trigger.every === 'week' && (
            <select
              className={selectCls}
              value={trigger.weekday}
              onChange={(e) => onChange({ ...trigger, weekday: Number(e.target.value) })}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>
                  {f.dateTime(new Date(Date.UTC(2024, 0, d)), { weekday: 'long', timeZone: 'UTC' })}
                </option>
              ))}
            </select>
          )}
          {trigger.every === 'month' && (
            <select
              className={selectCls}
              value={trigger.monthday}
              onChange={(e) => onChange({ ...trigger, monthday: Number(e.target.value) })}
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
            value={trigger.time}
            onChange={(e) => onChange({ ...trigger, time: e.target.value })}
          />
          {hasDb && (
            <label className="inline-flex items-center gap-1 text-[13px]">
              <input
                type="checkbox"
                checked={trigger.forEachRow}
                onChange={(e) => onChange({ ...trigger, forEachRow: e.target.checked })}
              />
              {t('forEachRow')}
            </label>
          )}
        </>
      );
    case 'button':
      return hasDb ? (
        <select
          className={selectCls}
          value={trigger.propertyId ?? ''}
          onChange={(e) => onChange({ ...trigger, propertyId: e.target.value || null })}
          data-testid="automation-trigger-button"
        >
          {props
            .filter((p) => p.type === 'button')
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          {!props.some((p) => p.type === 'button') && (
            <option value="">{t('noButtonProperty')}</option>
          )}
        </select>
      ) : null;
    default:
      return null;
  }
}

function ActionFields({
  action,
  db,
  workspaceId,
  members,
  onChange,
}: {
  action: AutomationAction;
  db: DatabaseDto | null;
  workspaceId: string;
  members: MemberDto[];
  onChange: (a: AutomationAction) => void;
}) {
  const t = useTranslations('automations');
  if (action.type === 'webhook')
    return (
      <div className="flex flex-col gap-1.5">
        <input
          className={inputClass}
          value={action.url}
          onChange={(e) => onChange({ ...action, url: e.target.value })}
          placeholder="https://…"
          data-testid="automation-webhook-url"
        />
        <label className="inline-flex items-center gap-1.5 text-[13px]">
          <input
            type="checkbox"
            checked={action.includeRow}
            onChange={(e) => onChange({ ...action, includeRow: e.target.checked })}
          />
          {t('includeRow')}
        </label>
        <p className="text-[12px] text-fg-subtle">{t('webhookHint')}</p>
      </div>
    );
  if (action.type === 'create_row')
    return (
      <CreateRowFields
        action={action}
        db={db}
        workspaceId={workspaceId}
        members={members}
        onChange={onChange}
      />
    );
  return <SetPropertyFields action={action} db={db!} members={members} onChange={onChange} />;
}

function SetPropertyFields({
  action,
  db,
  members,
  onChange,
}: {
  action: Extract<AutomationAction, { type: 'set_property' }>;
  db: DatabaseDto;
  members: MemberDto[];
  onChange: (a: AutomationAction) => void;
}) {
  const t = useTranslations('automations');
  const relations = db.properties.filter((p) => p.type === 'relation');
  const relationId = action.target.kind === 'related' ? action.target.relationPropertyId : null;
  const relation = relations.find((r) => r.id === relationId);
  const targetDb = useDatabase(
    relation ? String((relation.config as { targetDatabaseId: string }).targetDatabaseId) : '',
  );
  const props = relation ? (targetDb.data?.properties ?? []) : db.properties;
  const settable = props.filter((p) => p.type === 'title' || SETTABLE.includes(p.type));
  const prop = settable.find((p) => (p.type === 'title' ? 'title' : p.id) === action.propertyId);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={selectCls}
        value={relationId ?? ''}
        onChange={(e) =>
          onChange({
            ...action,
            target: e.target.value
              ? { kind: 'related', relationPropertyId: e.target.value }
              : { kind: 'trigger' },
            propertyId: 'title',
            value: { kind: 'text', text: '' },
          })
        }
        data-testid="automation-set-target"
      >
        <option value="">{t('targetTrigger')}</option>
        {relations.map((r) => (
          <option key={r.id} value={r.id}>
            {t('targetRelated', { name: r.name })}
          </option>
        ))}
      </select>
      <select
        className={selectCls}
        value={action.propertyId}
        onChange={(e) => {
          const p = settable.find((x) => (x.type === 'title' ? 'title' : x.id) === e.target.value);
          onChange({ ...action, propertyId: e.target.value, value: defaultValue(p) });
        }}
        data-testid="automation-set-property"
      >
        {settable.map((p) => (
          <option key={p.id} value={p.type === 'title' ? 'title' : p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <span className="text-[12px] text-fg-muted">=</span>
      {prop && (
        <ValueSpecEditor
          prop={prop}
          spec={action.value}
          members={members}
          onChange={(value) => onChange({ ...action, value })}
        />
      )}
    </div>
  );
}

function defaultValue(p: PropertyDto | undefined): ValueSpec {
  if (!p) return { kind: 'clear' };
  if (p.type === 'date') return { kind: 'today', offsetDays: 0 };
  if (p.type === 'checkbox') return { kind: 'static', value: true };
  if (p.type === 'person') return { kind: 'trigger_user' };
  if (['select', 'status'].includes(p.type))
    return { kind: 'static', value: optionsOf(p)[0]?.id ?? null };
  if (p.type === 'number') return { kind: 'static', value: 0 };
  return { kind: 'text', text: '' };
}

function kindsFor(p: PropertyDto): ValueSpec['kind'][] {
  switch (p.type) {
    case 'date':
      return ['today', 'now', 'static', 'formula', 'clear'];
    case 'checkbox':
      return ['static', 'toggle', 'formula'];
    case 'person':
      return ['trigger_user', 'static', 'clear'];
    case 'select':
    case 'status':
    case 'multi_select':
      return ['static', 'text', 'formula', 'clear'];
    case 'number':
      return ['static', 'formula', 'clear'];
    case 'relation':
      return ['formula', 'clear'];
    default:
      return ['text', 'formula', 'clear'];
  }
}

function ValueSpecEditor({
  prop,
  spec,
  members,
  onChange,
}: {
  prop: PropertyDto;
  spec: ValueSpec;
  members: MemberDto[];
  onChange: (s: ValueSpec) => void;
}) {
  const t = useTranslations('automations');
  const kinds = kindsFor(prop);
  const setKind = (k: ValueSpec['kind']) => {
    if (k === 'today') onChange({ kind: 'today', offsetDays: 0 });
    else if (k === 'formula') onChange({ kind: 'formula', expression: '' });
    else if (k === 'text') onChange({ kind: 'text', text: '' });
    else if (k === 'static')
      onChange({
        kind: 'static',
        value: (defaultValue(prop) as { value?: unknown }).value ?? null,
      });
    else onChange({ kind: k } as ValueSpec);
  };
  const options = optionsOf(prop);
  return (
    <>
      <select
        className={selectCls}
        value={spec.kind}
        onChange={(e) => setKind(e.target.value as ValueSpec['kind'])}
        data-testid="automation-value-kind"
      >
        {kinds.map((k) => (
          <option key={k} value={k}>
            {t(`values.${k}`)}
          </option>
        ))}
      </select>
      {spec.kind === 'today' && (
        <>
          <input
            type="number"
            className={cn(selectCls, 'w-16')}
            value={spec.offsetDays}
            onChange={(e) => onChange({ ...spec, offsetDays: Number(e.target.value) })}
          />
          <span className="text-[12px] text-fg-muted">{t('days')}</span>
        </>
      )}
      {spec.kind === 'text' && (
        <input
          className={cn(selectCls, 'min-w-[200px] flex-1')}
          value={spec.text}
          onChange={(e) => onChange({ ...spec, text: e.target.value })}
          placeholder="{{title}}"
          data-testid="automation-value-text"
        />
      )}
      {spec.kind === 'formula' && (
        <input
          className={cn(selectCls, 'min-w-[200px] flex-1 font-mono')}
          value={spec.expression}
          onChange={(e) => onChange({ ...spec, expression: e.target.value })}
          placeholder='prop("Zahl") + 1'
          data-testid="automation-value-formula"
        />
      )}
      {spec.kind === 'static' &&
        (options.length ? (
          <select
            className={selectCls}
            value={String(Array.isArray(spec.value) ? (spec.value[0] ?? '') : (spec.value ?? ''))}
            onChange={(e) =>
              onChange({
                kind: 'static',
                value: prop.type === 'multi_select' ? [e.target.value] : e.target.value,
              })
            }
            data-testid="automation-value-option"
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        ) : prop.type === 'checkbox' ? (
          <select
            className={selectCls}
            value={String(spec.value === true)}
            onChange={(e) => onChange({ kind: 'static', value: e.target.value === 'true' })}
          >
            <option value="true">{t('checked')}</option>
            <option value="false">{t('unchecked')}</option>
          </select>
        ) : prop.type === 'person' ? (
          <select
            className={selectCls}
            value={String((spec.value as string[] | null)?.[0] ?? '')}
            onChange={(e) => onChange({ kind: 'static', value: [e.target.value] })}
          >
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        ) : prop.type === 'date' ? (
          <input
            type="date"
            className={selectCls}
            value={String((spec.value as { start?: string } | null)?.start ?? '')}
            onChange={(e) => onChange({ kind: 'static', value: { start: e.target.value } })}
          />
        ) : (
          <input
            className={selectCls}
            type={prop.type === 'number' ? 'number' : 'text'}
            value={String(spec.value ?? '')}
            onChange={(e) =>
              onChange({
                kind: 'static',
                value: prop.type === 'number' ? Number(e.target.value) : e.target.value,
              })
            }
          />
        ))}
    </>
  );
}

function CreateRowFields({
  action,
  db,
  workspaceId,
  members,
  onChange,
}: {
  action: Extract<AutomationAction, { type: 'create_row' }>;
  db: DatabaseDto | null;
  workspaceId: string;
  members: MemberDto[];
  onChange: (a: AutomationAction) => void;
}) {
  const t = useTranslations('automations');
  const [q, setQ] = useState('');
  const dbs = useQuery({
    queryKey: ['dbSearch', workspaceId, q],
    queryFn: () =>
      apiGet<DatabaseSearchResultDto[]>(
        `/workspaces/${workspaceId}/databases?q=${encodeURIComponent(q)}`,
      ),
  });
  const target = useDatabase(action.databaseId);
  const templates = useQuery({
    queryKey: ['rowTemplates', action.databaseId],
    queryFn: () => apiGet<RowTemplateDto[]>(`/databases/${action.databaseId}/templates`),
    enabled: !!action.databaseId,
  });
  const props = (target.data?.properties ?? []).filter((p) => SETTABLE.includes(p.type));
  const links = props.filter(
    (p) =>
      p.type === 'relation' &&
      db &&
      (p.config as { targetDatabaseId?: string }).targetDatabaseId === db.dataId,
  );
  const [adding, setAdding] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-fg-muted">{t('inDatabase')}</span>
        <select
          className={selectCls}
          value={action.databaseId}
          onChange={(e) =>
            onChange({
              ...action,
              databaseId: e.target.value,
              templateId: null,
              values: {},
              linkPropertyId: null,
            })
          }
          data-testid="automation-create-db"
        >
          {!action.databaseId && <option value="">{t('chooseDatabase')}</option>}
          {target.data && !(dbs.data ?? []).some((d) => d.id === action.databaseId) && (
            <option value={target.data.id}>{target.data.title || t('untitled')}</option>
          )}
          {(dbs.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.title || t('untitled')}
            </option>
          ))}
        </select>
        <input
          className={cn(selectCls, 'w-32')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search')}
        />
        {!!templates.data?.length && (
          <select
            className={selectCls}
            value={action.templateId ?? ''}
            onChange={(e) => onChange({ ...action, templateId: e.target.value || null })}
            data-testid="automation-create-template"
          >
            <option value="">{t('noTemplate')}</option>
            {templates.data.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.title || t('untitled')}
              </option>
            ))}
          </select>
        )}
      </div>
      <input
        className={inputClass}
        value={action.title}
        onChange={(e) => onChange({ ...action, title: e.target.value })}
        placeholder={`${t('titlePlaceholder')} {{title}}`}
        data-testid="automation-create-title"
      />
      {Object.entries(action.values).map(([pid, spec]) => {
        const p = props.find((x) => x.id === pid);
        if (!p) return null;
        return (
          <div key={pid} className="flex flex-wrap items-center gap-2">
            <span className="text-[13px]">{p.name}</span>
            <ValueSpecEditor
              prop={p}
              spec={spec}
              members={members}
              onChange={(s) => onChange({ ...action, values: { ...action.values, [pid]: s } })}
            />
            <button
              type="button"
              className="rounded p-1 text-fg-subtle hover:bg-hover"
              aria-label={t('removeAction')}
              onClick={() => {
                const { [pid]: _, ...rest } = action.values;
                onChange({ ...action, values: rest });
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        );
      })}
      {props.length > 0 && (
        <select
          className={cn(selectCls, 'self-start')}
          value={adding}
          onChange={(e) => {
            const p = props.find((x) => x.id === e.target.value);
            if (p) onChange({ ...action, values: { ...action.values, [p.id]: defaultValue(p) } });
            setAdding('');
          }}
        >
          <option value="">{t('addValue')}</option>
          {props
            .filter((p) => !(p.id in action.values) && p.type !== 'relation')
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      )}
      {links.length > 0 && (
        <label className="inline-flex items-center gap-1.5 text-[13px]">
          {t('linkVia')}
          <select
            className={selectCls}
            value={action.linkPropertyId ?? ''}
            onChange={(e) => onChange({ ...action, linkPropertyId: e.target.value || null })}
          >
            <option value="">{t('noLink')}</option>
            {links.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
