import { createHash } from 'node:crypto';
import { CalDavClient, SyncTokenInvalidError, type CalendarObject } from './caldav';
import { parseIcs } from './ical';
import { dropboxConnector } from './dropbox';
import { googleConnector } from './google';
import { guard } from './guard';
import { microsoftConnector } from './microsoft';
import { telegramConnector } from './telegram';
import { checkWebDavFolder, pullWebDavFiles } from './webdav';
import {
  ConnectorError,
  type ConnectorContext,
  type ConnectorDefinition,
  type ExternalRecord,
  type ExternalSource,
  type PullResult,
  type RecordKind,
  type SourceOptions,
} from './sdk';

export { guard } from './guard';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function httpUrl(raw: unknown, field: string, requireHttps = false): string {
  let s = str(raw);
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:/i, 'https:');
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new ConnectorError('config', `${field}: keine gültige URL`);
  }
  if (u.protocol !== 'https:' && (requireHttps || u.protocol !== 'http:'))
    throw new ConnectorError(
      'config',
      `${field}: ${requireHttps ? 'nur https' : 'nur http oder https'}`,
    );
  if (u.username || u.password)
    throw new ConnectorError('config', `${field}: Zugangsdaten bitte nicht in die URL schreiben`);
  u.hash = '';
  return u.toString();
}

const today = (ctx: ConnectorContext) => new Date(ctx.now()).toISOString().slice(0, 10);

function kindsOf(components: string[]): RecordKind[] {
  const k: RecordKind[] = [];
  if (components.includes('VEVENT')) k.push('event');
  if (components.includes('VTODO')) k.push('task');
  return k;
}

// ------------------------------------------------------------------ iCal-Feed

type FeedCursor = {
  etag?: string | null;
  hash?: string;
  day?: string;
};

async function fetchFeed(ctx: ConnectorContext, url: string, cursor: FeedCursor | null) {
  const headers: Record<string, string> = { Accept: 'text/calendar, */*;q=0.5' };
  const user = str(ctx.config.username);
  if (user)
    headers.Authorization = `Basic ${Buffer.from(`${user}:${ctx.secrets.password ?? ''}`).toString('base64')}`;
  if (cursor?.etag && cursor.day === today(ctx)) headers['If-None-Match'] = cursor.etag;
  const res = await guard(() => ctx.http.get(url, headers));
  if (res.status === 401 || res.status === 403)
    throw new ConnectorError('auth', 'Zugriff auf den Kalender-Feed verweigert');
  if (res.status === 404) throw new ConnectorError('not_found', 'Kalender-Feed nicht gefunden');
  if (res.status === 304) return { notModified: true as const };
  if (res.status !== 200)
    throw new ConnectorError('network', `Feed antwortet mit Status ${res.status}`);
  if (res.truncated) throw new ConnectorError('protocol', 'Kalender-Feed ist zu groß');
  const body = res.body.toString('utf8');
  if (!/BEGIN:VCALENDAR/i.test(body))
    throw new ConnectorError('protocol', 'Die Adresse liefert keinen iCalendar-Feed');
  const etag = typeof res.headers.etag === 'string' ? res.headers.etag : null;
  return { notModified: false as const, body, etag };
}

function calName(ics: string): string | null {
  const m = /^X-WR-CALNAME:(.+)$/im.exec(ics);
  return m ? m[1]!.trim().replace(/\\,/g, ',') : null;
}

