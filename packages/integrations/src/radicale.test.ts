import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { caldavConnector, pullCalendar } from './connectors';
import { SafeHttpClient } from './safe-http';
import { DEFAULT_SOURCE_OPTIONS, type ConnectorContext } from './sdk';

/**
 * Echter CalDAV-Server (Radicale, docker/radicale). Läuft nur mit JOTION_RADICALE_URL, z. B.
 *   docker run -d -p 5232:5232 -v $PWD/docker/radicale/config:/config/config:ro \
 *     -v $PWD/docker/radicale/users:/config/users:ro tomsquest/docker-radicale:3.5.4.0
 */
const BASE = process.env.JOTION_RADICALE_URL;
const auth = `Basic ${Buffer.from('anna:geheim').toString('base64')}`;
const http = new SafeHttpClient({
  allowlist: ['127.0.0.1', 'localhost'],
  timeoutMs: 10_000,
  maxBytes: 5_000_000,
});

const ics = (uid: string, summary: string, extra = '') => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Jotion Test//DE
BEGIN:VEVENT
UID:${uid}
DTSTAMP:20261101T000000Z
DTSTART;TZID=Europe/Berlin:20261112T080000
DTEND;TZID=Europe/Berlin:20261112T093000
SUMMARY:${summary}
${extra}END:VEVENT
END:VCALENDAR
`;

async function dav(
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: auth,
      ...(body ? { 'Content-Type': 'text/calendar; charset=utf-8' } : {}),
      ...headers,
    },
    ...(body ? { body } : {}),
  });
  return res.status;
}

describe.skipIf(!BASE)('Radicale (echter CalDAV-Server)', () => {
  const ctx = (): ConnectorContext => ({
    config: { serverUrl: BASE!, username: 'anna' },
    secrets: { password: 'geheim' },
    http,
    timeZone: 'Europe/Berlin',
    now: () => Date.parse('2026-11-08T12:00:00Z'),
  });

  it('Discovery, vollständiger Abruf, sync-collection, Löschung', async () => {
    const cal = `/anna/test-${randomUUID().slice(0, 8)}/`;
    const mk = `<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:displayname>Schule Test</D:displayname></D:prop></D:set></C:mkcalendar>`;
    expect(await dav('MKCALENDAR', cal, mk, { 'Content-Type': 'application/xml' })).toBe(201);
    expect(await dav('PUT', `${cal}a.ics`, ics('a', 'Mathe', 'LOCATION:Raum 1\n'))).toBe(201);
    expect(await dav('PUT', `${cal}b.ics`, ics('b', 'Deutsch'))).toBe(201);

    const test = await caldavConnector.testConnection(ctx());
    const source = test.sources.find((s) => s.name === 'Schule Test');
    expect(source).toBeDefined();
    expect(test.capabilities.incremental).toBe(true);

    const full = await pullCalendar(ctx(), source!.remoteId, DEFAULT_SOURCE_OPTIONS, null);
    expect(full.complete).toBe(true);
    expect(full.records.map((r) => [r.externalId, r.fields.title]).sort()).toEqual([
      ['a', 'Mathe'],
      ['b', 'Deutsch'],
    ]);
    expect(full.records.find((r) => r.externalId === 'a')!.fields.date).toEqual({
      start: '2026-11-12T07:00:00.000Z',
      end: '2026-11-12T08:30:00.000Z',
      hasTime: true,
    });

    expect([201, 204]).toContain(
      await dav('PUT', `${cal}a.ics`, ics('a', 'Mathe', 'LOCATION:Raum 2\n')),
    );
    expect(await dav('PUT', `${cal}c.ics`, ics('c', 'Englisch'))).toBe(201);
    expect([200, 204]).toContain(await dav('DELETE', `${cal}b.ics`));

    const inc = await pullCalendar(ctx(), source!.remoteId, DEFAULT_SOURCE_OPTIONS, full.cursor);
    expect(inc.complete).toBe(false);
    expect(inc.records.map((r) => [r.externalId, r.fields.location ?? null]).sort()).toEqual([
      ['a', 'Raum 2'],
      ['c', null],
    ]);
    expect(inc.deletedRefs).toEqual([`${cal}b.ics`]);

    const none = await pullCalendar(ctx(), source!.remoteId, DEFAULT_SOURCE_OPTIONS, inc.cursor);
    expect(none.records).toEqual([]);
    expect(none.deletedRefs).toEqual([]);

    await expect(
      caldavConnector.testConnection({ ...ctx(), secrets: { password: 'falsch' } }),
    ).rejects.toMatchObject({ code: 'auth' });
    await dav('DELETE', cal);
  });
});
