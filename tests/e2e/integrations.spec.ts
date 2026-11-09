import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 8: Einstellungen → Integrationen gegen einen echten CalDAV-Server (Radicale im
 * Docker-Netz des Stacks, Alias "radicale"; der Stack braucht JOTION_SSRF_ALLOWLIST=radicale).
 * Verbinden, testen, Ziel-Datenbank anlegen, synchronisieren (Worker), Mapping-Vorschau,
 * lokale Änderung bleibt, Trennen.
 */
const OWNER = {
  name: 'Jarne Beispiel',
  email: 'jarne@example.com',
  password: 'ein-sicheres-passwort',
};
const RUN = Date.now().toString(36).slice(-4);
const PORT = 5233;
const CONTAINER = 'jotion-e2e-radicale';
const DAV = `http://127.0.0.1:${PORT}`;
const auth = `Basic ${Buffer.from('anna:geheim').toString('base64')}`;

test.describe.configure({ mode: 'serial' });
test.skip(process.env.JOTION_E2E_DOCKER !== '1', 'benötigt Docker-Zugriff');

let page: Page;

const ics = (uid: string, summary: string, extra = '') => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Jotion E2E//DE
BEGIN:VEVENT
UID:${uid}
DTSTAMP:20261101T000000Z
DTSTART;TZID=Europe/Berlin:20261112T080000
DTEND;TZID=Europe/Berlin:20261112T093000
SUMMARY:${summary}
${extra}END:VEVENT
END:VCALENDAR
`;

async function dav(method: string, path: string, body?: string, type = 'text/calendar') {
  const res = await fetch(`${DAV}${path}`, {
    method,
    headers: { Authorization: auth, ...(body ? { 'Content-Type': type } : {}) },
    ...(body ? { body } : {}),
  });
  return res.status;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const project = process.env.JOTION_COMPOSE_PROJECT ?? 'jotion';
  const dir = resolve(__dirname, '../../docker/radicale');
  execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
  execSync(
    `docker run -d --name ${CONTAINER} --network ${project}_default --network-alias radicale -p ${PORT}:5232 ` +
      `-v ${dir}/config:/config/config:ro -v ${dir}/users:/config/users:ro tomsquest/docker-radicale:3.5.4.0`,
    { stdio: 'ignore', timeout: 90_000 },
  );
  await expect
    .poll(async () => dav('PROPFIND', '/.well-known/caldav').catch(() => 0), { timeout: 30_000 })
    .toBe(207);
  const mk = `<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:displayname>Schule ${RUN}</D:displayname></D:prop></D:set></C:mkcalendar>`;
  expect(await dav('MKCALENDAR', `/anna/schule-${RUN}/`, mk, 'application/xml')).toBe(201);
  expect(
    await dav(
      'PUT',
      `/anna/schule-${RUN}/a.ics`,
      ics('a', `Klausur ${RUN}`, 'LOCATION:Raum 1\nCATEGORIES:Mathe\n'),
    ),
  ).toBe(201);
  expect(await dav('PUT', `/anna/schule-${RUN}/b.ics`, ics('b', `Wandertag ${RUN}`))).toBe(201);

  page = await browser.newPage({
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    viewport: { width: 1280, height: 900 },
  });
  await page.goto('/');
  await page.waitForURL(/\/setup$|\/login|\/w\//);
  if (page.url().endsWith('/setup')) {
    await page.getByLabel('Name', { exact: true }).fill(OWNER.name);
    await page.getByLabel('E-Mail').fill(OWNER.email);
    await page.getByLabel('Passwort').fill(OWNER.password);
    await page.getByLabel('Name des Workspace').fill('Familie');
    await page.getByRole('button', { name: 'Jotion einrichten' }).click();
  } else if (page.url().includes('/login')) {
    await page.getByLabel('E-Mail').fill(OWNER.email);
    await page.getByLabel('Passwort').fill(OWNER.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
  }
  await page.waitForURL(/\/w\/[0-9a-f-]+$/);
});

test.afterAll(async () => {
  await page?.close();
  execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' });
});

test('CalDAV verbinden, synchronisieren, Mapping-Vorschau, lokale Änderung bleibt, trennen', async () => {
  test.setTimeout(180_000);
  const ws = new URL(page.url()).pathname.split('/')[2]!;
  await page.goto(`/w/${ws}/settings/integrations`);
  await page.getByTestId('integration-add').click();
  await page.getByTestId('integration-type-caldav').click();
  await page.getByLabel('Name', { exact: true }).fill(`Radicale ${RUN}`);
  await page.getByTestId('integration-field-serverUrl').fill('http://radicale:5232');
  await page.getByTestId('integration-field-username').fill('anna');

  // Falsches Passwort: verständliche Meldung
  await page.getByTestId('integration-field-password').fill('falsch');
  await page.getByTestId('integration-test').click();
  await expect(page.getByRole('alert')).toContainText('Anmeldung fehlgeschlagen');

  await page.getByTestId('integration-field-password').fill('geheim');
  await page.getByTestId('integration-test').click();
  await expect(page.getByTestId('integration-test-result')).toContainText(`Schule ${RUN}`);
  await page.getByTestId('integration-save').click();

  const card = page.locator(`[data-testid="integration-card"][data-name="Radicale ${RUN}"]`);
  await expect(card).toBeVisible();
  await expect(card.getByTestId('integration-status')).toHaveText('Aktiv');
  const source = card.locator(`[data-testid="integration-source"][data-name="Schule ${RUN}"]`);
  await source.getByTestId('source-pick-target').click();
  await source.getByTestId('source-create-db').click();
  await expect(source.getByTestId('source-target')).toHaveText(`Schule ${RUN}`);
  await expect(source.getByTestId('source-enabled')).toBeChecked();

  // Mapping-Vorschau: erste Einträge mit neuen Optionen
  await source.getByTestId('source-mapping').click();
  await expect(page.locator('[data-testid="mapping-row"][data-property="Ort"]')).toBeVisible();
  await page.getByTestId('mapping-preview').click();
  const preview = page.getByTestId('mapping-preview-table');
  await expect(preview).toContainText(`Klausur ${RUN}`);
  await expect(preview).toContainText('Mathe');
  await page.getByTestId('mapping-save').click();

  // Synchronisieren (Worker)
  await card.getByTestId('integration-sync').click();
  await expect
    .poll(
      async () => {
        await page.reload();
        return (await card.getByTestId('integration-last-run').textContent()) ?? '';
      },
      { timeout: 60_000, intervals: [1000, 2000, 3000] },
    )
    .toContain('2 neu');

  // Datenbank öffnen: beide Termine da, Ort übernommen
  const dbId = await page.evaluate(
    async ({ w, name }) => {
      const list = (await (await fetch(`/api/workspaces/${w}/integrations`)).json()) as {
        name: string;
        sources: { targetDatabaseId: string | null }[];
      }[];
      return list.find((c) => c.name === name)!.sources.find((s) => s.targetDatabaseId)!
        .targetDatabaseId!;
    },
    { w: ws, name: `Radicale ${RUN}` },
  );
  await page.goto(`/w/${ws}/p/${dbId}`);
  await expect(page.getByText(`Klausur ${RUN}`)).toBeVisible();
  await expect(page.getByText(`Wandertag ${RUN}`)).toBeVisible();
  await expect(page.getByText('Raum 1')).toBeVisible();

  // Lokale Änderung am Titel, Remote ändert den Ort: Titel bleibt, Ort kommt an
  const rows = await page.evaluate(async (id) => {
    const r = await fetch(`/api/databases/${id}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return (await r.json()).rows as { id: string; title: string }[];
  }, dbId);
  const klausur = rows.find((r) => r.title === `Klausur ${RUN}`)!;
  await page.evaluate(
    async ({ id, row, title }) => {
      await fetch(`/api/databases/${id}/rows/${row}/properties`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    },
    { id: dbId, row: klausur.id, title: `Mathe-Klausur ${RUN}` },
  );
  // Radicale erkennt Änderungen mit Sekundenauflösung
  await page.waitForTimeout(1100);
  expect([201, 204]).toContain(
    await dav(
      'PUT',
      `/anna/schule-${RUN}/a.ics`,
      ics('a', `Klausur ${RUN}`, 'LOCATION:Aula\nCATEGORIES:Mathe\n'),
    ),
  );
  await page.goto(`/w/${ws}/settings/integrations`);
  await card.getByTestId('integration-sync').click();
  await page.goto(`/w/${ws}/p/${dbId}`);
  await expect(page.getByText('Aula')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(`Mathe-Klausur ${RUN}`)).toBeVisible();

  // Trennen: Zeilen bleiben
  await page.goto(`/w/${ws}/settings/integrations`);
  await card.getByTestId('integration-disconnect').click();
  await page.getByTestId('integration-disconnect-confirm').click();
  await expect(card).toHaveCount(0);
  await page.goto(`/w/${ws}/p/${dbId}`);
  await expect(page.getByText(`Wandertag ${RUN}`)).toBeVisible();
});

