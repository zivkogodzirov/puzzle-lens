/**
 * M9 part 4 (design plan §4 items 1 and 8): the puzzle's More tab as one grouped list, and Home's puzzle cards.
 * - More: Back up now (when the last backup was, why one is due, Remind me tomorrow), Share / Download once
 *   made; the More tab's dot while a backup is due; the "Back up now?" toast at most once a day on opening the
 *   puzzle, whose Back up opens More and starts the backup; Start a new lot of pieces (its sheet), Removed
 *   scans (restore), Delete scanned pieces; Puzzle details (box picture, rename in its row, count, grid, size,
 *   coin, set-up); How it works; "How often is the app right?" only in Tester mode; Delete this puzzle.
 * - Home: each puzzle a card (box picture or the puzzle icon, its name, "24 of 80 in place" with a bar) that
 *   opens the Table tab; Settings in the bar; New puzzle; "Import a backup" still opens the file picker.
 * - 44 px targets, no sideways scroll, nothing under the tab bar, at 375 and 402 px.
 */
import { createCanvas } from '@napi-rs/canvas';
import type { Page } from '@playwright/test';
import { generatePuzzle } from '../synth/index';
import { test, expect, openTab } from './fixtures';

test.setTimeout(120_000);
// Blobs in IndexedDB need a persistent WebKit context (as in scan-bin.spec.ts).
test.use({ persistentStorage: true });

const pz = generatePuzzle({ cols: 10, rows: 8, cellMm: [17.8, 19.4], seed: 5 });

function boxJpeg(): string {
  const art = pz.art;
  const c = createCanvas(art.width, art.height);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(art.width, art.height);
  img.data.set(art.rgba);
  ctx.putImageData(img, 0, 0);
  return c.encodeSync('jpeg', 85).toString('base64');
}

/**
 * Three puzzles: `more-done` (box picture, 24 pieces in the puzzle and 6 on the table, never backed up, so a
 * backup is due; with answers when `answers`), `more-setup` (stopped at step 3) and `more-nobox` (set up, no
 * box picture, no pieces). `tester`: Tester mode on or off.
 */
async function seed(page: Page, { answers = false, tester = true } = {}): Promise<void> {
  await page.goto('./#/');
  await expect(page.locator('#app > .app.route-home')).toBeAttached();
  const ok = await page.evaluate(
    async ([box, w, h, withAnswers, testerOn]) => {
      const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'pieces', 'blobs', 'settings'], 'readwrite');
        tx.objectStore('settings').put({ key: 'testerMode', value: testerOn });
        tx.objectStore('blobs').put({ id: 'more:box', ts: 1, kind: 'box', blob: new Blob([bytes(box)], { type: 'image/jpeg' }) });
        const base = { createdAt: 1, updatedAt: 2, pieceCount: 80, markerMap: null, tableModel: null, tracking: 'pieces', openSpots: null };
        const corners = [
          [0, 0],
          [w, 0],
          [w, h],
          [0, h],
        ];
        tx.objectStore('projects').put({
          ...base,
          id: 'more-done',
          name: 'Harbour at dusk',
          grid: { cols: 10, rows: 8, source: 'suggested' },
          box: { photoBlobId: 'more:box', rectifiedBlobId: 'more:box', corners, photoWidth: w, photoHeight: h, width: w, height: h },
          piecePitch: { wMm: 17.8, hMm: 19.4, n: 6 },
          setupStep: 6,
          scaleSource: 'coin',
          coin: 'mk-1',
          answers: withAnswers
            ? [{ pieceId: 'p0', col: 0, row: 0, rot: 0, fits: true, at: 3, grid: '10x8', rank: 0, p: 0.9, verdict: 'strong', from: 'piece', mode: 'whole' }]
            : [],
        });
        tx.objectStore('projects').put({ ...base, id: 'more-setup', name: 'Half set up', grid: null, box: null, piecePitch: null, setupStep: 3 });
        tx.objectStore('projects').put({
          ...base,
          id: 'more-nobox',
          name: 'Mountain lake',
          pieceCount: 48,
          grid: { cols: 8, rows: 6, source: 'suggested' },
          box: null,
          piecePitch: null,
          setupStep: 6,
        });
        for (let i = 0; i < 30; i++)
          tx.objectStore('pieces').put({
            id: `p${i}`,
            projectId: 'more-done',
            createdAt: 1,
            updatedAt: 5,
            status: i < 24 ? 'placed' : 'table',
            placedAt: i < 24 ? { col: i % 10, row: Math.floor(i / 10), at: 5 } : undefined,
            table: { x: i * 30, y: 0, angleDeg: 0, lastSeen: 1, snapId: 's1' },
            outlineMm: [0, 0, 1, 0, 1, 1],
            areaMm2: 345,
            sizeMm: [18, 19],
            colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
            thumbBlobId: null,
            seen: 1,
            bestPxPerMm: 5,
            flags: {},
          });
        tx.oncomplete = () => res();
      });
      dbh.close();
      return 'ok';
    },
    [boxJpeg(), pz.art.width, pz.art.height, answers, tester] as const,
  );
  expect(ok).toBe('ok');
}

