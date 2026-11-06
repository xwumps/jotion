import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 6: Relationen, Rollups und Formeln im Browser. Die Berechnung über Relationen läuft im
 * Docker-Stack im Worker; geänderte Werte müssen ohne Neuladen erscheinen.
 */
const OWNER = {
  name: 'Jarne Beispiel',
  email: 'jarne@example.com',
  password: 'ein-sicheres-passwort',
};

test.describe.configure({ mode: 'serial' });

let page: Page;
let ws = '';

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ locale: 'de-DE', timezoneId: 'Europe/Berlin' });
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

const db = () => page.getByTestId('database-view').first();
const header = (name: string) =>
  db().locator(`[data-testid="column-header"][data-property="${name}"]`);
const rowByTitle = (title: string) => db().getByTestId('table-row').filter({ hasText: title });
const cellOf = (title: string, prop: string) =>
  rowByTitle(title).locator(`[data-property="${prop}"]`).first();

/** Eindeutige Namen je Lauf (die Instanz kann aus früheren Läufen Daten haben) */
const RUN = Date.now().toString(36).slice(-4);
const TASKS = `Aufgaben ${RUN}`;
let tasksId = '';
let projectsId = '';
let pointsId = '';
const taskIds: Record<string, string> = {};

test('Relation über die Oberfläche anlegen und Zeilen verknüpfen', async () => {
  const tasks = await api('POST', `/workspaces/${ws}/databases`, {
    scope: 'TEAM',
    title: TASKS,
  });
  tasksId = tasks.id;
  pointsId = (
    await api('POST', `/databases/${tasksId}/properties`, { name: 'Punkte', type: 'number' })
  ).id;
  for (const [t, p] of [
    ['Einkaufen', 3],
    ['Steuer', 5],
    ['Urlaub', 8],
  ] as const)
    taskIds[t] = (
      await api('POST', `/databases/${tasksId}/rows`, { title: t, values: { [pointsId]: p } })
    ).id;
  const projects = await api('POST', `/workspaces/${ws}/databases`, {
    scope: 'TEAM',
    title: `Projekte ${RUN}`,
  });
  projectsId = projects.id;
  await api('POST', `/databases/${projectsId}/rows`, { title: 'Haushalt' });

  await page.goto(`/w/${ws}/p/${projectsId}`);
  await expect(db()).toBeVisible();
  await db().getByTestId('add-property').click();
  await page.getByTestId('type-relation').click();
  await expect(page.getByTestId('computed-setup')).toBeVisible();
  await page.getByTestId('relation-db-search').fill(TASKS);
  await page.locator(`[data-testid="relation-db-option"][data-title="${TASKS}"]`).click();
  await page.getByTestId('relation-two-way').check();
  await page.getByTestId('computed-save').click();
  await expect(header('Relation')).toBeVisible();

  // Zeilen verknüpfen
  await cellOf('Haushalt', 'Relation').click();
  await expect(page.getByTestId('relation-editor')).toBeVisible();
  await page.getByTestId('relation-option').filter({ hasText: 'Einkaufen' }).click();
  await page.getByTestId('relation-option').filter({ hasText: 'Steuer' }).click();
  await page.keyboard.press('Escape');
  await expect(cellOf('Haushalt', 'Relation').getByTestId('relation-chip')).toHaveText([
    'Einkaufen',
    'Steuer',
  ]);

  // Zweiseitig: die Aufgaben zeigen das Projekt
  const row = await api('GET', `/databases/${tasksId}/rows/${taskIds['Steuer']}`);
  const reverse = (await api('GET', `/databases/${tasksId}`)).properties.find(
    (p: { name: string }) => p.name === `Projekte ${RUN}`,
  );
  expect(row.values[reverse.id]).toHaveLength(1);
});

test('Rollup einrichten, Wert folgt Änderungen live (Worker)', async () => {
  await db().getByTestId('add-property').click();
  await page.getByTestId('type-rollup').click();
  await page.getByTestId('rollup-relation').selectOption({ label: 'Relation' });
  await page.getByTestId('rollup-property').selectOption({ label: 'Punkte' });
  await page.getByTestId('rollup-aggregation').selectOption('sum');
  await page.getByTestId('computed-save').click();
  await expect(header('Rollup')).toBeVisible();
  await expect(cellOf('Haushalt', 'Rollup')).toHaveText('8');

  // Wert in der verknüpften Datenbank ändern: Rollup aktualisiert sich ohne Neuladen
  await api('PATCH', `/databases/${tasksId}/rows/${taskIds['Steuer']}/properties`, {
    values: { [pointsId]: 10 },
  });
  await expect(cellOf('Haushalt', 'Rollup')).toHaveText('13', { timeout: 10_000 });
});

test('Formel mit Editor: Fehler, Vorschau, Ergebnis, Filter danach', async () => {
  await db().getByTestId('add-property').click();
  await page.getByTestId('type-formula').click();
  const input = page.getByTestId('formula-input');
  await expect(input).toBeVisible();
  await input.click();
  await page.keyboard.type('prop("Rollup") * ');
  await expect(page.getByTestId('formula-status')).toContainText('endet unerwartet');
  await expect(page.getByTestId('computed-save')).toBeDisabled();
  await page.keyboard.type('2');
  await expect(page.getByTestId('formula-status')).toContainText('Ergebnis: Zahl');
  await expect(page.getByTestId('formula-preview')).toContainText('26');
  await page.getByTestId('computed-save').click();
  await expect(header('Formel')).toBeVisible();
  await expect(cellOf('Haushalt', 'Formel')).toHaveText('26');

  // Autovervollständigung für Properties
  await header('Formel').getByRole('button').first().click();
  await page.getByTestId('property-configure').click();
  await page.getByTestId('formula-input').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('upper(prop("');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Name');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Filter auf das Formel-Ergebnis
  await api('POST', `/databases/${projectsId}/rows`, { title: 'Leeres Projekt' });
  await expect(db().getByTestId('table-row')).toHaveCount(2);
  await db().getByTestId('filter-button').click();
  await page.getByTestId('add-filter').click();
  await page.getByTestId('filter-property').selectOption({ label: 'Formel' });
  await page.getByTestId('filter-operator').selectOption({ label: '>' });
  await page.getByTestId('filter-value').fill('10');
  await expect(db().getByTestId('table-row')).toHaveCount(1);
  await expect(db().getByTestId('table-row')).toContainText('Haushalt');
  await page.keyboard.press('Escape');
});

test('Filtergruppen bis Tiefe 3', async () => {
  await db().getByTestId('filter-button').click();
  await page.getByTestId('add-filter-group').click();
  const nestedGroup = page.getByTestId('add-nested-group').first();
  await nestedGroup.click();
  // Tiefe 3 erreicht: keine weitere Untergruppe in der innersten Gruppe
  await expect(page.getByTestId('add-nested-group')).toHaveCount(1);
  await expect(page.getByTestId('add-nested-filter')).toHaveCount(2);
  await page.keyboard.press('Escape');
});
