import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getMe, getSetupStatus } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Einstieg: Ersteinrichtung, Login oder zuletzt genutzter Workspace. */
export default async function RootPage() {
  const status = await getSetupStatus();
  if (status?.setupRequired) redirect('/setup');
  const me = await getMe();
  if (!me) redirect('/login');
  const last = (await cookies()).get('jotion-ws')?.value;
  const target = me.workspaces.find((w) => w.id === last) ?? me.workspaces[0];
  if (!target) redirect('/start');
  redirect(`/w/${target.id}`);
}
