import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';
import { getMe, getSetupStatus } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('loginTitle') };
}

export default async function LoginPage() {
  const status = await getSetupStatus();
  if (status?.setupRequired) redirect('/setup');
  if (await getMe()) redirect('/');
  const t = await getTranslations('auth');
  return (
    <AuthShell title={t('loginTitle')}>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="mt-6 text-center text-[13px] text-fg-subtle">{t('noAccount')}</p>
    </AuthShell>
  );
}
