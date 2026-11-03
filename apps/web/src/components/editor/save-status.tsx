'use client';

import { cn } from '@jotion/ui';
import { CloudOff, Eye, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { SaveState } from './collab-client';

const Ctx = createContext<{ state: SaveState; set: (s: SaveState) => void } | null>(null);

export function SaveStatusProvider({ children }: { children: ReactNode }) {
  const [state, set] = useState<SaveState>('connecting');
  return <Ctx.Provider value={{ state, set }}>{children}</Ctx.Provider>;
}

export const useSaveStatus = () => useContext(Ctx);

/** Leitet den Speicherstatus aus dem Provider ab und warnt beim Schließen mit offenen Änderungen. */
export function useTrackSaveState(
  provider: HocuspocusProvider | null,
  editable: boolean,
): SaveState {
  const ctx = useSaveStatus();
  const [state, setState] = useState<SaveState>('connecting');

  useEffect(() => {
    if (!provider) return;
    const compute = () => {
      let s: SaveState;
      const online = provider.isAuthenticated && provider.synced;
      if (!editable || provider.authorizedScope === 'readonly') s = 'readonly';
      else if (!online)
        s =
          navigator.onLine && provider.configuration.websocketProvider.status === 'connecting'
            ? 'connecting'
            : 'offline';
      else s = provider.hasUnsyncedChanges ? 'saving' : 'saved';
      setState(s);
      ctx?.set(s);
    };
    compute();
    const events = [
      'unsyncedChanges',
      'synced',
      'status',
      'authenticated',
      'close',
      'disconnect',
      'open',
    ] as const;
    for (const e of events) provider.on(e, compute);
    const ws = provider.configuration.websocketProvider;
    ws.on('status', compute);
    window.addEventListener('online', compute);
    window.addEventListener('offline', compute);
    const timer = setInterval(compute, 2000);

    // Nicht bestätigte Änderungen: Browser fragt vor dem Schließen nach
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (provider.hasUnsyncedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      for (const e of events) provider.off(e, compute);
      ws.off('status', compute);
      window.removeEventListener('online', compute);
      window.removeEventListener('offline', compute);
      window.removeEventListener('beforeunload', beforeUnload);
      clearInterval(timer);
    };
  }, [provider, editable, ctx]);

  return state;
}

export function SaveIndicator() {
  const t = useTranslations('editor');
  const ctx = useSaveStatus();
  const state = ctx?.state ?? 'saved';
  return (
    <span
      data-testid="save-status"
      data-state={state}
      className={cn(
        'flex items-center gap-1 text-[13px]',
        state === 'offline' ? 'text-[var(--c-orange)]' : 'text-fg-subtle',
      )}
      aria-live="polite"
    >
      {state === 'saving' && <Loader2 className="size-3.5 animate-spin" />}
      {state === 'offline' && <CloudOff className="size-3.5" />}
      {state === 'readonly' && <Eye className="size-3.5" />}
      {t(`status.${state}`)}
    </span>
  );
}