/** Home Screen app safe areas (WebKit in Playwright reports 0). */
const SAFE = ':root { --safe-top: 62px !important; --safe-bottom: 34px !important; }';

async function openMore(page: Page, id = 'more-done'): Promise<void> {
  await page.goto(`./#/puzzle/${id}/more`);
  await page.reload();
  await page.addStyleTag({ content: SAFE });
  await expect(page.getByTestId('tab-panel-more')).toBeVisible();
}

/** Every visible button, link and field at least 44 × 44 px. */
async function smallTargets(page: Page, within = '#app'): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const root of document.querySelectorAll(sel))
      for (const el of root.querySelectorAll<HTMLElement>('button, a[href], [role=button], label.btn, input:not(.hidden-input), select')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
        if (r.width < 43.5 || r.height < 43.5)
          out.push(
            `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`,
          );
      }
    return out;
  }, within);
}

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test('More: one grouped list in order; Puzzle details; How it works; no accuracy row without answers', async ({ page }) => {
  await seed(page);
  await openMore(page);
  const panel = page.getByTestId('tab-panel-more');
  await expect(panel.locator('.list-header')).toHaveText(['Backup', 'Pieces', 'Puzzle details']);
  const rows = panel.locator('.list-row .list-title');
  await expect(rows.first()).toContainText('Back up now');
  for (const id of ['export-backup', 'backup-later', 'new-batch', 'delete-scan', 'rename', 'more-help', 'delete-puzzle'])
    await expect(page.getByTestId(id), id).toBeVisible();
  // The order of the actions, top to bottom.
  const ys: number[] = [];
  for (const id of ['export-backup', 'new-batch', 'delete-scan', 'rename', 'setup-finished', 'more-help', 'delete-puzzle'])
    ys.push((await page.getByTestId(id).boundingBox())!.y);
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  // Puzzle details.
  await expect(page.getByTestId('puzzle-box')).toBeVisible();
  await expect(page.getByTestId('puzzle-name')).toHaveText('Harbour at dusk');
  await expect(page.getByTestId('puzzle-count')).toHaveText('80');
  await expect(page.getByTestId('puzzle-grid')).toHaveText('10 across × 8 down (80 pieces)');
  await expect(page.getByTestId('puzzle-size')).toContainText('measured with your coin');
  await expect(page.getByTestId('puzzle-coin')).toContainText('1 denar');
  await expect(page.getByTestId('setup-finished')).toContainText('Set-up finished');
  await expect(page.getByTestId('continue-setup')).toHaveCount(0);
  // Without answers, no accuracy row even in Tester mode.
  await expect(page.getByTestId('accuracy-link')).toHaveCount(0);
  // How it works opens Help.
  await page.getByTestId('more-help').click();
  await expect(page).toHaveURL(/#\/help$/);
  // A puzzle still being set up: its steps and Continue set-up, which opens the wizard.
  await openMore(page, 'more-setup');
  await expect(page.getByTestId('setup-progress').locator('li')).toHaveCount(4);
  await expect(page.getByTestId('continue-setup')).toContainText('Step 3 of 4: Grid');
  await expect(page.getByTestId('puzzle-grid')).toHaveText('Not chosen yet');
  await expect(page.getByTestId('setup-finished')).toHaveCount(0);
  await page.getByTestId('continue-setup').click();
  await expect(page).toHaveURL(/#\/new\/more-setup$/);
});

test('More: a backup is due: the dot on More and the reason in the row; Remind me tomorrow; Back up now, then Download', async ({ page }) => {
  await seed(page);
  await openMore(page);
  await expect(page.getByTestId('tab-more')).toHaveAttribute('aria-label', 'More, backup due');
  await expect(page.getByTestId('last-backup')).toHaveText('Never backed up');
  await expect(page.getByTestId('backup-reminder')).toContainText('the 30 pieces read so far are only on this iPhone');
  // On the More tab itself, no toast (the reminder is right there).
  await expect(page.getByTestId('toast')).toHaveCount(0);
  // Remind me tomorrow: the reason and the dot go, also after a reload.
  await page.getByTestId('backup-later').click();
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);
  await expect(page.getByTestId('backup-later')).toHaveCount(0);
  await expect(page.getByTestId('tab-more')).not.toHaveAttribute('aria-label', /.+/);
  await openMore(page);
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);
  // Back up now: the file is made; Share and Download.
  await page.getByTestId('export-backup').click();
  await expect(page.getByTestId('export-ready')).toContainText('Backup ready', { timeout: 30_000 });
  await expect(page.getByTestId('export-ready')).toContainText('.pfbackup');
  await expect(page.getByTestId('share-backup')).toBeVisible();
  await expect(page.getByTestId('export-backup')).toHaveCount(0);
  const dl = page.waitForEvent('download');
  await page.getByTestId('download-backup').click();
  expect((await dl).suggestedFilename()).toMatch(/^Harbour at dusk \d{4}-\d\d-\d\d\.pfbackup$/);
  await expect(page.getByTestId('last-backup')).toContainText('Last backup:');
  await expect(page.getByTestId('last-backup')).toContainText('30 pieces then');
});

