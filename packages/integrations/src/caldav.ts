import { XMLParser } from 'fast-xml-parser';
import type { SafeHttpClient, SafeHttpResponse } from './safe-http';
import { ConnectorError } from './sdk';

/**
 * Schlanker CalDAV-Client (RFC 4791, 6578, 6764) auf dem SSRF-geschützten HTTP-Client.
 * Discovery: konfigurierte URL, /.well-known/caldav, current-user-principal, calendar-home-set.
 * Abruf: calendar-query (alles), sync-collection (Änderungen seit Token), calendar-multiget.
 */

export interface DavAuth {
  username: string;
  password: string;
}

export interface CalendarInfo {
  url: string;
  displayName: string;
  components: string[];
  ctag: string | null;
  syncToken: string | null;
  color: string | null;
}

export interface CalendarObject {
  href: string;
  etag: string | null;
  data: string;
}

export interface DiscoveryResult {
  principalUrl: string;
  homeUrls: string[];
  calendars: CalendarInfo[];
  /** URL, über die der Server gefunden wurde */
  contextUrl: string;
}

export class SyncTokenInvalidError extends Error {
  constructor() {
    super('Sync-Token ungültig');
    this.name = 'SyncTokenInvalidError';
  }
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['response', 'propstat', 'href', 'comp'].includes(name),
});

type Node = Record<string, unknown>;
const obj = (v: unknown): Node =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Node) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const txt = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  const o = obj(v);
  return typeof o['#text'] === 'string' ? o['#text'] : '';
};

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>';
const NS =
  'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/"';
const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface MultiStatusEntry {
  href: string;
  status: number;
  props: Node;
}

/** 207-Antwort in Einträge mit den Properties der erfolgreichen propstat-Blöcke. */
export function parseMultiStatus(xml: string): {
  responses: MultiStatusEntry[];
  syncToken: string | null;
} {
  let doc: Node;
  try {
    doc = obj(parser.parse(xml));
  } catch {
    throw new ConnectorError('protocol', 'Ungültige XML-Antwort des Servers');
  }
  if (doc.multistatus === undefined)
    throw new ConnectorError('protocol', 'Antwort des Servers ist keine DAV-Multistatus-Antwort');
  const ms = obj(doc.multistatus);
  const responses: MultiStatusEntry[] = [];
  for (const r of arr(ms.response)) {
    const resp = obj(r);
    const href = txt(arr(resp.href)[0]);
    const props: Node = {};
    for (const ps of arr(resp.propstat)) {
      const p = obj(ps);
      if (statusCode(txt(p.status)) >= 300) continue;
      Object.assign(props, obj(p.prop));
    }
    const status = resp.status ? statusCode(txt(resp.status)) : 200;
    responses.push({ href: safeDecode(href), status, props });
  }
  return {
    responses,
    syncToken: ms['sync-token'] !== undefined ? txt(ms['sync-token']) || null : null,
  };
}

function statusCode(line: string): number {
  const m = /HTTP\/[\d.]+\s+(\d{3})/.exec(line);
  return m ? Number(m[1]) : 200;
}

function safeDecode(href: string): string {
  try {
    return encodeURI(decodeURI(href));
  } catch {
    return href;
  }
}

const hrefOf = (v: unknown): string | null => {
  const h = arr(obj(v).href)[0];
  return h === undefined ? null : txt(h) || null;
};

