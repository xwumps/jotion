'use client';

import { cn } from '@jotion/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

const OPTIONS = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
] as const;

const subscribe = () => () => {};

/** Dreifach-Umschalter Hell / Dunkel / System. */
export function ThemeSwitch() {
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();
  // Erst nach Hydration den aktiven Zustand zeigen (Theme ist serverseitig unbekannt)
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return (
    <div role="radiogroup" aria-label={t('label')} className="flex rounded-md bg-hover p-0.5">
      {OPTIONS.map(({ value, icon: Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={t(value)}
            onClick={() => setTheme(value)}
            className={cn(
              'flex h-6 flex-1 items-center justify-center rounded-[5px] text-fg-muted transition-colors',
              active ? 'bg-bg text-fg shadow-sm' : 'hover:text-fg',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="sr-only">{t(value)}</span>
          </button>
        );
      })}
    </div>
  );
}