test('the "Back up now?" toast: on opening a puzzle with a backup due, at most once a day; Back up opens More and starts it', async ({ page }) => {
  await seed(page);
  await page.goto('./#/puzzle/more-done');
  await page.reload();
  await expect(page.getByTestId('tab-table')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('toast-text')).toHaveText('Back up now?');
  await expect(page.getByTestId('toast-action')).toHaveText('Back up');
  await page.getByTestId('toast-action').click();
  await expect(page.getByTestId('tab-more')).toHaveAttribute('aria-current', 'page');
  expect(new URL(page.url()).hash).toBe('#/puzzle/more-done/more');
  await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 30_000 });
  // Opened again the same day (the backup only made, not yet taken off the iPhone): no second toast.
  await page.goto('./#/');
  await page.goto('./#/puzzle/more-done');
  await page.reload();
  await expect(page.getByTestId('tab-table')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('tab-more')).toHaveAttribute('aria-label', 'More, backup due');
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('More: Start a new lot of pieces (its sheet), Delete scanned pieces, Removed scans brings them back', async ({ page }) => {
  await seed(page);
  await openMore(page);
  await page.getByTestId('new-batch').click();
  const sheet = page.getByTestId('new-batch-confirm');
  await expect(sheet).toContainText('Start a new lot of pieces?');
  await expect(sheet).toContainText('6 pieces on the table are set aside');
  await page.getByTestId('new-batch-yes').click();
  await expect(page.getByTestId('scan-bin-note')).toContainText('New lot started (lot 2): 6 pieces set aside');
  await expect(page.getByTestId('new-batch')).toHaveCount(0);
  // Delete the pieces read so far (an action sheet), then bring them back from Removed scans.
  await page.getByTestId('delete-scan').click();
  await page.getByTestId('delete-scan-yes').click();
  await expect(page.getByTestId('scan-bin-note')).toContainText('30 pieces moved to the bin');
  await expect(page.getByTestId('restore-scan')).toContainText('Removed scans');
  await expect(page.getByTestId('scan-bin')).toContainText('30 pieces and 0 photos');
  await expect(page.getByTestId('delete-scan')).toHaveCount(0);
  await page.getByTestId('restore-scan').click();
  await expect(page.getByTestId('scan-bin-note')).toContainText('30 pieces restored');
  await expect(page.getByTestId('restore-scan')).toHaveCount(0);
  await expect(page.getByTestId('delete-scan')).toBeVisible();
});