export const icalFeedConnector: ConnectorDefinition = {
  type: 'ical',
  displayName: 'iCal-Feed',
  authKind: 'none',
  configFields: ['url', 'username'],
  secretFields: ['password'],
  capabilities: { kinds: ['event', 'task'], incremental: false, write: false },
  validateConfig(config) {
    return { url: httpUrl(config.url, 'Feed-URL'), username: str(config.username) || null };
  },
  async testConnection(ctx) {
    const sources = await this.discoverSources(ctx);
    return {
      accountLabel: new URL(str(ctx.config.url)).host,
      sources,
      capabilities: { ical: true },
    };
  },
  async discoverSources(ctx) {
    const url = str(ctx.config.url);
    const feed = await fetchFeed(ctx, url, null);
    const body = feed.notModified ? '' : feed.body;
    const kinds: RecordKind[] = [];
    if (/BEGIN:VEVENT/i.test(body)) kinds.push('event');
    if (/BEGIN:VTODO/i.test(body)) kinds.push('task');
    return [
      {
        remoteId: url,
        name: calName(body) ?? new URL(url).host,
        kinds: kinds.length ? kinds : ['event'],
      },
    ];
  },
  async pull(ctx, source, cursor) {
    const c = cursor as FeedCursor | null;
    const feed = await fetchFeed(ctx, source.remoteId, c);
    const day = today(ctx);
    if (feed.notModified)
      return { records: [], deletedRefs: [], refreshedRefs: [], complete: false, cursor: c };
    const hash = createHash('sha256').update(feed.body).digest('hex');
    // Gleicher Inhalt am selben Tag: nichts zu tun (am nächsten Tag verschiebt sich das Zeitfenster)
    if (c?.hash === hash && c.day === day)
      return { records: [], deletedRefs: [], refreshedRefs: [], complete: false, cursor: c };
    const records = parseIcs(feed.body, {
      sourceKey: source.remoteId,
      timeZone: ctx.timeZone,
      now: ctx.now(),
      options: source.options,
    });
    return {
      records,
      deletedRefs: [],
      refreshedRefs: [],
      complete: true,
      cursor: { etag: feed.etag, hash, day },
    };
  },
};

// ------------------------------------------------------------------ CalDAV

type DavCursor = {
  syncToken?: string | null;
  ctag?: string | null;
  day?: string;
};

function davClient(ctx: ConnectorContext): CalDavClient {
  const username = str(ctx.config.username);
  return new CalDavClient(
    ctx.http,
    username ? { username, password: ctx.secrets.password ?? '' } : null,
  );
}

function parseObjects(
  objects: CalendarObject[],
  ctx: ConnectorContext,
  sourceKey: string,
  options: SourceOptions,
): { records: ExternalRecord[]; errors: { ref: string; message: string }[] } {
  const records: ExternalRecord[] = [];
  const errors: { ref: string; message: string }[] = [];
  for (const o of objects) {
    try {
      records.push(
        ...parseIcs(o.data, {
          sourceKey,
          remoteRef: o.href,
          timeZone: ctx.timeZone,
          now: ctx.now(),
          options,
        }),
      );
    } catch (err) {
      errors.push({ ref: o.href, message: (err as Error).message });
    }
  }
  return { records, errors };
}

/**
 * Kalender abrufen: inkrementell über sync-collection, wenn der Server es kann, sonst ctag-Vergleich.
 * Einmal am Tag vollständig, damit Wiederholungen im wandernden Zeitfenster nachkommen.
 */
export async function pullCalendar(
  ctx: ConnectorContext,
  url: string,
  options: SourceOptions,
  cursor: DavCursor | null,
): Promise<PullResult> {
  const client = davClient(ctx);
  const day = today(ctx);
  return guard(async () => {
    if (cursor?.day === day) {
      if (cursor.syncToken) {
        try {
          const r = await client.syncCollection(url, cursor.syncToken);
          const objects = r.changed.length ? await client.multiget(url, r.changed) : [];
          const parsed = parseObjects(objects, ctx, url, options);
          return {
            ...parsed,
            deletedRefs: r.deleted,
            refreshedRefs: objects.map((o) => o.href),
            complete: false,
            cursor: { syncToken: r.syncToken ?? cursor.syncToken, ctag: null, day },
          };
        } catch (err) {
          if (!(err instanceof SyncTokenInvalidError)) throw err;
          // Token abgelaufen: vollständiger Abgleich
        }
      } else if (cursor.ctag) {
        const state = await client.calendarState(url);
        if (state.ctag === cursor.ctag)
          return { records: [], deletedRefs: [], refreshedRefs: [], complete: false, cursor };
      }
    }
    // Zustand vor dem Abruf merken: Änderungen währenddessen kommen beim nächsten Lauf
    const state = await client.calendarState(url);
    const objects = await client.fetchAll(url);
    const parsed = parseObjects(objects, ctx, url, options);
    return {
      ...parsed,
      deletedRefs: [],
      refreshedRefs: objects.map((o) => o.href),
      complete: true,
      cursor: { syncToken: state.syncToken, ctag: state.ctag, day },
    };
  });
}

