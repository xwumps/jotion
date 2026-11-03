import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';

// Hocuspocus-Nachrichtentypen (siehe @hocuspocus/server MessageType)
const MESSAGE_SYNC = 0;
const MESSAGE_SYNC_REPLY = 4;
// y-protocols/sync
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

/**
 * Liest aus einer eingehenden Hocuspocus-Nachricht ein Dokument-Update, falls enthalten.
 * Wirft bei beschädigten Updates, damit sie weder gespeichert noch angewendet werden.
 */
export function extractDocumentUpdate(message: Uint8Array): Uint8Array | null {
  const decoder = decoding.createDecoder(message);
  decoding.readVarString(decoder); // Dokumentname
  const type = decoding.readVarUint(decoder);
  if (type !== MESSAGE_SYNC && type !== MESSAGE_SYNC_REPLY) return null;
  const syncType = decoding.readVarUint(decoder);
  if (syncType !== SYNC_STEP_2 && syncType !== SYNC_UPDATE) return null;
  const update = decoding.readVarUint8Array(decoder);
  // Struktur prüfen (wirft bei Müll)
  const decoded = Y.decodeUpdate(update);
  if (decoded.structs.length === 0 && decoded.ds.clients.size === 0) return null; // leeres Update
  return update;
}
