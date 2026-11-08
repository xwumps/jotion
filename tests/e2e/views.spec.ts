import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Phase 5: Board, Liste, Galerie, Kalender und Zeitleiste im Browser.
 * Daten werden über die API (fetch im Browser, gleiche Sitzung) angelegt, bedient wird die Oberfläche.
 * Läuft eigenständig (richtet Jotion ein) oder nach den anderen Specs (meldet sich an).
 */
const OWNER = {
  name: 'Jarne Beispiel',
  email: 'jarne@example.com',
  password: 'ein-sicheres-passwort',
};

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
  return new URL(p.url()).pathname.split('/')[2]!;
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  ws = await login(page);
});
test.afterAll(async () => {
  await page.close();
});

/** API-Aufruf aus dem Browser (gleiche Sitzung und gleicher Origin). */
async function api<T = any>(method: string, path: string, body?: unknown, p = page): Promise<T> {
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

interface Option {
  id: string;
  name: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
function dayIn(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Datenbank mit Status, Datum und Zahl sowie einigen Zeilen. */
async function setupDb(title: string) {
  const d = await api('POST', `/workspaces/${ws}/databases`, { scope: 'TEAM', title });
  const status = await api('POST', `/databases/${d.id}/properties`, {
    name: 'Status',
    type: 'status',
  });
  const date = await api('POST', `/databases/${d.id}/properties`, { name: 'Fällig', type: 'date' });
  const points = await api('POST', `/databases/${d.id}/properties`, {
    name: 'Punkte',
    type: 'number',
  });
  const [todo, doing, done] = status.config.options as Option[];
  // Mitte des Monats, damit Kalender und Zeitleiste die Einträge sicher zeigen
  const mid = `${dayIn(0).slice(0, 7)}-14`;
  const rows: Record<string, { id: string }> = {};
  for (const [t, s, p] of [
    ['Einkaufen', todo, 3],
    ['Steuer', todo, 5],
    ['Urlaub planen', doing, 8],
  ] as const)
    rows[t] = await api('POST', `/databases/${d.id}/rows`, {
      title: t,
      values: {
        [status.id]: s!.id,
        [points.id]: p,
        ...(t === 'Steuer' ? { [date.id]: { start: mid } } : {}),
        ...(t === 'Urlaub planen'
          ? { [date.id]: { start: mid, end: `${mid.slice(0, 8)}16` } }
          : {}),
      },
    });
  return { d, status, date, points, todo: todo!, doing: doing!, done: done!, rows, mid };
}

async function openDb(id: string, p = page) {
  await p.goto(`/w/${ws}/p/${id}`);
  await expect(p.getByTestId('database-view')).toBeVisible();
}

async function addView(layout: string) {
  await page.getByTestId('add-view').click();
  await page.locator(`[data-testid="add-view-type"][data-layout="${layout}"]`).click();
}

const column = (key: string, p = page) =>
  p.locator(`[data-testid="board-column"][data-group="${key}"]`).first();
const head = (key: string, p = page) =>
  p.locator(`[data-testid="board-column-head"][data-group="${key}"]`);

/** Ziehen mit der Maus in kleinen Schritten (dnd-kit braucht Bewegung nach dem Drücken). */
async function dragTo(source: Locator, target: Locator, yOffset = 0.5, p = page) {
  const a = (await source.boundingBox())!;
  const b = (await target.boundingBox())!;
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 4 });
  await p.mouse.move(b.x + b.width / 2, b.y + b.height * yOffset, { steps: 12 });
  await p.mouse.move(b.x + b.width / 2, b.y + b.height * yOffset + 2, { steps: 2 });
  await p.mouse.up();
}

test('Board: Spalten nach Status, Ziehen zwischen Spalten, zweiter Client sieht es live', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const s = await setupDb('Aufgaben-Board');
  await openDb(s.d.id);
  await addView('board');
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(head(s.todo.id).getByTestId('column-count')).toHaveText('2');
  await expect(head(s.doing.id).getByTestId('column-count')).toHaveText('1');
  await expect(head(s.done.id).getByTestId('column-count')).toHaveText('0');
  await expect(column(s.todo.id).getByTestId('card')).toHaveText(['Einkaufen', 'Steuer']);

  // Zweiter Client auf derselben Datenbank
  const ctx2 = await browser.newContext({ locale: 'de-DE' });
  const other = await ctx2.newPage();
  await login(other);
  await openDb(s.d.id, other);
  await other.getByRole('tab', { name: 'Board' }).click();
  await expect(column(s.todo.id, other).getByTestId('card')).toHaveCount(2);

  // Im zweiten Client (im Vordergrund) ziehen, der erste sieht es live ohne Neuladen
  await dragTo(
    column(s.todo.id, other).getByTestId('card').first(),
    column(s.done.id, other),
    0.5,
    other,
  );
  await expect(column(s.done.id, other).getByTestId('card')).toHaveText(['Einkaufen']);
  await expect(head(s.done.id, other).getByTestId('column-count')).toHaveText('1');
  await expect(head(s.todo.id, other).getByTestId('column-count')).toHaveText('1');
  await expect(column(s.done.id).getByTestId('card')).toHaveText(['Einkaufen']);
  await expect(column(s.todo.id).getByTestId('card')).toHaveText(['Steuer']);
  await expect(head(s.done.id).getByTestId('column-count')).toHaveText('1');

  // Innerhalb einer Spalte umsortieren: Steuer über Urlaub planen in "In Bearbeitung"
  await dragTo(
    column(s.todo.id, other).getByTestId('card').first(),
    column(s.doing.id, other).getByTestId('card').first(),
    0.15,
    other,
  );
  await expect(column(s.doing.id, other).getByTestId('card')).toHaveText([
    'Steuer',
    'Urlaub planen',
  ]);
  await expect(column(s.doing.id).getByTestId('card')).toHaveText(['Steuer', 'Urlaub planen']);

  // Nach dem Neuladen gespeichert
  await page.reload();
  await expect(column(s.doing.id).getByTestId('card')).toHaveText(['Steuer', 'Urlaub planen']);
  await expect(column(s.done.id).getByTestId('card')).toHaveText(['Einkaufen']);
  const row = await api('GET', `/databases/${s.d.id}/rows/${s.rows['Einkaufen']!.id}`);
  expect(row.values[s.status.id]).toBe(s.done.id);
  await ctx2.close();
});

