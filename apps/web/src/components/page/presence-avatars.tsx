'use client';

import { useTranslations } from 'next-intl';
import { usePresence } from '@/lib/presence-store';
import { useMe } from '../app/providers';

/** Phase 10: Personen, die die Seite gerade geöffnet haben (ohne einen selbst). */
export function PresenceAvatars({ pageId }: { pageId: string }) {
  const t = useTranslations('presence');
  const me = useMe();
  const others = usePresence(pageId).filter((u) => u.userId !== me.user.id);
  if (!others.length) return null;
  const shown = others.slice(0, 4);
  return (
    <div
      className="flex items-center -space-x-1.5"
      aria-label={t('label', { names: others.map((o) => o.name).join(', ') })}
      data-testid="presence"
    >
      {shown.map((u) => (
        <span
          key={u.userId}
          title={u.name}
          className="flex size-6 items-center justify-center rounded-full border-2 border-bg text-[11px] font-medium text-white"
          style={{ background: u.color }}
          data-testid="presence-avatar"
          data-name={u.name}
        >
          {u.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {others.length > shown.length && (
        <span className="flex size-6 items-center justify-center rounded-full border-2 border-bg bg-active text-[10px] text-fg-muted">
          +{others.length - shown.length}
        </span>
      )}
    </div>
  );
}
