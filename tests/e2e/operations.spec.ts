import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 12: Import über den Dialog, Export, API-Token, Admin-Bereich mit Sicherung, mobile Ansicht.
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

async function login(p: Page) {
  await p.goto('/');
  await p.waitForURL(/\/setup$|\/login|\/w\//);
  if (p.url().endsWith('/setup')) {
    await p.getByLabel('Name', { exact: true }).fill(OWNER.name);
    await p.getByLabel('E-Mail').fill(OWNER.email);
    await p.getByLabel('Passwort').fill(OWNER.password);
    await p.getByLabel('Name des Workspace').fill('Familie');
    await p.getByRole('button', { name: 'Jotion einrichten' }).click();
  } else if (p.url().includes('/login')) {
    await p.getByLabel('E-Mail').fill(OWNER.email);
    await p.getByLabel('Passwort').fill(OWNER.password);
    await p.getByRole('button', { name: 'Anmelden' }).click();
  }
  await p.waitForURL(/\/w\/[0-9a-f-]+$/);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ locale: 'de-DE', viewport: { width: 1280, height: 900 } });
  await login(page);
  ws = new URL(page.url()).pathname.split('/')[2]!;
});
test.afterAll(async () => {
  await page.close();
});

test('Markdown importieren und als ZIP exportieren', async () => {
  await page.getByTestId('nav-import').click();
  const dialog = page.getByTestId('import-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('import-file').setInputFiles({
    name: 'notiz.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(`# Import ${RUN}\n\n- [ ] Erste Aufgabe\n\n**Fett** und *kursiv*`),
  });
  await expect(page.getByTestId('import-file-name')).toHaveText('notiz.md');
  await page.getByTestId('import-run').click();
  await page.waitForURL(/\/p\/[0-9a-f-]+$/);
  await expect(page.getByTestId('page-title')).toHaveValue(`Import ${RUN}`);
  await expect(page.getByTestId('editor')).toContainText('Erste Aufgabe');

  await page.getByRole('button', { name: 'Seitenoptionen' }).click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-markdown').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`Import ${RUN}.zip`);
  const bytes = readFileSync(await file.path());
  // ZIP-Signatur
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
});

test('API-Token erstellen und damit lesen', async () => {
  await page.goto(`/w/${ws}/settings/account`);
  await page.getByTestId('api-token-name').fill(`Skript ${RUN}`);
  await page.getByTestId('api-token-create').click();
  const token = await page.getByTestId('api-token-value').inputValue();
  expect(token).toMatch(/^jtn_/);
  await expect(page.locator(`[data-testid="api-token"][data-name="Skript ${RUN}"]`)).toBeVisible();
  const res = await page.request.get('/api/auth/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect((await res.json()).user.email).toBe(OWNER.email);
  const write = await page.request.post(`/api/workspaces/${ws}/pages`, {
    headers: { authorization: `Bearer ${token}`, cookie: '' },
    data: { title: 'x', scope: 'TEAM' },
  });
  expect(write.status()).toBe(403);
});

test('Server-Bereich: Zustand und Sicherung auf Knopfdruck', async () => {
  test.setTimeout(120_000);
  await page.goto(`/w/${ws}/settings/server`);
  const admin = page.getByTestId('admin-settings');
  await expect(admin).toBeVisible();
  await expect(admin.locator('[data-testid="admin-check"][data-status="ok"]')).toHaveCount(3);
  const before = await page.getByTestId('admin-backup').count();
  await page.getByTestId('admin-backup-now').click();
  await expect(page.getByTestId('admin-backup')).toHaveCount(before + 1, { timeout: 90_000 });
  await expect(page.getByTestId('admin-backup').first()).toContainText('manuell');
});

test('Mobile Ansicht: Seitenleiste über das Menü', async ({ browser }) => {
  const phone = await browser.newPage({ locale: 'de-DE', viewport: { width: 390, height: 844 } });
  await login(phone);
  const sidebar = phone.getByTestId('sidebar');
  await expect(sidebar).toHaveAttribute('data-open', 'false');
  await expect(phone.getByTestId('mobile-menu')).toBeVisible();
  await phone.getByTestId('mobile-menu').click();
  await expect(sidebar).toHaveAttribute('data-open', 'true');
  await phone.getByTestId('nav-settings').click();
  await phone.waitForURL(/\/settings\//);
  await expect(sidebar).toHaveAttribute('data-open', 'false');
  // Kein waagrechtes Scrollen der Seite
  const overflow = await phone.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await phone.close();
});
