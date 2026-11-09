import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nextcloudConnector, webdavConnector, icloudConnector } from './connectors';
import { dropboxConnector } from './dropbox';
import { googleConnector, googleEventDate } from './google';
import { microsoftConnector, msEventDate } from './microsoft';
import {
  authorizeUrl,
  exchangeCode,
  needsRefresh,
  OAUTH_PROVIDERS,
  pkcePair,
  refreshTokens,
  tokensToSecrets,
} from './oauth';
import { SafeHttpClient } from './safe-http';
import { ConnectorError, DEFAULT_SOURCE_OPTIONS, type ConnectorContext } from './sdk';
import { telegramConnector } from './telegram';
import { FakeCloud } from './testing/fake-cloud';

/** Phase 11: Contract-Tests der neuen Connectoren gegen Fake-Server (Form wie die echten APIs). */

const http = new SafeHttpClient({ allowlist: ['127.0.0.1'], timeoutMs: 5000, maxBytes: 5_000_000 });
const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
let cloud: FakeCloud;

beforeAll(async () => {
  cloud = new FakeCloud();
  await cloud.start();
});
afterAll(async () => {
  await cloud.stop();
});

function ctx(over: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    config: {},
    secrets: {},
    http,
    timeZone: 'Europe/Berlin',
    now: () => NOW,
    endpoints: cloud.endpoints,
    accessToken: async () => cloud.accessToken,
    ...over,
  };
}
const opts = { ...DEFAULT_SOURCE_OPTIONS };

