import { PageView } from '@/components/page/page-view';

export default async function PageRoute({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  return <PageView pageId={pageId} />;
}
