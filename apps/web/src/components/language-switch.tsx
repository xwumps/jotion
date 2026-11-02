'use client';

import { LOCALES } from '@jotion/shared';
import { cn } from '@jotion/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocale } from '@/lib/locale-actions';

export function LanguageSwitch() {
  const t = useTranslations('language');
  const current = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div role="radiogroup" aria-label={t('label')} className="flex rounded-md bg-hover p-0.5">
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          role="radio"
          aria-checked={current === locale}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await setLocale(locale);
              router.refresh();
            })
          }
          className={cn(
            'h-6 flex-1 rounded-[5px] text-[11px] font-medium uppercase tracking-wide transition-colors',
            current === locale ? 'bg-bg text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
          )}
        >
          {locale}
        </button>
      ))}
    </div>
  );
}
