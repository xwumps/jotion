import { redirect } from 'next/navigation';
import { AppProviders } from '@/components/app/providers';
import { PrintView } from '@/components/page/print-view';
import { getMe } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

/** Druckansicht einer Seite (Browser-Druck, "Als PDF speichern"). */
export default async function PrintRoute({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const me = await getMe();
  if (!me) redirect(`/login?next=/print/${pageId}`);
  return (
    <AppProviders me={me}>
      <PrintView pageId={pageId} />
    </AppProviders>
  );
}