export class CalDavClient {
  constructor(
    private readonly http: SafeHttpClient,
    private readonly auth: DavAuth | null,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.auth)
      h.Authorization = `Basic ${Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64')}`;
    return h;
  }

  /**
   * DAV-Anfrage. Weiterleitungen folgt sie nur innerhalb desselben Origins (Zugangsdaten gehen
   * nie an einen anderen Server).
   */
  async request(
    method: string,
    url: string,
    body: string | null,
    depth: '0' | '1' | null,
  ): Promise<{ url: string; res: SafeHttpResponse }> {
    let target = url;
    for (let i = 0; i < 5; i++) {
      const res = await this.http.fetch(target, {
        method,
        headers: this.headers({
          ...(body ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}),
          ...(depth !== null ? { Depth: depth } : {}),
        }),
        ...(body ? { body } : {}),
      });
      if (res.status === 401)
        throw new ConnectorError(
          'auth',
          'Anmeldung fehlgeschlagen (Benutzername oder Passwort falsch)',
        );
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.location;
        const next = typeof loc === 'string' ? new URL(loc, target) : null;
        if (!next || next.origin !== new URL(target).origin)
          throw new ConnectorError(
            'protocol',
            'Weiterleitung auf einen anderen Server wird nicht gefolgt',
          );
        target = next.toString();
        continue;
      }
      return { url: target, res };
    }
    throw new ConnectorError('protocol', 'Zu viele Weiterleitungen');
  }

  private async propfind(url: string, props: string, depth: '0' | '1') {
    const body = `${XML_HEAD}<d:propfind ${NS}><d:prop>${props}</d:prop></d:propfind>`;
    const { url: final, res } = await this.request('PROPFIND', url, body, depth);
    if (res.status === 404) throw new ConnectorError('not_found', `Nicht gefunden: ${final}`);
    if (res.status === 403) throw new ConnectorError('auth', 'Zugriff verweigert');
    if (res.status !== 207)
      throw new ConnectorError('protocol', `Unerwartete Antwort ${res.status} auf PROPFIND`);
    return { url: final, ...parseMultiStatus(res.body.toString('utf8')) };
  }

  /** Server finden: Kandidaten nacheinander probieren, bis current-user-principal antwortet. */
  async discover(baseUrl: string, extraPaths: string[] = []): Promise<DiscoveryResult> {
    const base = new URL(baseUrl);
    const candidates = [
      ...(base.pathname !== '/' ? [base.toString()] : []),
      new URL('/.well-known/caldav', base).toString(),
      ...extraPaths.map((p) => new URL(p, base).toString()),
      base.origin + '/',
    ];
    let lastErr: unknown = null;
    for (const c of [...new Set(candidates)]) {
      try {
        const r = await this.propfind(c, '<d:current-user-principal/><d:resourcetype/>', '0');
        const props = r.responses[0]?.props ?? {};
        const principal = hrefOf(props['current-user-principal']);
        if (!principal) continue;
        const principalUrl = new URL(principal, r.url).toString();
        const p = await this.propfind(principalUrl, '<c:calendar-home-set/>', '0');
        const homes = arr(obj(p.responses[0]?.props['calendar-home-set']).href).map((h) =>
          new URL(txt(h), p.url).toString(),
        );
        if (!homes.length)
          throw new ConnectorError('protocol', 'Kein Kalenderverzeichnis gefunden');
        const calendars: CalendarInfo[] = [];
        for (const home of homes) calendars.push(...(await this.listCalendars(home)));
        return { principalUrl, homeUrls: homes, calendars, contextUrl: r.url };
      } catch (err) {
        // Anmelde- und Netzwerkfehler betreffen alle Kandidaten
        if (!(err instanceof ConnectorError) || err.code === 'auth') throw err;
        lastErr = err;
      }
    }
    if (lastErr instanceof ConnectorError) throw lastErr;
    throw new ConnectorError('not_found', 'Kein CalDAV-Dienst unter dieser Adresse gefunden');
  }

  async listCalendars(homeUrl: string): Promise<CalendarInfo[]> {
    const r = await this.propfind(
      homeUrl,
      '<d:resourcetype/><d:displayname/><cs:getctag/><d:sync-token/><c:supported-calendar-component-set/><ic:calendar-color/>',
      '1',
    );
    const out: CalendarInfo[] = [];
    for (const e of r.responses) {
      if (!('calendar' in obj(e.props.resourcetype))) continue;
      const comps = arr(obj(e.props['supported-calendar-component-set']).comp);
      // Ohne Angabe gelten alle Komponenten als unterstützt
      const components = comps.length
        ? comps.map((c) => String(obj(c)['@_name'] ?? '').toUpperCase()).filter(Boolean)
        : ['VEVENT', 'VTODO'];
      const url = new URL(e.href, r.url).toString();
      out.push({
        url,
        displayName:
          txt(e.props.displayname) ||
          decodeURIComponent(url.replace(/\/$/, '').split('/').pop() ?? url),
        components,
        ctag: txt(e.props.getctag) || null,
        syncToken: txt(e.props['sync-token']) || null,
        color: txt(e.props['calendar-color']) || null,
      });
    }
    return out;
  }

  /** Eigenschaften eines Kalenders (ctag, sync-token). */
  async calendarState(url: string): Promise<{ ctag: string | null; syncToken: string | null }> {
    const r = await this.propfind(url, '<cs:getctag/><d:sync-token/>', '0');
    const p = r.responses[0]?.props ?? {};
    return { ctag: txt(p.getctag) || null, syncToken: txt(p['sync-token']) || null };
  }

  private async report(url: string, body: string, depth: '0' | '1') {
    const { url: final, res } = await this.request('REPORT', url, `${XML_HEAD}${body}`, depth);
    if (res.status === 403 || res.status === 409) {
      const text = res.body.toString('utf8');
      if (/valid-sync-token/.test(text)) throw new SyncTokenInvalidError();
      throw new ConnectorError('auth', 'Zugriff verweigert');
    }
    if (res.status === 404)
      throw new ConnectorError('not_found', `Kalender nicht gefunden: ${final}`);
    if (res.status !== 207)
      throw new ConnectorError('protocol', `Unerwartete Antwort ${res.status} auf REPORT`);
    if (res.truncated) throw new ConnectorError('protocol', 'Antwort des Servers ist zu groß');
    return { url: final, ...parseMultiStatus(res.body.toString('utf8')) };
  }

  private objects(r: { url: string; responses: MultiStatusEntry[] }): CalendarObject[] {
    return r.responses
      .filter((e) => e.status < 300 && typeof e.props['calendar-data'] !== 'undefined')
      .map((e) => ({
        href: new URL(e.href, r.url).pathname,
        etag: txt(e.props.getetag) || null,
        data: txt(e.props['calendar-data']),
      }));
  }

  /** Alle Objekte eines Kalenders (VEVENT und VTODO). */
  async fetchAll(
    url: string,
    components: string[] = ['VEVENT', 'VTODO'],
  ): Promise<CalendarObject[]> {
    const out: CalendarObject[] = [];
    for (const comp of components) {
      const body =
        `<c:calendar-query ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>` +
        `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="${xmlEscape(comp)}"/></c:comp-filter></c:filter></c:calendar-query>`;
      out.push(...this.objects(await this.report(url, body, '1')));
    }
    // Ein Objekt kann mehrere Komponenten enthalten: nach href zusammenfassen
    return [...new Map(out.map((o) => [o.href, o])).values()];
  }

  /** Änderungen seit einem Sync-Token (RFC 6578). */
  async syncCollection(
    url: string,
    token: string,
  ): Promise<{ changed: string[]; deleted: string[]; syncToken: string | null }> {
    const body =
      `<d:sync-collection ${NS}><d:sync-token>${xmlEscape(token)}</d:sync-token><d:sync-level>1</d:sync-level>` +
      `<d:prop><d:getetag/></d:prop></d:sync-collection>`;
    const r = await this.report(url, body, '0');
    const changed: string[] = [];
    const deleted: string[] = [];
    const self = new URL(r.url).pathname;
    for (const e of r.responses) {
      const path = new URL(e.href, r.url).pathname;
      if (path === self) continue;
      if (e.status === 404) deleted.push(path);
      else changed.push(path);
    }
    return { changed, deleted, syncToken: r.syncToken };
  }

  /** Bestimmte Objekte laden. */
  async multiget(url: string, hrefs: string[]): Promise<CalendarObject[]> {
    const out: CalendarObject[] = [];
    for (let i = 0; i < hrefs.length; i += 100) {
      const part = hrefs.slice(i, i + 100);
      const body =
        `<c:calendar-multiget ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>` +
        part.map((h) => `<d:href>${xmlEscape(h)}</d:href>`).join('') +
        `</c:calendar-multiget>`;
      out.push(...this.objects(await this.report(url, body, '1')));
    }
    return out;
  }
}
