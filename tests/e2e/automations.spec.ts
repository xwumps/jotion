import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9: Vorlagen-Galerie, Zeilen-Vorlagen, Automations-Builder (über die Queue im API-Prozess),
 * Protokoll, Button-Property und Button-Block.
 */
const OWNER = {
  name: 'Jarne Beispiel',
  email: 'jarne@example.com',
  password: 'ein-sicheres-passwort',
};
const RUN = Date.now().toString(36).slice(-4);

test.describe.configure({ mode: 'serial' });

let page: Page;
let ws = '';

test.beforeAll(async ({ browser }) => {
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
  ws = new URL(page.url()).pathname.split('/')[2]!;
});
test.afterAll(async () => {
  await page.close();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
      return res.status === 204 ? null : res.json();
    },
    { method, path, body },
  ) as Promise<T>;
}

/** Datenbank als eigene Seite mit Status, Datum, Checkbox und Button */
async function setupDb(title: string) {
  const d = await api('POST', `/workspaces/${ws}/databases`, { title, scope: 'TEAM' });
  const status = await api('POST', `/databases/${d.id}/properties`, {
    name: 'Status',
    type: 'status',
  });
  const doneAt = await api('POST', `/databases/${d.id}/properties`, {
    name: 'Erledigt am',
    type: 'date',
  });
  const flag = await api('POST', `/databases/${d.id}/properties`, {
    name: 'Markiert',
    type: 'checkbox',
  });
  const btn = await api('POST', `/databases/${d.id}/properties`, {
    name: 'Aktion',
    type: 'button',
    config: { label: 'Markieren' },
  });
  const options = status.config.options as { id: string; group: string }[];
  return {
    d,
    status,
    doneAt,
    flag,
    btn,
    todo: options[0]!.id,
    done: options.find((o) => o.group === 'complete')!.id,
  };
}

test('Vorlagen-Galerie legt "Aufgaben" mit Board und Beispielen an', async () => {
  await page.getByTestId('nav-templates').click();
  await expect(page.getByTestId('template-gallery')).toBeVisible();
  await page.getByTestId('template-scope').selectOption('TEAM');
  await page.locator('[data-testid="template-card"][data-title="Aufgaben"]').click();
  await page.waitForURL(/\/p\/[0-9a-f-]+$/);
  await expect(page.getByTestId('page-title')).toHaveValue('Aufgaben');
  const db = page.getByTestId('database-view').first();
  await expect(db).toBeVisible();
  await expect(db.getByText('Wochenplanung')).toBeVisible();
  await expect(db.getByTestId('view-tab').first()).toContainText('Board');
});

test('Automations-Builder: Status = Erledigt → Datum setzen greift über die Queue in unter 2 s', async () => {
  test.setTimeout(90_000);
  const s = await setupDb(`Aufgaben ${RUN}`);
  const row = await api('POST', `/databases/${s.d.id}/rows`, {
    title: 'Steuer',
    values: { [s.status.id]: s.todo },
  });
  await page.goto(`/w/${ws}/p/${s.d.id}`);
  await page.getByTestId('automations-button').click();
  await page.getByTestId('automation-new').click();
  await page.getByTestId('automation-name').fill('Erledigt-Datum');
  await page.getByTestId('automation-trigger').selectOption('property_changed');
  await page.getByTestId('automation-trigger-property').selectOption({ label: 'Status' });
  await page.getByTestId('automation-action-type').selectOption('set_property');
  await page.getByTestId('automation-set-property').selectOption({ label: 'Erledigt am' });
  await expect(page.getByTestId('automation-value-kind')).toHaveValue('today');
  await page.getByTestId('automation-save').click();
  const item = page.locator('[data-testid="automation-item"][data-name="Erledigt-Datum"]');
  await expect(item).toBeVisible();

  const t0 = Date.now();
  await api('PATCH', `/databases/${s.d.id}/rows/${row.id}/properties`, {
    values: { [s.status.id]: s.done },
  });
  await expect
    .poll(
      async () =>
        (await api('GET', `/databases/${s.d.id}/rows/${row.id}`)).values[s.doneAt.id] ?? null,
      { timeout: 5000, intervals: [100] },
    )
    .not.toBeNull();
  expect(Date.now() - t0).toBeLessThan(2000);

  // Protokoll zeigt die Ausführung
  await item.getByTestId('automation-log').click();
  await expect(
    page.locator('[data-testid="automation-run"][data-status="succeeded"]').first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('automation-runs')).toContainText('Steuer');
});