test('Phase 11: Connector-Auswahl, OAuth ohne Einrichtung, Telegram-Felder', async () => {
  const ws = new URL(page.url()).pathname.split('/')[2]!;
  await page.goto(`/w/${ws}/settings/integrations`);
  await page.getByTestId('integration-add').click();
  for (const type of [
    'icloud',
    'nextcloud',
    'webdav',
    'google',
    'microsoft',
    'dropbox',
    'telegram',
  ])
    await expect(page.getByTestId(`integration-type-${type}`)).toBeVisible();

  // Ohne Client-ID im Stack: Hinweis für den Admin, Anmelde-Knopf gesperrt
  await page.getByTestId('integration-type-google').click();
  await expect(page.getByRole('alert')).toContainText('nicht eingerichtet');
  await expect(page.getByTestId('integration-oauth')).toBeDisabled();

  // Nextcloud: Ordner optional
  await page.getByTestId('integration-type-nextcloud').click();
  await expect(page.getByTestId('integration-field-folder')).toBeVisible();
  await expect(page.getByTestId('integration-test')).toBeDisabled();

  // Telegram: Bot-Token und erlaubte Absender; ungültiges Token mit Meldung
  await page.getByTestId('integration-type-telegram').click();
  await page.getByTestId('integration-field-botToken').fill('kein-token');
  await page.getByTestId('integration-field-allowedUsers').fill('@jarne');
  await page.getByTestId('integration-test').click();
  await expect(page.getByRole('alert')).toContainText('Bot-Token');
  await page.keyboard.press('Escape');
});
