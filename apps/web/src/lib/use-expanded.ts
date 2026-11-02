'use client';

import { useCallback, useEffect, useState } from 'react';

/** Aufgeklappte Seiten der Sidebar, je Workspace im Browser gemerkt. */
export function useExpanded(ws: string) {
  const key = `jotion:expanded:${ws}`;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setExpanded(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* Speicher nicht verfügbar */
    }
  }, [key]);

  const persist = useCallback(
    (next: Set<string>) => {
      try {
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        /* ignorieren */
      }
    },
    [key],
  );

  const toggle = useCallback(
    (id: string, open?: boolean) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        const shouldOpen = open ?? !next.has(id);
        if (shouldOpen) next.add(id);
        else next.delete(id);
        persist(next);
        return next;
      }),
    [persist],
  );

  return { expanded, toggle };
}
