import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { SetupForm } from '@/components/auth/setup-form';
import { getSetupStatus } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('setupTitle') };
}

export default async function SetupPage() {
  const status = await getSetupStatus();
  if (status && !status.setupRequired) redirect('/login');
  const t = await getTranslations('auth');
  return (
    <AuthShell title={t('setupTitle')} intro={t('setupIntro')}>
      <SetupForm />
    </AuthShell>
  );
}
