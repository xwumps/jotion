'use server';

import { isLocale } from '@jotion/shared';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE } from '@/i18n/request';

export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}
