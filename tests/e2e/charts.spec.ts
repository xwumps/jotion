import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Phase 7: Diagramme (Ansicht, Builder, alle Typen in hell und dunkel, Drilldown, Live-Update,
 * Diagramm-Block) und das Dashboard (Widgets, Layout bleibt erhalten).
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

const pad = (n: number) => String(n).padStart(2, '0');
const dayIn = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Anzahl farbiger Pixel im Canvas eines Diagramms (gerendert und nicht leer). */
async function inkOf(chart: Locator): Promise<number> {
  return chart
    .locator('canvas')
    .first()
    .evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d');
      if (!ctx) return 0;
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 0) n++;
      return n;
    });
}

let dbId = '';
let viewId = '';
const ids: Record<string, string> = {};

test('Chart-Ansicht über den Builder einrichten, alle Typen hell und dunkel', async () => {
  const d = await api('POST', `/workspaces/${ws}/databases`, {
    scope: 'TEAM',
    title: `Verkäufe ${RUN}`,
  });
  dbId = d.id;
  ids.amount = (
    await api('POST', `/databases/${dbId}/properties`, { name: 'Betrag', type: 'number' })
  ).id;
  ids.date = (
    await api('POST', `/databases/${dbId}/properties`, { name: 'Datum', type: 'date' })
  ).id;
  const status = await api('POST', `/databases/${dbId}/properties`, {
    name: 'Status',
    type: 'status',
  });
  ids.status = status.id;
  const opts = status.config.options as { id: string }[];
  for (const [i, [t, b, s]] of (
    [
      ['A', 10, 0],
      ['B', 20, 0],
      ['C', 5, 2],
      ['D', 7, 1],
      ['E', 3, 2],
    ] as const
  ).entries())
    await api('POST', `/databases/${dbId}/rows`, {
      title: t,
      values: { [ids.amount]: b, [ids.status]: opts[s]!.id, [ids.date]: { start: dayIn(-i * 3) } },
    });

  await page.goto(`/w/${ws}/p/${dbId}`);
  await page.getByTestId('add-view').click();
  await page.locator('[data-testid="add-view-type"][data-layout="chart"]').click();
  await expect(page.getByTestId('chart-empty')).toBeVisible();
  viewId = (await api('GET', `/databases/${dbId}`)).views.find(
    (v: { type: string }) => v.type === 'chart',
  ).id;

  await page.getByTestId('chart-builder').click();
  await page.getByTestId('chart-x').selectOption({ label: 'Status' });
  await page.getByTestId('chart-measure').selectOption('sum');
  await page.getByTestId('chart-value-property').selectOption({ label: 'Betrag' });
  await page.keyboard.press('Escape');
  const chart = page.getByTestId('chart-view');
  await expect(chart.getByTestId('echart')).toBeVisible();
  await expect.poll(() => inkOf(chart)).toBeGreaterThan(500);

  // Jeder Typ rendert, in hell und dunkel (Screenshots als Anhang)
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const type of ['bar', 'bar_horizontal', 'line', 'area', 'pie', 'donut', 'scatter']) {
      await api('PATCH', `/databases/${dbId}/views/${viewId}`, {
        config: {
          chart: {
            type,
            x: { propertyId: ids.status },
            y: { measure: 'sum', propertyId: ids.amount },
            display: {
              dataLabels: true,
              legend: true,
              height: 320,
              palette: 'jotion',
              optionColors: true,
              xTitle: '',
              yTitle: '',
              grid: true,
              smooth: false,
            },
          },
        },
      });
      await expect(
        page.locator(`[data-testid="chart-view"][data-chart-type="${type}"]`),
      ).toBeVisible();
      await expect.poll(() => inkOf(chart), { message: `${type} ${theme}` }).toBeGreaterThan(500);
      await test.info().attach(`chart-${type}-${theme}`, {
        body: await chart.screenshot(),
        contentType: 'image/png',
      });
    }
    for (const type of ['kpi', 'progress_bar', 'progress_ring']) {
      await api('PATCH', `/databases/${dbId}/views/${viewId}`, {
        config: {
          chart: {
            type,
            y: { measure: 'sum', propertyId: ids.amount },
            target: 100,
            dateFilter: { propertyId: ids.date, range: 'last_30_days' },
            compare: true,
          },
        },
      });
      const el =
        type === 'kpi' ? chart.getByTestId('chart-kpi') : chart.getByTestId('chart-progress');
      await expect(el).toBeVisible();
      if (type === 'kpi') await expect(el.getByTestId('kpi-value')).toHaveText('45');
      if (type === 'progress_bar') await expect(el).toContainText('45 %');
      await test.info().attach(`chart-${type}-${theme}`, {
        body: await chart.screenshot(),
        contentType: 'image/png',
      });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
});

