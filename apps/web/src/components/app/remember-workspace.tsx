'use client';

import { useEffect } from 'react';

/** Merkt den zuletzt geöffneten Workspace für den Einstieg unter "/". */
export function RememberWorkspace({ ws }: { ws: string }) {
  useEffect(() => {
    document.cookie = `jotion-ws=${ws}; path=/; max-age=31536000; samesite=lax`;
  }, [ws]);
  return null;
}
