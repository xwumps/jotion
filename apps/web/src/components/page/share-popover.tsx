'use client';

import {
  PERMISSION_LEVELS,
  type PageDto,
  type PermissionLevel,
  type SharingDto,
} from '@jotion/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Link2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPost, apiPut, errorMessage } from '@/lib/api-client';
import { invalidateTree } from '@/lib/hooks';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

const selectCls =
  'h-7 rounded-md border border-border bg-bg px-1.5 text-[13px] outline-none focus:border-accent disabled:opacity-60';

/**
 * Phase 10: Teilen. Stufe für alle Mitglieder (Team-Seiten), Angaben je Mitglied (vererbt an
 * Unterseiten) und Lese-Link für Personen ohne Konto.
 */
export function SharePopover({ page }: { page: PageDto }) {
  const t = useTranslations('sharing');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [addUser, setAddUser] = useState('');
  const [addLevel, setAddLevel] = useState<PermissionLevel>('edit');
  const key = ['sharing', page.id] as const;
  const sharing = useQuery({
    queryKey: key,
    queryFn: () => apiGet<SharingDto>(`/pages/${page.id}/sharing`),
    enabled: open,
  });
  const done = (data?: SharingDto) => {
    if (data) qc.setQueryData(key, data);
    else void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['page', page.id] });
    invalidateTree(qc, page.workspaceId);
  };
  const set = useMutation({
    mutationFn: (body: { userId: string | null; level: PermissionLevel | null }) =>
      apiPut<SharingDto>(`/pages/${page.id}/permissions`, body),
    onSuccess: (d) => done(d),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const link = useMutation({
    mutationFn: (on: boolean) =>
      on ? apiPost(`/pages/${page.id}/share-link`) : apiDelete(`/pages/${page.id}/share-link`),
    onSuccess: () => done(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const d = sharing.data;
  const manage = d?.canManage ?? false;
  const own = d?.entries.filter((e) => e.userId) ?? [];
  const candidates =
    d?.members.filter((m) => !m.fixed && !own.some((e) => e.userId === m.userId && !e.inherited)) ??
    [];
  const levelLabel = (l: PermissionLevel) => t(`level.${l}`);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-7 rounded-md px-2 text-[14px] text-fg hover:bg-hover"
          data-testid="share-button"
        >
          {t('button')}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-3 text-fg" data-testid="share-popover">
        {!d ? (
          <p className="text-[13px] text-fg-muted">{t('loading')}</p>
        ) : (
          <div className="flex flex-col gap-3 text-[14px]">
            <p className="text-[12px] text-fg-subtle" data-testid="share-my-level">
              {t('yourLevel', { level: levelLabel(d.myLevel) })}
            </p>
            {d.scope === 'TEAM' && (
              <div className="flex items-center gap-2">
                <Users className="size-4 text-fg-muted" />
                <span className="flex-1">{t('allMembers')}</span>
                <select
                  className={selectCls}
                  value={d.general}
                  disabled={!manage}
                  onChange={(e) =>
                    set.mutate({ userId: null, level: e.target.value as PermissionLevel })
                  }
                  data-testid="share-general"
                >
                  {PERMISSION_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {levelLabel(l)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {own.length > 0 && (
              <ul className="flex flex-col gap-1.5" data-testid="share-entries">
                {own.map((e) => (
                  <li
                    key={`${e.userId}-${e.sourcePageId}`}
                    className="flex items-center gap-2"
                    data-testid="share-entry"
                    data-user={e.email ?? ''}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{e.name}</span>
                      {e.inherited && (
                        <span className="block truncate text-[12px] text-fg-subtle">
                          {t('inheritedFrom', { title: e.sourceTitle || t('untitled') })}
                        </span>
                      )}
                    </span>
                    <select
                      className={selectCls}
                      value={e.level}
                      disabled={!manage}
                      onChange={(ev) =>
                        set.mutate({ userId: e.userId, level: ev.target.value as PermissionLevel })
                      }
                      data-testid="share-entry-level"
                    >
                      {PERMISSION_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {levelLabel(l)}
                        </option>
                      ))}
                    </select>
                    {manage && !e.inherited && (
                      <button
                        type="button"
                        className="rounded px-1.5 text-[12px] text-fg-muted hover:bg-hover"
                        onClick={() => set.mutate({ userId: e.userId, level: null })}
                        data-testid="share-entry-remove"
                      >
                        {t('remove')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {manage && candidates.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  className={`${selectCls} min-w-0 flex-1`}
                  value={addUser}
                  onChange={(e) => setAddUser(e.target.value)}
                  data-testid="share-add-user"
                  aria-label={t('addMember')}
                >
                  <option value="">{t('addMember')}</option>
                  {candidates.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name} ({m.email})
                    </option>
                  ))}
                </select>
                <select
                  className={selectCls}
                  value={addLevel}
                  onChange={(e) => setAddLevel(e.target.value as PermissionLevel)}
                  data-testid="share-add-level"
                  aria-label={t('levelLabel')}
                >
                  {PERMISSION_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {levelLabel(l)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!addUser}
                  onClick={() => {
                    set.mutate({ userId: addUser, level: addLevel });
                    setAddUser('');
                  }}
                  className="h-7 rounded-md bg-accent px-2 text-[13px] text-white disabled:opacity-50"
                  data-testid="share-add"
                >
                  {t('add')}
                </button>
              </div>
            )}
            {!manage && <p className="text-[12px] text-fg-subtle">{t('noManage')}</p>}
            {manage && (
              <div className="border-t border-border pt-3">
                <label className="flex items-center gap-2">
                  <Globe className="size-4 text-fg-muted" />
                  <span className="flex-1">{t('publicLink')}</span>
                  <input
                    type="checkbox"
                    checked={!!d.shareLink}
                    onChange={(e) => link.mutate(e.target.checked)}
                    data-testid="share-link-toggle"
                  />
                </label>
                {d.shareLink && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      readOnly
                      value={d.shareLink.url}
                      className="h-7 min-w-0 flex-1 rounded-md border border-border bg-hover px-2 text-[12px]"
                      data-testid="share-link-url"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(d.shareLink!.url)
                          .then(() => toast.success(t('linkCopied')))
                      }
                      className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[12px] hover:bg-hover"
                    >
                      <Link2 className="size-3.5" />
                      {t('copy')}
                    </button>
                  </div>
                )}
                <p className="mt-1 text-[12px] text-fg-subtle">{t('publicLinkHint')}</p>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
