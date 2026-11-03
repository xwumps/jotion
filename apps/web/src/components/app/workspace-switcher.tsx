'use client';

import { JotionMark } from '@jotion/ui';
import { Check, ChevronsUpDown, LogOut, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import type { WorkspaceSummaryDto } from '@jotion/shared';
import { apiPost, errorMessage } from '@/lib/api-client';
import { Dialog, DialogContent } from '../ui/dialog';
import { Field } from '../ui/field';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../ui/menu';
import { PageIcon } from '../page/page-icon';
import { useMe } from './providers';

function WorkspaceAvatar({
  ws,
  size = 22,
}: {
  ws: WorkspaceSummaryDto | undefined;
  size?: number;
}) {
  if (ws?.icon) return <PageIcon icon={ws.icon} size={size - 2} />;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[5px] bg-fg text-bg"
      style={{ width: size, height: size }}
    >
      <JotionMark className="size-[70%]" />
    </span>
  );
}

export function WorkspaceSwitcher({ ws }: { ws: string }) {
  const t = useTranslations('sidebar');
  const me = useMe();
  const router = useRouter();
  const current = me.workspaces.find((w) => w.id === ws);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    await apiPost('/auth/logout').catch(() => undefined);
    window.location.href = '/login';
  };

  const create = async () => {
    setBusy(true);
    try {
      const w = await apiPost<WorkspaceSummaryDto>('/workspaces', { name });
      setCreating(false);
      setName('');
      router.push(`/w/${w.id}`);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-hover data-[state=open]:bg-hover"
            data-testid="workspace-switcher"
          >
            <WorkspaceAvatar ws={current} />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">
              {current?.name}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-fg-subtle" />
          </button>
        </MenuTrigger>
        <MenuContent className="w-[260px]">
          <MenuLabel>{me.user.email}</MenuLabel>
          {me.workspaces.map((w) => (
            <MenuItem key={w.id} onSelect={() => router.push(`/w/${w.id}`)}>
              <span className="flex items-center gap-2">
                <WorkspaceAvatar ws={w} size={20} />
                <span className="truncate">{w.name}</span>
                {w.id === ws && <Check className="ml-auto size-4" />}
              </span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon={Plus} onSelect={() => setCreating(true)}>
            {t('newWorkspace')}
          </MenuItem>
          <MenuItem icon={LogOut} onSelect={() => void logout()}>
            {t('logout')}
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title={t('newWorkspace')} description={t('newWorkspaceHint')}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
            className="space-y-4"
          >
            <Field
              label={t('workspaceName')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="h-8 rounded-md px-3 text-[14px] text-fg-muted hover:bg-hover"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={busy || !name.trim()}
                className="h-8 rounded-md bg-accent px-3 text-[14px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {t('create')}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
