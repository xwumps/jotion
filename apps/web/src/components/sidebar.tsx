import { JotionMark, cn } from '@jotion/ui';
import { ChevronsUpDown, Home, Inbox, Plus, Search, Settings, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { LanguageSwitch } from './language-switch';
import { ThemeSwitch } from './theme-switch';

interface NavItemProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  active?: boolean;
  disabledHint?: string;
  shortcut?: string;
}

function NavItem({ icon: Icon, label, href, active, disabledHint, shortcut }: NavItemProps) {
  const className = cn(
    'group flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[14px] text-fg-muted transition-colors',
    active ? 'bg-active font-medium text-fg' : 'hover:bg-hover',
    disabledHint && 'cursor-default',
  );
  const content = (
    <>
      <Icon className="size-[18px] shrink-0 opacity-80" />
      <span className="truncate">{label}</span>
      {shortcut && (
        <kbd className="ml-auto font-sans text-[11px] text-fg-subtle opacity-0 group-hover:opacity-100">
          {shortcut}
        </kbd>
      )}
    </>
  );
  if (href && !disabledHint) {
    return (
      <Link href={href} className={className} aria-current={active ? 'page' : undefined}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={className} title={disabledHint} aria-disabled="true">
      {content}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <div className="px-2 pb-1 text-[12px] font-medium text-fg-subtle">{title}</div>
      {children}
    </div>
  );
}

export function Sidebar({ active }: { active: 'home' }) {
  const t = useTranslations('sidebar');
  const soon = t('comingSoon');

  return (
    <aside
      aria-label="Sidebar"
      className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-bg-sidebar print:hidden"
    >
      <div className="px-2 pt-2">
        <button
          type="button"
          title={soon}
          className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
        >
          <span className="flex size-6 items-center justify-center rounded-[5px] bg-fg text-bg">
            <JotionMark className="size-4" />
          </span>
          <span className="truncate text-[14px] font-medium text-fg">{t('workspace')}</span>
          <ChevronsUpDown className="ml-auto size-3.5 text-fg-subtle" />
        </button>
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto px-2 pb-2">
        <div className="mt-1 space-y-px">
          <NavItem icon={Search} label={t('search')} shortcut="Ctrl K" disabledHint={soon} />
          <NavItem icon={Home} label={t('home')} href="/" active={active === 'home'} />
          <NavItem icon={Inbox} label={t('inbox')} disabledHint={soon} />
          <NavItem icon={Settings} label={t('settings')} disabledHint={soon} />
        </div>

        <Section title={t('private')}>
          <p className="px-2 py-1 text-[13px] text-fg-subtle">{t('emptyTree')}</p>
          <NavItem icon={Plus} label={t('newPage')} disabledHint={soon} />
        </Section>

        <Section title={t('team')}>
          <p className="px-2 py-1 text-[13px] text-fg-subtle">{t('emptyTree')}</p>
        </Section>

        <div className="mt-auto space-y-px pt-4">
          <NavItem icon={Trash2} label={t('trash')} disabledHint={soon} />
        </div>
      </nav>

      <div className="space-y-1.5 border-t border-border p-2">
        <ThemeSwitch />
        <LanguageSwitch />
      </div>
    </aside>
  );
}