function calendarSources(
  calendars: { url: string; displayName: string; components: string[]; color: string | null }[],
): ExternalSource[] {
  return calendars
    .map((c) => ({
      remoteId: c.url,
      name: c.displayName,
      kinds: kindsOf(c.components),
      meta: { color: c.color, components: c.components },
    }))
    .filter((s) => s.kinds.length > 0);
}

export function davConnector(
  type: string,
  displayName: string,
  urlField: 'serverUrl' | 'baseUrl',
  extraPaths: string[],
  requireHttps: boolean,
): ConnectorDefinition {
  return {
    type,
    displayName,
    authKind: 'basic',
    configFields: [urlField, 'username'],
    secretFields: ['password'],
    capabilities: { kinds: ['event', 'task'], incremental: true, write: false },
    validateConfig(config) {
      const username = str(config.username);
      if (!username) throw new ConnectorError('config', 'Benutzername fehlt');
      const url = httpUrl(config[urlField], 'Serveradresse', requireHttps);
      return { [urlField]: url, username };
    },
    async testConnection(ctx) {
      const client = davClient(ctx);
      const d = await guard(() => client.discover(str(ctx.config[urlField]), extraPaths));
      const sources = calendarSources(d.calendars);
      return {
        accountLabel: `${str(ctx.config.username)} @ ${new URL(d.principalUrl).host}`,
        sources,
        capabilities: {
          caldav: true,
          events: d.calendars.some((c) => c.components.includes('VEVENT')),
          tasks: d.calendars.some((c) => c.components.includes('VTODO')),
          incremental: d.calendars.some((c) => c.syncToken !== null),
        },
      };
    },
    async discoverSources(ctx) {
      const client = davClient(ctx);
      const d = await guard(() => client.discover(str(ctx.config[urlField]), extraPaths));
      return calendarSources(d.calendars);
    },
    pull(ctx, source, cursor) {
      return pullCalendar(ctx, source.remoteId, source.options, cursor as DavCursor | null);
    },
  };
}

export const caldavConnector = davConnector('caldav', 'CalDAV', 'serverUrl', [], false);

/**
 * IServ: CalDAV des Kalendermoduls. Die Adresse wird per Discovery ermittelt (well-known,
 * current-user-principal); /caldav ist nur ein zusätzlicher Kandidat, nie fest verdrahtet.
 * Das Modul "Aufgaben" hat keine dokumentierte Schnittstelle und wird nicht angebunden.
 */
export const iservConnector = davConnector(
  'iserv',
  'IServ',
  'baseUrl',
  ['/caldav/', '/iserv/caldav/'],
  true,
);

// ------------------------------------------------------------------ Phase 11

const ICLOUD_URL = 'https://caldav.icloud.com/';

/** Apple iCloud: CalDAV mit Apple-ID und app-spezifischem Passwort (feste Serveradresse). */
export const icloudConnector: ConnectorDefinition = {
  ...davConnector('icloud', 'Apple iCloud', 'serverUrl', [], true),
  configFields: ['username'],
  validateConfig(config) {
    const username = str(config.username);
    if (!username) throw new ConnectorError('config', 'Apple-ID fehlt');
    return { serverUrl: ICLOUD_URL, username };
  },
};

const ncBase = (ctx: ConnectorContext) => str(ctx.config.serverUrl).replace(/\/+$/, '');
const ncFilesUrl = (ctx: ConnectorContext) => {
  const folder = str(ctx.config.folder).replace(/^\/+|\/+$/g, '');
  const user = encodeURIComponent(str(ctx.config.username));
  const path = folder ? folder.split('/').map(encodeURIComponent).join('/') + '/' : '';
  return `${ncBase(ctx)}/remote.php/dav/files/${user}/${path}`;
};

/**
 * Nextcloud: Kalender und Aufgaben über CalDAV (/remote.php/dav) und Dateien eines Ordners über
 * WebDAV. Anmeldung mit App-Passwort (Einstellungen → Sicherheit).
 */
