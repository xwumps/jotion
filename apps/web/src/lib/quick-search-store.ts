'use client';

import { useSyncExternalStore } from 'react';

type State =
  | { open: false }
  | { open: true; mode: 'open' }
  | { open: true; mode: 'pick'; resolve: (id: string | null) => void };

let state: State = { open: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openQuickSearch(): void {
  state = { open: true, mode: 'open' };
  emit();
}

/** Öffnet die Suche als Seitenauswahl und liefert die gewählte Seite (oder null bei Abbruch). */
export function pickPage(): Promise<string | null> {
  return new Promise((resolve) => {
    if (state.open && state.mode === 'pick') state.resolve(null);
    state = { open: true, mode: 'pick', resolve };
    emit();
  });
}

export function closeQuickSearch(pickedId: string | null = null): void {
  if (state.open && state.mode === 'pick') state.resolve(pickedId);
  state = { open: false };
  emit();
}

export function useQuickSearch(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}
