import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetForm } from '@/components/auth/reset-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('resetTitle') };
}

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations('auth');
  return (
    <AuthShell title={t('resetTitle')} intro={t('resetIntro')}>
      <ResetForm token={token} />
    </AuthShell>
  );
}
