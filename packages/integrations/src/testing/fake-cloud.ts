import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Phase 11: Fake-Server für die REST-Connectoren (Google, Microsoft Graph, Dropbox, Telegram),
 * einen OAuth-Token-Endpunkt und WebDAV-Dateien. Antworten folgen den echten APIs in Form und
 * Paginierung; jeder Dienst führt ein Änderungsprotokoll für die inkrementellen Abrufe.
 */

type Json = Record<string, unknown>;

interface LogEntry {
  seq: number;
  id: string;
  removed: boolean;
}

/** Sammlung mit Änderungsprotokoll (Delta, Changes, History) */
class Collection<T extends { id: string }> {
  readonly items = new Map<string, T>();
  readonly log: LogEntry[] = [];
  constructor(private readonly seq: { n: number }) {}
  put(item: T) {
    this.items.set(item.id, item);
    this.log.push({ seq: ++this.seq.n, id: item.id, removed: false });
  }
  remove(id: string) {
    this.items.delete(id);
    this.log.push({ seq: ++this.seq.n, id, removed: true });
  }
  /** Änderungen nach seq (letzter Stand je ID) */
  since(after: number): { id: string; item: T | null }[] {
    const ids = new Map<string, boolean>();
    for (const e of this.log) if (e.seq > after) ids.set(e.id, e.removed);
    return [...ids.keys()].map((id) => ({ id, item: this.items.get(id) ?? null }));
  }
}

export class FakeCloud {
  private server: http.Server | null = null;
  url = '';
  readonly requests: { method: string; path: string; body: string }[] = [];
  readonly seq = { n: 1 };
  /** Gültiges Zugriffs-Token; andere liefern 401 */
  accessToken = 'access-1';
  refreshToken = 'refresh-1';
  private tokenCounter = 1;
  /** Seitengröße der Fake-APIs (klein, damit Paginierung getestet wird) */
  pageSize = 2;

  // Google
  readonly gCalendars: { id: string; summary: string }[] = [{ id: 'primary', summary: 'Privat' }];
  readonly gEvents = new Map<string, Json[]>();
  readonly gmail: Collection<Json & { id: string }>;
  gmailMinHistory = 0;
  readonly drive: Collection<Json & { id: string }>;

  // Microsoft
  readonly msEvents: Collection<Json & { id: string }>;
  readonly msMail: Collection<Json & { id: string }>;
  readonly msDrive: Collection<Json & { id: string }>;

  // Dropbox (ID → Eintrag; gelöschte mit Pfad im Protokoll)
  readonly dbx: Collection<Json & { id: string }>;
  readonly dbxDeletedPaths = new Map<string, string>();

  // Telegram
  botToken = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
  readonly tgUpdates: Json[] = [];

  // WebDAV: Pfad → Inhalt (Ordner enden mit /)
  readonly dav = new Map<
    string,
    { etag: string; size: number; modified: string; fileid: string }
  >();
  davRootEtag = '"root-1"';

  constructor() {
    this.gmail = new Collection(this.seq);
    this.drive = new Collection(this.seq);
    this.msEvents = new Collection(this.seq);
    this.msMail = new Collection(this.seq);
    this.msDrive = new Collection(this.seq);
    this.dbx = new Collection(this.seq);
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }

  /** Basis-URLs für ConnectorContext.endpoints */
  get endpoints(): Record<string, string> {
    return {
      google: `${this.url}/google`,
      microsoft: `${this.url}/graph`,
      dropbox: `${this.url}/dropbox`,
      telegram: `${this.url}/telegram`,
    };
  }

