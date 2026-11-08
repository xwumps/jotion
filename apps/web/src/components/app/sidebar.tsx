'use client';

import { cn } from '@jotion/ui';
import { Home, Inbox, LayoutTemplate, Search, Settings, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ComponentType } from 'react';
import { pageHref } from '@/lib/format';
import { openQuickSearch } from '@/lib/quick-search-store';
import { useFavorites, usePageActions, useRealtime, useSidebar } from '@/lib/hooks';
import { LanguageSwitch } from '../language-switch';
import { PageIcon } from '../page/page-icon';
import { ThemeSwitch } from '../theme-switch';
import { PageTreeDnd, SharedSection, TreeSection } from './page-tree';
import { QuickSearch } from './quick-search';
import { ShortcutsDialog } from './shortcuts-dialog';
import { TemplateGallery } from './template-gallery';
import { TrashDialog } from './trash-dialog';
import { WorkspaceSwitcher } from './workspace-switcher';

function NavItem({
  icon: Icon,
  label,
  href,
  active,
  onClick,
  disabledHint,
  testId,
  shortcut,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  active?: boolean;
  onClick?: () => void;
  disabledHint?: string;
  testId?: string;
  shortcut?: string;
}) {
  const className = cn(
    'flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[14px] text-fg-muted transition-colors',
    active ? 'bg-active font-medium text-fg' : 'hover:bg-hover',
    disabledHint && 'cursor-default opacity-70',
  );
  const inner = (
    <>
      <Icon className="size-[18px] shrink-0 opacity-80" />
      <span className="truncate">{label}</span>
      {shortcut && <kbd className="ml-auto font-sans text-[11px] text-fg-subtle">{shortcut}</kbd>}
    </>
  );
  if (href)
    return (
      <Link
        href={href}
        className={className}
        aria-current={active ? 'page' : undefined}
        data-testid={testId}
      >
        {inner}
      </Link>
    );
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      title={disabledHint}
      aria-disabled={disabledHint ? true : undefined}
      data-testid={testId}
    >
      {inner}
    </button>
  );
}

export function Sidebar({ ws }: { ws: string }) {
  const t = useTranslations('sidebar');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const sidebar = useSidebar(ws);
  const favorites = useFavorites(ws);
  const { create } = usePageActions(ws);
  const [trashOpen, setTrashOpen] = useState(false);
  const [gallery, setGallery] = useState(false);
  useRealtime(ws);

  return (
    <aside
      aria-label="Sidebar"
      className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-bg-sidebar print:hidden"
    >
      <div className="px-2 pt-2">
        <WorkspaceSwitcher ws={ws} />
      </div>
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        <div className="mt-1 space-y-px">
          <NavItem
            icon={Search}
            label={t('search')}
            onClick={openQuickSearch}
            testId="nav-search"
            shortcut="Strg K"
          />
          <NavItem
            icon={Home}
            label={t('home')}
            href={`/w/${ws}`}
            active={pathname === `/w/${ws}`}
            testId="nav-home"
          />
          <NavItem icon={Inbox} label={t('inbox')} disabledHint={t('comingSoon')} />
          <NavItem
            icon={LayoutTemplate}
            label={t('templates')}
            onClick={() => setGallery(true)}
            testId="nav-templates"
          />
          <NavItem
            icon={Settings}
            label={t('settings')}
            href={`/w/${ws}/settings`}
            active={pathname.startsWith(`/w/${ws}/settings`)}
            testId="nav-settings"
          />
        </div>

        {(favorites.data?.length ?? 0) > 0 && (
          <div className="mt-4">
            <div className="flex h-[26px] items-center gap-1 px-2 text-[12px] font-medium text-fg-subtle">
              <Star className="size-3" />
              {t('favorites')}
            </div>
            {favorites.data!.map((f) => {
              const active = pathname === pageHref(ws, f.id);
              return (
                <Link
                  key={f.id}
                  href={pageHref(ws, f.id)}
                  className={cn(
                    'flex h-[30px] items-center gap-2 rounded-md px-2 text-[14px] text-fg-muted',
                    active ? 'bg-active font-medium text-fg' : 'hover:bg-hover',
                  )}
                >
                  <PageIcon icon={f.icon} />
                  <span className="truncate">{f.title || tc('untitled')}</span>
                </Link>
              );
            })}
          </div>
        )}

        <PageTreeDnd ws={ws}>
          <TreeSection
            scope="TEAM"
            title={t('team')}
            nodes={sidebar.data?.team ?? []}
            onAdd={() => create.mutate({ scope: 'TEAM' })}
          />
          <TreeSection
            scope="PRIVATE"
            title={t('private')}
            nodes={sidebar.data?.private ?? []}
            onAdd={() => create.mutate({ scope: 'PRIVATE' })}
          />
          <SharedSection title={t('shared')} nodes={sidebar.data?.shared ?? []} />
        </PageTreeDnd>

        <div className="mt-auto pt-4">
          <NavItem
            icon={Trash2}
            label={t('trash')}
            onClick={() => setTrashOpen(true)}
            testId="nav-trash"
          />
        </div>
      </nav>
      <div className="space-y-1.5 border-t border-border p-2">
        <ThemeSwitch />
        <LanguageSwitch />
      </div>
      <TrashDialog ws={ws} open={trashOpen} onOpenChange={setTrashOpen} />
      <TemplateGallery ws={ws} open={gallery} onOpenChange={setGallery} />
      <QuickSearch ws={ws} />
      <ShortcutsDialog />
    </aside>
  );
}
