import { useSyncExternalStore } from 'react';

/** Phase 12: Seitenleiste auf schmalen Bildschirmen ein- und ausklappen. */
let open = false;
const listeners = new Set<() => void>();

export function setMobileNav(value: boolean): void {
  if (open === value) return;
  open = value;
  for (const l of listeners) l();
}

export function useMobileNav(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => open,
    () => false,
  );
}
