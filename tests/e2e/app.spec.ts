import { execSync } from 'node:child_process';
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

test('Unterseite über das Slash-Menü, mit Breadcrumbs', async () => {
  await createAndName(async () => {
    await page.getByTestId('page-title').press('Enter');
    await expect(page.getByTestId('editor')).toBeFocused();
    await page.keyboard.type('/seite');
    await expect(page.getByTestId('slash-menu')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('page-ref')).toBeVisible();
    await page.getByTestId('page-ref').click();
  }, 'Meilensteine');
  const crumbs = page.getByRole('navigation', { name: 'Pfad' });
  await expect(crumbs).toContainText('Projektplan');
  await expect(crumbs).toContainText('Meilensteine');
  await crumbs.getByRole('link', { name: /Projektplan/ }).click();
  await expect(page.getByTestId('page-ref')).toHaveText(/Meilensteine/);
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

// ---------------------------------------------------------------------------
// Phase 2: Block-Editor und Schutz vor Datenverlust
// ---------------------------------------------------------------------------

const editor = () => page.getByTestId('editor');
const saveState = () => page.getByTestId('save-status');

async function newTeamPage(title: string) {
  await page.goto(workspaceUrl);
  // Warten, bis die Seite hydriert ist (Sidebar-Daten per Client geladen)
  await expect(treeItem('Projektplan')).toBeVisible();
  await createAndName(
    () =>
      page
        .getByTestId('section-TEAM')
        .getByRole('button', { name: 'Seite in Team hinzufügen' })
        .click({ force: true }),
    title,
  );
  await page.getByTestId('page-title').press('Enter');
  await expect(editor()).toBeFocused();
}

test('Markdown-Kürzel erzeugen die passenden Blöcke und bleiben nach Neuladen erhalten', async () => {
  await newTeamPage('Blöcke');
  const k = page.keyboard;
  await k.type('# Großes Thema');
  await k.press('Enter');
  await k.type('## Unterthema');
  await k.press('Enter');
  await k.type('Normaler Text mit **fett** und *kursiv*.');
  await k.press('Enter');
  await k.type('- Punkt eins');
  await k.press('Enter');
  await k.type('Punkt zwei');
  await k.press('Enter');
  await k.press('Enter');
  await k.type('1. Erster Schritt');
  await k.press('Enter');
  await k.press('Enter');
  await k.type('[] Aufgabe offen');
  await k.press('Enter');
  await k.press('Enter');
  await k.type('" Ein Zitat');
  await k.press('Enter');
  await k.press('Enter');
  // Wie bei Markdown: ``` gefolgt von Leerzeichen (oder einer Sprache und Leerzeichen)
  await k.type('``` ');
  await k.type('const x = 42;');
  // Codeblock verlassen: dreimal Enter am Ende
  await k.press('Enter');
  await k.press('Enter');
  await k.press('Enter');
  await k.type('> Aufklappbar');
  // Enter im Toggle-Titel springt in den Inhalt
  await k.press('Enter');
  await k.type('Versteckter Inhalt');
  await expect(saveState()).toHaveAttribute('data-state', 'saved');

  await page.reload();
  await expect(editor().locator('h1')).toHaveText('Großes Thema');
  await expect(editor().locator('h2')).toHaveText('Unterthema');
  await expect(editor().locator('strong')).toHaveText('fett');
  await expect(editor().locator('em')).toHaveText('kursiv');
  await expect(editor().locator('ul:not([data-type]) > li')).toHaveCount(2);
  await expect(editor().locator('ol > li')).toHaveCount(1);
  await expect(editor().locator('ul[data-type="taskList"] li')).toContainText('Aufgabe offen');
  await expect(editor().locator('blockquote')).toContainText('Ein Zitat');
  await expect(editor().locator('[data-type="details"]')).toContainText('Aufklappbar');
  await expect(editor().locator('[data-type="details"]')).toContainText('Versteckter Inhalt');
  // Kein leerer Absatz vor der ersten Überschrift
  await expect(editor().locator('> *').first()).toHaveText('Großes Thema');
  // Mehrfaches Öffnen darf das Dokument nicht verändern (keine zusätzlichen leeren Absätze)
  const blockCount = await editor().locator('> *').count();
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await expect(editor().locator('h1')).toHaveText('Großes Thema');
    await expect(saveState()).toHaveAttribute('data-state', 'saved');
  }
  await expect(editor().locator('> *')).toHaveCount(blockCount);
  await expect(editor().locator('pre')).toContainText('const x = 42;');
  await snap('10-blocks');

  // To-do abhaken bleibt erhalten
  await editor().locator('ul[data-type="taskList"] input[type="checkbox"]').check();
  await expect(saveState()).toHaveAttribute('data-state', 'saved');
  await page.reload();
  await expect(editor().locator('ul[data-type="taskList"] input[type="checkbox"]')).toBeChecked();
});

test('Formatierung über das Bubble-Menü und Rückgängig', async () => {
  await newTeamPage('Formatierung');
  await page.keyboard.type('Markiere mich');
  // Yjs fasst Änderungen innerhalb von 500 ms zu einem Rückgängig-Schritt zusammen
  await page.waitForTimeout(700);
  await page.keyboard.press('Shift+Home');
  await expect(page.getByTestId('bubble-menu')).toBeVisible();
  await page.getByTestId('bubble-menu').getByRole('button', { name: 'Fett' }).click();
  await expect(editor().locator('strong')).toHaveText('Markiere mich');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor().locator('strong')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(editor().locator('strong')).toHaveText('Markiere mich');
  await page.getByTestId('bubble-menu').getByRole('button', { name: 'Farbe' }).click();
  await page.getByRole('button', { name: 'Rot' }).first().click();
  await expect(editor().locator('[data-color="red"]')).toHaveText('Markiere mich');
});

test('Blockmenü: duplizieren, umwandeln, löschen', async () => {
  await newTeamPage('Blockmenü');
  await page.keyboard.type('Mein Block');
  const block = editor().locator('p', { hasText: 'Mein Block' });
  const openMenu = async () => {
    await block.first().hover();
    await page.getByTestId('block-menu-trigger').click();
  };
  await openMenu();
  await page.getByRole('menuitem', { name: 'Duplizieren' }).click();
  await expect(editor().locator('p', { hasText: 'Mein Block' })).toHaveCount(2);

  await openMenu();
  await page.getByRole('menuitem', { name: 'Umwandeln in' }).click();
  await page.getByRole('menuitem', { name: 'Überschrift 2' }).click();
  await expect(editor().locator('h2')).toHaveText('Mein Block');

  await editor().locator('p', { hasText: 'Mein Block' }).hover();
  await page.getByTestId('block-menu-trigger').click();
  await page.getByRole('menuitem', { name: 'Löschen' }).click();
  await expect(editor().locator('p', { hasText: 'Mein Block' })).toHaveCount(0);
  await expect(editor().locator('h2')).toHaveText('Mein Block');
});

test('Slash-Menü ohne Treffer bleibt normaler Text', async () => {
  await newTeamPage('Schrägstrich');
  await page.keyboard.type('/abc');
  await expect(page.getByTestId('slash-menu')).toBeVisible();
  await page.keyboard.type(' def');
  await expect(page.getByTestId('slash-menu')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(editor().locator('p').first()).toHaveText('/abc def');
});

test('Link zu Seite über Slash-Menü und Schnellsuche', async () => {
  await newTeamPage('Verweise');
  await page.keyboard.type('/link zu');
  await expect(page.getByTestId('slash-menu')).toContainText('Link zu Seite');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('quick-search-input')).toBeFocused();
  await page.keyboard.type('Projektplan');
  await expect(page.getByTestId('quick-search-result').first()).toContainText('Projektplan');
  await page.keyboard.press('Enter');
  const ref = editor().getByTestId('page-ref');
  await expect(ref).toContainText('Projektplan');
  await ref.click();
  await expect(page).toHaveTitle('Projektplan | Jotion');
});

test('Schnellsuche mit Strg+K', async () => {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('quick-search-input')).toBeFocused();
  await page.getByTestId('quick-search-input').fill('meilen');
  // Auf die Treffer zur aktuellen Eingabe warten (nicht auf die vorherige Liste)
  await expect(page.getByTestId('quick-search-result')).toHaveCount(1);
  await expect(page.getByTestId('quick-search-result').first()).toContainText('Meilensteine');
  await expect(page.getByTestId('quick-search-result').first()).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(page).toHaveTitle('Meilensteine | Jotion');
});

