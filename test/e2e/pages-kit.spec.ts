/**
 * M9 part 2, round 2 in WebKit: Home, Settings, Help, Device check, Send report, Activity log, the set-up
 * wizard and its marker sheets, tray labels, Accuracy and Progress on the component kit (src/app/ui/).
 * - Home: a Large Title, the puzzles as list rows, "New puzzle" the one filled button, the testing tools in one
 *   "Diagnostics" section (Tester mode only), and "Import a backup" still opens the file picker;
 * - icons instead of emoji, with names where they say something on their own;
 * - the NavBar's back goes to the parent screen (Home, Settings, the puzzle by its name, the step before);
 * - erasing all data asks first in an action sheet: Cancel keeps everything, the red button erases;
 * - no sideways scroll and every control at least 44 × 44 px at 375 and 402 px.
 */
import type { Page } from '@playwright/test';
import { test, expect, gotoScreen } from './fixtures';

/** A puzzle that has finished set-up, with a grid but no box picture and no pieces. */
async function addPuzzle(page: Page, id: string, name: string): Promise<void> {
  await page.evaluate(
    async ([pid, pname]) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({
          id: pid,
          name: pname,
          createdAt: 1,
          updatedAt: 2,
          pieceCount: 48,
          grid: { cols: 8, rows: 6, source: 'suggested' },
          box: null,
          markerMap: null,
          tableModel: null,
          piecePitch: null,
          setupStep: 6,
          tracking: 'pieces',
        });
        tx.oncomplete = () => res();
      });
      dbh.close();
    },
    [id, name] as const,
  );
}

/** Controls under 44 × 44 px. Words-only links inside a sentence and the hidden file inputs are left out. */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const els = document.querySelectorAll<HTMLElement>(
      '#app button, #app [role=button], #app a[href], #app label.btn, #app select, #app input:not(.hidden-input)',
    );
    for (const el of els) {
      if (el.matches('a:not(.btn):not(.list-row)') && el.closest('p, li, dd')) continue;
      // A checkbox counts with its label (the whole row is the place to tap).
      const box = (el.matches('input[type=checkbox]') && el.closest('label')) || el;
      const r = box.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.width < 43.5 || r.height < 43.5)
        out.push(
          `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`,
        );
    }
    return out;
  });
}

