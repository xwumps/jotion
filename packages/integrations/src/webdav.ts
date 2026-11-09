import { parseMultiStatus } from './caldav';
import { guard } from './guard';
import { instant, record } from './rest';
import { ConnectorError, type ConnectorContext, type ExternalRecord, type PullResult } from './sdk';

/**
 * Phase 11: Dateien über WebDAV (Nextcloud, IServ, andere Server). Liest den Ordnerbaum per
 * PROPFIND (Tiefe 1, Ebene für Ebene). Ändert sich das ETag des Startordners nicht (Nextcloud
 * reicht Änderungen nach oben weiter), entfällt der Abruf.
 */

export const MAX_FILES = 5000;
const MAX_DEPTH = 8;

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <d:resourcetype/><d:getlastmodified/><d:getcontentlength/><d:getcontenttype/><d:getetag/>
    <oc:fileid/>
  </d:prop>
</d:propfind>`;

interface DavEntry {
  href: string;
  url: string;
  isDir: boolean;
  etag: string | null;
  size: number | null;
  mime: string | null;
  modified: string | null;
  fileId: string | null;
}

const text = (v: unknown): string | null => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && typeof (v as { '#text'?: unknown })['#text'] === 'string')
    return (v as { '#text': string })['#text'];
  return null;
};

function authHeader(ctx: ConnectorContext): Record<string, string> {
  const user = typeof ctx.config.username === 'string' ? ctx.config.username : '';
  return user
    ? {
        Authorization: `Basic ${Buffer.from(`${user}:${ctx.secrets.password ?? ''}`).toString('base64')}`,
      }
    : {};
}

async function propfind(ctx: ConnectorContext, url: string): Promise<DavEntry[]> {
  const res = await guard(() =>
    ctx.http.fetch(url, {
      method: 'PROPFIND',
      headers: {
        ...authHeader(ctx),
        Depth: '1',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: PROPFIND_BODY,
    }),
  );
  if (res.status === 401 || res.status === 403)
    throw new ConnectorError('auth', 'WebDAV: Zugriff verweigert');
  if (res.status === 404) throw new ConnectorError('not_found', 'WebDAV: Ordner nicht gefunden');
  if (res.status !== 207)
    throw new ConnectorError('protocol', `WebDAV: unerwartete Antwort (Status ${res.status})`);
  const { responses } = parseMultiStatus(res.body.toString('utf8'));
  return responses.map((r) => {
    const p = r.props;
    const rt = p.resourcetype;
    const isDir = !!rt && typeof rt === 'object' && 'collection' in (rt as object);
    const len = Number(text(p.getcontentlength));
    const mod = text(p.getlastmodified);
    return {
      href: r.href,
      url: new URL(r.href, url).toString(),
      isDir,
      etag: text(p.getetag),
      size: Number.isFinite(len) && !isDir ? len : null,
      mime: text(p.getcontenttype),
      modified: mod ? new Date(mod).toISOString() : null,
      fileId: text(p.fileid),
    };
  });
}

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

export interface WebDavPullOptions {
  /** Link zur Datei in der Weboberfläche (Nextcloud: /index.php/f/<fileid>) */
  webUrl?: (e: DavEntry) => string | null;
}

/** Ordner vollständig lesen; ETag des Startordners als Cursor. */
export async function pullWebDavFiles(
  ctx: ConnectorContext,
  rootUrl: string,
  cursor: { etag?: string | null } | null,
  opts: WebDavPullOptions = {},
): Promise<PullResult> {
  const root = rootUrl.endsWith('/') ? rootUrl : `${rootUrl}/`;
  const first = await propfind(ctx, root);
  const self = first.find((e) => sameUrl(e.url, root));
  const etag = self?.etag ?? null;
  if (etag && cursor?.etag === etag)
    return { records: [], deletedRefs: [], refreshedRefs: [], complete: false, cursor };

  const records: ExternalRecord[] = [];
  const rootPath = decodeURIComponent(new URL(root).pathname);
  let level = first;
  let truncated = false;
  for (let depth = 0; depth < MAX_DEPTH && level.length; depth++) {
    const dirs: string[] = [];
    for (const e of level) {
      if (sameUrl(e.url, root) && depth === 0) continue;
      if (e.isDir) {
        dirs.push(e.url);
        continue;
      }
      if (records.length >= MAX_FILES) {
        truncated = true;
        break;
      }
      const path = `/${decodeURIComponent(new URL(e.url).pathname).slice(rootPath.length)}`;
      const name = path.split('/').pop() ?? path;
      records.push(
        record(
          'file',
          e.fileId ? `fileid:${e.fileId}` : e.href,
          {
            title: name,
            path,
            size: e.size,
            mime: e.mime,
            date: instant(e.modified),
            url: opts.webUrl?.(e) ?? e.url,
          },
          e.href,
        ),
      );
    }
    if (truncated) break;
    const next: DavEntry[] = [];
    for (const d of dirs) {
      const entries = await propfind(ctx, d);
      next.push(...entries.filter((e) => !sameUrl(e.url, d)));
    }
    level = next;
  }
  return {
    records,
    deletedRefs: [],
    refreshedRefs: [],
    // Abgeschnittene Listen dürfen nichts als gelöscht markieren
    complete: !truncated,
    cursor: { etag },
  };
}

/** Prüft den Zugriff auf einen Ordner (Verbindungstest). */
export async function checkWebDavFolder(ctx: ConnectorContext, url: string): Promise<void> {
  await propfind(ctx, url.endsWith('/') ? url : `${url}/`);
}