test('Zwei Tabs sehen Änderungen live', async () => {
  await newTeamPage('Gemeinsam');
  const url = page.url();
  // Zweiter Tab: eigener Kontext mit derselben Anmeldung
  const ctx = await page
    .context()
    .browser()!
    .newContext({ locale: 'de-DE', storageState: await page.context().storageState() });
  const second = await ctx.newPage();
  await second.goto(url);
  await expect(second.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await page.keyboard.type('Aus Tab eins');
  await expect(second.getByTestId('editor')).toContainText('Aus Tab eins');
  await second.getByTestId('editor').locator('p').last().click();
  await second.keyboard.press('End');
  await second.keyboard.press('Enter');
  await second.keyboard.type('Aus Tab zwei');
  await expect(editor()).toContainText('Aus Tab zwei');
  await ctx.close();
});

test('Offline weiterschreiben: lokal gesichert, danach automatisch gespeichert', async () => {
  await newTeamPage('Offline');
  await page.keyboard.type('Vor dem Ausfall.');
  await expect(saveState()).toHaveAttribute('data-state', 'saved');
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.keyboard.press('Enter');
  await page.keyboard.type('Während des Ausfalls geschrieben.');
  await expect(saveState()).toHaveAttribute('data-state', /offline|saving/);
  await snap('11-offline');
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(saveState()).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
  // Frischer Browserkontext ohne lokale Kopie: Inhalt kommt vom Server
  const fresh = await page
    .context()
    .browser()!
    .newContext({ locale: 'de-DE', storageState: await page.context().storageState() });
  const p2 = await fresh.newPage();
  await p2.goto(page.url());
  await expect(p2.getByTestId('editor')).toContainText('Während des Ausfalls geschrieben.');
  await fresh.close();
});

test('Gesperrte Seiten sind schreibgeschützt', async () => {
  await newTeamPage('Gesperrt');
  await page.keyboard.type('Fester Inhalt');
  await expect(saveState()).toHaveAttribute('data-state', 'saved');
  await page.getByRole('button', { name: 'Seitenoptionen' }).click();
  await page.getByRole('menuitem', { name: 'Seite sperren' }).click();
  await page.keyboard.press('Escape');
  await expect(editor()).toHaveAttribute('contenteditable', 'false');
  await expect(saveState()).toHaveAttribute('data-state', 'readonly');
  await expect(page.getByTestId('page-title')).toHaveAttribute('readonly', '');
});

test('Server-Neustart: weiterschreiben ohne Verlust', async () => {
  // Startet den API-Container neu; nur mit JOTION_E2E_DOCKER=1 (CI und lokal mit Docker)
  test.skip(process.env.JOTION_E2E_DOCKER !== '1', 'benötigt Docker-Zugriff');
  test.setTimeout(120_000);
  await newTeamPage('Neustart');
  await page.keyboard.type('Vor dem Neustart.');
  await expect(saveState()).toHaveAttribute('data-state', 'saved');
  const composeProject = process.env.JOTION_COMPOSE_PROJECT;
  execSync(`docker compose ${composeProject ? `-p ${composeProject} ` : ''}restart api`, {
    stdio: 'ignore',
    timeout: 90_000,
  });
  // Während die API weg ist, wird lokal weiter gesichert
  await page.keyboard.press('Enter');
  await page.keyboard.type('Während des Neustarts.');
  await expect(saveState()).toHaveAttribute('data-state', 'saved', { timeout: 60_000 });
  await page.reload();
  await expect(editor()).toContainText('Vor dem Neustart.');
  await expect(editor()).toContainText('Während des Neustarts.');
});
