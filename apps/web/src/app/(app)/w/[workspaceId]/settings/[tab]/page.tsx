import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { SettingsView, type SettingsTab } from '@/components/settings/settings-view';

const TABS = new Set<SettingsTab>(['account', 'workspace', 'members', 'integrations']);

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('title') };
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string; tab: string }>;
}) {
  const { workspaceId, tab } = await params;
  if (!TABS.has(tab as SettingsTab)) notFound();
  return <SettingsView ws={workspaceId} tab={tab as SettingsTab} />;
}