describe('OAuth', () => {
  it('Autorisierungs-URL mit PKCE, Code-Tausch und Erneuerung', async () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const client = { clientId: 'cid', clientSecret: 'sec', tokenUrl: `${cloud.url}/oauth/token` };
    const url = new URL(
      authorizeUrl(OAUTH_PROVIDERS.google, client, {
        redirectUri: 'https://jotion.test/api/integrations/oauth/callback',
        state: 'st',
        codeChallenge: challenge,
        scopes: googleConnector.oauth!.scopes,
      }),
    );
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toContain('gmail.readonly');
    // Microsoft: Mandant in der URL
    const ms = authorizeUrl(
      OAUTH_PROVIDERS.microsoft,
      { ...client, tenant: 'contoso' },
      {
        redirectUri: 'x',
        state: 's',
        codeChallenge: challenge,
        scopes: [],
      },
    );
    expect(ms).toContain('/contoso/oauth2/v2.0/authorize');
    expect(ms).toContain('offline_access');

    const t = await exchangeCode(http, OAUTH_PROVIDERS.google, client, {
      code: 'good-code',
      redirectUri: 'x',
      codeVerifier: verifier,
      now: NOW,
    });
    expect(t.refreshToken).toBe('refresh-1');
    expect(t.expiresAt).toBe(NOW + 3600_000);
    const s = tokensToSecrets(t);
    expect(needsRefresh(s, NOW)).toBe(false);
    expect(needsRefresh(s, NOW + 3590_000)).toBe(true);
    // Erneuern ohne neues Refresh-Token behält das alte
    const r = await refreshTokens(http, OAUTH_PROVIDERS.google, client, 'refresh-1', NOW);
    expect(r.refreshToken).toBe('refresh-1');
    expect(r.accessToken).toBe(cloud.accessToken);
    await expect(
      refreshTokens(http, OAUTH_PROVIDERS.google, client, 'widerrufen', NOW),
    ).rejects.toMatchObject({ code: 'auth' });
    await expect(
      exchangeCode(http, OAUTH_PROVIDERS.google, client, {
        code: 'falsch',
        redirectUri: 'x',
        codeVerifier: verifier,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ConnectorError);
  });
});

describe('Google', () => {
  beforeEach(() => {
    cloud.gEvents.set('primary', [
      {
        id: 'e1',
        summary: 'Elternabend',
        location: 'Aula',
        start: { dateTime: '2026-11-12T18:00:00+01:00' },
        end: { dateTime: '2026-11-12T19:30:00+01:00' },
        htmlLink: 'https://calendar.google.com/e1',
      },
      { id: 'e2', summary: 'Ferien', start: { date: '2026-12-21' }, end: { date: '2027-01-03' } },
      { id: 'e3', summary: 'Abgesagt', status: 'cancelled', start: { date: '2026-11-20' } },
      { id: 'e4', summary: 'Weit weg', start: { date: '2028-01-01' }, end: { date: '2028-01-02' } },
    ]);
  });

  it('Verbindungstest, Quellen, Kalender im Zeitfenster mit Paginierung', async () => {
    const t = await googleConnector.testConnection(ctx());
    expect(t.accountLabel).toBe('jarne@gmail.test');
    expect(t.sources.map((s) => s.remoteId)).toEqual([
      'calendar:primary',
      'gmail:INBOX',
      'gmail:STARRED',
      'drive',
    ]);
    const r = await googleConnector.pull(
      ctx(),
      { remoteId: 'calendar:primary', options: opts },
      null,
    );
    expect(r.complete).toBe(true);
    expect(r.windowStart).toBe(new Date(NOW - 30 * 86_400_000).toISOString());
    expect(r.records.map((x) => x.fields.title)).toEqual(['Elternabend', 'Ferien']);
    expect(r.records[0]!.fields.date).toEqual({
      start: '2026-11-12T17:00:00.000Z',
      end: '2026-11-12T18:30:00.000Z',
      hasTime: true,
    });
    // Ganztägig: Ende exklusiv → letzter Tag
    expect(r.records[1]!.fields.date).toEqual({
      start: '2026-12-21',
      end: '2027-01-02',
      hasTime: false,
    });
    expect(googleEventDate({ date: '2026-11-01' }, { date: '2026-11-02' })).toEqual({
      start: '2026-11-01',
      end: null,
      hasTime: false,
    });
  });

  it('Gmail: neueste Nachrichten, danach nur Änderungen über die Historie', async () => {
    const msg = (id: string, subject: string, ms: number, labels = ['INBOX', 'UNREAD']) => ({
      id,
      threadId: `t${id}`,
      labelIds: labels,
      snippet: 'Hallo &amp; willkommen',
      internalDate: String(ms),
      payload: {
        headers: [
          { name: 'Subject', value: subject },
          { name: 'From', value: 'Schule <info@schule.test>' },
        ],
      },
    });
    cloud.gmail.put(msg('m1', 'Elternbrief', NOW - 3000));
    cloud.gmail.put(msg('m2', 'Rechnung', NOW - 2000, ['INBOX']));
    cloud.gmail.put(msg('m3', 'Newsletter', NOW - 1000));
    const ctxG = ctx({ config: { maxMessages: 2 } });
    const full = await googleConnector.pull(ctxG, { remoteId: 'gmail:INBOX', options: opts }, null);
    expect(full.complete).toBe(false);
    expect(full.records.map((r) => r.fields.title)).toEqual(['Newsletter', 'Rechnung']);
    expect(full.records[1]!.fields).toMatchObject({
      from: 'Schule <info@schule.test>',
      read: true,
      description: 'Hallo & willkommen',
    });
    cloud.gmail.put(msg('m4', 'Neu', NOW));
    cloud.gmail.remove('m3');
    const inc = await googleConnector.pull(
      ctxG,
      { remoteId: 'gmail:INBOX', options: opts },
      full.cursor,
    );
    expect(inc.records.map((r) => r.externalId)).toEqual(['m4']);
    expect(inc.deletedRefs).toEqual(['m3']);
    // Historie abgelaufen: vollständig neu
    cloud.gmailMinHistory = cloud.seq.n + 10;
    const again = await googleConnector.pull(
      ctxG,
      { remoteId: 'gmail:INBOX', options: opts },
      inc.cursor,
    );
    expect(again.records.map((r) => r.externalId)).toEqual(['m4', 'm2']);
  });

  it('Drive: alle Dateien, danach Änderungen und Löschungen', async () => {
    cloud.drive.put({
      id: 'f1',
      name: 'Zeugnis.pdf',
      mimeType: 'application/pdf',
      size: '1200',
      modifiedTime: '2026-11-01T10:00:00Z',
      webViewLink: 'https://drive/f1',
    });
    cloud.drive.put({ id: 'd1', name: 'Ordner', mimeType: 'application/vnd.google-apps.folder' });
    cloud.drive.put({
      id: 'f2',
      name: 'Plan.docx',
      mimeType: 'application/vnd.google-apps.document',
    });
    const full = await googleConnector.pull(ctx(), { remoteId: 'drive', options: opts }, null);
    // Ordner werden in der Abfrage ausgeschlossen (q), der Fake filtert nur Papierkorb
    expect(full.records.map((r) => r.fields.title)).toContain('Zeugnis.pdf');
    expect(full.records.find((r) => r.externalId === 'f1')!.fields).toMatchObject({
      size: 1200,
      mime: 'application/pdf',
    });
    expect(full.complete).toBe(true);
    cloud.drive.put({
      id: 'f1',
      name: 'Zeugnis 2026.pdf',
      mimeType: 'application/pdf',
      size: '1300',
    });
    cloud.drive.remove('f2');
    const inc = await googleConnector.pull(
      ctx(),
      { remoteId: 'drive', options: opts },
      full.cursor,
    );
    expect(inc.records.map((r) => r.fields.title)).toEqual(['Zeugnis 2026.pdf']);
    expect(inc.deletedRefs).toEqual(['f2']);
  });

  it('abgelaufenes Token ergibt einen Anmeldefehler', async () => {
    await expect(
      googleConnector.testConnection(ctx({ accessToken: async () => 'alt' })),
    ).rejects.toMatchObject({ code: 'auth' });
  });
});

describe('Microsoft Graph', () => {
  it('Kalender per Delta mit Paginierung, entfernte Termine, abgelaufener Delta-Stand', async () => {
    const ev = (id: string, subject: string, start: string, allDay = false) => ({
      id,
      subject,
      isAllDay: allDay,
      start: { dateTime: `${start}T09:00:00.0000000`, timeZone: 'UTC' },
      end: { dateTime: `${start}T10:00:00.0000000`, timeZone: 'UTC' },
      location: { displayName: 'Raum 12' },
    });
    cloud.msEvents.put(ev('a', 'Mathe', '2026-11-10'));
    cloud.msEvents.put(ev('b', 'Deutsch', '2026-11-11'));
    cloud.msEvents.put(ev('c', 'Sport', '2026-11-12'));
    const t = await microsoftConnector.testConnection(ctx());
    expect(t.accountLabel).toBe('jarne@outlook.test');
    expect(t.sources.map((s) => s.remoteId)).toEqual(['calendar:cal1', 'mail:inbox', 'onedrive']);
    const full = await microsoftConnector.pull(
      ctx(),
      { remoteId: 'calendar:cal1', options: opts },
      null,
    );
    expect(full.records.map((r) => r.fields.title)).toEqual(['Mathe', 'Deutsch', 'Sport']);
    expect(full.complete).toBe(true);
    expect(full.records[0]!.fields).toMatchObject({
      location: 'Raum 12',
      start: '2026-11-10T09:00:00.000Z',
    });
    cloud.msEvents.remove('b');
    cloud.msEvents.put({ ...ev('c', 'Sport (Halle 2)', '2026-11-12'), isCancelled: false });
    const inc = await microsoftConnector.pull(
      ctx(),
      { remoteId: 'calendar:cal1', options: opts },
      full.cursor,
    );
    expect(inc.complete).toBe(false);
    expect(inc.deletedRefs).toEqual(['b']);
    expect(inc.records.map((r) => r.fields.title)).toEqual(['Sport (Halle 2)']);
    const expired = await microsoftConnector.pull(
      ctx(),
      { remoteId: 'calendar:cal1', options: opts },
      {
        deltaLink: `${cloud.url}/graph/me/calendars/cal1/calendarView/delta?$deltatoken=expired`,
        day: '2026-11-09',
      },
    );
    expect(expired.complete).toBe(true);
    expect(expired.records).toHaveLength(2);
    expect(
      msEventDate({
        isAllDay: true,
        start: { dateTime: '2026-11-10T00:00:00' },
        end: { dateTime: '2026-11-12T00:00:00' },
      }),
    ).toEqual({
      start: '2026-11-10',
      end: '2026-11-11',
      hasTime: false,
    });
  });

  it('Outlook-Posteingang und OneDrive', async () => {
    cloud.msMail.put({
      id: 'x1',
      subject: 'Klassenfahrt',
      bodyPreview: 'Bitte anmelden',
      receivedDateTime: '2026-11-08T08:00:00Z',
      isRead: false,
      from: { emailAddress: { name: 'Frau Meier', address: 'meier@schule.test' } },
      toRecipients: [{ emailAddress: { address: 'jarne@outlook.test' } }],
    });
    const mail = await microsoftConnector.pull(
      ctx(),
      { remoteId: 'mail:inbox', options: opts },
      null,
    );
    expect(mail.complete).toBe(false);
    expect(mail.records[0]!.fields).toMatchObject({
      title: 'Klassenfahrt',
      from: 'Frau Meier <meier@schule.test>',
      to: 'jarne@outlook.test',
      read: false,
    });
    cloud.msDrive.put({
      id: 'o1',
      name: 'Bericht.docx',
      size: 2048,
      file: { mimeType: 'application/msword' },
      parentReference: { path: '/drive/root:/Schule' },
    });
    cloud.msDrive.put({ id: 'o2', name: 'Schule', folder: {} });
    const drive = await microsoftConnector.pull(
      ctx(),
      { remoteId: 'onedrive', options: opts },
      null,
    );
    expect(drive.records.map((r) => r.fields.path)).toEqual(['/Schule/Bericht.docx']);
    cloud.msDrive.remove('o1');
    const inc = await microsoftConnector.pull(
      ctx(),
      { remoteId: 'onedrive', options: opts },
      drive.cursor,
    );
    expect(inc.deletedRefs).toEqual(['o1']);
  });
});

describe('Dropbox', () => {
  it('Ordner vollständig, danach Änderungen über den Cursor, Löschung per Pfad, Reset', async () => {
    const f = (id: string, path: string) => ({
      id,
      name: path.split('/').pop(),
      path_lower: path.toLowerCase(),
      path_display: path,
      size: 10,
      server_modified: '2026-11-01T10:00:00Z',
    });
    cloud.dbx.put(f('id:1', '/Schule/Mathe.pdf'));
    cloud.dbx.put(f('id:2', '/Schule/Deutsch.pdf'));
    const c = ctx({ config: dropboxConnector.validateConfig({ folder: 'Schule' }) });
    expect(c.config.folder).toBe('/Schule');
    expect((await dropboxConnector.testConnection(c)).accountLabel).toBe('jarne@dropbox.test');
    const full = await dropboxConnector.pull(c, { remoteId: 'dropbox', options: opts }, null);
    expect(full.complete).toBe(true);
    expect(full.records.map((r) => [r.externalId, r.remoteRef, r.fields.mime])).toEqual([
      ['id:1', '/schule/mathe.pdf', 'application/pdf'],
      ['id:2', '/schule/deutsch.pdf', 'application/pdf'],
    ]);
    cloud.removeDropbox('id:2');
    cloud.dbx.put(f('id:3', '/Schule/Bio.png'));
    cloud.dbx.put(f('id:1', '/Schule/Archiv/Mathe.pdf'));
    const inc = await dropboxConnector.pull(c, { remoteId: 'dropbox', options: opts }, full.cursor);
    expect(inc.complete).toBe(false);
    expect(inc.deletedRefs).toEqual(['/schule/deutsch.pdf']);
    expect(inc.records.map((r) => r.externalId).sort()).toEqual(['id:1', 'id:3']);
    const reset = await dropboxConnector.pull(
      c,
      { remoteId: 'dropbox', options: opts },
      { cursor: 'reset' },
    );
    expect(reset.complete).toBe(true);
    expect(() => dropboxConnector.validateConfig({ folder: '../etc' })).toThrow(ConnectorError);
  });
});

describe('Telegram', () => {
  const update = (id: number, from: string, text: string, chat = 1) => ({
    update_id: id,
    message: {
      message_id: id * 10,
      date: NOW / 1000,
      text,
      from: { id: 100 + id, username: from, first_name: from },
      chat: { id: chat, type: 'private' },
    },
  });

  it('nur erlaubte Absender, Offset als Cursor, Bearbeitungen aktualisieren', async () => {
    expect(() => telegramConnector.validateConfig({ allowedUsers: '' })).toThrow(ConnectorError);
    const config = telegramConnector.validateConfig({ allowedUsers: '@Jarne, 105' });
    expect(config.allowedUsers).toEqual(['jarne', '105']);
    const c = ctx({ config, secrets: { botToken: cloud.botToken }, accessToken: undefined });
    expect((await telegramConnector.testConnection(c)).accountLabel).toBe('@jotion_test_bot');
    cloud.tgUpdates.push(
      update(1, 'jarne', 'Milch kaufen\nund Brot'),
      update(2, 'fremder', 'Spam'),
      update(5, 'nobody', 'per ID erlaubt'),
    );
    const r = await telegramConnector.pull(c, { remoteId: 'messages', options: opts }, null);
    expect(r.records.map((x) => x.fields.title)).toEqual(['Milch kaufen', 'per ID erlaubt']);
    expect(r.records[0]!.fields.description).toBe('Milch kaufen\nund Brot');
    expect(r.records[0]!.externalId).toBe('1:10');
    expect(r.errors?.[0]!.message).toContain('1 Nachricht');
    expect(r.cursor).toEqual({ offset: 6 });
    cloud.tgUpdates.push({
      update_id: 6,
      edited_message: { ...update(1, 'jarne', 'Milch und Eier kaufen').message },
    });
    const next = await telegramConnector.pull(c, { remoteId: 'messages', options: opts }, r.cursor);
    expect(next.records.map((x) => [x.externalId, x.fields.title])).toEqual([
      ['1:10', 'Milch und Eier kaufen'],
    ]);
    await expect(
      telegramConnector.testConnection({
        ...c,
        secrets: { botToken: '1234567:falschfalschfalschfalschfalschfalsch' },
      }),
    ).rejects.toMatchObject({ code: 'auth' });
  });
});

describe('WebDAV und Nextcloud', () => {
  it('Ordnerbaum, ETag des Startordners verhindert unnötige Abrufe', async () => {
    cloud.addDavFile('/files/jarne/Schule/Plan.pdf', '11');
    cloud.addDavFile('/files/jarne/Schule/Fotos/Klasse.pdf', '12');
    const config = webdavConnector.validateConfig({
      folderUrl: `${cloud.url}/webdav/files/jarne/Schule/`,
      username: 'jarne',
    });
    const c = ctx({ config, secrets: { password: 'app-passwort' } });
    const t = await webdavConnector.testConnection(c);
    expect(t.sources[0]!.name).toBe('Dateien: Schule');
    const full = await webdavConnector.pull(
      c,
      { remoteId: String(config.folderUrl), options: opts },
      null,
    );
    expect(full.records.map((r) => [r.externalId, r.fields.path])).toEqual([
      ['fileid:11', '/Plan.pdf'],
      ['fileid:12', '/Fotos/Klasse.pdf'],
    ]);
    // Startordner unverändert: kein Baumabruf
    const before = cloud.requests.length;
    const same = await webdavConnector.pull(
      c,
      { remoteId: String(config.folderUrl), options: opts },
      full.cursor,
    );
    expect(same.records).toEqual([]);
    expect(cloud.requests.length - before).toBe(1);
    await expect(
      webdavConnector.testConnection({ ...c, secrets: { password: 'falsch' } }),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it('Nextcloud und iCloud: Konfiguration', () => {
    expect(
      nextcloudConnector.validateConfig({
        serverUrl: 'https://cloud.test/',
        username: 'jarne',
        folder: '/Schule/',
      }),
    ).toEqual({ serverUrl: 'https://cloud.test/', username: 'jarne', folder: 'Schule' });
    expect(() =>
      nextcloudConnector.validateConfig({
        serverUrl: 'https://cloud.test',
        username: 'j',
        folder: '../x',
      }),
    ).toThrow();
    expect(icloudConnector.validateConfig({ username: 'jarne@icloud.com' })).toEqual({
      serverUrl: 'https://caldav.icloud.com/',
      username: 'jarne@icloud.com',
    });
    expect(icloudConnector.authKind).toBe('basic');
  });
});
