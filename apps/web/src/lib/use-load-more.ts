'use client';

import { useEffect, useRef, useState } from 'react';

interface Pager {
  hasNextPage: boolean;
  isFetching: boolean;
  fetchNextPage: () => Promise<unknown>;
}

/**
 * Lädt die nächste Seite, solange das zurückgegebene Element (am Ende einer Liste) sichtbar
 * ist. Die Sichtbarkeit wird als Zustand gehalten: Fällt sie in ein laufendes Neuladen
 * (z. B. nach dem Verschieben einer Karte), wird danach nachgeladen statt gar nicht.
 */
export function useLoadMore({ hasNextPage, isFetching, fetchNextPage }: Pager) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasNextPage) return setVisible(false);
    const io = new IntersectionObserver((e) => setVisible(e.some((x) => x.isIntersecting)), {
      rootMargin: '200px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage]);
  useEffect(() => {
    if (visible && hasNextPage && !isFetching) void fetchNextPage();
  }, [visible, hasNextPage, isFetching, fetchNextPage]);
  return ref;
}