test('Board: Karten-Properties, Spalte ausblenden, Gruppe anlegen, Swimlanes, neue Karte', async () => {
  const s = await setupDb('Board-Einstellungen');
  await openDb(s.d.id);
  await addView('board');
  await expect(page.getByTestId('board')).toBeVisible();

  // Punkte auf den Karten zeigen, Kartengröße ändern
  await page.getByTestId('view-settings').click();
  await page.locator('[data-testid="card-property"][data-property="Punkte"]').click();
  await page.getByTestId('card-size').selectOption('large');
  await page.keyboard.press('Escape');
  await expect(column(s.todo.id).getByTestId('card').first().getByTestId('card-value')).toHaveText(
    '3',
  );

  // Spalte ausblenden und wieder einblenden
  await head(s.done.id).hover();
  await head(s.done.id).getByTestId('column-menu').click();
  await page.getByRole('menuitem', { name: 'Gruppe ausblenden' }).click();
  await expect(head(s.done.id)).toHaveCount(0);
  await expect(page.getByTestId('hidden-groups')).toContainText('Erledigt');
  await page.getByRole('button', { name: 'Erledigt einblenden' }).click();
  await expect(head(s.done.id)).toBeVisible();

  // Neue Gruppe (Option) anlegen
  await page.getByTestId('add-group').click();
  await page.getByTestId('add-group-input').fill('Warten');
  await page.getByTestId('add-group-input').press('Enter');
  await expect(page.getByTestId('board-column-head').filter({ hasText: 'Warten' })).toBeVisible();

  // Neue Karte in einer Spalte bekommt deren Status
  await column(s.doing.id).getByTestId('board-new-card').click();
  await expect(page.getByTestId('row-peek')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(column(s.doing.id).getByTestId('card')).toHaveCount(2);

  // Swimlanes nach Punkte-Bereichen
  await page.getByTestId('view-settings').click();
  await page.getByTestId('sub-group-by').selectOption({ label: 'Punkte' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('swimlane')).not.toHaveCount(0);
  await expect(page.getByTestId('swimlane').filter({ hasText: '0 – 10' })).toBeVisible();
});

test('Liste und Galerie: Layout wechseln, gruppieren, Karte öffnen', async () => {
  const s = await setupDb('Leseliste');
  await openDb(s.d.id);
  await page.getByTestId('view-settings').click();
  await page.locator('[data-testid="layout-option"][data-layout="list"]').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('list-row')).toHaveCount(3);
  await page.getByTestId('view-settings').click();
  await page.getByTestId('group-by').selectOption({ label: 'Status' });
  await page.keyboard.press('Escape');
  await expect(
    page.locator(`[data-testid="view-group"][data-group="${s.todo.id}"] [data-testid="list-row"]`),
  ).toHaveCount(2);

  await page.getByTestId('view-settings').click();
  await page.locator('[data-testid="layout-option"][data-layout="gallery"]').click();
  await page.getByTestId('group-by').selectOption({ label: 'Keine' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('gallery').getByTestId('card')).toHaveCount(3);
  await page.getByTestId('gallery').getByTestId('card').filter({ hasText: 'Steuer' }).click();
  await expect(page.getByTestId('row-peek')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('Kalender: mehrtägige Einträge, Ziehen auf einen anderen Tag, Klick zum Anlegen', async () => {
  const s = await setupDb('Termine');
  await openDb(s.d.id);
  await addView('calendar');
  await expect(page.getByTestId('calendar')).toBeVisible();
  const event = (title: string) => page.getByTestId('calendar-event').filter({ hasText: title });
  await expect(event('Steuer')).toBeVisible();
  // Urlaub über drei Tage: drei Spalten breit (über eine Wochengrenze in zwei Stücken)
  const dayCell = (day: string) => page.locator(`[data-testid="calendar-day"][data-day="${day}"]`);
  const cellBox = (await dayCell(s.mid).boundingBox())!;
  let width = 0;
  for (const seg of await event('Urlaub planen').all()) width += (await seg.boundingBox())!.width;
  expect(width).toBeGreaterThan(cellBox.width * 2.5);
  expect(width).toBeLessThan(cellBox.width * 3.1);

  // Steuer vom 14. auf den 20. ziehen
  const target = `${s.mid.slice(0, 8)}20`;
  await dayCell(target).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await dragTo(event('Steuer'), dayCell(target));
  await expect
    .poll(
      async () =>
        (await api('GET', `/databases/${s.d.id}/rows/${s.rows['Steuer']!.id}`)).values[s.date.id]
          ?.start,
    )
    .toBe(target);
  await page.reload();
  const steuer = (await event('Steuer').boundingBox())!;
  const t20 = (await dayCell(target).boundingBox())!;
  expect(steuer.x).toBeGreaterThanOrEqual(t20.x - 1);
  expect(steuer.x).toBeLessThan(t20.x + t20.width);

  // Neuer Eintrag per Klick auf einen Tag
  const day = `${s.mid.slice(0, 8)}10`;
  await dayCell(day).hover();
  await dayCell(day).getByTestId('calendar-new').click();
  await expect(page.getByTestId('row-peek')).toBeVisible();
  await page.keyboard.press('Escape');
  // Steuer, neuer Eintrag und Urlaub (über die Wochengrenze zwei Stücke)
  await expect(page.getByTestId('calendar-event').filter({ hasText: 'Ohne Titel' })).toHaveCount(1);

  // Wochenansicht
  await page.getByTestId('calendar-week').click();
  await expect(page.getByTestId('calendar-day')).toHaveCount(7);
});

test('Zeitleiste: Balken verschieben und Ende ziehen, Heute-Linie', async () => {
  const s = await setupDb('Projektplan');
  await openDb(s.d.id);
  await addView('timeline');
  await expect(page.getByTestId('timeline')).toBeVisible();
  await page.getByTestId('timeline-zoom').selectOption('day');
  await expect(page.getByTestId('timeline-today-line')).toBeVisible();
  const bar = page.locator('[data-testid="timeline-bar"]').filter({ hasText: 'Urlaub planen' });
  await bar.scrollIntoViewIfNeeded();
  const box = (await bar.boundingBox())!;
  expect(box.width).toBeGreaterThan(200); // 3 Tage à 80 px

  // Zwei Tage nach rechts verschieben
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  const shifted = (d: string, n: number) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  await expect
    .poll(
      async () =>
        (await api('GET', `/databases/${s.d.id}/rows/${s.rows['Urlaub planen']!.id}`)).values[
          s.date.id
        ],
    )
    .toMatchObject({ start: shifted(s.mid, 2), end: shifted(s.mid, 4) });

  // Ende einen Tag weiter ziehen
  const b2 = (await bar.boundingBox())!;
  const handle = bar.getByTestId('timeline-resize-end');
  // Je nach heutigem Datum liegt das Ende rechts außerhalb des sichtbaren Bereichs
  await handle.scrollIntoViewIfNeeded();
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 80, h.y + h.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await api('GET', `/databases/${s.d.id}/rows/${s.rows['Urlaub planen']!.id}`)).values[
          s.date.id
        ],
    )
    .toMatchObject({ start: shifted(s.mid, 2), end: shifted(s.mid, 5) });
  expect(b2.width).toBeGreaterThan(200);
});

test('Gesperrte Datenbank: Ansichten fest, Einträge bearbeitbar', async () => {
  const s = await setupDb('Gesperrt');
  await openDb(s.d.id);
  await page.getByTestId('view-settings').click();
  await page.getByTestId('lock-database').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('database-locked')).toBeVisible();
  await expect(page.getByTestId('add-view')).toHaveCount(0);
  await page.getByTestId('view-settings').click();
  await expect(page.locator('[data-testid="layout-option"][data-layout="board"]')).toBeDisabled();
  await page.keyboard.press('Escape');
  // Zeilen bleiben bearbeitbar
  await expect(page.getByTestId('new-row')).toBeVisible();
});

test('Performance: Board mit 2.000 Karten und 10 Spalten', async () => {
  test.setTimeout(180_000);
  const d = await api('POST', `/workspaces/${ws}/databases`, {
    scope: 'TEAM',
    title: 'Großes Board',
  });
  const options = Array.from({ length: 10 }, (_, i) => ({
    id: crypto.randomUUID(),
    name: `Spalte ${i + 1}`,
    color: 'blue',
  }));
  const sel = await api('POST', `/databases/${d.id}/properties`, {
    name: 'Phase',
    type: 'select',
    config: { options },
  });
  // 2.000 Zeilen in parallelen Blöcken anlegen
  await page.evaluate(
    async ({ dbId, propId, ids }) => {
      const make = (i: number) =>
        fetch(`/api/databases/${dbId}/rows`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: `Karte ${i}`, values: { [propId]: ids[i % ids.length] } }),
        });
      for (let i = 0; i < 2000; i += 50)
        await Promise.all(Array.from({ length: 50 }, (_, k) => make(i + k)));
    },
    { dbId: d.id, propId: sel.id, ids: options.map((o) => o.id) },
  );
  const view = await api('POST', `/databases/${d.id}/views`, { name: 'Board', type: 'board' });
  expect(view.config.groupBy.propertyId).toBe(sel.id);

  await page.goto(`/w/${ws}/p/${d.id}`);
  await expect(page.getByTestId('database-view')).toBeVisible();
  const t0 = Date.now();
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(head(options[9]!.id).getByTestId('column-count')).toHaveText('200');
  await expect(column(options[9]!.id).getByTestId('card')).toHaveCount(100);
  const openMs = Date.now() - t0;
  console.log(`Board mit 2.000 Karten geöffnet in ${openMs} ms`);
  expect(openMs).toBeLessThan(5000);

  // Ziehen bleibt flüssig: Karte in eine andere Spalte, Zähler stimmen danach
  await page.bringToFront();
  const t1 = Date.now();
  await dragTo(column(options[0]!.id).getByTestId('card').first(), head(options[1]!.id));
  await expect(head(options[1]!.id).getByTestId('column-count')).toHaveText('201');
  await expect(head(options[0]!.id).getByTestId('column-count')).toHaveText('199');
  console.log(`Ziehen bis zum aktualisierten Zähler: ${Date.now() - t1} ms`);

  // Nachladen beim Scrollen ans Ende einer Spalte
  await column(options[9]!.id).getByTestId('card').last().scrollIntoViewIfNeeded();
  await expect(column(options[9]!.id).getByTestId('card')).toHaveCount(200);
});
