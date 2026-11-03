import type { InvitationPreviewDto } from '@jotion/shared';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { InviteView } from '@/components/auth/invite-view';
import { getMe } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('inviteMetaTitle') };
}

async function preview(token: string): Promise<InvitationPreviewDto | null> {
  try {
    const res = await fetch(
      `${process.env.API_INTERNAL_URL ?? 'http://localhost:4000'}/api/auth/invitations/${encodeURIComponent(token)}`,
      { cache: 'no-store' },
    );
    return res.ok ? ((await res.json()) as InvitationPreviewDto) : null;
  } catch {
    return null;
  }
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [p, me] = await Promise.all([preview(token), getMe()]);
  return <InviteView token={token} preview={p} me={me} />;
}
