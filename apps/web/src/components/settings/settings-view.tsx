'use client';

import type {
  InvitationDto,
  MemberDto,
  ResetLinkDto,
  UserDto,
  WorkspaceRole,
  WorkspaceSummaryDto,
} from '@jotion/shared';
import { PASSWORD_MIN_LENGTH } from '@jotion/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@jotion/ui';
import { Copy, Link2, LogOut, Trash2, UserMinus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { useMe } from '../app/providers';
import { IconPicker } from '../page/icon-picker';
import { PageIcon } from '../page/page-icon';
import { Field, FormError } from '../ui/field';
import { IconButton } from '../ui/icon-button';
import { Tooltip } from '../ui/tooltip';

export type SettingsTab = 'account' | 'workspace' | 'members';
const TABS: SettingsTab[] = ['account', 'workspace', 'members'];

const primaryBtn =
  'h-8 rounded-md bg-accent px-3 text-[14px] font-medium text-white hover:bg-accent-hover disabled:opacity-50';
const secondaryBtn =
  'h-8 rounded-md border border-border px-3 text-[14px] hover:bg-hover disabled:opacity-50';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border py-6 first:pt-0 last:border-0">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {description && <p className="mt-1 text-[13px] text-fg-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SettingsView({ ws, tab }: { ws: string; tab: SettingsTab }) {
  const t = useTranslations('settings');
  const router = useRouter();
  return (
    <div className="mx-auto flex w-full max-w-[880px] gap-10 px-6 py-10 sm:px-12">
      <nav aria-label={t('title')} className="w-40 shrink-0">
        <h1 className="mb-3 px-2 text-[13px] font-medium text-fg-subtle">{t('title')}</h1>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => router.push(`/w/${ws}/settings/${id}`)}
            className={cn(
              'flex h-[30px] w-full items-center rounded-md px-2 text-[14px]',
              tab === id ? 'bg-active font-medium text-fg' : 'text-fg-muted hover:bg-hover',
            )}
            aria-current={tab === id ? 'page' : undefined}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {tab === 'account' && <AccountSettings />}
        {tab === 'workspace' && <WorkspaceSettings ws={ws} />}
        {tab === 'members' && <MemberSettings ws={ws} />}
      </div>
    </div>
  );
}

function AccountSettings() {
  const t = useTranslations('settings');
  const me = useMe();
  const router = useRouter();
  const [name, setName] = useState(me.user.name);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);

  const saveName = useMutation({
    mutationFn: () => apiPatch<UserDto>('/auth/me', { name }),
    onSuccess: () => {
      toast.success(t('saved'));
      router.refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const changePw = useMutation({
    mutationFn: () => apiPost('/auth/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setPwError(null);
      toast.success(t('passwordChanged'));
    },
    onError: (e) => setPwError(errorMessage(e)),
  });

  return (
    <>
      <Section title={t('profile')}>
        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault();
            saveName.mutate();
          }}
          className="flex max-w-sm items-end gap-2"
        >
          <div className="flex-1">
            <Field
              label={t('name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </div>
          <button
            type="submit"
            className={secondaryBtn}
            disabled={saveName.isPending || !name.trim() || name === me.user.name}
          >
            {t('save')}
          </button>
        </form>
        <p className="mt-3 text-[13px] text-fg-muted">{t('emailInfo', { email: me.user.email })}</p>
      </Section>
      <Section title={t('changePassword')} description={t('changePasswordHint')}>
        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault();
            changePw.mutate();
          }}
          className="max-w-sm space-y-3"
        >
          <Field
            label={t('currentPassword')}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <Field
            label={t('newPassword')}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            minLength={PASSWORD_MIN_LENGTH}
            required
            hint={t('passwordHint', { min: PASSWORD_MIN_LENGTH })}
          />
          <FormError>{pwError}</FormError>
          <button type="submit" className={primaryBtn} disabled={changePw.isPending}>
            {t('changePassword')}
          </button>
        </form>
      </Section>
      <Section title={t('session')}>
        <button
          type="button"
          className={cn(secondaryBtn, 'inline-flex items-center gap-2')}
          onClick={() =>
            void apiPost('/auth/logout').finally(() => (window.location.href = '/login'))
          }
        >
          <LogOut className="size-4" />
          {t('logout')}
        </button>
      </Section>
    </>
  );
}

