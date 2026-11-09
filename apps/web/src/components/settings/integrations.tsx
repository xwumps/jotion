'use client';

import {
  RECORD_FIELDS,
  SYNC_INTERVALS,
  TEMPLATE_SOURCE,
  type ConflictDto,
  type ConnectionDto,
  type ConnectionTestDto,
  type ConnectorType,
  type DatabaseSearchResultDto,
  type DeletionPolicy,
  type FieldOwnership,
  type Mapping,
  type MappingField,
  type MappingPreviewDto,
  type SourceDto,
  type SyncRunDto,
  type ConnectorInfoDto,
} from '@jotion/shared';
import { cn } from '@jotion/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '@/lib/api-client';
import { useDatabase } from '../database/use-database';
import { Dialog, DialogContent } from '../ui/dialog';
import { Field, FormError, inputClass } from '../ui/field';

const primaryBtn =
  'h-8 rounded-md bg-accent px-3 text-[14px] font-medium text-white hover:bg-accent-hover disabled:opacity-50';
const secondaryBtn =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[14px] hover:bg-hover disabled:opacity-50';
const selectCls =
  'h-8 rounded-md border border-border bg-bg px-2 text-[13px] outline-none focus:border-accent';

const MAPPABLE = [
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
];
const OWNERSHIPS: FieldOwnership[] = ['local_preserve', 'remote', 'once'];

const key = (ws: string) => ['integrations', ws] as const;

function useInvalidate(ws: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: key(ws) });
}

/** Einstellungen → Integrationen: Verbindungen, Quellen, Mapping, Läufe, Konflikte. */
export function IntegrationsSettings({ ws }: { ws: string }) {
  const t = useTranslations('integrations');
  const list = useQuery({
    queryKey: key(ws),
    queryFn: () => apiGet<ConnectionDto[]>(`/workspaces/${ws}/integrations`),
    // Laufende Syncs im Worker: regelmäßig nachladen
    refetchInterval: 15_000,
  });
  const [adding, setAdding] = useState(false);
  // Phase 11: Rückkehr von der Anmeldung beim Anbieter (Ergebnis in der URL)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const err = q.get('integrationError');
    if (q.get('connected')) toast.success(t('oauthConnected'));
    else if (err)
      toast.error(
        t.has(`oauthErrors.${err}`) ? t(`oauthErrors.${err}`) : t('oauthErrors.provider'),
        { description: q.get('message') ?? undefined },
      );
    if (q.get('connected') || err) window.history.replaceState(null, '', window.location.pathname);
  }, [t]);
  return (
    <div>
      <div className="flex items-start justify-between gap-4 border-b border-border pb-6">
        <div>
          <h2 className="text-[15px] font-semibold">{t('title')}</h2>
          <p className="mt-1 max-w-[520px] text-[13px] text-fg-muted">{t('intro')}</p>
          <p className="mt-2 max-w-[520px] text-[12px] text-fg-subtle">{t('privacy')}</p>
        </div>
        <button
          type="button"
          className={cn(primaryBtn, 'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap')}
          onClick={() => setAdding(true)}
          data-testid="integration-add"
        >
          <Plus className="size-4" />
          {t('add')}
        </button>
      </div>
      {list.isLoading && <p className="py-6 text-[13px] text-fg-muted">{t('loading')}</p>}
      {list.data?.length === 0 && (
        <p className="py-6 text-[13px] text-fg-muted" data-testid="integrations-empty">
          {t('empty')}
        </p>
      )}
      <div className="flex flex-col gap-4 py-6">
        {list.data?.map((c) => (
          <ConnectionCard key={c.id} ws={ws} conn={c} />
        ))}
      </div>
      <AddConnectionDialog ws={ws} open={adding} onOpenChange={setAdding} />
    </div>
  );
}

// ------------------------------------------------------------------ Hinzufügen

/** Phase 11: Felder je Connector-Typ (Konfiguration oder Geheimnis) */
interface FieldDef {
  key: string;
  secret?: boolean;
  required?: boolean;
  kind: 'url' | 'text' | 'password';
}

const TYPE_GROUPS: { id: string; types: ConnectorType[] }[] = [
  { id: 'calendar', types: ['iserv', 'caldav', 'ical', 'icloud'] },
  { id: 'cloud', types: ['google', 'microsoft', 'nextcloud'] },
  { id: 'files', types: ['dropbox', 'webdav'] },
  { id: 'messages', types: ['telegram'] },
];

const OAUTH_TYPES = new Set<ConnectorType>(['google', 'microsoft', 'dropbox']);

