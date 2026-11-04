import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4: Datenbanken im Browser. Läuft eigenständig (richtet Jotion ein, falls nötig)
 * oder nach app.spec.ts in derselben Instanz (meldet sich dann mit demselben Owner an).
 */
const OWNER = {
  name: 'Jarne Beispiel',
  email: 'jarne@example.com',
  password: 'ein-sicheres-passwort',
};

test.describe.configure({ mode: 'serial' });

let page: Page;
let workspaceUrl = '';

const db = () => page.getByTestId('database-view').first();
const rows = () => db().getByTestId('table-row');
const cell = (row: number, property: string) =>
  rows().nth(row).locator(`[data-testid="cell"][data-property="${property}"]`);
const header = (property: string) =>
  db().locator(`[data-testid="column-header"][data-property="${property}"]`);

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ locale: 'de-DE' });
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
  workspaceUrl = new URL(page.url()).pathname;
});
test.afterAll(async () => {
  await page.close();
});

async function newTeamPage(title: string) {
  await page.goto(workspaceUrl);
  await expect(page.getByTestId('section-TEAM')).toBeVisible();
  const before = page.url();
  await page
    .getByTestId('section-TEAM')
    .getByRole('button', { name: 'Seite in Team hinzufügen' })
    .click({ force: true });
  await expect(page).not.toHaveURL(before);
  await page.getByTestId('page-title').fill(title);
  await page.getByTestId('page-title').press('Enter');
  await expect(page).toHaveTitle(`${title} | Jotion`);
  await expect(page.getByTestId('editor')).toBeFocused();
}

