import { Button, JotionLogo } from '@jotion/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('login');
  return { title: t('title') };
}

const inputClass =
  'h-9 w-full rounded-md border border-border bg-bg px-2.5 text-[14px] outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60';

export default async function LoginPage() {
  const t = await getTranslations('login');
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="w-full max-w-[320px]">
        <div className="mb-8 flex justify-center">
          <JotionLogo className="[&_svg]:size-8 [&>span]:text-[22px]" />
        </div>
        <h1 className="mb-6 text-center text-[22px] font-semibold tracking-[-0.01em]">
          {t('title')}
        </h1>
        <form className="space-y-3" aria-describedby="login-notice">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-fg-muted">{t('email')}</span>
            <input
              type="email"
              disabled
              placeholder={t('emailPlaceholder')}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-fg-muted">
              {t('password')}
            </span>
            <input type="password" disabled className={inputClass} />
          </label>
          <Button type="submit" variant="primary" disabled className="w-full">
            {t('submit')}
          </Button>
        </form>
        <p id="login-notice" className="mt-4 text-center text-[13px] text-fg-muted">
          {t('notice')}
        </p>
        <p className="mt-6 text-center">
          <Link href="/" className="text-[13px] text-fg-muted underline-offset-2 hover:underline">
            {t('back')}
          </Link>
        </p>
      </div>
    </main>
  );
}
