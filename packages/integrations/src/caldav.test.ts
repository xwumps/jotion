import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CalDavClient, parseMultiStatus } from './caldav';
import { caldavConnector, iservConnector, pullCalendar } from './connectors';
import { SafeHttpClient } from './safe-http';
import { ConnectorError, DEFAULT_SOURCE_OPTIONS, type ConnectorContext } from './sdk';
import { FakeCalDav } from './testing/fake-caldav';

const http = new SafeHttpClient({ allowlist: ['127.0.0.1'], timeoutMs: 5000, maxBytes: 5_000_000 });
const NOW = Date.parse('2026-11-08T12:00:00Z');

const ics = (uid: string, summary: string, day = '20261112') => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//DE
BEGIN:VEVENT
UID:${uid}
DTSTAMP:20261101T000000Z
DTSTART:${day}T080000Z
DTEND:${day}T090000Z
SUMMARY:${summary}
END:VEVENT
END:VCALENDAR
`;
const todo = (uid: string, summary: string) => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//DE
BEGIN:VTODO
UID:${uid}
DTSTAMP:20261101T000000Z
DUE;VALUE=DATE:20261120
SUMMARY:${summary}
END:VTODO
END:VCALENDAR
`;

describe('parseMultiStatus', () => {
  it('liest Namespaces mit beliebigen Präfixen und ignoriert 404-propstat', () => {
    const xml = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
 <D:response><D:href>/cal/a%20b.ics</D:href>
  <D:propstat><D:prop><D:getetag>"1"</D:getetag><C:calendar-data><![CDATA[BEGIN:VCALENDAR
END:VCALENDAR]]></C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  <D:propstat><D:prop><D:displayname/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>
 </D:response>
 <D:sync-token>tok-2</D:sync-token>
</D:multistatus>`;
    const r = parseMultiStatus(xml);
    expect(r.syncToken).toBe('tok-2');
    expect(r.responses[0]!.href).toBe('/cal/a%20b.ics');
    expect(r.responses[0]!.props.getetag).toBe('"1"');
    expect(String(r.responses[0]!.props['calendar-data'])).toContain('BEGIN:VCALENDAR');
    expect('displayname' in r.responses[0]!.props).toBe(false);
  });

  it('ungültiges XML ist ein Protokollfehler', () => {
    expect(() => parseMultiStatus('<a><b></a>')).toThrow(ConnectorError);
  });
});

describe('CalDAV gegen Testserver', () => {
  const dav = new FakeCalDav();
  let ctx: ConnectorContext;

  beforeAll(async () => {
    await dav.start();
    dav.addCalendar('schule', 'Schule', ['VEVENT']);
    dav.addCalendar('aufgaben', 'Aufgaben', ['VTODO']);
    dav.put('schule', 'a.ics', ics('a', 'Mathe'));
    dav.put('schule', 'b.ics', ics('b', 'Deutsch'));
    dav.put('aufgaben', 't.ics', todo('t', 'Hausaufgabe'));
    ctx = {
      config: { serverUrl: dav.url, username: 'anna' },
      secrets: { password: 'geheim' },
      http,
      timeZone: 'Europe/Berlin',
      now: () => NOW,
    };
  });
  afterAll(() => dav.stop());

  it('Discovery über well-known findet Kalender mit Komponenten', async () => {
    const client = new CalDavClient(http, { username: 'anna', password: 'geheim' });
    const d = await client.discover(dav.url);
    expect(d.principalUrl).toBe(`${dav.url}/dav/principals/anna/`);
    expect(d.calendars.map((c) => [c.displayName, c.components])).toEqual([
      ['Schule', ['VEVENT']],
      ['Aufgaben', ['VTODO']],
    ]);
    expect(d.calendars[0]!.syncToken).toMatch(/sync/);
  });

  it('testConnection meldet Konto, Quellen und Fähigkeiten', async () => {
    const r = await caldavConnector.testConnection(ctx);
    expect(r.sources.map((s) => [s.name, s.kinds])).toEqual([
      ['Schule', ['event']],
      ['Aufgaben', ['task']],
    ]);
    expect(r.capabilities).toMatchObject({
      caldav: true,
      events: true,
      tasks: true,
      incremental: true,
    });
  });

  it('falsches Passwort ist ein Anmeldefehler', async () => {
    await expect(
      caldavConnector.testConnection({ ...ctx, secrets: { password: 'falsch' } }),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it('nicht erreichbarer Server ist ein Netzwerkfehler', async () => {
    await expect(
      caldavConnector.testConnection({
        ...ctx,
        config: { ...ctx.config, serverUrl: 'http://127.0.0.1:1' },
      }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('erst vollständig, dann inkrementell über sync-collection', async () => {
    const url = dav.calendarUrl('schule');
    const full = await pullCalendar(ctx, url, DEFAULT_SOURCE_OPTIONS, null);
    expect(full.complete).toBe(true);
    expect(full.records.map((r) => r.externalId).sort()).toEqual(['a', 'b']);
    expect(full.records[0]!.remoteRef).toMatch(/^\/dav\/calendars\/anna\/schule\/[ab]\.ics$/);

    dav.put('schule', 'a.ics', ics('a', 'Mathe (Raum 3)'));
    dav.put('schule', 'c.ics', ics('c', 'Englisch'));
    dav.remove('schule', 'b.ics');
    dav.requests.length = 0;
    const inc = await pullCalendar(ctx, url, DEFAULT_SOURCE_OPTIONS, full.cursor);
    expect(inc.complete).toBe(false);
    expect(inc.records.map((r) => [r.externalId, r.fields.title]).sort()).toEqual([
      ['a', 'Mathe (Raum 3)'],
      ['c', 'Englisch'],
    ]);
    expect(inc.deletedRefs).toEqual(['/dav/calendars/anna/schule/b.ics']);
    expect(inc.refreshedRefs.sort()).toEqual([
      '/dav/calendars/anna/schule/a.ics',
      '/dav/calendars/anna/schule/c.ics',
    ]);
    expect(dav.requests.some((r) => r.body.includes('calendar-query'))).toBe(false);

    // Keine Änderung: leere Antwort
    const none = await pullCalendar(ctx, url, DEFAULT_SOURCE_OPTIONS, inc.cursor);
    expect(none.records).toEqual([]);
    expect(none.deletedRefs).toEqual([]);

    // Abgelaufenes Token: vollständiger Abgleich
    dav.forgetHistory();
    const again = await pullCalendar(ctx, url, DEFAULT_SOURCE_OPTIONS, none.cursor);
    expect(again.complete).toBe(true);
    expect(again.records.map((r) => r.externalId).sort()).toEqual(['a', 'c']);

    // Neuer Tag: vollständig (Zeitfenster für Wiederholungen wandert)
    const nextDay = await pullCalendar(
      { ...ctx, now: () => NOW + 86_400_000 },
      url,
      DEFAULT_SOURCE_OPTIONS,
      again.cursor,
    );
    expect(nextDay.complete).toBe(true);
  });

  it('ohne sync-collection: ctag-Vergleich', async () => {
    const plain = new FakeCalDav({ supportsSync: false });
    await plain.start();
    try {
      plain.addCalendar('k', 'K');
      plain.put('k', 'x.ics', ics('x', 'X'));
      const c = { ...ctx, config: { serverUrl: plain.url, username: 'anna' } };
      const url = plain.calendarUrl('k');
      const first = await pullCalendar(c, url, DEFAULT_SOURCE_OPTIONS, null);
      expect(first.cursor).toMatchObject({ syncToken: null, ctag: expect.any(String) });
      const same = await pullCalendar(c, url, DEFAULT_SOURCE_OPTIONS, first.cursor);
      expect(same.records).toEqual([]);
      expect(same.complete).toBe(false);
      plain.put('k', 'y.ics', ics('y', 'Y'));
      const changed = await pullCalendar(c, url, DEFAULT_SOURCE_OPTIONS, same.cursor);
      expect(changed.complete).toBe(true);
      expect(changed.records.map((r) => r.externalId).sort()).toEqual(['x', 'y']);
    } finally {
      await plain.stop();
    }
  });

  it('IServ verlangt https und findet den Dienst nur per Discovery', () => {
    expect(() =>
      iservConnector.validateConfig({ baseUrl: 'http://schule.example', username: 'a' }),
    ).toThrow(/https/);
    expect(
      iservConnector.validateConfig({ baseUrl: 'https://schule.example', username: 'anna' }),
    ).toEqual({
      baseUrl: 'https://schule.example/',
      username: 'anna',
    });
  });

  it('Weiterleitung auf einen anderen Server wird nicht gefolgt', async () => {
    const other = new FakeCalDav({ root: '/x/' });
    await other.start();
    try {
      // well-known des zweiten Servers zeigt auf sich selbst: erlaubt
      const client = new CalDavClient(http, { username: 'anna', password: 'geheim' });
      await expect(client.discover(other.url)).resolves.toMatchObject({
        homeUrls: [`${other.url}/x/calendars/anna/`],
      });
    } finally {
      await other.stop();
    }
  });
});
