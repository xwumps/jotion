import { expect, test, type Page } from '@playwright/test';

/**
 * Ende-zu-Ende-Ablauf Phase 1 gegen einen frisch gestarteten Stack (leere Datenbank).
 * Die Schritte bauen aufeinander auf und laufen daher seriell.
 */
const shots = process.env.JOTION_SCREENSHOT_DIR;
const OWNER = {
  name: 'Jarne Beispiel',
  email: 'jarne@example.com',
  password: 'ein-sicheres-passwort',
};
const MEMBER = { name: 'Max Muster', email: 'max@example.com', password: 'noch-ein-passwort' };

test.describe.configure({ mode: 'serial' });

let page: Page;
let workspaceUrl = '';

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ locale: 'de-DE' });
});
test.afterAll(async () => {
  await page.close();
});

const sidebar = () => page.getByRole('complementary', { name: 'Sidebar' });
const treeItem = (title: string) =>
  sidebar().locator(`[data-testid="tree-item"][data-title="${title}"]`);
/** Klickt einen Anlegen-Knopf, wartet auf die neue Seite und setzt den Titel. */
async function createAndName(click: () => Promise<void>, title: string) {
  const before = page.url();
  await click();
  await expect(page).not.toHaveURL(before);
  await expect(page.getByTestId('page-title')).toHaveValue('');
  await page.getByTestId('page-title').fill(title);
  await page.getByTestId('page-title').blur();
  // Gespeichert, sobald die Server-Antwort den Tab-Titel aktualisiert hat
  await expect(page).toHaveTitle(`${title} | Jotion`);
}

const snap = async (name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};

test('Infrastruktur: Healthcheck und Sicherheits-Header', async ({ request }) => {
  expect((await request.get('/healthz')).ok()).toBe(true);
  const res = await request.get('/login');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['x-frame-options']).toBe('SAMEORIGIN');
  expect(res.headers()['x-powered-by']).toBeUndefined();
});

test('Ersteinrichtung legt Owner und Workspace an', async () => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Willkommen bei Jotion' })).toBeVisible();
  await snap('01-setup');
  await page.getByLabel('Name', { exact: true }).fill(OWNER.name);
  await page.getByLabel('E-Mail').fill(OWNER.email);
  await page.getByLabel('Passwort').fill(OWNER.password);
  await page.getByLabel('Name des Workspace').fill('Familie');
  await page.getByRole('button', { name: 'Jotion einrichten' }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/);
  workspaceUrl = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Jarne');
  await expect(page.getByTestId('workspace-switcher')).toContainText('Familie');
  // Setup ist danach gesperrt
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/login$|\/w\//);
  await page.goto(workspaceUrl);
});

test('Teamseite anlegen, benennen, Icon und Cover setzen', async () => {
  await page
    .getByTestId('section-TEAM')
    .getByRole('button', { name: 'Seite hinzufügen' })
    .first()
    .click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]+$/);
  const title = page.getByTestId('page-title');
  await title.fill('Projektplan');
  await title.press('Enter');
  await expect(treeItem('Projektplan')).toBeVisible();

  await page.getByTestId('page-title').hover();
  await page.getByRole('button', { name: 'Icon hinzufügen' }).click();
  await page.getByRole('button', { name: '🚀' }).click();
  await expect(page.getByTestId('page-icon')).toContainText('🚀');

  await page.getByTestId('page-title').hover();
  await page.getByRole('button', { name: 'Cover hinzufügen' }).click();
  await expect(page.getByTestId('page-cover')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('page-title')).toHaveValue('Projektplan');
  await expect(page.getByTestId('page-icon')).toContainText('🚀');
  await expect(page).toHaveTitle('Projektplan | Jotion');
  await snap('02-page');
});

test('Unterseite mit Breadcrumbs', async () => {
  await createAndName(
    () => page.getByRole('button', { name: 'Unterseite hinzufügen' }).last().click(),
    'Meilensteine',
  );
  const crumbs = page.getByRole('navigation', { name: 'Pfad' });
  await expect(crumbs).toContainText('Projektplan');
  await expect(crumbs).toContainText('Meilensteine');
  await crumbs.getByRole('link', { name: /Projektplan/ }).click();
  await expect(page.getByTestId('subpage-link')).toHaveText(/Meilensteine/);
});

test('Drag-and-drop verschiebt eine Seite in eine andere', async () => {
  await createAndName(
    () =>
      page
        .getByTestId('section-TEAM')
        .getByRole('button', { name: 'Seite in Team hinzufügen' })
        .click({ force: true }),
    'Notizen',
  );

  const source = await treeItem('Notizen').boundingBox();
  const target = await treeItem('Projektplan').boundingBox();
  if (!source || !target) throw new Error('Baumelemente nicht gefunden');
  await page.mouse.move(source.x + 60, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 60, source.y + source.height / 2 - 10, { steps: 4 });
  await page.mouse.move(target.x + 60, target.y + target.height / 2, { steps: 12 });
  await snap('03-drag');
  await page.mouse.up();

  // Notizen ist jetzt Unterseite von Projektplan
  await expect(page.getByRole('navigation', { name: 'Pfad' })).toContainText('Projektplan', {
    timeout: 10_000,
  });
  await expect(
    sidebar().getByRole('treeitem', { name: 'Projektplan' }).getByRole('group'),
  ).toContainText('Notizen');
});