const FIELDS: Record<ConnectorType, FieldDef[]> = {
  iserv: [
    { key: 'baseUrl', kind: 'url', required: true },
    { key: 'username', kind: 'text', required: true },
    { key: 'password', kind: 'password', secret: true, required: true },
  ],
  caldav: [
    { key: 'serverUrl', kind: 'url', required: true },
    { key: 'username', kind: 'text', required: true },
    { key: 'password', kind: 'password', secret: true, required: true },
  ],
  ical: [
    { key: 'url', kind: 'url', required: true },
    { key: 'username', kind: 'text' },
    { key: 'password', kind: 'password', secret: true },
  ],
  icloud: [
    { key: 'username', kind: 'text', required: true },
    { key: 'password', kind: 'password', secret: true, required: true },
  ],
  nextcloud: [
    { key: 'serverUrl', kind: 'url', required: true },
    { key: 'username', kind: 'text', required: true },
    { key: 'password', kind: 'password', secret: true, required: true },
    { key: 'folder', kind: 'text' },
  ],
  webdav: [
    { key: 'folderUrl', kind: 'url', required: true },
    { key: 'username', kind: 'text' },
    { key: 'password', kind: 'password', secret: true },
  ],
  telegram: [
    { key: 'botToken', kind: 'password', secret: true, required: true },
    { key: 'allowedUsers', kind: 'text', required: true },
  ],
  google: [],
  microsoft: [],
  dropbox: [],
};

/** Feld mit der Adresse (Beschreibung im Bearbeiten-Dialog) */
const URL_FIELD: Partial<Record<ConnectorType, string>> = {
  iserv: 'baseUrl',
  caldav: 'serverUrl',
  ical: 'url',
  nextcloud: 'serverUrl',
  webdav: 'folderUrl',
};

/** Phase 11: Anmeldung beim Anbieter beginnen (Weiterleitung) */
export async function startOAuth(
  ws: string,
  body: { type: ConnectorType; name?: string; connectionId?: string },
) {
  const r = await apiPost<{ url: string }>(`/workspaces/${ws}/integrations/oauth/start`, body);
  window.location.assign(r.url);
}

