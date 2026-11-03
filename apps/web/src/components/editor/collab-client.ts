'use client';

import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { pageDocName } from '@jotion/editor';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

let sharedSocket: HocuspocusProviderWebsocket | null = null;

function collabUrl(): string {
  const configured = process.env.NEXT_PUBLIC_COLLAB_URL;
  if (configured) return configured;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/collab`;
}

/** Ein WebSocket pro Tab, mehrere Dokumente werden darüber gebündelt. */
function socket(): HocuspocusProviderWebsocket {
  sharedSocket ??= new HocuspocusProviderWebsocket({
    url: collabUrl(),
    maxAttempts: 0,
    delay: 1000,
    minDelay: 1000,
    maxDelay: 10_000,
  });
  return sharedSocket;
}

export type SaveState = 'connecting' | 'saving' | 'saved' | 'offline' | 'readonly';

export interface PageSession {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** Lokale Kopie im Browser (IndexedDB). null, wenn nicht verfügbar (z. B. privater Modus). */
  local: IndexeddbPersistence | null;
  localReady: Promise<void>;
  destroy: () => void;
}

/**
 * Öffnet eine Seite: lokale Kopie laden, mit dem Server synchronisieren.
 * Änderungen landen sofort in IndexedDB und werden an den Server geschickt;
 * der Server bestätigt erst, wenn sie in der Datenbank liegen.
 */
export function openPageSession(pageId: string): PageSession {
  const doc = new Y.Doc();
  let local: IndexeddbPersistence | null = null;
  let localReady = Promise.resolve();
  try {
    local = new IndexeddbPersistence(`jotion:${pageDocName(pageId)}`, doc);
    localReady = local.whenSynced.then(() => undefined).catch(() => undefined);
  } catch {
    local = null;
  }
  const provider = new HocuspocusProvider({
    websocketProvider: socket(),
    name: pageDocName(pageId),
    document: doc,
    token: 'cookie',
  });
  provider.attach();
  return {
    doc,
    provider,
    local,
    localReady,
    destroy: () => {
      provider.destroy();
      void local?.destroy();
      doc.destroy();
    },
  };
}

/** Lokale Kopie einer Seite löschen (z. B. nach endgültigem Löschen). */
export async function clearLocalCopy(pageId: string): Promise<void> {
  try {
    const p = new IndexeddbPersistence(`jotion:${pageDocName(pageId)}`, new Y.Doc());
    await p.clearData();
  } catch {
    /* ignorieren */
  }
}