function WorkspaceSettings({ ws }: { ws: string }) {
  const t = useTranslations('settings');
  const me = useMe();
  const router = useRouter();
  const current = me.workspaces.find((w) => w.id === ws)!;
  const isOwner = current.role === 'OWNER';
  const [name, setName] = useState(current.name);
  const save = useMutation({
    mutationFn: (input: Partial<Pick<WorkspaceSummaryDto, 'name' | 'icon'>>) =>
      apiPatch(`/workspaces/${ws}`, input),
    onSuccess: () => {
      toast.success(t('saved'));
      router.refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Section title={t('workspaceSection')} description={isOwner ? undefined : t('onlyOwner')}>
      <div className="flex max-w-sm items-end gap-3">
        <IconPicker
          workspaceId={ws}
          hasIcon={!!current.icon}
          onSelect={(icon) => isOwner && save.mutate({ icon })}
        >
          <button
            type="button"
            disabled={!isOwner}
            aria-label={t('workspaceIcon')}
            className="flex size-9 items-center justify-center rounded-md border border-border hover:bg-hover disabled:opacity-60"
          >
            <PageIcon icon={current.icon} size={22} />
          </button>
        </IconPicker>
        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ name });
          }}
          className="flex flex-1 items-end gap-2"
        >
          <div className="flex-1">
            <Field
              label={t('workspaceName')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner}
              required
              maxLength={100}
            />
          </div>
          {isOwner && (
            <button
              type="submit"
              className={secondaryBtn}
              disabled={save.isPending || !name.trim() || name === current.name}
            >
              {t('save')}
            </button>
          )}
        </form>
      </div>
    </Section>
  );
}

