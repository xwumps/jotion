/**
 * Prüfungen für URLs in Knotenattributen. Attribute kommen aus dem Yjs-Dokument und damit
 * potenziell von jedem Client: Beim Darstellen immer erneut prüfen, nie gespeicherten Werten trauen.
 */

const FILE_URL_RE = /^\/api\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Datei aus dem eigenen Speicher (`/api/files/<uuid>`) */
export function isFileUrl(src: unknown): src is string {
  return typeof src === 'string' && FILE_URL_RE.test(src);
}

/** Datei-ID aus einer eigenen Datei-URL */
export function fileIdFromUrl(src: unknown): string | null {
  return isFileUrl(src) ? src.slice('/api/files/'.length).toLowerCase() : null;
}

/** Externe http(s)-URL ohne Zugangsdaten, sonst null. */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Quelle für Bild, Video, Audio, Datei, PDF: eigene Datei oder externe http(s)-URL. */
export function safeMediaSrc(src: unknown): string | null {
  if (isFileUrl(src)) return src;
  return safeExternalUrl(src);
}
