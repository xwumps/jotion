import { HomeView } from '@/components/app/home-view';
import { SystemStatus } from '@/components/system-status';
import { fetchSystemHealth } from '@/lib/api';

export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const report = await fetchSystemHealth();
  return <HomeView ws={workspaceId} status={<SystemStatus report={report} />} />;
}