test('More: rename in its row (Enter saves, Escape keeps the name); Delete this puzzle asks first', async ({ page }) => {
  await seed(page);
  await openMore(page);
  await page.getByTestId('rename').click();
  const input = page.getByTestId('rename-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Harbour at dusk');
  await input.press('Escape');
  await expect(page.getByTestId('puzzle-name')).toHaveText('Harbour at dusk');
  await page.getByTestId('rename').click();
  await page.getByTestId('rename-input').fill('Lighthouse');
  await page.getByTestId('rename-input').press('Enter');
  await expect(page.getByTestId('puzzle-name')).toHaveText('Lighthouse');
  await expect(page.getByTestId('navbar').locator('h1')).toHaveText('Lighthouse');
  // Delete: Cancel keeps it; Delete puzzle deletes it and goes Home.
  await page.getByTestId('delete-puzzle').click();
  await expect(page.getByTestId('confirm-sheet')).toContainText('Delete “Lighthouse”?');
  await page.getByTestId('confirm-sheet-cancel').click();
  await expect(page.getByTestId('confirm-sheet')).toHaveCount(0);
  await expect(page.getByTestId('puzzle-name')).toHaveText('Lighthouse');
  await page.getByTestId('delete-puzzle').click();
  await page.getByTestId('confirm-sheet-ok').click();
  await expect(page.getByTestId('your-puzzles')).toBeVisible();
  await expect(page.getByTestId('puzzle-card')).toHaveCount(2);
  await expect(page.getByTestId('your-puzzles')).not.toContainText('Lighthouse');
});

for (const tester of [true, false])
  test(`More: "How often is the app right?" ${tester ? 'shows in Tester mode' : 'is hidden without Tester mode'}`, async ({ page }) => {
    await seed(page, { answers: true, tester });
    await openMore(page);
    await expect(page.getByTestId('more-help')).toBeVisible();
    if (!tester) {
      await expect(page.getByTestId('accuracy-link')).toHaveCount(0);
      return;
    }
    await page.getByTestId('accuracy-link').click();
    await expect(page.locator('.navbar h1')).toHaveText('How often is the app right?');
    await page.getByRole('button', { name: 'Back to Harbour at dusk' }).click();
    await expect(page.getByTestId('tab-more')).toHaveAttribute('aria-current', 'page');
  });