test('Favoriten', async () => {
  await treeItem('Projektplan').locator('a').click();
  await page.getByRole('button', { name: 'Zu Favoriten' }).click();
  await expect(sidebar().getByText('Favoriten')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aus Favoriten entfernen' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('Papierkorb und Wiederherstellen als Einheit', async () => {
  await page.getByRole('button', { name: 'Seitenoptionen' }).click();
  await page.getByRole('menuitem', { name: 'In den Papierkorb' }).click();
  await expect(page.getByTestId('trash-banner')).toBeVisible();
  await expect(treeItem('Projektplan')).toHaveCount(0);

  await page.getByTestId('nav-trash').click();
  const dialog = page.getByRole('dialog', { name: 'Papierkorb' });
  await expect(dialog.getByTestId('trash-item')).toHaveCount(1);
  await snap('04-trash');
  await dialog.getByRole('button', { name: 'Wiederherstellen' }).click();
  await expect(dialog.getByText('Der Papierkorb ist leer.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(treeItem('Projektplan')).toBeVisible();
  await expect(page.getByTestId('trash-banner')).toHaveCount(0);
});

test('Private Seite anlegen', async () => {
  await createAndName(
    () =>
      page
        .getByTestId('section-PRIVATE')
        .getByRole('button', { name: 'Seite in Privat hinzufügen' })
        .click({ force: true }),
    'Mein Tagebuch',
  );
  await expect(page.getByTestId('section-PRIVATE')).toContainText('Mein Tagebuch');
});

test('Dark Mode bleibt nach Reload erhalten', async () => {
  await page.getByRole('radio', { name: 'Dunkel' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await treeItem('Projektplan').locator('a').click();
  await expect(page.getByTestId('page-title')).toHaveValue('Projektplan');
  await snap('05-dark');
  await page.getByRole('radio', { name: 'Hell' }).click();
});

test('Einladung: zweites Mitglied sieht Team-, aber keine privaten Seiten', async ({ browser }) => {
  await page.goto(`${workspaceUrl}/settings/members`);
  await page.getByTestId('create-invite').click();
  const link = (await page.getByTestId('invite-link').textContent())!;
  expect(link).toContain('/invite/');
  await snap('06-members');

  const ctx = await browser.newContext({ locale: 'de-DE' });
  const max = await ctx.newPage();
  await max.goto(new URL(link).pathname);
  await expect(max.getByRole('heading', { name: 'Einladung zu Familie' })).toBeVisible();
  await max.getByLabel('Name', { exact: true }).fill(MEMBER.name);
  await max.getByLabel('E-Mail').fill(MEMBER.email);
  await max.getByLabel('Passwort').fill(MEMBER.password);
  await max.getByRole('button', { name: 'Konto erstellen und beitreten' }).click();
  await expect(max).toHaveURL(/\/w\/[0-9a-f-]+$/);
  const maxSidebar = max.getByRole('complementary', { name: 'Sidebar' });
  await expect(maxSidebar.getByTestId('section-TEAM')).toContainText('Projektplan');
  await expect(maxSidebar).not.toContainText('Mein Tagebuch');

  // Einladung ist verbraucht
  const again = await ctx.newPage();
  await ctx.clearCookies();
  await again.goto(new URL(link).pathname);
  await expect(again.getByRole('heading', { name: 'Einladung ungültig' })).toBeVisible();
  await ctx.close();

  await page.reload();
  await expect(page.getByTestId('member-row')).toHaveCount(2);
});

test('Abmelden und wieder anmelden', async () => {
  await page.goto(`${workspaceUrl}/settings/account`);
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('E-Mail').fill(OWNER.email);
  await page.getByLabel('Passwort').fill('falsches-passwort');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText(
    'E-Mail oder Passwort falsch',
  );
  await page.getByLabel('Passwort').fill(OWNER.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(new RegExp(`${workspaceUrl}$`));
  await expect(page.getByTestId('recent-card').first()).toBeVisible();
  await snap('07-home');
});

test('Sprache wechselt auf Englisch', async () => {
  await page.getByRole('radio', { name: 'en' }).click();
  await expect(page.getByTestId('nav-settings')).toHaveText('Settings');
  await page.getByRole('radio', { name: 'de' }).click();
  await expect(page.getByTestId('nav-settings')).toHaveText('Einstellungen');
});
