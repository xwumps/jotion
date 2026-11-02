import { expect, test } from '@playwright/test';

const shots = process.env.JOTION_SCREENSHOT_DIR;

test.describe('Phase 0: gebrandete Shell', () => {
  test('Startseite zeigt Jotion-Branding und gesunden Systemstatus', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Jotion');
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toContainText(
      'Mein Workspace',
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Guten (Morgen|Tag|Abend)/);
    const status = page.getByTestId('system-status');
    await expect(status).toHaveAttribute('data-status', 'ok');
    await expect(status).toContainText('Alle Dienste laufen');
    if (shots) await page.screenshot({ path: `${shots}/home-light.png` });
  });

  test('Dark Mode lässt sich umschalten und bleibt nach Reload erhalten', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('radio', { name: 'Dunkel' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(25, 25, 25)');
    if (shots) await page.screenshot({ path: `${shots}/home-dark.png` });
  });

  test('Sprache wechselt auf Englisch und zurück', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('radio', { name: 'en' }).click();
    await expect(page.getByTestId('system-status')).toContainText('All services are running');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('radio', { name: 'de' }).click();
    await expect(page.getByTestId('system-status')).toContainText('Alle Dienste laufen');
  });

  test('Login-Seite ist gebrandet', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle('Bei Jotion anmelden | Jotion');
    await expect(page.getByRole('heading', { name: 'Bei Jotion anmelden' })).toBeVisible();
    await expect(page.getByText('Die Anmeldung wird in Phase 1 freigeschaltet.')).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/login.png` });
  });

  test('Sicherheits-Header werden gesetzt', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers()['x-powered-by']).toBeUndefined();
  });
});