/** Schreibt in eine Text-Zelle und bestätigt mit Enter. */
async function typeInCell(target: ReturnType<typeof cell>, text: string) {
  await target.click();
  const input = db().getByTestId('cell-input');
  await expect(input).toBeFocused();
  await input.fill(text);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

async function addProperty(type: string, name: string) {
  await db().getByTestId('add-property').click();
  await page.getByTestId(`type-${type}`).click();
  // Neue Spalte heißt wie ihr Typ; umbenennen
  const typeLabel = { number: 'Zahl', select: 'Auswahl', checkbox: 'Checkbox' }[type]!;
  await header(typeLabel).getByRole('button').first().click();
  await page.getByTestId('property-name').fill(name);
  await page.getByTestId('property-name').press('Enter');
  await page.keyboard.press('Escape');
  await expect(header(name)).toBeVisible();
}

test('Inline-Datenbank über das Slash-Menü, Zeilen und Werte bearbeiten', async () => {
  await newTeamPage('Haushalt');
  await page.keyboard.type('/datenbank');
  await expect(page.getByTestId('slash-menu')).toContainText('Datenbank');
  await page.keyboard.press('Enter');
  await expect(db()).toBeVisible();
  await expect(header('Name')).toBeVisible();
  await db().getByTestId('database-title').fill('Einkäufe');
  await db().getByTestId('database-title').press('Enter');

  for (let i = 0; i < 3; i++) {
    await db().getByTestId('add-row').click();
    await expect(rows()).toHaveCount(i + 1);
  }
  await typeInCell(cell(0, 'Name'), 'Milch');
  await typeInCell(cell(1, 'Name'), 'Brot');
  await typeInCell(cell(2, 'Name'), 'Käse');

  await addProperty('number', 'Preis');
  await typeInCell(cell(0, 'Preis'), '1,5');
  await typeInCell(cell(1, 'Preis'), '3');
  await typeInCell(cell(2, 'Preis'), '6');
  await expect(cell(0, 'Preis')).toContainText('1,5');

  await addProperty('select', 'Laden');
  await cell(0, 'Laden').click();
  await page.getByTestId('option-search').fill('Markt');
  await page.getByTestId('option-search').press('Enter');
  await expect(cell(0, 'Laden')).toContainText('Markt');
  await cell(1, 'Laden').click();
  await page.getByTestId('option').filter({ hasText: 'Markt' }).click();
  await expect(cell(1, 'Laden')).toContainText('Markt');

  // Alles ist gespeichert
  await page.reload();
  await expect(rows()).toHaveCount(3);
  await expect(cell(2, 'Name')).toHaveText(/^Käse/);
  await expect(cell(1, 'Laden')).toContainText('Markt');
  await expect(db().getByTestId('database-title')).toHaveValue('Einkäufe');
});

test('Filter mit Gruppe, Sortierung, Suche und Berechnung', async () => {
  // Filter: Preis > 2
  await db().getByTestId('filter-button').click();
  await page.getByTestId('add-filter').click();
  await page.getByTestId('filter-property').selectOption({ label: 'Preis' });
  await page.getByTestId('filter-operator').selectOption({ label: '>' });
  await page.getByTestId('filter-value').fill('2');
  await expect(rows()).toHaveCount(2);
  // ODER-Gruppe: ... oder Name enthält "milch"
  await page.getByTestId('add-filter-group').click();
  await page.getByTestId('filter-op').selectOption('or');
  const inner = page.getByTestId('filter-condition').nth(1);
  await inner.getByTestId('filter-property').selectOption({ label: 'Name' });
  await inner.getByTestId('filter-operator').selectOption({ label: 'enthält' });
  await inner.getByTestId('filter-value').fill('milch');
  await expect(rows()).toHaveCount(3);
  await page.keyboard.press('Escape');

  // Sortierung absteigend nach Preis
  await db().getByTestId('sort-button').click();
  await page.getByTestId('add-sort').click();
  await page.getByTestId('sort-editor').locator('select').first().selectOption({ label: 'Preis' });
  await page.getByTestId('sort-direction').selectOption('desc');
  await page.keyboard.press('Escape');
  await expect(cell(0, 'Name')).toHaveText(/^Käse/);
  await expect(cell(2, 'Name')).toHaveText(/^Milch/);

  // Summe der Preise
  await db().locator('[data-testid="calculation"][data-property="Preis"]').click();
  await page.getByTestId('calc-sum').click();
  await expect(db().locator('[data-testid="calculation"][data-property="Preis"]')).toContainText(
    '10,5',
  );

  // Suche in der Ansicht
  await db().getByTestId('search-button').click();
  await db().getByTestId('database-search').fill('bro');
  await expect(rows()).toHaveCount(1);
  await db().getByTestId('database-search').fill('');
  await expect(rows()).toHaveCount(3);

  // Gespeichert in der Ansicht
  await page.reload();
  await expect(db().getByTestId('filter-button')).toContainText('2');
  await expect(cell(0, 'Name')).toHaveText(/^Käse/);
});

test('Zweite Ansicht hat eigene Einstellungen', async () => {
  await db().getByTestId('add-view').click();
  await page.locator('[data-testid="add-view-type"][data-layout="table"]').click();
  await expect(db().getByTestId('view-tab')).toHaveCount(2);
  await expect(db().getByTestId('view-tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(db().getByTestId('filter-button')).not.toContainText('2');
  await expect(cell(0, 'Name')).toHaveText(/^Milch/);
  await db().getByTestId('view-tab').first().click();
  await expect(cell(0, 'Name')).toHaveText(/^Käse/);
});

test('Spaltenbreite ändern und Spalte ausblenden bleiben erhalten', async () => {
  const h = header('Preis');
  const before = (await h.boundingBox())!.width;
  const handle = h.getByTestId('column-resizer');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await h.boundingBox())!.width).toBeGreaterThan(before + 50);
  await page.reload();
  await expect
    .poll(async () => (await header('Preis').boundingBox())!.width)
    .toBeGreaterThan(before + 50);
  // Spalte per Drag-and-drop verschieben
  const order = () =>
    db()
      .getByTestId('column-header')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-property')));
  expect(await order()).toEqual(['Name', 'Tags', 'Preis', 'Laden']);
  await header('Laden').getByTestId('column-label').dragTo(header('Preis'));
  await expect.poll(order).toEqual(['Name', 'Tags', 'Laden', 'Preis']);
  await page.reload();
  await expect.poll(order).toEqual(['Name', 'Tags', 'Laden', 'Preis']);
  await db().getByTestId('properties-button').click();
  await page.locator('[data-testid="toggle-property"][data-property="Laden"]').click();
  await page.keyboard.press('Escape');
  await expect(header('Laden')).toHaveCount(0);
});

test('Zeile im Peek öffnen, Inhalt schreiben, als ganze Seite mit Properties', async () => {
  await rows().first().hover();
  await rows().first().getByTestId('open-row').click();
  const peek = page.getByTestId('row-peek');
  await expect(peek).toBeVisible();
  await expect(peek.getByTestId('page-title')).toHaveValue('Käse');
  await expect(peek.getByTestId('row-properties')).toContainText('Preis');
  const editor = peek.getByTestId('editor');
  await editor.click();
  await page.keyboard.type('Gouda, mittelalt');
  await expect(peek.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await peek.getByTestId('peek-open-page').click();
  await expect(page).toHaveTitle('Käse | Jotion');
  await expect(page.getByTestId('row-properties')).toContainText('6');
  await expect(page.getByTestId('editor')).toContainText('Gouda, mittelalt');
  // Breadcrumb zeigt die Datenbank
  await expect(page.getByRole('navigation', { name: 'Pfad' })).toContainText('Einkäufe');
  // Wert im Properties-Bereich ändern
  await page.getByTestId('row-properties').locator('[data-property="Preis"]').click();
  await page.getByTestId('cell-input').fill('7');
  await page.getByTestId('cell-input').press('Enter');
  await page.reload();
  await expect(page.getByTestId('row-properties')).toContainText('7');
  await page.goBack();
});

test('Zeilen auswählen und löschen', async () => {
  await expect(page).toHaveTitle('Haushalt | Jotion');
  await expect(rows()).toHaveCount(3);
  await rows().nth(2).hover();
  await rows().nth(2).getByTestId('row-select').check();
  await db().getByTestId('delete-rows').click();
  await expect(rows()).toHaveCount(2);
});

test('Full-Page-Datenbank und Linked Database', async () => {
  await newTeamPage('Projekte');
  await page.keyboard.type('/datenbank ganz');
  await expect(page.getByTestId('slash-menu')).toContainText('Datenbank ganzseitig');
  await page.keyboard.press('Enter');
  const ref = page.getByTestId('editor').getByTestId('page-ref');
  await expect(ref).toBeVisible();
  await ref.click();
  await expect(db()).toBeVisible();
  await page.getByTestId('page-title').fill('Aufgabenliste');
  await page.getByTestId('page-title').press('Tab');
  await expect(page).toHaveTitle('Aufgabenliste | Jotion');
  await db().getByTestId('new-row').click();
  await expect(page.getByTestId('row-peek')).toBeVisible();
  await page.getByTestId('row-peek').getByTestId('page-title').fill('Dach reparieren');
  await page.getByTestId('row-peek').getByTestId('page-title').blur();
  await page.keyboard.press('Escape');
  await expect(cell(0, 'Name')).toHaveText(/^Dach reparieren/);

  // Verknüpfte Ansicht in einer anderen Seite
  await newTeamPage('Übersicht');
  await page.keyboard.type('/verknüpfte');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('quick-search-input')).toBeFocused();
  await page.keyboard.type('Aufgabenliste');
  await expect(page.getByTestId('quick-search-result').first()).toContainText('Aufgabenliste');
  await page.keyboard.press('Enter');
  await expect(db().getByTestId('linked-source')).toContainText('Aufgabenliste');
  await expect(cell(0, 'Name')).toHaveText(/^Dach reparieren/);
});

test('Dark Mode zeigt die Tabelle lesbar', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const bg = await db()
    .getByTestId('table-row')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgb(255, 255, 255)');
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.emulateMedia({ colorScheme: 'light' });
});
