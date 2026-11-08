import { useSyncExternalStore } from 'react';

/** Phase 10: Wer ist gerade auf einer Seite (aus dem Awareness-Zustand des Editors). */
export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
}

const state = new Map<string, PresenceUser[]>();
const listeners = new Set<() => void>();
const EMPTY: PresenceUser[] = [];

export function setPresence(pageId: string, users: PresenceUser[]): void {
  if (users.length) state.set(pageId, users);
  else state.delete(pageId);
  for (const l of listeners) l();
}

export function usePresence(pageId: string): PresenceUser[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.get(pageId) ?? EMPTY,
    () => EMPTY,
  );
}

const COLORS = [
  '#e03e3e',
  '#d9730d',
  '#cb912f',
  '#448361',
  '#337ea9',
  '#9065b0',
  '#c14c8a',
  '#64473a',
];

/** Feste Farbe je Nutzer (gleich in allen Tabs und für alle Betrachter) */
export function userColor(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}