function MemberSettings({ ws }: { ws: string }) {
  const t = useTranslations('settings');
  const locale = useLocale();
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const isOwner = me.workspaces.find((w) => w.id === ws)?.role === 'OWNER';
  const members = useQuery({
    queryKey: qk.members(ws),
    queryFn: () => apiGet<MemberDto[]>(`/workspaces/${ws}/members`),
  });
  const invitations = useQuery({
    queryKey: qk.invitations(ws),
    queryFn: () => apiGet<InvitationDto[]>(`/workspaces/${ws}/invitations`),
    enabled: isOwner,
  });
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('MEMBER');
  const [maxUses, setMaxUses] = useState(1);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<{ name: string; link: ResetLinkDto } | null>(null);
  const onError = (e: unknown) => toast.error(errorMessage(e));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.members(ws) });
    void qc.invalidateQueries({ queryKey: qk.invitations(ws) });
  };

  const createInvite = useMutation({
    mutationFn: () =>
      apiPost<InvitationDto>(`/workspaces/${ws}/invitations`, { role: inviteRole, maxUses }),
    onSuccess: (inv) => {
      setNewLink(inv.url ?? null);
      refresh();
    },
    onError,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete(`/workspaces/${ws}/invitations/${id}`),
    onSuccess: refresh,
    onError,
  });
  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      apiPatch(`/workspaces/${ws}/members/${userId}`, { role }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => apiDelete(`/workspaces/${ws}/members/${userId}`),
    onSuccess: (_d, userId) => {
      if (userId === me.user.id) {
        router.push('/');
        router.refresh();
      } else refresh();
    },
    onError,
  });
  const createReset = useMutation({
    mutationFn: (m: MemberDto) =>
      apiPost<ResetLinkDto>(`/workspaces/${ws}/members/${m.userId}/reset-link`).then((link) => ({
        name: m.name,
        link,
      })),
    onSuccess: setResetLink,
    onError,
  });

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(t('copied'));
  };

  return (
    <>
      {isOwner && (
        <Section title={t('invite')} description={t('inviteHint')}>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-fg-muted">
                {t('inviteRole')}
              </span>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                className="h-9 rounded-md border border-border bg-bg px-2 text-[14px]"
              >
                <option value="MEMBER">{t('role.MEMBER')}</option>
                <option value="OWNER">{t('role.OWNER')}</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-fg-muted">
                {t('inviteMaxUses')}
              </span>
              <input
                type="number"
                min={1}
                max={50}
                value={maxUses}
                onChange={(e) => setMaxUses(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                className="h-9 w-20 rounded-md border border-border bg-bg px-2 text-[14px]"
              />
            </label>
            <button
              type="button"
              className={cn(primaryBtn, 'inline-flex h-9 items-center gap-2')}
              onClick={() => createInvite.mutate()}
              disabled={createInvite.isPending}
              data-testid="create-invite"
            >
              <Link2 className="size-4" />
              {t('createInvite')}
            </button>
          </div>
          {newLink && (
            <div className="mt-3 flex items-center gap-2 rounded-md bg-[var(--cb-green)] p-2">
              <code className="min-w-0 flex-1 truncate text-[13px]" data-testid="invite-link">
                {newLink}
              </code>
              <button
                type="button"
                className={cn(secondaryBtn, 'inline-flex items-center gap-1 bg-bg')}
                onClick={() => void copy(newLink)}
              >
                <Copy className="size-3.5" />
                {t('copy')}
              </button>
            </div>
          )}
          {(invitations.data?.length ?? 0) > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-[12px] font-medium text-fg-subtle">
                {t('activeInvites')}
              </div>
              {invitations.data!.map((inv) => (
                <div key={inv.id} className="flex h-9 items-center gap-2 text-[14px]">
                  <span className="rounded bg-hover px-1.5 py-0.5 text-[12px]">
                    {t(`role.${inv.role}`)}
                  </span>
                  <span className="text-fg-muted">
                    {t('inviteUses', { uses: inv.uses, max: inv.maxUses })}
                  </span>
                  <span className="text-fg-subtle">
                    {t('inviteExpiresAt', {
                      date: new Date(inv.expiresAt).toLocaleDateString(locale),
                    })}
                  </span>
                  <button
                    type="button"
                    className="ml-auto rounded-md px-2 py-1 text-[13px] text-fg-muted hover:bg-hover"
                    onClick={() => revoke.mutate(inv.id)}
                  >
                    {t('revoke')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <Section title={t('membersTitle', { count: members.data?.length ?? 0 })}>
        <div className="divide-y divide-border">
          {members.data?.map((m) => {
            const self = m.userId === me.user.id;
            return (
              <div key={m.userId} className="flex items-center gap-3 py-2" data-testid="member-row">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-active text-[13px] font-medium">
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px]">
                    {m.name}
                    {self && <span className="ml-1 text-fg-subtle">({t('you')})</span>}
                  </div>
                  <div className="truncate text-[12px] text-fg-subtle">{m.email}</div>
                </div>
                {isOwner ? (
                  <select
                    value={m.role}
                    onChange={(e) =>
                      changeRole.mutate({ userId: m.userId, role: e.target.value as WorkspaceRole })
                    }
                    className="h-8 rounded-md border border-border bg-bg px-2 text-[13px]"
                    aria-label={t('inviteRole')}
                  >
                    <option value="MEMBER">{t('role.MEMBER')}</option>
                    <option value="OWNER">{t('role.OWNER')}</option>
                  </select>
                ) : (
                  <span className="text-[13px] text-fg-muted">{t(`role.${m.role}`)}</span>
                )}
                {isOwner && !self && (
                  <Tooltip label={t('resetLink')}>
                    <IconButton aria-label={t('resetLink')} onClick={() => createReset.mutate(m)}>
                      <Link2 />
                    </IconButton>
                  </Tooltip>
                )}
                {(isOwner || self) && (
                  <Tooltip label={self ? t('leaveWorkspace') : t('removeMember')}>
                    <IconButton
                      aria-label={self ? t('leaveWorkspace') : t('removeMember')}
                      onClick={() => {
                        if (
                          window.confirm(
                            self ? t('confirmLeave') : t('confirmRemove', { name: m.name }),
                          )
                        )
                          remove.mutate(m.userId);
                      }}
                    >
                      {self ? <UserMinus /> : <Trash2 />}
                    </IconButton>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>
        {resetLink && (
          <div className="mt-3 rounded-md bg-[var(--cb-yellow)] p-3 text-[13px]">
            <p>{t('resetLinkCreated', { name: resetLink.name })}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate">{resetLink.link.url}</code>
              <button
                type="button"
                className={cn(secondaryBtn, 'inline-flex items-center gap-1 bg-bg')}
                onClick={() => void copy(resetLink.link.url)}
              >
                <Copy className="size-3.5" />
                {t('copy')}
              </button>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
