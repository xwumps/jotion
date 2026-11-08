import type { PublicPageDto } from '@jotion/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PublicPageView } from '@/components/page/public-page-view';

export const dynamic = 'force-dynamic';

async function load(token: string, page?: string): Promise<PublicPageDto | null> {
  const q = page ? `?page=${encodeURIComponent(page)}` : '';
  try {
    const res = await fetch(
      `${process.env.API_INTERNAL_URL ?? 'http://localhost:4000'}/api/share/${encodeURIComponent(token)}${q}`,
      { cache: 'no-store' },
    );
    return res.ok ? ((await res.json()) as PublicPageDto) : null;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  // Titel nicht in Metadaten: Vorschau-Crawler sollen keine Inhalte sehen
  return { title: (await getTranslations('sharing'))('publicTitle'), robots: { index: false } };
}

/** Phase 10: Leseansicht über einen Lese-Link (ohne Konto). */
export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { token } = await params;
  const { page } = await searchParams;
  const data = await load(token, typeof page === 'string' ? page : undefined);
  const t = await getTranslations('sharing');
  if (!data)
    return (
      <div
        className="flex h-dvh items-center justify-center text-[14px] text-fg-muted"
        data-testid="public-not-found"
      >
        {t('publicNotFound')}
      </div>
    );
  return <PublicPageView token={token} data={data} />;
}