test('Home: Large Title, puzzle rows, one filled button, Diagnostics in Tester mode, icons, and the backup picker opens', async ({ page }) => {
  await gotoScreen(page, '');
  await addPuzzle(page, 'e2e-pages-home', 'Harbour at dusk');
  await page.reload();
  await expect(page.locator('h1.large-title')).toHaveText('Puzzle Lens');
  await expect(page.getByTestId('navbar-back')).toHaveCount(0);

  const row = page.getByTestId('puzzle-card');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Harbour at dusk');
  await expect(row).toContainText('48 pieces · 8 × 6');
  await expect(row.locator('svg[data-icon=puzzle]')).toBeVisible();
  await expect(row).toHaveAttribute('href', '#/puzzle/e2e-pages-home');

  // One filled (main) button on the page, with the plus icon.
  await expect(page.locator('main .btn-filled, main .btn-primary')).toHaveCount(1);
  await expect(page.getByTestId('new-puzzle').locator('svg[data-icon=plus]')).toBeVisible();

  // The testing tools: one Diagnostics section, each row with its icon.
  const diag = page.getByTestId('home-diagnostics');
  await expect(diag.locator('.list-header')).toHaveText('Diagnostics');
  for (const [id, icon] of [
    ['tool-live', 'camera'],
    ['tool-device', 'stethoscope'],
    ['tool-report', 'send'],
    ['tool-log', 'info'],
  ] as const) {
    await expect(diag.getByTestId(id).locator(`svg[data-icon="${icon}"]`), id).toBeAttached();
  }
  await expect(page.getByTestId('tool-help').locator('svg[data-icon=compass]')).toBeAttached();
  await expect(page.getByTestId('tool-settings').locator('svg[data-icon=settings]')).toBeAttached();
  // No emoji left on Home.
  expect(await page.locator('main').innerText()).not.toMatch(/[🧩📷🩺📦🧭⚙]/u);

  // Safari's ⋯ button, named in the install steps, is an icon with a name.
  await expect(page.getByTestId('install-banner').getByRole('img', { name: '⋯ (More)' })).toBeVisible();

  // A tap on "Import a backup" opens the file picker.
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-backup').click();
  expect((await chooser).isMultiple()).toBe(false);

  // The row opens the puzzle.
  await row.click();
  await expect(page).toHaveURL(/#\/puzzle\/e2e-pages-home$/);
});

test('NavBar back goes to the parent: Home, Settings, the puzzle by its name, the step before', async ({ page }) => {
  await gotoScreen(page, '');
  await addPuzzle(page, 'e2e-pages-nav', 'Lighthouse');

  // Home's children.
  for (const screen of ['settings', 'help', 'device', 'report', 'log'] as const) {
    await gotoScreen(page, screen);
    await page.getByRole('button', { name: 'Back to home' }).click();
    await expect(page.getByTestId('your-puzzles'), screen).toBeVisible();
  }

  // Accuracy of all puzzles opens from Settings: back to Settings.
  await gotoScreen(page, 'settings');
  await page.getByTestId('settings-accuracy').click();
  await expect(page.locator('.navbar h1')).toHaveText('How often is the app right?');
  await page.getByRole('button', { name: 'Back to Settings' }).click();
  await expect(page).toHaveURL(/#\/settings$/);

  // One puzzle's pages: back to the puzzle, under its name.
  for (const [hash, title] of [
    ['#/accuracy/e2e-pages-nav', 'How often is the app right?'],
    ['#/progress/e2e-pages-nav', 'Progress'],
    ['#/trays/e2e-pages-nav', 'Tray labels'],
  ] as const) {
    await page.evaluate((h) => (location.hash = h), hash);
    await expect(page.locator('.navbar h1')).toHaveText(title);
    const back = page.getByRole('button', { name: 'Back to Lighthouse' });
    await expect(back, hash).toContainText('Lighthouse');
    await back.click();
    await expect(page, hash).toHaveURL(/#\/puzzle\/e2e-pages-nav$/);
  }
  // The tray labels keep their own test id on back.
  await page.evaluate(() => (location.hash = '#/trays/e2e-pages-nav'));
  await page.getByTestId('labels-back').click();
  await expect(page).toHaveURL(/#\/puzzle\/e2e-pages-nav$/);

  // The wizard: back goes one step back, and says where to.
  await page.evaluate(() => (location.hash = '#/new/e2e-pages-nav'));
  await expect(page.getByTestId('step-count')).toContainText('Step 4 of 4');
  const wback = page.getByTestId('wizard-back');
  await expect(wback).toHaveAccessibleName('Back to Step 3');
  await wback.click();
  await expect(page.getByTestId('step-count')).toContainText('Step 3 of 4');
  await expect(wback).toHaveAccessibleName('Back to Step 2');
  // Close leaves the wizard for the puzzle.
  await page.getByTestId('wizard-close').click();
  await expect(page).toHaveURL(/#\/puzzle\/e2e-pages-nav$/);

  // The marker sheets: back to the set-up.
  await page.evaluate(() => (location.hash = '#/markers/e2e-pages-nav'));
  await expect(page.getByTestId('sheets-back')).toHaveAccessibleName('Back to Set-up');
  await expect(page.getByTestId('print-sheets').locator('svg[data-icon=printer]')).toBeVisible();
  await page.getByTestId('sheets-back').click();
  await expect(page).toHaveURL(/#\/new\/e2e-pages-nav$/);
});

test('Settings: erasing asks first in an action sheet; Cancel keeps everything, the red button erases', async ({ page }) => {
  await gotoScreen(page, '');
  await addPuzzle(page, 'e2e-pages-erase', 'Keep me');
  await gotoScreen(page, 'settings');

  await page.getByTestId('erase-all').click();
  const sheet = page.getByTestId('confirm-sheet');
  await expect(page.getByRole('alertdialog', { name: 'Erase all Puzzle Lens data?' })).toBeVisible();
  await expect(sheet).toContainText("can't be undone");
  await page.getByTestId('confirm-sheet-cancel').click();
  await expect(sheet).toHaveCount(0);
  await gotoScreen(page, '');
  await expect(page.getByTestId('puzzle-card')).toContainText('Keep me');

  await gotoScreen(page, 'settings');
  await page.getByTestId('erase-all').click();
  await page.getByTestId('confirm-sheet-ok').click();
  // The app reloads (on Settings), with nothing in it.
  await page.waitForEvent('load');
  await gotoScreen(page, '');
  await expect(page.getByTestId('your-puzzles')).toContainText('No puzzles yet', { timeout: 20_000 });
});

test('Settings: grouped sections, the kit’s segmented controls, Tester mode first', async ({ page }) => {
  await gotoScreen(page, 'settings');
  const headers = await page.locator('main .list-header').allTextContents();
  expect(headers[0]).toBe('Tester mode');
  for (const h of ['Accuracy', 'Units', 'Live camera format', 'Camera lens', 'Scan mode', 'Live tracking speed', 'Performance display', 'Storage', 'Erase'])
    expect(headers, h).toContain(h);
  // Every choice is the kit's segmented control.
  await expect(page.locator('main .segmented .segmented-btn')).toHaveCount(2 + 3 + 3 + 2 + 2 + 2);
  await page.getByTestId('units-in').click();
  await expect(page.getByTestId('units-in')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('units-cm').click();
  await expect(page.getByTestId('settings-accuracy').locator('svg[data-icon=bar-chart]')).toBeAttached();
  expect(await page.locator('main').innerText()).not.toMatch(/📊/u);
});

test('Help: the steps index opens each step; Device check marks steps with icons that have names', async ({ page }) => {
  await gotoScreen(page, 'help');
  await expect(page.getByTestId('help-index').locator('.list-row')).toHaveCount(6);
  await page.getByTestId('help-report-link').click();
  await expect(page.getByTestId('help-report')).toBeInViewport();
  // The step's card starts below the navigation bar, not under it.
  const bar = (await page.getByTestId('navbar').boundingBox())!;
  await expect.poll(async () => (await page.getByTestId('help-report').boundingBox())!.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  await expect(page.getByTestId('help-camera').getByRole('img', { name: 'light' })).toBeAttached();
  expect(await page.locator('main').innerText()).not.toMatch(/[🔦⋯]/u);

  await gotoScreen(page, 'device');
  const part = page.getByTestId('device-part-automatic');
  await expect(part.getByRole('img', { name: 'Not done yet' })).toBeVisible();
  await expect(part.locator('svg[data-icon=circle]')).toBeVisible();
});

for (const size of [
  { width: 375, height: 667 },
  { width: 402, height: 874 },
]) {
  test(`${size.width} px: no sideways scroll and no control under 44 px on these screens`, async ({ page }) => {
    await page.setViewportSize(size);
    await gotoScreen(page, '');
    await addPuzzle(page, 'e2e-pages-size', 'Lighthouse');
    for (const hash of [
      '#/',
      '#/settings',
      '#/help',
      '#/device',
      '#/report',
      '#/log',
      '#/accuracy',
      '#/accuracy/e2e-pages-size',
      '#/progress/e2e-pages-size',
      '#/trays/e2e-pages-size',
      '#/markers/e2e-pages-size',
      '#/new',
      '#/new/e2e-pages-size',
    ]) {
      await page.goto(`./${hash}`);
      await expect(page.getByTestId('navbar'), hash).toBeVisible();
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${hash}: sideways`).toBeLessThanOrEqual(0);
      expect(await smallTargets(page), `${hash}: small controls`).toEqual([]);
    }
    // Wizard step 1 (after the install advice) and step 3.
    // From Home: moving from #/new/<id> to #/new keeps the wizard's step (as before this change).
    await page.goto('./#/');
    await page.goto('./#/new');
    await page.getByTestId('continue-anyway').click();
    await expect(page.getByTestId('step-name')).toBeVisible();
    expect(await smallTargets(page), 'step 1: small controls').toEqual([]);
  });
}