function AddConnectionDialog({
  ws,
  open,
  onOpenChange,
}: {
  ws: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('integrations');
  const invalidate = useInvalidate(ws);
  const [type, setType] = useState<ConnectorType>('iserv');
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ConnectionTestDto | null>(null);
  const connectors = useQuery({
    queryKey: ['connectors', ws],
    queryFn: () => apiGet<ConnectorInfoDto[]>(`/workspaces/${ws}/integrations/connectors`),
    enabled: open,
    staleTime: 60_000,
  });
  const available = (x: ConnectorType) =>
    connectors.data?.find((c) => c.type === x)?.available ?? !OAUTH_TYPES.has(x);
  const fields = FIELDS[type];
  const isOAuth = OAUTH_TYPES.has(type);
  const body = () => {
    const config: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const f of fields) {
      const v = (values[f.key] ?? '').trim();
      if (!v) continue;
      (f.secret ? secrets : config)[f.key] = v;
    }
    return { type, config, secrets };
  };
  const fail = (e: unknown) =>
    setResult({
      ok: false,
      accountLabel: null,
      sources: [],
      capabilities: {},
      error: { code: 'error', message: errorMessage(e) },
    });
  const test = useMutation({
    mutationFn: () => apiPost<ConnectionTestDto>(`/workspaces/${ws}/integrations/test`, body()),
    onSuccess: setResult,
    onError: fail,
  });
  const create = useMutation({
    mutationFn: () =>
      apiPost<ConnectionDto>(`/workspaces/${ws}/integrations`, {
        ...body(),
        name: name.trim() || t(`types.${type}`),
      }),
    onSuccess: () => {
      toast.success(t('created'));
      void invalidate();
      onOpenChange(false);
      setResult(null);
      setValues({});
      setName('');
    },
    onError: fail,
  });
  const oauth = useMutation({
    mutationFn: () => startOAuth(ws, { type, ...(name.trim() ? { name: name.trim() } : {}) }),
    onError: fail,
  });
  const complete = fields.every((f) => !f.required || (values[f.key] ?? '').trim());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('addTitle')}
        description={t('addDescription')}
        className="max-w-[600px]"
      >
        <form
          method="post"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (isOAuth) oauth.mutate();
            else create.mutate();
          }}
        >
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('type')}>
            {TYPE_GROUPS.map((g) => (
              <div key={g.id}>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                  {t(`groups.${g.id}`)}
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {g.types.map((x) => (
                    <button
                      key={x}
                      type="button"
                      role="radio"
                      aria-checked={type === x}
                      onClick={() => {
                        setType(x);
                        setResult(null);
                        setValues({});
                      }}
                      className={cn(
                        'rounded-md border px-2 py-2 text-[13px]',
                        type === x
                          ? 'border-accent bg-accent/10 font-medium'
                          : 'border-border hover:bg-hover',
                        !available(x) && 'opacity-60',
                      )}
                      data-testid={`integration-type-${x}`}
                    >
                      {t(`types.${x}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-fg-subtle">{t(`typeHints.${type}`)}</p>
          <Field
            label={t('name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(`types.${type}`)}
            maxLength={100}
          />
          {fields.map((f) => (
            <Field
              key={`${type}-${f.key}`}
              label={t(f.required ? `inputs.${f.key}` : `inputsOptional.${f.key}`)}
              value={values[f.key] ?? ''}
              onChange={(e) => {
                setValues({ ...values, [f.key]: e.target.value });
                setResult(null);
              }}
              type={f.kind === 'password' ? 'password' : 'text'}
              inputMode={f.kind === 'url' ? 'url' : undefined}
              autoComplete={
                f.kind === 'password'
                  ? 'current-password'
                  : f.key === 'username'
                    ? 'username'
                    : 'off'
              }
              placeholder={
                t.has(`placeholders.${type}.${f.key}`)
                  ? t(`placeholders.${type}.${f.key}`)
                  : undefined
              }
              hint={t.has(`hints.${type}.${f.key}`) ? t(`hints.${type}.${f.key}`) : undefined}
              required={f.required}
              data-testid={`integration-field-${f.key}`}
            />
          ))}
          {isOAuth && !available(type) && (
            <FormError>{t('oauthUnavailable', { provider: t(`types.${type}`) })}</FormError>
          )}
          {result && <TestResult result={result} />}
          <div className="flex justify-end gap-2 pt-1">
            {isOAuth ? (
              <button
                type="submit"
                className={primaryBtn}
                disabled={!available(type) || oauth.isPending}
                data-testid="integration-oauth"
              >
                {t('oauthConnect', { provider: t(`types.${type}`) })}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={secondaryBtn}
                  disabled={!complete || test.isPending}
                  onClick={() => test.mutate()}
                  data-testid="integration-test"
                >
                  {test.isPending ? t('testing') : t('test')}
                </button>
                <button
                  type="submit"
                  className={primaryBtn}
                  disabled={!complete || create.isPending}
                  data-testid="integration-save"
                >
                  {create.isPending ? t('saving') : t('save')}
                </button>
              </>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TestResult({ result }: { result: ConnectionTestDto }) {
  const t = useTranslations('integrations');
  if (!result.ok) return <FormError>{result.error?.message ?? t('testFailed')}</FormError>;
  return (
    <div
      className="rounded-md border border-border p-3 text-[13px]"
      data-testid="integration-test-result"
    >
      <p className="flex items-center gap-1.5 font-medium text-[var(--c-green)]">
        <CheckCircle2 className="size-4" />
        {t('testOk', { account: result.accountLabel ?? '' })}
      </p>
      <ul className="mt-2 list-disc pl-5 text-fg-muted">
        {result.sources.map((s) => (
          <li key={s.remoteId}>
            {s.name}{' '}
            <span className="text-fg-subtle">
              ({s.kinds.map((k) => t(`kinds.${k}`)).join(', ')})
            </span>
          </li>
        ))}
      </ul>
      {result.sources.length === 0 && <p className="mt-1 text-fg-muted">{t('noSources')}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ Verbindung

function StatusBadge({ conn }: { conn: ConnectionDto }) {
  const t = useTranslations('integrations');
  const color =
    conn.status === 'active'
      ? 'bg-[var(--cb-green)] text-[var(--c-green)]'
      : conn.status === 'paused'
        ? 'bg-[var(--cb-yellow)] text-[var(--c-yellow)]'
        : 'bg-[var(--cb-red)] text-[var(--c-red)]';
  return (
    <span
      className={cn('rounded px-1.5 py-0.5 text-[12px] font-medium', color)}
      data-testid="integration-status"
    >
      {t(`status.${conn.status}`)}
    </span>
  );
}

function RunSummary({ run }: { run: SyncRunDto }) {
  const t = useTranslations('integrations');
  const f = useFormatter();
  const s = run.stats;
  return (
    <span className="text-[12px] text-fg-muted" data-testid="integration-last-run">
      {t(`runStatus.${run.status}`)} · {f.relativeTime(new Date(run.finishedAt ?? run.startedAt))}
      {run.status !== 'running' &&
        ` · ${t('stats', { created: s.created ?? 0, updated: s.updated ?? 0, deleted: s.deleted ?? 0, conflicts: s.conflicts ?? 0, errors: s.errors ?? 0 })}`}
    </span>
  );
}

function ConnectionCard({ ws, conn }: { ws: string; conn: ConnectionDto }) {
  const t = useTranslations('integrations');
  const invalidate = useInvalidate(ws);
  const base = `/workspaces/${ws}/integrations/${conn.id}`;
  const [showRuns, setShowRuns] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [editing, setEditing] = useState(false);
  const sync = useMutation({
    mutationFn: () => apiPost<{ queued: boolean; run: SyncRunDto | null }>(`${base}/sync`),
    onSuccess: (r) => {
      toast.success(r.queued ? t('syncQueued') : t(`runStatus.${r.run?.status ?? 'succeeded'}`));
      void invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const retest = useMutation({
    mutationFn: () => apiPost<ConnectionTestDto>(`${base}/test`),
    onSuccess: (r) => {
      if (r.ok) toast.success(t('testOk', { account: r.accountLabel ?? '' }));
      else toast.error(r.error?.message ?? t('testFailed'));
      void invalidate();
    },
  });
  const patch = useMutation({
    mutationFn: (body: object) => apiPatch<ConnectionDto>(base, body),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const active = conn.sources.filter((s) => s.enabled && s.targetDatabaseId).length;
  return (
    <section
      className="rounded-lg border border-border"
      data-testid="integration-card"
      data-name={conn.name}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <CalendarDays className="size-4 text-fg-muted" />
        <h3 className="text-[14px] font-semibold">{conn.name}</h3>
        <span className="text-[12px] text-fg-subtle">
          {t(`types.${conn.type}`)}
          {conn.accountLabel && ` · ${conn.accountLabel}`}
        </span>
        <StatusBadge conn={conn} />
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => sync.mutate()}
            disabled={sync.isPending || !active}
            data-testid="integration-sync"
          >
            <RefreshCw className={cn('size-3.5', sync.isPending && 'animate-spin')} />
            {t('syncNow')}
          </button>
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => setEditing(true)}
            aria-label={t('edit')}
            data-testid="integration-edit"
          >
            <Settings2 className="size-3.5" />
          </button>
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => setDisconnecting(true)}
            aria-label={t('disconnect')}
            data-testid="integration-disconnect"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </header>
      <div className="flex flex-col gap-3 px-4 py-3">
        {conn.statusMessage && (
          <p
            className="flex items-start gap-1.5 text-[13px] text-[var(--c-red)]"
            data-testid="integration-status-message"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {conn.statusMessage}
              {conn.status === 'error' && (
                <button type="button" className="ml-2 underline" onClick={() => retest.mutate()}>
                  {t('retest')}
                </button>
              )}
            </span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={conn.syncEnabled}
              onChange={(e) => patch.mutate({ syncEnabled: e.target.checked })}
              data-testid="integration-auto"
            />
            {t('autoSync')}
          </label>
          <select
            className={selectCls}
            value={conn.intervalMinutes}
            onChange={(e) => patch.mutate({ intervalMinutes: Number(e.target.value) })}
            aria-label={t('interval')}
            disabled={!conn.syncEnabled}
          >
            {SYNC_INTERVALS.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? t('minutes', { n: m }) : t('hours', { n: m / 60 })}
              </option>
            ))}
          </select>
          {conn.lastRun && <RunSummary run={conn.lastRun} />}
        </div>
        <div className="flex flex-col divide-y divide-border rounded-md border border-border">
          {conn.sources.map((s) => (
            <SourceRow key={s.id} ws={ws} conn={conn} source={s} />
          ))}
          {conn.sources.length === 0 && (
            <p className="px-3 py-2 text-[13px] text-fg-muted">{t('noSources')}</p>
          )}
        </div>
        <div className="flex gap-3 text-[13px]">
          <button
            type="button"
            className="text-fg-muted underline-offset-2 hover:underline"
            onClick={() => setShowRuns((v) => !v)}
            data-testid="integration-runs-toggle"
          >
            {showRuns ? t('hideRuns') : t('showRuns')}
          </button>
          {conn.openConflicts > 0 && (
            <button
              type="button"
              className="font-medium text-[var(--c-orange)] underline-offset-2 hover:underline"
              onClick={() => setShowConflicts((v) => !v)}
              data-testid="integration-conflicts-toggle"
            >
              {t('conflictsCount', { n: conn.openConflicts })}
            </button>
          )}
        </div>
        {showRuns && <RunList base={base} />}
        {showConflicts && conn.openConflicts > 0 && <ConflictList ws={ws} base={base} />}
      </div>
      <DisconnectDialog ws={ws} conn={conn} open={disconnecting} onOpenChange={setDisconnecting} />
      <EditConnectionDialog ws={ws} conn={conn} open={editing} onOpenChange={setEditing} />
    </section>
  );
}

function EditConnectionDialog({
  ws,
  conn,
  open,
  onOpenChange,
}: {
  ws: string;
  conn: ConnectionDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('integrations');
  const invalidate = useInvalidate(ws);
  const [name, setName] = useState(conn.name);
  const [username, setUsername] = useState(String(conn.config.username ?? ''));
  const [password, setPassword] = useState('');
  // Phase 11: Telegram (Bot-Token, erlaubte Absender), OAuth (nur Name, neu anmelden)
  const isOAuth = OAUTH_TYPES.has(conn.type);
  const isTelegram = conn.type === 'telegram';
  const hasUsername = !isOAuth && !isTelegram;
  const [allowed, setAllowed] = useState(
    Array.isArray(conn.config.allowedUsers)
      ? (conn.config.allowedUsers as string[]).join(', ')
      : '',
  );
  const save = useMutation({
    mutationFn: () =>
      apiPatch(`/workspaces/${ws}/integrations/${conn.id}`, {
        name,
        ...(hasUsername && (conn.type !== 'ical' || username) ? { config: { username } } : {}),
        ...(isTelegram ? { config: { allowedUsers: allowed } } : {}),
        ...(password ? { secrets: { [isTelegram ? 'botToken' : 'password']: password } } : {}),
      }),
    onSuccess: () => {
      toast.success(t('savedConnection'));
      void invalidate();
      setPassword('');
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('editTitle')}
        description={String(
          URL_FIELD[conn.type]
            ? (conn.config[URL_FIELD[conn.type]!] ?? '')
            : (conn.accountLabel ?? ''),
        )}
      >
        <form
          method="post"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field
            label={t('name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
          {hasUsername && (
            <Field
              label={t('username')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          )}
          {isTelegram && (
            <Field
              label={t('inputs.allowedUsers')}
              value={allowed}
              onChange={(e) => setAllowed(e.target.value)}
              hint={t('hints.telegram.allowedUsers')}
            />
          )}
          {!isOAuth && (
            <Field
              label={isTelegram ? t('newBotToken') : t('newPassword')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              hint={conn.secretKeys.length ? t('passwordStored') : undefined}
              data-testid="integration-edit-password"
            />
          )}
          {isOAuth && (
            <button
              type="button"
              className={secondaryBtn}
              onClick={() =>
                void startOAuth(ws, { type: conn.type, connectionId: conn.id }).catch((e) =>
                  toast.error(errorMessage(e)),
                )
              }
              data-testid="integration-reconnect"
            >
              {t('oauthReconnect', { provider: t(`types.${conn.type}`) })}
            </button>
          )}
          {save.isError && <FormError>{errorMessage(save.error)}</FormError>}
          <div className="flex justify-end">
            <button type="submit" className={primaryBtn} disabled={save.isPending}>
              {t('save')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DisconnectDialog({
  ws,
  conn,
  open,
  onOpenChange,
}: {
  ws: string;
  conn: ConnectionDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('integrations');
  const invalidate = useInvalidate(ws);
  const [rows, setRows] = useState<'keep' | 'archive'>('keep');
  const remove = useMutation({
    mutationFn: () => apiDelete(`/workspaces/${ws}/integrations/${conn.id}?rows=${rows}`),
    onSuccess: () => {
      toast.success(t('disconnected'));
      void invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('disconnectTitle', { name: conn.name })}
        description={t('disconnectDescription')}
      >
        <div className="flex flex-col gap-2 text-[14px]">
          {(['keep', 'archive'] as const).map((r) => (
            <label key={r} className="flex items-center gap-2">
              <input type="radio" name="rows" checked={rows === r} onChange={() => setRows(r)} />
              {t(`disconnectRows.${r}`)}
            </label>
          ))}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className={secondaryBtn} onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className={cn(primaryBtn, 'bg-[var(--c-red)] hover:bg-[var(--c-red)]')}
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              data-testid="integration-disconnect-confirm"
            >
              {t('disconnect')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Quelle

function SourceRow({ ws, conn, source }: { ws: string; conn: ConnectionDto; source: SourceDto }) {
  const t = useTranslations('integrations');
  const invalidate = useInvalidate(ws);
  const base = `/workspaces/${ws}/integrations/${conn.id}/sources/${source.id}`;
  const [picking, setPicking] = useState(false);
  const [mapping, setMapping] = useState(false);
  const patch = useMutation({
    mutationFn: (body: object) => apiPatch<SourceDto>(base, body),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const createDb = useMutation({
    mutationFn: () => apiPost<SourceDto>(`${base}/database`, { title: source.name }),
    onSuccess: () => {
      toast.success(t('databaseCreated', { title: source.name }));
      void invalidate();
      setPicking(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div
      className="flex flex-col gap-2 px-3 py-2.5"
      data-testid="integration-source"
      data-name={source.name}
    >
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <label className="inline-flex items-center gap-1.5 font-medium">
          <input
            type="checkbox"
            checked={source.enabled}
            disabled={!source.targetDatabaseId}
            onChange={(e) => patch.mutate({ enabled: e.target.checked })}
            data-testid="source-enabled"
          />
          {source.name}
        </label>
        <span className="text-[12px] text-fg-subtle">
          {source.kinds.map((k) => t(`kinds.${k}`)).join(', ')}
        </span>
        <span className="text-fg-subtle">→</span>
        {source.targetDatabaseId ? (
          <span className="font-medium" data-testid="source-target">
            {source.targetDatabaseTitle || t('untitled')}
          </span>
        ) : (
          <span className="text-fg-muted">{t('noTarget')}</span>
        )}
        {source.entityCount > 0 && (
          <span className="text-[12px] text-fg-subtle">
            {t('entityCount', { n: source.entityCount })}
          </span>
        )}
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => setPicking((v) => !v)}
            data-testid="source-pick-target"
          >
            {source.targetDatabaseId ? t('changeTarget') : t('chooseTarget')}
          </button>
          {source.targetDatabaseId && (
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => setMapping(true)}
              data-testid="source-mapping"
            >
              {t('mapping')}
            </button>
          )}
        </div>
      </div>
      {picking && (
        <TargetPicker
          ws={ws}
          onPick={(id) => {
            patch.mutate({ targetDatabaseId: id });
            setPicking(false);
          }}
          onCreate={() => createDb.mutate()}
          creating={createDb.isPending}
          sourceName={source.name}
        />
      )}
      {source.targetDatabaseId && (
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-fg-muted">
          <label className="inline-flex items-center gap-1.5">
            {t('deletionPolicy')}
            <select
              className={selectCls}
              value={source.deletionPolicy}
              onChange={(e) => patch.mutate({ deletionPolicy: e.target.value as DeletionPolicy })}
              data-testid="source-deletion"
            >
              {(['mark', 'archive', 'trash'] as const).map((p) => (
                <option key={p} value={p}>
                  {t(`deletion.${p}`)}
                </option>
              ))}
            </select>
          </label>
          {source.kinds.includes('event') && (
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={source.options.expandRecurring}
                onChange={(e) =>
                  patch.mutate({
                    options: { ...source.options, expandRecurring: e.target.checked },
                  })
                }
              />
              {t('expandRecurring', {
                past: source.options.windowPastDays,
                future: source.options.windowFutureDays,
              })}
            </label>
          )}
          {source.lastSyncedAt && (
            <span>{t('lastSynced', { date: new Date(source.lastSyncedAt) })}</span>
          )}
        </div>
      )}
      {mapping && source.targetDatabaseId && (
        <MappingDialog
          ws={ws}
          base={base}
          source={source}
          open={mapping}
          onOpenChange={setMapping}
        />
      )}
    </div>
  );
}

function TargetPicker({
  ws,
  onPick,
  onCreate,
  creating,
  sourceName,
}: {
  ws: string;
  onPick: (id: string) => void;
  onCreate: () => void;
  creating: boolean;
  sourceName: string;
}) {
  const t = useTranslations('integrations');
  const [q, setQ] = useState('');
  const dbs = useQuery({
    queryKey: ['dbSearch', ws, q],
    queryFn: () =>
      apiGet<DatabaseSearchResultDto[]>(`/workspaces/${ws}/databases?q=${encodeURIComponent(q)}`),
  });
  return (
    <div className="flex flex-col gap-2 rounded-md bg-bg-secondary p-2">
      <button
        type="button"
        className={cn(secondaryBtn, 'justify-center bg-bg')}
        onClick={onCreate}
        disabled={creating}
        data-testid="source-create-db"
      >
        <Plus className="size-3.5" />
        {t('createDatabase', { title: sourceName })}
      </button>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('searchDatabase')}
        className={cn(inputClass, 'h-8')}
        data-testid="source-db-search"
      />
      <div className="max-h-[160px] overflow-y-auto">
        {(dbs.data ?? []).map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onPick(d.id)}
            className="flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] hover:bg-hover"
            data-testid="source-db-option"
            data-title={d.title}
          >
            <span className="truncate">{d.title || t('untitled')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Mapping

function MappingDialog({
  ws,
  base,
  source,
  open,
  onOpenChange,
}: {
  ws: string;
  base: string;
  source: SourceDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('integrations');
  const invalidate = useInvalidate(ws);
  const db = useDatabase(source.targetDatabaseId!);
  const [mapping, setMapping] = useState<Mapping>(source.mapping);
  const [preview, setPreview] = useState<MappingPreviewDto | null>(null);
  const fields = [
    ...new Set([
      ...source.kinds.flatMap((k) => RECORD_FIELDS[k as 'event' | 'task'] ?? []),
      'source',
    ]),
  ];
  const props = (db.data?.properties ?? []).filter(
    (p) => MAPPABLE.includes(p.type) && p.id !== mapping.syncStatusPropertyId,
  );
  const targets = [{ id: 'title', name: t('titleProperty'), type: 'title' }, ...props];
  const fieldOf = (target: string) => mapping.fields.find((f) => f.target === target);
  const setField = (target: string, patch: Partial<MappingField> | null) =>
    setMapping((m) => {
      const rest = m.fields.filter((f) => f.target !== target);
      if (!patch) return { ...m, fields: rest };
      const prev = m.fields.find((f) => f.target === target) ?? {
        source: 'title',
        target,
        ownership: 'local_preserve' as const,
        autoCreateOptions: true,
      };
      return { ...m, fields: [...rest, { ...prev, ...patch }] };
    });
  const save = useMutation({
    mutationFn: () => apiPatch(base, { mapping }),
    onSuccess: () => {
      toast.success(t('mappingSaved'));
      void invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const runPreview = useMutation({
    mutationFn: () => apiPost<MappingPreviewDto>(`${base}/preview`, { mapping }),
    onSuccess: setPreview,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const selects = (db.data?.properties ?? []).filter((p) => p.type === 'select');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('mappingTitle', { name: source.name })}
        description={t('mappingDescription')}
        className="max-w-[760px]"
      >
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
          <table className="w-full text-[13px]" data-testid="mapping-table">
            <thead className="text-left text-[12px] text-fg-subtle">
              <tr>
                <th className="pb-1 font-medium">{t('property')}</th>
                <th className="pb-1 font-medium">{t('sourceField')}</th>
                <th className="pb-1 font-medium">{t('ownership')}</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((p) => {
                const f = fieldOf(p.id);
                return (
                  <tr
                    key={p.id}
                    className="align-top"
                    data-testid="mapping-row"
                    data-property={p.name}
                  >
                    <td className="py-1 pr-2">{p.name}</td>
                    <td className="py-1 pr-2">
                      <select
                        className={cn(selectCls, 'w-full')}
                        value={f?.source ?? ''}
                        onChange={(e) =>
                          setField(
                            p.id,
                            e.target.value
                              ? {
                                  source: e.target.value,
                                  ...(e.target.value === TEMPLATE_SOURCE && !f?.template
                                    ? { template: '{{title}}' }
                                    : {}),
                                }
                              : null,
                          )
                        }
                        data-testid="mapping-source"
                      >
                        <option value="">{t('notMapped')}</option>
                        {fields.map((x) => (
                          <option key={x} value={x}>
                            {t(`fields.${x}`)}
                          </option>
                        ))}
                        <option value={TEMPLATE_SOURCE}>{t('template')}</option>
                      </select>
                      {f?.source === TEMPLATE_SOURCE && (
                        <input
                          className={cn(inputClass, 'mt-1 h-8')}
                          value={f.template ?? ''}
                          onChange={(e) => setField(p.id, { template: e.target.value })}
                          placeholder="{{categories}}: {{title}}"
                        />
                      )}
                    </td>
                    <td className="py-1">
                      {f && (
                        <select
                          className={cn(selectCls, 'w-full')}
                          value={f.ownership}
                          onChange={(e) =>
                            setField(p.id, { ownership: e.target.value as FieldOwnership })
                          }
                          data-testid="mapping-ownership"
                        >
                          {OWNERSHIPS.map((o) => (
                            <option key={o} value={o}>
                              {t(`ownerships.${o}`)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[12px] text-fg-subtle">{t('ownershipHint')}</p>
          <div className="flex flex-wrap items-center gap-4 text-[13px]">
            <label className="inline-flex items-center gap-1.5">
              {t('syncStatusProperty')}
              <select
                className={selectCls}
                value={mapping.syncStatusPropertyId ?? ''}
                onChange={(e) =>
                  setMapping((m) => ({ ...m, syncStatusPropertyId: e.target.value || null }))
                }
              >
                <option value="">{t('none')}</option>
                {selects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={mapping.descriptionToContent}
                onChange={(e) =>
                  setMapping((m) => ({ ...m, descriptionToContent: e.target.checked }))
                }
              />
              {t('descriptionToContent')}
            </label>
          </div>
          {preview && (
            <PreviewTable preview={preview} names={new Map(targets.map((p) => [p.id, p.name]))} />
          )}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => runPreview.mutate()}
            disabled={runPreview.isPending}
            data-testid="mapping-preview"
          >
            {runPreview.isPending ? t('loading') : t('preview')}
          </button>
          <button
            type="button"
            className={primaryBtn}
            onClick={() => save.mutate()}
            disabled={save.isPending}
            data-testid="mapping-save"
          >
            {t('save')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function previewValue(v: unknown, t: (k: string, v?: Record<string, string>) => string): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-fg-subtle">–</span>;
  if (typeof v === 'boolean') return v ? '✓' : '–';
  if (Array.isArray(v)) return v.length ? `${v.length}` : '–';
  if (typeof v === 'object') {
    const o = v as { start?: string; end?: string | null; newOptions?: string[] };
    if (o.newOptions)
      return (
        <span className="text-[var(--c-blue)]">
          {t('newOption', { names: o.newOptions.join(', ') })}
        </span>
      );
    if (o.start)
      return o.end
        ? `${o.start.replace('T', ' ').slice(0, 16)} – ${o.end.replace('T', ' ').slice(0, 16)}`
        : o.start.replace('T', ' ').slice(0, 16);
  }
  return String(v);
}

function PreviewTable({
  preview,
  names,
}: {
  preview: MappingPreviewDto;
  names: Map<string, string>;
}) {
  const t = useTranslations('integrations');
  const cols = [...new Set(preview.rows.flatMap((r) => Object.keys(r.values)))].filter(
    (c) => c !== 'title',
  );
  return (
    <div className="flex flex-col gap-2" data-testid="mapping-preview-table">
      <h4 className="text-[13px] font-semibold">{t('previewTitle', { n: preview.rows.length })}</h4>
      {preview.errors.map((e) => (
        <FormError key={e}>{e}</FormError>
      ))}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-[12px]">
          <thead className="bg-bg-secondary text-left">
            <tr>
              <th className="px-2 py-1">{t('titleProperty')}</th>
              {cols.map((c) => (
                <th key={c} className="px-2 py-1">
                  {names.get(c) ?? c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r) => (
              <tr key={r.externalId} className="border-t border-border">
                <td className="px-2 py-1">{r.title}</td>
                {cols.map((c) => (
                  <td key={c} className="px-2 py-1">
                    {previewValue(r.values[c], t as never)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Object.keys(preview.newOptions).length > 0 && (
        <p className="text-[12px] text-fg-muted">
          {t('newOptionsHint', {
            list: Object.entries(preview.newOptions)
              .map(([p, n]) => `${p}: ${n.join(', ')}`)
              .join('; '),
          })}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Läufe und Konflikte

function RunList({ base }: { base: string }) {
  const t = useTranslations('integrations');
  const f = useFormatter();
  const runs = useQuery({
    queryKey: ['integrationRuns', base],
    queryFn: () => apiGet<SyncRunDto[]>(`${base}/runs`),
  });
  return (
    <div className="flex flex-col gap-1.5 text-[12px]" data-testid="integration-runs">
      {(runs.data ?? []).map((r) => (
        <details key={r.id} className="rounded-md border border-border px-2 py-1.5">
          <summary className="cursor-pointer">
            <span
              className={cn(
                'font-medium',
                r.status === 'failed' && 'text-[var(--c-red)]',
                r.status === 'partial' && 'text-[var(--c-orange)]',
              )}
            >
              {t(`runStatus.${r.status}`)}
            </span>{' '}
            · {f.dateTime(new Date(r.startedAt), { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
            {t(`trigger.${r.trigger}`)}
            {r.status !== 'running' &&
              ` · ${t('stats', { created: r.stats.created ?? 0, updated: r.stats.updated ?? 0, deleted: r.stats.deleted ?? 0, conflicts: r.stats.conflicts ?? 0, errors: r.stats.errors ?? 0 })}`}
          </summary>
          {r.errorMessage && <p className="mt-1 text-[var(--c-red)]">{r.errorMessage}</p>}
          {r.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-fg-muted">
              {r.errors.map((e, i) => (
                <li key={i}>
                  {[e.source, e.externalId].filter(Boolean).join(' / ')}
                  {(e.source || e.externalId) && ': '}
                  {e.message}
                </li>
              ))}
            </ul>
          )}
        </details>
      ))}
    </div>
  );
}

function conflictValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'object' && v && 'start' in v) {
    const d = v as { start: string; end: string | null };
    return d.end ? `${d.start} – ${d.end}` : d.start;
  }
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function ConflictList({ ws, base }: { ws: string; base: string }) {
  const t = useTranslations('integrations');
  const invalidate = useInvalidate(ws);
  const qc = useQueryClient();
  const conflicts = useQuery({
    queryKey: ['integrationConflicts', base],
    queryFn: () => apiGet<ConflictDto[]>(`${base}/conflicts`),
  });
  const resolve = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: 'remote' | 'local' }) =>
      apiPost(`${base}/conflicts/${id}`, { resolution }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['integrationConflicts', base] });
      void invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-2" data-testid="integration-conflicts">
      <p className="text-[12px] text-fg-muted">{t('conflictsHint')}</p>
      {(conflicts.data ?? []).map((c) => (
        <div
          key={c.id}
          className="rounded-md border border-border p-2 text-[13px]"
          data-testid="integration-conflict"
        >
          <p className="font-medium">
            {c.rowTitle || t('untitled')} · {c.fieldName}
          </p>
          <p className="mt-1 text-fg-muted">
            {t('localValue')}: <span className="text-fg">{conflictValue(c.localValue)}</span> ·{' '}
            {t('remoteValue')}: <span className="text-fg">{conflictValue(c.remoteValue)}</span>
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => resolve.mutate({ id: c.id, resolution: 'remote' })}
              data-testid="conflict-take-remote"
            >
              {t('takeRemote')}
            </button>
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => resolve.mutate({ id: c.id, resolution: 'local' })}
              data-testid="conflict-keep-local"
            >
              {t('keepLocal')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
