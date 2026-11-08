import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Phase 10: Zusammenarbeit mit mehreren Nutzern. Freigabe mit Stufen, Kommentar mit Erwähnung,
 * Posteingang, Präsenz, Synced Block und Lese-Link.
 */
const OWNER = {
  name: 'Jarne Beispiel',
  email: 'jarne@example.com',
  password: 'ein-sicheres-passwort',
};
const RUN = Date.now().toString(36).slice(-4);
const MEMBER = {
  name: `Mia${RUN}`,
  email: `mia-${RUN}@example.com`,
  password: 'noch-ein-sicheres-passwort',
};

test.describe.configure({ mode: 'serial' });

let owner: Page;
let member: Page;
let ws = '';
let memberId = '';

const ctxOptions = {
  locale: 'de-DE',
  timezoneId: 'Europe/Berlin',
  viewport: { width: 1400, height: 900 },
};

async function login(browser: Browser): Promise<Page> {
  const page = await browser.newPage(ctxOptions);
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
  return page;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api<T = any>(p: Page, method: string, path: string, body?: unknown): Promise<T> {
  return p.evaluate(
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

test.beforeAll(async ({ browser }) => {
  owner = await login(browser);
  ws = new URL(owner.url()).pathname.split('/')[2]!;
  // Zweites Mitglied per Einladung registrieren (eigener Browser-Kontext)
  const inv = await api(owner, 'POST', `/workspaces/${ws}/invitations`, { role: 'MEMBER' });
  const token = new URL(inv.url).pathname.split('/').pop()!;
  member = await browser.newPage(ctxOptions);
  await member.goto('/login');
  await api(member, 'POST', '/auth/register', { token, ...MEMBER });
  memberId = (await api(member, 'GET', '/auth/me')).user.id;
});
test.afterAll(async () => {
  await owner.close();
  await member.close();
});

async function typeInEditor(p: Page, text: string) {
  const editor = p.getByTestId('editor');
  await editor.click();
  await p.keyboard.type(text);
  await expect(editor).toContainText(text);
}

test('Freigabe "kommentieren": Mitglied liest, kommentiert mit Erwähnung, Owner bekommt Nachricht', async () => {
  test.setTimeout(90_000);
  const page = await api(owner, 'POST', `/workspaces/${ws}/pages`, {
    title: `Reiseplan ${RUN}`,
    scope: 'TEAM',
  });
  await owner.goto(`/w/${ws}/p/${page.id}`);
  await typeInEditor(owner, 'Abfahrt am Samstag um acht');
  await owner.waitForTimeout(800);

  // Freigabe über den Dialog: Mitglied darf kommentieren
  await owner.getByTestId('share-button').click();
  const popover = owner.getByTestId('share-popover');
  await popover.getByTestId('share-add-user').selectOption(memberId);
  await popover.getByTestId('share-add-level').selectOption('comment');
  await popover.getByTestId('share-add').click();
  await expect(
    popover.locator(`[data-testid="share-entry"][data-user="${MEMBER.email}"]`),
  ).toBeVisible();
  await owner.keyboard.press('Escape');

  // Mitglied: Präsenz beim Owner, Editor schreibgeschützt
  await member.goto(`/w/${ws}/p/${page.id}`);
  const memberEditor = member.getByTestId('editor');
  await expect(memberEditor).toContainText('Abfahrt am Samstag');
  await expect(memberEditor).toHaveAttribute('contenteditable', 'false');
  await expect(
    owner.locator(`[data-testid="presence-avatar"][data-name="${MEMBER.name}"]`),
  ).toBeVisible({ timeout: 15_000 });

  // Text markieren, kommentieren und den Owner erwähnen
  // Wort "Samstag" markieren
  await memberEditor.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const i = node.textContent?.indexOf('Samstag') ?? -1;
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 'Samstag'.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
  });
  await member.getByTestId('readonly-comment').click();
  const draft = member.getByTestId('comment-draft');
  await expect(draft).toBeVisible();
  const input = draft.getByTestId('comment-input');
  await input.click();
  await member.keyboard.type('Lieber Sonntag? @Jar');
  await expect(member.getByTestId('comment-mention-menu')).toBeVisible();
  await member.keyboard.press('Enter');
  await member.keyboard.type('was meinst du?');
  await member.keyboard.press('Enter');
  const thread = member.getByTestId('comment-thread').first();
  await expect(thread).toContainText('Lieber Sonntag?');
  await expect(thread).toContainText('Samstag');

  // Owner: Posteingang zeigt die Erwähnung (Echtzeit), Klick führt zum Thread
  await expect(owner.getByTestId('inbox-unread')).toBeVisible({ timeout: 15_000 });
  await owner.getByTestId('nav-inbox').click();
  const item = owner.locator('[data-testid="inbox-item"][data-type="mention_comment"]').first();
  await expect(item).toContainText(MEMBER.name);
  await item.click();
  await expect(owner.getByTestId('comments-panel')).toBeVisible();
  await expect(owner.getByTestId('comment-thread').first()).toContainText('was meinst du?');

  // Bearbeiten bleibt dem Mitglied verwehrt
  const res = await member.evaluate(
    async (id) =>
      (
        await fetch(`/api/pages/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'x' }),
        })
      ).status,
    page.id,
  );
  expect(res).toBe(403);
});

test('Kein Zugriff: Seite verschwindet für das Mitglied, auch aus der Suche', async () => {
  const page = await api(owner, 'POST', `/workspaces/${ws}/pages`, {
    title: `Geschenkideen ${RUN}`,
    scope: 'TEAM',
  });
  await api(owner, 'PUT', `/pages/${page.id}/permissions`, { userId: memberId, level: 'none' });
  await member.goto(`/w/${ws}/p/${page.id}`);
  await expect(member.getByTestId('page-not-found')).toBeVisible();
  const found = await api(
    member,
    'GET',
    `/workspaces/${ws}/search/content?q=Geschenkideen%20${RUN}`,
  );
  expect(found.map((r: { id: string }) => r.id)).not.toContain(page.id);
});

test('Synced Block: gleicher Inhalt auf zwei Seiten, Änderungen erscheinen überall', async () => {
  test.setTimeout(90_000);
  const a = await api(owner, 'POST', `/workspaces/${ws}/pages`, {
    title: `Sync A ${RUN}`,
    scope: 'TEAM',
  });
  const b = await api(owner, 'POST', `/workspaces/${ws}/pages`, {
    title: `Sync B ${RUN}`,
    scope: 'TEAM',
  });
  await owner.goto(`/w/${ws}/p/${a.id}`);
  await owner.getByTestId('editor').click();
  await owner.keyboard.type('/synced');
  await expect(owner.getByTestId('slash-menu')).toBeVisible();
  await owner.keyboard.press('Enter');
  const block = owner.getByTestId('synced-block');
  await expect(block).toBeVisible();
  const syncedEditor = block.getByTestId('synced-editor');
  await expect(syncedEditor).toBeVisible();
  await syncedEditor.click();
  await owner.keyboard.type('Packliste für alle');
  const syncedId = await block.getAttribute('data-page-id');
  expect(syncedId).toMatch(/^[0-9a-f-]{36}$/);
  await owner.waitForTimeout(1000);

  // Zweites Vorkommen per Einfügen des Sync-Tokens auf Seite B
  await member.goto(`/w/${ws}/p/${b.id}`);
  const editorB = member.getByTestId('editor');
  await editorB.click();
  await editorB.evaluate((el, token) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', token);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, `jotion-synced:${syncedId}`);
  const blockB = member.getByTestId('synced-block');
  await expect(blockB.getByTestId('synced-editor')).toContainText('Packliste für alle', {
    timeout: 15_000,
  });

  // Änderung auf Seite B erscheint live auf Seite A
  await blockB.getByTestId('synced-editor').click();
  await member.keyboard.press('End');
  await member.keyboard.type(' und Snacks');
  await expect(syncedEditor).toContainText('Packliste für alle und Snacks', { timeout: 15_000 });
});

test('Lese-Link zeigt die Seite ohne Anmeldung', async ({ browser }) => {
  const page = await api(owner, 'POST', `/workspaces/${ws}/pages`, {
    title: `Rezept ${RUN}`,
    scope: 'TEAM',
  });
  await owner.goto(`/w/${ws}/p/${page.id}`);
  await owner.getByTestId('share-button').click();
  await owner.getByTestId('share-link-toggle').click();
  await expect(owner.getByTestId('share-link-url')).toBeVisible();
  const url = await owner.getByTestId('share-link-url').inputValue();
  await owner.keyboard.press('Escape');
  const anon = await browser.newPage(ctxOptions);
  await anon.goto(new URL(url).pathname);
  await expect(anon.getByTestId('public-title')).toHaveText(`Rezept ${RUN}`);
  await anon.close();
});