export const nextcloudConnector: ConnectorDefinition = {
  type: 'nextcloud',
  displayName: 'Nextcloud',
  authKind: 'basic',
  configFields: ['serverUrl', 'username', 'folder'],
  secretFields: ['password'],
  capabilities: { kinds: ['event', 'task', 'file'], incremental: true, write: false },
  validateConfig(config) {
    const username = str(config.username);
    if (!username) throw new ConnectorError('config', 'Benutzername fehlt');
    const folder = str(config.folder).replace(/^\/+|\/+$/g, '');
    if (folder.split('/').includes('..'))
      throw new ConnectorError('config', 'Ordner: ungültiger Pfad');
    return { serverUrl: httpUrl(config.serverUrl, 'Serveradresse'), username, folder };
  },
  async testConnection(ctx) {
    const sources = await this.discoverSources(ctx);
    return {
      accountLabel: `${str(ctx.config.username)} @ ${new URL(ncBase(ctx)).host}`,
      sources,
      capabilities: {
        caldav: sources.some((s) => s.kinds.includes('event') || s.kinds.includes('task')),
        webdav: true,
        incremental: true,
      },
    };
  },
  async discoverSources(ctx) {
    const d = await guard(() => davClient(ctx).discover(`${ncBase(ctx)}/remote.php/dav/`, []));
    await checkWebDavFolder(ctx, ncFilesUrl(ctx));
    const folder = str(ctx.config.folder);
    return [
      ...calendarSources(d.calendars),
      { remoteId: 'files', name: folder ? `Dateien: ${folder}` : 'Dateien', kinds: ['file'] },
    ];
  },
  pull(ctx, source, cursor) {
    if (source.remoteId === 'files')
      return pullWebDavFiles(ctx, ncFilesUrl(ctx), cursor as { etag?: string } | null, {
        webUrl: (e) => (e.fileId ? `${ncBase(ctx)}/index.php/f/${e.fileId}` : null),
      });
    return pullCalendar(ctx, source.remoteId, source.options, cursor as DavCursor | null);
  },
};

/** WebDAV-Dateien (z. B. IServ-Dateien, andere Server): ein Ordner samt Unterordnern. */
export const webdavConnector: ConnectorDefinition = {
  type: 'webdav',
  displayName: 'WebDAV-Dateien',
  authKind: 'basic',
  configFields: ['folderUrl', 'username'],
  secretFields: ['password'],
  capabilities: { kinds: ['file'], incremental: false, write: false },
  validateConfig(config) {
    return {
      folderUrl: httpUrl(config.folderUrl, 'Ordner-Adresse'),
      username: str(config.username) || null,
    };
  },
  async testConnection(ctx) {
    const sources = await this.discoverSources(ctx);
    return {
      accountLabel: new URL(str(ctx.config.folderUrl)).host,
      sources,
      capabilities: { webdav: true },
    };
  },
  async discoverSources(ctx) {
    const url = str(ctx.config.folderUrl);
    await checkWebDavFolder(ctx, url);
    const name =
      decodeURIComponent(new URL(url).pathname.replace(/\/+$/, '').split('/').pop() || '') ||
      new URL(url).host;
    return [{ remoteId: url, name: `Dateien: ${name}`, kinds: ['file'] }];
  },
  pull(ctx, source, cursor) {
    return pullWebDavFiles(ctx, source.remoteId, cursor as { etag?: string } | null);
  },
};

export const CONNECTORS: Record<string, ConnectorDefinition> = {
  [icalFeedConnector.type]: icalFeedConnector,
  [caldavConnector.type]: caldavConnector,
  [iservConnector.type]: iservConnector,
  [icloudConnector.type]: icloudConnector,
  [nextcloudConnector.type]: nextcloudConnector,
  [webdavConnector.type]: webdavConnector,
  [googleConnector.type]: googleConnector,
  [microsoftConnector.type]: microsoftConnector,
  [dropboxConnector.type]: dropboxConnector,
  [telegramConnector.type]: telegramConnector,
};

export function connectorFor(type: string): ConnectorDefinition {
  const c = CONNECTORS[type];
  if (!c) throw new ConnectorError('config', `Unbekannter Connector: ${type}`);
  return c;
}
