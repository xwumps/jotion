import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppProviders } from '@/components/app/providers';
import { RememberWorkspace } from '@/components/app/remember-workspace';
import { Sidebar } from '@/components/app/sidebar';
import { getMe } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const me = await getMe();
  if (!me) redirect(`/login?next=/w/${workspaceId}`);
  if (!me.workspaces.some((w) => w.id === workspaceId)) notFound();

  return (
    <AppProviders me={me}>
      <RememberWorkspace ws={workspaceId} />
      <div className="flex h-dvh">
        <Sidebar ws={workspaceId} />
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </AppProviders>
  );
}
