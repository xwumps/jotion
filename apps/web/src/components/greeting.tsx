'use client';

import { useTranslations } from 'next-intl';

/** Tageszeitabhängige Begrüßung in der lokalen Zeit des Browsers. */
export function Greeting() {
  const t = useTranslations('home');
  const hour = new Date().getHours();
  const key = hour < 11 ? 'greetingMorning' : hour < 18 ? 'greetingDay' : 'greetingEvening';
  return <span suppressHydrationWarning>{t(key)}</span>;
}