  // ---------------------------------------------------------------- Routing

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const u = new URL(req.url ?? '/', this.url);
    this.requests.push({ method: req.method ?? 'GET', path: u.pathname + u.search, body });
    const send = (status: number, data: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(typeof data === 'string' ? data : JSON.stringify(data));
    };
    try {
      if (u.pathname === '/oauth/token') return this.oauth(body, send);
      if (u.pathname.startsWith('/telegram/')) return this.telegram(u, body, send);
      if (u.pathname.startsWith('/webdav/')) return this.webdav(req, u, res);
      if (req.headers.authorization !== `Bearer ${this.accessToken}`)
        return send(401, { error: 'invalid_token' });
      if (u.pathname.startsWith('/google/')) return this.google(u, send);
      if (u.pathname.startsWith('/graph/')) return this.graph(u, send);
      if (u.pathname.startsWith('/dropbox/')) return this.dropbox(u, body, send);
      send(404, { error: 'not found' });
    } catch (err) {
      send(500, { error: String(err) });
    }
  }

  private oauth(body: string, send: (s: number, d: unknown) => void) {
    const f = new URLSearchParams(body);
    const grant = f.get('grant_type');
    if (grant === 'authorization_code' && f.get('code') === 'good-code' && f.get('code_verifier')) {
      return send(200, this.issue());
    }
    if (grant === 'refresh_token' && f.get('refresh_token') === this.refreshToken)
      return send(200, { ...this.issue(), refresh_token: undefined });
    send(400, { error: 'invalid_grant' });
  }

  private issue() {
    this.accessToken = `access-${++this.tokenCounter}`;
    return {
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'test',
    };
  }

  /** Seite aus einer Liste mit pageToken = Startindex */
  private page<T>(list: T[], token: string | null): { items: T[]; next: string | null } {
    const start = token ? Number(token) : 0;
    const items = list.slice(start, start + this.pageSize);
    return {
      items,
      next: start + this.pageSize < list.length ? String(start + this.pageSize) : null,
    };
  }

  // ---------------------------------------------------------------- Google

  private google(u: URL, send: (s: number, d: unknown) => void) {
    const p = u.pathname.slice('/google'.length);
    const q = u.searchParams;
    if (p === '/oauth2/v3/userinfo') return send(200, { email: 'jarne@gmail.test' });
    if (p === '/calendar/v3/users/me/calendarList') return send(200, { items: this.gCalendars });
    let m = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(p);
    if (m) {
      const min = Date.parse(q.get('timeMin') ?? '1970-01-01');
      const max = Date.parse(q.get('timeMax') ?? '2999-01-01');
      const all = (this.gEvents.get(decodeURIComponent(m[1]!)) ?? []).filter((e) => {
        const s = e.start as { date?: string; dateTime?: string };
        const t = Date.parse(s.dateTime ?? `${s.date}T00:00:00Z`);
        return t >= min && t < max;
      });
      const pg = this.page(all, q.get('pageToken'));
      return send(200, { items: pg.items, ...(pg.next ? { nextPageToken: pg.next } : {}) });
    }
    if (p === '/gmail/v1/users/me/profile') return send(200, { historyId: String(this.seq.n) });
    if (p === '/gmail/v1/users/me/messages') {
      const label = q.get('labelIds');
      const all = [...this.gmail.items.values()]
        .filter((x) => (x.labelIds as string[]).includes(label ?? 'INBOX'))
        .sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
      const pg = this.page(all, q.get('pageToken'));
      return send(200, {
        messages: pg.items.map((x) => ({ id: x.id, threadId: x.threadId })),
        ...(pg.next ? { nextPageToken: pg.next } : {}),
      });
    }
    m = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(p);
    if (m) {
      const msg = this.gmail.items.get(m[1]!);
      return msg ? send(200, msg) : send(404, { error: 'not found' });
    }
    if (p === '/gmail/v1/users/me/history') {
      const start = Number(q.get('startHistoryId'));
      if (start < this.gmailMinHistory) return send(404, { error: 'history expired' });
      const history = this.gmail
        .since(start)
        .map(({ id, item }) =>
          item
            ? { messagesAdded: [{ message: { id, threadId: item.threadId } }] }
            : { messagesDeleted: [{ message: { id } }] },
        );
      return send(200, { history, historyId: String(this.seq.n) });
    }
    if (p === '/drive/v3/changes/startPageToken')
      return send(200, { startPageToken: String(this.seq.n) });
    if (p === '/drive/v3/files') {
      const all = [...this.drive.items.values()].filter((f) => !f.trashed);
      const pg = this.page(all, q.get('pageToken'));
      return send(200, { files: pg.items, ...(pg.next ? { nextPageToken: pg.next } : {}) });
    }
    if (p === '/drive/v3/changes') {
      const token = Number(q.get('pageToken'));
      const changes = this.drive
        .since(token)
        .map(({ id, item }) =>
          item ? { fileId: id, removed: false, file: item } : { fileId: id, removed: true },
        );
      return send(200, { changes, newStartPageToken: String(this.seq.n) });
    }
    send(404, { error: 'not found' });
  }

  // ---------------------------------------------------------------- Graph

  private graph(u: URL, send: (s: number, d: unknown) => void) {
    const p = u.pathname.slice('/graph'.length);
    if (p === '/me') return send(200, { mail: 'jarne@outlook.test', displayName: 'Jarne' });
    if (p === '/me/calendars') return send(200, { value: [{ id: 'cal1', name: 'Kalender' }] });
    const coll = p.endsWith('/calendarView/delta')
      ? this.msEvents
      : p.endsWith('/messages/delta')
        ? this.msMail
        : p === '/me/drive/root/delta'
          ? this.msDrive
          : null;
    if (!coll) return send(404, { error: 'not found' });
    const token = u.searchParams.get('$deltatoken');
    if (token === 'expired') return send(410, { error: { code: 'syncStateNotFound' } });
    const skip = Number(u.searchParams.get('$skiptoken') ?? 0);
    const all = token
      ? coll
          .since(Number(token))
          .map(({ id, item }) => item ?? { id, '@removed': { reason: 'deleted' } })
      : [...coll.items.values()];
    const items = all.slice(skip, skip + this.pageSize);
    const self = new URL(u.toString());
    if (skip + this.pageSize < all.length) {
      self.searchParams.set('$skiptoken', String(skip + this.pageSize));
      return send(200, { value: items, '@odata.nextLink': self.toString() });
    }
    const delta = new URL(`${this.url}/graph${p}`);
    delta.searchParams.set('$deltatoken', String(this.seq.n));
    return send(200, { value: items, '@odata.deltaLink': delta.toString() });
  }

  // ---------------------------------------------------------------- Dropbox

  private dropbox(u: URL, body: string, send: (s: number, d: unknown) => void) {
    const p = u.pathname.slice('/dropbox'.length);
    const args = body ? (JSON.parse(body) as Json) : {};
    if (p === '/users/get_current_account') return send(200, { email: 'jarne@dropbox.test' });
    const entries = (after: number | null) => {
      if (after === null)
        return [...this.dbx.items.values()].map((e) => ({ '.tag': 'file', ...e }));
      return this.dbx
        .since(after)
        .map(({ id, item }) =>
          item
            ? { '.tag': 'file', ...item }
            : { '.tag': 'deleted', name: 'x', path_lower: this.dbxDeletedPaths.get(id) },
        );
    };
    if (p === '/files/list_folder') {
      const all = entries(null);
      return send(200, { entries: all, cursor: `c${this.seq.n}`, has_more: false });
    }
    if (p === '/files/list_folder/continue') {
      const c = String(args.cursor ?? '');
      if (c === 'reset') return send(409, { error_summary: 'reset/' });
      const [after, skip] = c.slice(1).split(':').map(Number) as [number, number | undefined];
      const all = entries(after);
      const from = skip ?? 0;
      const items = all.slice(from, from + this.pageSize);
      const more = from + this.pageSize < all.length;
      return send(200, {
        entries: items,
        cursor: more ? `c${after}:${from + this.pageSize}` : `c${this.seq.n}`,
        has_more: more,
      });
    }
    send(404, { error_summary: 'not_found/' });
  }

  removeDropbox(id: string) {
    const e = this.dbx.items.get(id);
    if (e) this.dbxDeletedPaths.set(id, String(e.path_lower));
    this.dbx.remove(id);
  }

  // ---------------------------------------------------------------- Telegram

  private telegram(u: URL, body: string, send: (s: number, d: unknown) => void) {
    const m = /^\/telegram\/bot([^/]+)\/(\w+)$/.exec(u.pathname);
    if (!m || m[1] !== this.botToken) return send(401, { ok: false, description: 'Unauthorized' });
    const args = body ? (JSON.parse(body) as Json) : {};
    if (m[2] === 'getMe')
      return send(200, { ok: true, result: { id: 1, username: 'jotion_test_bot' } });
    if (m[2] === 'getUpdates') {
      const offset = Number(args.offset ?? 0);
      return send(200, {
        ok: true,
        result: this.tgUpdates
          .filter((x) => Number(x.update_id) >= offset)
          .slice(0, Number(args.limit ?? 100)),
      });
    }
    if (m[2] === 'sendMessage') return send(200, { ok: true, result: { message_id: 1 } });
    send(404, { ok: false, description: 'Not Found' });
  }

  // ---------------------------------------------------------------- WebDAV

  private webdav(req: IncomingMessage, u: URL, res: ServerResponse) {
    const auth = Buffer.from('jarne:app-passwort').toString('base64');
    if (req.headers.authorization !== `Basic ${auth}`) {
      res.writeHead(401);
      return res.end();
    }
    if (req.method !== 'PROPFIND') {
      res.writeHead(405);
      return res.end();
    }
    const path = decodeURIComponent(u.pathname.slice('/webdav'.length)) || '/';
    const dir = path.endsWith('/') ? path : `${path}/`;
    const children = new Set<string>();
    for (const p of this.dav.keys()) {
      if (!p.startsWith(dir) || p === dir) continue;
      const rest = p.slice(dir.length);
      const seg = rest.split('/')[0]!;
      children.add(rest.includes('/') ? `${dir}${seg}/` : `${dir}${seg}`);
    }
    if (dir !== '/' && !children.size && ![...this.dav.keys()].some((k) => k.startsWith(dir))) {
      res.writeHead(404);
      return res.end();
    }
    const href = (p: string) => `/webdav${p.split('/').map(encodeURIComponent).join('/')}`;
    const entry = (p: string) => {
      const isDir = p.endsWith('/');
      const f = this.dav.get(p);
      const etag = isDir ? (p === '/' ? this.davRootEtag : `"dir-${p}"`) : (f?.etag ?? '"x"');
      return `<d:response><d:href>${href(p)}</d:href><d:propstat><d:prop>
        <d:resourcetype>${isDir ? '<d:collection/>' : ''}</d:resourcetype>
        <d:getetag>${etag}</d:getetag>
        ${isDir ? '' : `<d:getcontentlength>${f?.size ?? 0}</d:getcontentlength><d:getcontenttype>application/pdf</d:getcontenttype><d:getlastmodified>${f?.modified ?? ''}</d:getlastmodified><oc:fileid>${f?.fileid ?? ''}</oc:fileid>`}
      </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    };
    const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">${[dir, ...children].map(entry).join('')}</d:multistatus>`;
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(xml);
  }

  addDavFile(path: string, fileid: string, size = 100) {
    this.dav.set(path, {
      etag: `"${fileid}-${this.seq.n++}"`,
      size,
      modified: new Date(Date.UTC(2026, 10, 1)).toUTCString(),
      fileid,
    });
    // Ordner-Einträge anlegen
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const dir = `/${parts.slice(0, i).join('/')}/`;
      if (!this.dav.has(dir)) this.dav.set(dir, { etag: '', size: 0, modified: '', fileid: '' });
    }
    this.davRootEtag = `"root-${this.seq.n}"`;
  }
}