test('Home: puzzle cards (picture or icon, name, in place with a bar) open the Table tab; Settings in the bar; Import opens the picker', async ({ page }) => {
  await seed(page);
  await page.reload();
  const cards = page.getByTestId('puzzle-card');
  await expect(cards).toHaveCount(3);
  const harbour = cards.filter({ hasText: 'Harbour at dusk' });
  await expect(harbour.locator('img')).toBeVisible();
  await expect(harbour.locator('.home-card-name')).toHaveText('Harbour at dusk');
  await expect(harbour.getByTestId('puzzle-card-progress')).toHaveText('24 of 80 in place');
  await expect(harbour).toContainText('80 pieces · 10 × 8');
  const bar = harbour.locator('.home-card-bar > span');
  const full = (await harbour.locator('.home-card-bar').boundingBox())!.width;
  expect((await bar.boundingBox())!.width / full).toBeCloseTo(24 / 80, 1);
  // The name on its band reads (white on the dark band).
  // No box picture: the puzzle icon; set-up not finished: the step instead of a bar.
  const lake = cards.filter({ hasText: 'Mountain lake' });
  await expect(lake.locator('svg[data-icon=puzzle]')).toBeVisible();
  await expect(lake.getByTestId('puzzle-card-progress')).toHaveText('0 of 48 in place');
  const setup = cards.filter({ hasText: 'Half set up' });
  await expect(setup).toContainText('Set-up: step 3 of 4 (Grid)');
  await expect(setup.locator('.home-card-bar')).toHaveCount(0);
  // Large Title; Settings is an icon in the bar.
  await expect(page.locator('h1.large-title')).toHaveText('Puzzle Lens');
  const settingsBtn = page.getByTestId('navbar').getByTestId('tool-settings');
  await expect(settingsBtn).toHaveAccessibleName('Settings');
  await expect(settingsBtn.locator('svg[data-icon=settings]')).toBeVisible();
  // Import a backup: a footer link under New puzzle that opens the file picker.
  const newY = (await page.getByTestId('new-puzzle').boundingBox())!.y;
  expect((await page.getByTestId('import-backup').boundingBox())!.y).toBeGreaterThan(newY);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-backup').click();
  expect((await chooser).isMultiple()).toBe(false);
  // The whole card opens the puzzle, on its Table tab.
  await harbour.locator('.home-card-meta').click();
  await expect(page).toHaveURL(/#\/puzzle\/more-done$/);
  await expect(page.getByTestId('tab-table')).toHaveAttribute('aria-current', 'page');
  await page.goto('./#/');
  await page.getByTestId('tool-settings').click();
  await expect(page).toHaveURL(/#\/settings$/);
});

for (const size of [
  { width: 375, height: 667 },
  { width: 402, height: 874 },
])
  test(`${size.width} px: More and Home: no target under 44 px, no sideways scroll, nothing under the tab bar`, async ({ page }) => {
    await seed(page, { answers: true });
    await page.setViewportSize(size);
    await page.reload();
    await page.addStyleTag({ content: SAFE });
    await expect(page.getByTestId('puzzle-card')).toHaveCount(3);
    expect(await smallTargets(page), 'home').toEqual([]);
    expect(await sideways(page), 'home').toBeLessThanOrEqual(0);
    await openMore(page);
    const check = async (what: string, bottom = true) => {
      expect(await smallTargets(page), what).toEqual([]);
      expect(await sideways(page), what).toBeLessThanOrEqual(0);
      // (While the name field has the focus, WebKit keeps it in view instead of scrolling to the end.)
      if (!bottom) return;
      const barTop = (await page.getByTestId('puzzle-tabs').boundingBox())!.y;
      // Scrolled to the end, again until the page stops growing (the list's rows can still be arriving when the
      // first scroll happens: that made this check flaky under load).
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              scrollTo(0, document.documentElement.scrollHeight);
              let bottom = 0;
              for (const el of document.querySelectorAll('main *')) {
                if ((el as HTMLElement).closest('.tabbar')) continue;
                const r = el.getBoundingClientRect();
                if (r.height > 0) bottom = Math.max(bottom, r.bottom);
              }
              return bottom;
            }),
          { message: what, timeout: 10_000 },
        )
        .toBeLessThanOrEqual(barTop);
      await page.evaluate(() => scrollTo(0, 0));
    };
    await check('more');
    await page.getByTestId('rename').click();
    await check('renaming', false);
    await page.getByTestId('rename-input').press('Escape');
    await page.getByTestId('export-backup').click();
    await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 30_000 });
    await check('backup ready');
    await openMore(page, 'more-setup');
    await check('set-up');
  });