test('KPI aktualisiert sich live, Drilldown zeigt die Zeilen eines Segments', async () => {
  await api('PATCH', `/databases/${dbId}/views/${viewId}`, {
    config: {
      chart: {
        type: 'kpi',
        y: { measure: 'sum', propertyId: ids.amount },
        dateFilter: { propertyId: ids.date, range: 'last_30_days' },
        compare: true,
      },
    },
  });
  const chart = page.getByTestId('chart-view');
  await expect(chart.getByTestId('kpi-value')).toHaveText('45');
  // Live: neue Zeile über die API, Kennzahl folgt ohne Neuladen in unter 2 s
  await api('POST', `/databases/${dbId}/rows`, {
    title: 'F',
    values: { [ids.amount]: 55, [ids.date]: { start: dayIn(0) } },
  });
  const t0 = Date.now();
  await expect(chart.getByTestId('kpi-value')).toHaveText('100', { timeout: 5000 });
  const ms = Date.now() - t0;
  console.log(`Live-Update der Kennzahl: ${ms} ms`);
  expect(ms).toBeLessThan(2000);

  // Kreis mit einem einzigen Segment: Klick öffnet die Zeilen dieses Segments
  await api('PATCH', `/databases/${dbId}/views/${viewId}`, {
    config: {
      chart: {
        type: 'pie',
        x: { propertyId: ids.date, dateBucket: 'year' },
        y: { measure: 'count' },
      },
    },
  });
  await expect(page.locator('[data-testid="chart-view"][data-chart-type="pie"]')).toBeVisible();
  const canvas = chart.getByTestId('echart');
  await expect.poll(() => inkOf(chart)).toBeGreaterThan(500);
  // Aufbau-Animation abwarten
  await page.waitForTimeout(1200);
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height * 0.45);
  await expect(page.getByTestId('chart-drilldown')).toBeVisible();
  await expect(page.getByTestId('drill-row')).toHaveCount(6);
  await page.getByTestId('drill-row').filter({ hasText: 'B' }).click();
  await expect(page.getByTestId('row-peek')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('Diagramm als Block in einer Seite', async () => {
  const p = await api('POST', `/workspaces/${ws}/pages`, {
    scope: 'TEAM',
    title: `Bericht ${RUN}`,
  });
  await page.goto(`/w/${ws}/p/${p.id}`);
  await expect(page).toHaveTitle(`Bericht ${RUN} | Jotion`);
  await page.getByTestId('page-title').click();
  await page.getByTestId('page-title').press('End');
  await page.getByTestId('page-title').press('Enter');
  await expect(page.getByTestId('editor')).toBeFocused();
  await page.keyboard.type('/diagramm');
  await expect(page.getByTestId('slash-menu')).toContainText('Diagramm');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('quick-search-input')).toBeFocused();
  await page.keyboard.type(`Verkäufe ${RUN}`);
  await expect(page.getByTestId('quick-search-result').first()).toContainText(`Verkäufe ${RUN}`);
  await page.keyboard.press('Enter');
  const block = page.getByTestId('chart-block');
  await expect(block).toBeVisible();
  await expect(block).toContainText(`Verkäufe ${RUN}`);
  // Neue Chart-Ansicht: X-Achse im Block-Builder wählen
  await block.getByTestId('chart-builder').click();
  await page.getByTestId('chart-x').selectOption({ label: 'Status' });
  await page.keyboard.press('Escape');
  await expect.poll(() => inkOf(block)).toBeGreaterThan(500);
  await page.reload();
  await expect.poll(() => inkOf(page.getByTestId('chart-block'))).toBeGreaterThan(500);
});

test('Dashboard: Widgets hinzufügen, Notiz und Layout bleiben erhalten', async () => {
  // Frisches persönliches Dashboard (die Instanz kann Widgets aus früheren Läufen haben)
  await api('PUT', `/workspaces/${ws}/dashboard`, {
    widgets: [{ id: 'upcoming', type: 'upcoming', x: 0, y: 0, w: 6, h: 6 }],
  });
  await page.goto(`/w/${ws}`);
  const dash = page.getByTestId('dashboard');
  await expect(dash).toBeVisible();
  // Agenda zeigt Einträge aus der Datenbank (Datum heute: anstehend)
  await expect(dash.locator('[data-testid="widget"][data-type="upcoming"]')).toContainText('A');
  await page.getByTestId('edit-dashboard').click();
  await page.getByTestId('add-widget').click();
  await page.locator('[data-testid="add-widget-type"][data-type="note"]').click();
  const note = dash.locator('[data-testid="widget"][data-type="note"]');
  await expect(note).toBeVisible();
  await note.getByTestId('note-widget').fill('Milch kaufen');

  // KPI-Widget mit der Chart-Ansicht
  await page.getByTestId('add-widget').click();
  await page.locator('[data-testid="add-widget-type"][data-type="kpi"]').click();
  const kpi = dash.locator('[data-testid="widget"][data-type="kpi"]');
  await kpi.getByTestId('widget-settings').click();
  await page.getByTestId('widget-db-search').fill(`Verkäufe ${RUN}`);
  await page.locator(`[data-testid="widget-db-option"][data-title="Verkäufe ${RUN}"]`).click();
  await page.getByTestId('widget-view').selectOption({ index: 1 });
  await page.keyboard.press('Escape');
  await expect(kpi.getByTestId('chart-view')).toBeVisible();

  // Notiz-Widget nach rechts ziehen
  const before = (await api('GET', `/workspaces/${ws}/dashboard`)).widgets.find(
    (w: { type: string }) => w.type === 'note',
  );
  const handle = note.getByTestId('widget-handle');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + 5, hb.y + 5);
  await page.mouse.down();
  await page.mouse.move(hb.x + 300, hb.y + 5, { steps: 15 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await api('GET', `/workspaces/${ws}/dashboard`)).widgets.find(
          (w: { type: string }) => w.type === 'note',
        ).x,
    )
    .toBeGreaterThan(before.x);
  await page.getByTestId('edit-dashboard').click();

  await page.reload();
  await expect(page.getByTestId('note-widget')).toHaveValue('Milch kaufen');
  await expect(
    page.locator('[data-testid="widget"][data-type="kpi"]').getByTestId('chart-view'),
  ).toBeVisible();
});