test('Button-Property: Automatisierung über den Builder, Klick in der Tabelle', async () => {
  const s = await setupDb(`Buttons ${RUN}`);
  await api('POST', `/databases/${s.d.id}/rows`, { title: 'Klick mich' });
  await page.goto(`/w/${ws}/p/${s.d.id}`);
  const cell = page.getByTestId('row-button').first();
  // Noch keine Automatisierung zugeordnet
  await expect(page.getByTestId('database-view')).toContainText('Keine Automatisierung');
  await page.getByTestId('automations-button').click();
  await page.getByTestId('automation-new').click();
  await page.getByTestId('automation-name').fill('Markieren');
  await page.getByTestId('automation-trigger').selectOption('button');
  await page.getByTestId('automation-set-property').selectOption({ label: 'Markiert' });
  await page.getByTestId('automation-value-kind').selectOption('toggle');
  await page.getByTestId('automation-save').click();
  await expect(
    page.locator('[data-testid="automation-item"][data-name="Markieren"]'),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(cell).toHaveText('Markieren');
  await cell.click();
  await expect
    .poll(
      async () =>
        (await api('POST', `/databases/${s.d.id}/query`, {})).rows[0].values[s.flag.id] ?? false,
      { timeout: 10_000 },
    )
    .toBe(true);
  // Anzeige folgt per Echtzeit-Ereignis
  await expect(
    page.getByTestId('table-row').first().locator('[role="checkbox"][aria-checked="true"]'),
  ).toHaveCount(1, { timeout: 10_000 });
});

test('Zeilen-Vorlage anlegen und daraus eine Zeile erstellen', async () => {
  const s = await setupDb(`Vorlagen ${RUN}`);
  await page.goto(`/w/${ws}/p/${s.d.id}`);
  await page.getByTestId('new-row-menu').click();
  await page.getByTestId('new-row-template').click();
  const peek = page.getByTestId('row-peek');
  await expect(peek.getByTestId('peek-template-badge')).toBeVisible();
  const title = peek.getByTestId('page-title');
  await title.fill('Wochenbericht');
  await title.blur();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);
  // Vorlagen erscheinen nicht als Zeilen
  await expect(page.getByTestId('table-row')).toHaveCount(0);
  await page.getByTestId('new-row-menu').click();
  await page
    .locator('[data-testid="row-template"][data-title="Wochenbericht"]')
    .locator('button')
    .first()
    .click();
  await expect(page.getByTestId('row-peek').getByTestId('page-title')).toHaveValue('Wochenbericht');
  await expect(page.getByTestId('row-peek').getByTestId('peek-template-badge')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('table-row')).toHaveCount(1);
});

test('Button-Block legt eine Zeile an', async () => {
  test.setTimeout(90_000);
  const s = await setupDb(`Ziel ${RUN}`);
  const p = await api('POST', `/workspaces/${ws}/pages`, { title: `Knöpfe ${RUN}`, scope: 'TEAM' });
  await page.goto(`/w/${ws}/p/${p.id}`);
  const editor = page.getByTestId('editor');
  await editor.click();
  await page.keyboard.type('/button');
  await expect(page.getByTestId('slash-menu')).toBeVisible();
  await page.keyboard.press('Enter');
  const block = page.getByTestId('button-block');
  await expect(block).toHaveText('Button einrichten');
  await block.click();
  const dialog = page.getByTestId('automations-dialog');
  await expect(dialog.getByTestId('automation-editor')).toBeVisible();
  await dialog.getByTestId('automation-create-db').selectOption({ label: `Ziel ${RUN}` });
  await dialog.getByTestId('automation-create-title').fill('Per Knopf');
  await dialog.getByTestId('automation-save').click();
  await page.keyboard.press('Escape');
  await expect(block).not.toHaveText('Button einrichten');
  await block.click();
  await expect(page.getByText('Ausgeführt')).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () =>
      (await api('POST', `/databases/${s.d.id}/query`, {})).rows.map(
        (r: { title: string }) => r.title,
      ),
    )
    .toContain('Per Knopf');
});
