import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Kleiner CalDAV-Server im Speicher für Tests (Discovery, PROPFIND, calendar-query,
 * calendar-multiget, sync-collection, Basic-Auth). Antworten wie Radicale/SabreDAV.
 */

interface Calendar {
  name: string;
  components: string[];
  objects: Map<string, { etag: string; data: string }>;
  /** Änderungsprotokoll: Token-Nummer, Objektname, gelöscht */
  log: { token: number; name: string; deleted: boolean }[];
}

export interface FakeCalDavOptions {
  username?: string;
  password?: string;
  supportsSync?: boolean;
  /** Pfad, unter dem der Dienst liegt (well-known leitet dorthin weiter) */
  root?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class FakeCalDav {
  private server: http.Server | null = null;
  private readonly calendars = new Map<string, Calendar>();
  private token = 1;
  private etagSeq = 1;
  /** Anzahl Anfragen je Methode (für Tests der Inkrementalität) */
  readonly requests: { method: string; path: string; body: string }[] = [];
  url = '';

  constructor(private readonly opts: FakeCalDavOptions = {}) {}

  get root() {
    return this.opts.root ?? '/dav/';
  }
  private get user() {
    return this.opts.username ?? 'anna';
  }
  private calPath(id: string) {
    return `${this.root}calendars/${this.user}/${id}/`;
  }
  calendarUrl(id: string) {
    return `${this.url}${this.calPath(id)}`;
  }

  addCalendar(id: string, name: string, components = ['VEVENT']) {
    this.calendars.set(id, { name, components, objects: new Map(), log: [] });
  }

  put(cal: string, name: string, data: string) {
    const c = this.calendars.get(cal)!;
    c.objects.set(name, { etag: `"e${this.etagSeq++}"`, data });
    c.log.push({ token: ++this.token, name, deleted: false });
  }

  remove(cal: string, name: string) {
    const c = this.calendars.get(cal)!;
    c.objects.delete(name);
    c.log.push({ token: ++this.token, name, deleted: true });
  }

  /** Simuliert ein abgelaufenes Token: alte Einträge vergessen */
  forgetHistory() {
    for (const c of this.calendars.values()) c.log = [];
    this.token += 100;
  }

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop() {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  private ctag(c: Calendar) {
    return `ctag-${c.log.at(-1)?.token ?? 0}`;
  }

  private ms(responses: string, extra = '') {
    return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${responses}${extra}</d:multistatus>`;
  }

  private resp(href: string, props: string) {
    return `<d:response><d:href>${esc(href)}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  }

  private calProps(id: string, c: Calendar) {
    const sync =
      this.opts.supportsSync === false
        ? ''
        : `<d:sync-token>http://fake/sync/${this.token}</d:sync-token>`;
    return (
      `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>${esc(c.name)}</d:displayname>` +
      `<cs:getctag>${this.ctag(c)}</cs:getctag>${sync}` +
      `<c:supported-calendar-component-set>${c.components.map((x) => `<c:comp name="${x}"/>`).join('')}</c:supported-calendar-component-set>`
    );
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const path = decodeURIComponent(new URL(req.url ?? '/', this.url).pathname);
    this.requests.push({ method: req.method ?? '', path, body });
    const send = (status: number, xml = '', headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/xml; charset=utf-8', ...headers });
      res.end(xml);
    };

    if (path === '/.well-known/caldav') return send(301, '', { Location: this.root });
    const expected = `Basic ${Buffer.from(`${this.user}:${this.opts.password ?? 'geheim'}`).toString('base64')}`;
    if (req.headers.authorization !== expected)
      return send(401, '', { 'WWW-Authenticate': 'Basic realm="fake"' });

    const principal = `${this.root}principals/${this.user}/`;
    const home = `${this.root}calendars/${this.user}/`;
    if (req.method === 'PROPFIND') {
      if (path === this.root)
        return send(
          207,
          this.ms(
            this.resp(
              path,
              `<d:current-user-principal><d:href>${principal}</d:href></d:current-user-principal>`,
            ),
          ),
        );
      if (path === principal)
        return send(
          207,
          this.ms(
            this.resp(path, `<c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set>`),
          ),
        );
      if (path === home) {
        let out = this.resp(home, '<d:resourcetype><d:collection/></d:resourcetype>');
        for (const [id, c] of this.calendars)
          out += this.resp(this.calPath(id), this.calProps(id, c));
        return send(207, this.ms(out));
      }
      for (const [id, c] of this.calendars)
        if (path === this.calPath(id))
          return send(207, this.ms(this.resp(path, this.calProps(id, c))));
      return send(404);
    }

    if (req.method === 'REPORT') {
      const entry = [...this.calendars].find(([id]) => path === this.calPath(id));
      if (!entry) return send(404);
      const [id, c] = entry;
      const obj = (name: string) => {
        const o = c.objects.get(name)!;
        return this.resp(
          `${this.calPath(id)}${name}`,
          `<d:getetag>${esc(o.etag)}</d:getetag><c:calendar-data>${esc(o.data)}</c:calendar-data>`,
        );
      };
      if (body.includes('calendar-query')) {
        const comp = /comp-filter name="(V(?:EVENT|TODO))"/.exec(body)?.[1];
        const names = [...c.objects.keys()].filter(
          (n) => !comp || c.objects.get(n)!.data.includes(`BEGIN:${comp}`),
        );
        return send(207, this.ms(names.map(obj).join('')));
      }
      if (body.includes('calendar-multiget')) {
        const hrefs = [...body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((m) => m[1]!);
        const out = hrefs.map((h) => {
          const name = decodeURIComponent(h.split('/').pop()!);
          return c.objects.has(name)
            ? obj(name)
            : `<d:response><d:href>${esc(h)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;
        });
        return send(207, this.ms(out.join('')));
      }
      if (body.includes('sync-collection')) {
        if (this.opts.supportsSync === false)
          return send(403, '<d:error xmlns:d="DAV:"><d:supported-report/></d:error>');
        const t = Number(/sync\/(\d+)/.exec(body)?.[1] ?? NaN);
        const oldest = c.log[0]?.token ?? this.token;
        if (!Number.isFinite(t) || t < oldest - 1)
          return send(403, '<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>');
        const latest = new Map<string, boolean>();
        for (const l of c.log) if (l.token > t) latest.set(l.name, l.deleted);
        const out = [...latest].map(([name, deleted]) =>
          deleted || !c.objects.has(name)
            ? `<d:response><d:href>${esc(`${this.calPath(id)}${name}`)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`
            : this.resp(
                `${this.calPath(id)}${name}`,
                `<d:getetag>${esc(c.objects.get(name)!.etag)}</d:getetag>`,
              ),
        );
        return send(
          207,
          this.ms(out.join(''), `<d:sync-token>http://fake/sync/${this.token}</d:sync-token>`),
        );
      }
    }
    return send(405);
  }
}
