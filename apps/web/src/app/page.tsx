import { Database, FileText, LogIn } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Greeting } from '@/components/greeting';
import { Sidebar } from '@/components/sidebar';
import { SystemStatus } from '@/components/system-status';
import { fetchSystemHealth } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const t = await getTranslations('home');
  const report = await fetchSystemHealth();

  const roadmap = [
    { icon: LogIn, text: t('roadmap.auth') },
    { icon: FileText, text: t('roadmap.editor') },
    { icon: Database, text: t('roadmap.databases') },
  ];

  return (
    <div className="flex h-dvh">
      <Sidebar active="home" />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-6 pb-24 pt-[12vh] sm:px-12">
          <div className="mb-4 text-5xl" aria-hidden>
            👋
          </div>
          <h1 className="text-[40px] font-bold leading-tight tracking-[-0.02em]">
            <Greeting />
          </h1>
          <p className="mt-3 text-[16px] leading-relaxed text-fg-muted">{t('intro')}</p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <SystemStatus report={report} />
            <section className="rounded-lg border border-border p-4">
              <h2 className="text-[13px] font-medium text-fg-muted">{t('roadmapTitle')}</h2>
              <ul className="mt-3 space-y-2.5">
                {roadmap.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-2.5 text-[14px]">
                    <Icon className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                    {text}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
