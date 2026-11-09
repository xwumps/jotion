'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { setMobileNav } from '@/lib/mobile-nav-store';
import { useMe } from './providers';

/** Phase 12: Kopfzeile auf schmalen Bildschirmen mit Menü-Knopf für die Seitenleiste. */
export function MobileBar({ ws }: { ws: string }) {
  const t = useTranslations('sidebar');
  const me = useMe();
  const name = me.workspaces.find((w) => w.id === ws)?.name ?? '';
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2 md:hidden print:hidden">
      <button
        type="button"
        onClick={() => setMobileNav(true)}
        aria-label={t('openMenu')}
        className="rounded-md p-1.5 text-fg-muted hover:bg-hover"
        data-testid="mobile-menu"
      >
        <Menu className="size-5" />
      </button>
      <span className="truncate text-[14px] font-medium">{name}</span>
    </div>
  );
}
