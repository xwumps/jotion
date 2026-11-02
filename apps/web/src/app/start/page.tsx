import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { CreateWorkspaceForm } from '@/components/auth/create-workspace-form';
import { getMe } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Für Konten ohne Workspace (z. B. nach dem Austreten). */
export default async function StartPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.workspaces[0]) redirect(`/w/${me.workspaces[0].id}`);
  const t = await getTranslations('auth');
  return (
    <AuthShell title={t('startTitle')} intro={t('startIntro')}>
      <CreateWorkspaceForm />
    </AuthShell>
  );
}
