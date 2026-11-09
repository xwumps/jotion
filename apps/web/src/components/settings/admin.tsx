'use client';

import type { AdminStatusDto, AdminUserDto } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, DatabaseBackup, XCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost, errorMessage } from '@/lib/api-client';
import { useMe } from '../app/providers';

const KEY = ['admin'] as const;

function bytes(n: number, f: ReturnType<typeof useFormatter>) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${f.number(v, { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}

/** Phase 12: Server-Einstellungen für Instanz-Admins (Zustand, Sicherungen, Konten). */
export function AdminSettings() {
  const t = useTranslations('admin');
  const f = useFormatter();
  const qc = useQueryClient();
  const me = useMe();
  const status = useQuery({
    queryKey: [...KEY, 'status'],
    queryFn: () => apiGet<AdminStatusDto>('/admin/status'),
    refetchInterval: (q) => (q.state.data?.backups.requested ? 5000 : 30_000),
  });
  const users = useQuery({
    queryKey: [...KEY, 'users'],
    queryFn: () => apiGet<AdminUserDto[]>('/admin/users'),
  });
  const backup = useMutation({
    mutationFn: () => apiPost('/admin/backups'),
    onSuccess: () => {
      toast.success(t('backupRequested'));
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      apiPatch(`/admin/users/${id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = status.data;

  return (
    <div className="flex flex-col gap-8" data-testid="admin-settings">
      <section>
        <h2 className="text-[15px] font-semibold">{t('status')}</h2>
        {s && (
          <div className="mt-3 grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <div className="text-fg-muted">{t('version', { version: s.version })}</div>
              <ul className="mt-2 space-y-1">
                {Object.entries(s.checks).map(([k, c]) => (
                  <li
                    key={k}
                    className="flex items-center gap-1.5"
                    data-testid="admin-check"
                    data-status={c.status}
                  >
                    {c.status === 'ok' ? (
                      <CheckCircle2 className="size-4 text-[var(--c-green)]" />
                    ) : (
                      <XCircle className="size-4 text-[var(--c-red)]" />
                    )}
                    {t(`checks.${k}`)}
                    {c.message && <span className="text-fg-subtle">({c.message})</span>}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-border p-3">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                {(['users', 'workspaces', 'pages', 'databases', 'files'] as const).map((k) => (
                  <div key={k} className="contents">
                    <dt className="text-fg-muted">{t(`counts.${k}`)}</dt>
                    <dd>{f.number(s.counts[k])}</dd>
                  </div>
                ))}
                <dt className="text-fg-muted">{t('filesSize')}</dt>
                <dd>{bytes(s.storage.filesBytes, f)}</dd>
                <dt className="text-fg-muted">{t('databaseSize')}</dt>
                <dd>{bytes(s.storage.databaseBytes, f)}</dd>
              </dl>
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center gap-3">
          <h2 className="text-[15px] font-semibold">{t('backups')}</h2>
          <button
            type="button"
            onClick={() => backup.mutate()}
            disabled={!s?.backups.available || s.backups.requested || backup.isPending}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] hover:bg-hover disabled:opacity-50"
            data-testid="admin-backup-now"
          >
            <DatabaseBackup className="size-4" />
            {s?.backups.requested ? t('backupRunning') : t('backupNow')}
          </button>
        </div>
        <p className="mt-1 text-[13px] text-fg-muted">{t('backupsHint')}</p>
        {s && !s.backups.available && (
          <p className="mt-2 text-[13px] text-[var(--c-red)]">{t('backupsUnavailable')}</p>
        )}
        {s?.backups.last && (
          <p
            className={cn(
              'mt-2 text-[13px]',
              s.backups.last.ok ? 'text-fg-muted' : 'text-[var(--c-red)]',
            )}
          >
            {s.backups.last.ok
              ? t('lastOk', {
                  date: f.dateTime(new Date(s.backups.last.at), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                })
              : t('lastFailed', { error: s.backups.last.error ?? '' })}
          </p>
        )}
        <ul className="mt-3 divide-y divide-border rounded-md border border-border text-[13px]">
          {s?.backups.list.length === 0 && (
            <li className="px-3 py-2 text-fg-muted">{t('noBackups')}</li>
          )}
          {s?.backups.list.slice(0, 20).map((b) => (
            <li
              key={b.name}
              className="flex items-center gap-3 px-3 py-2"
              data-testid="admin-backup"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{b.name}</span>
              <span className="text-fg-muted">
                {t(`triggers.${b.trigger}`, { fallback: b.trigger })}
              </span>
              <span className="w-20 text-right text-fg-muted">{bytes(b.size, f)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-fg-subtle">{t('restoreHint')}</p>
      </section>

      <section>
        <h2 className="text-[15px] font-semibold">{t('users')}</h2>
        <ul className="mt-3 divide-y divide-border rounded-md border border-border text-[13px]">
          {users.data?.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center gap-3 px-3 py-2"
              data-testid="admin-user"
              data-email={u.email}
            >
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'truncate font-medium',
                    u.disabled && 'text-fg-subtle line-through',
                  )}
                >
                  {u.name} <span className="font-normal text-fg-muted">{u.email}</span>
                </div>
                <div className="text-[12px] text-fg-subtle">
                  {u.lastSeenAt
                    ? t('lastSeen', {
                        date: f.dateTime(new Date(u.lastSeenAt), { dateStyle: 'medium' }),
                      })
                    : t('neverSeen')}
                  {' · '}
                  {t('workspaces', { count: u.workspaces })}
                </div>
              </div>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={u.isAdmin}
                  disabled={u.id === me.user.id}
                  onChange={(e) => update.mutate({ id: u.id, body: { isAdmin: e.target.checked } })}
                />
                {t('isAdmin')}
              </label>
              <button
                type="button"
                disabled={u.id === me.user.id}
                onClick={() => update.mutate({ id: u.id, body: { disabled: !u.disabled } })}
                className="h-7 rounded-md border border-border px-2 hover:bg-hover disabled:opacity-40"
                data-testid="admin-user-toggle"
              >
                {u.disabled ? t('enable') : t('disable')}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
