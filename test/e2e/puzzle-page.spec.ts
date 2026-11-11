/**
 * The puzzle page in the component kit (M9 part 2, round 2; M9 part 4: its four tabs): icons instead of emoji (with their
 * words or a VoiceOver name), the NavBar back to the list of puzzles, action sheets before deleting the puzzle or the
 * scanned pieces (Cancel keeps everything), the new-batch explanation in a sheet, ✓ Fits answered with an
 * Undo toast, and at 375 and 402 px every button and link at least 44 px with no sideways scroll.
 */
import { createCanvas } from '@napi-rs/canvas';
import type { Page } from '@playwright/test';
import { extractPatch } from '../../src/cv/placement';
import type { Vec2 } from '../../src/project/types';
import { generatePuzzle } from '../synth/index';
import { test, expect, gotoScreen, openTab } from './fixtures';

test.setTimeout(180_000);
// Blobs in IndexedDB need a persistent WebKit context (as in scan-bin.spec.ts).
test.use({ persistentStorage: true });

const pz = generatePuzzle({ cols: 10, rows: 8, cellMm: [17.8, 19.4], seed: 5 });
const art = pz.art;
const picture = { data: art.rgba, width: art.width, height: art.height, stride: art.width * 4 };
const ids = ['r1c2', 'r3c7', 'r5c4', 'r6c8', 'r2c5', 'r4c1'];

function patchFor(id: string, q: number): string {
  const p = pz.pieces.find((x) => x.id === id)!;
  const [sx, sy] = art.pxPerMm;
  const cx = (p.col + 0.5) * pz.cellMm[0];
  const cy = (p.row + 0.5) * pz.cellMm[1];
  const toPx = (x: number, y: number): Vec2 => [(x + cx) * sx, (y + cy) * sy];
  const corners = [0, 1, 2, 3].map((k) => toPx(p.cornersMm[2 * k]!, p.cornersMm[2 * k + 1]!));
  const outline: number[] = [];
  for (let i = 0; i < p.outlineMm.length; i += 2) outline.push(...toPx(p.outlineMm[i]!, p.outlineMm[i + 1]!));
  const patch = extractPatch(
    picture,
    [0, 1, 2, 3].map((k) => corners[(k + q) % 4]!),
    outline,
  )!;
  return Buffer.from(patch.rgba).toString('base64');
}

function boxJpeg(): string {
  const c = createCanvas(art.width, art.height);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(art.width, art.height);
  img.data.set(art.rgba);
  ctx.putImageData(img, 0, 0);
  return c.encodeSync('jpeg', 92).toString('base64');
}

/**
 * The same puzzles as shell.spec.ts. Puzzles in IndexedDB: `shell-done` (set-up finished, a box picture and pieces that can be placed)
 * and `shell-setup` (stopped at step 3). `current`: the puzzle the app remembers as open last.
 */
async function seed(page: Page, current: string | null, withPieces = false): Promise<void> {
  const patches = withPieces ? ids.map((pid, i) => ({ id: pid, b64: patchFor(pid, i % 4) })) : [];
  await gotoScreen(page, '');
  const ok = await page.evaluate(
    async ([box, ps, w, h, cur]) => {
      const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'pieces', 'blobs', 'settings'], 'readwrite');
        if (cur) tx.objectStore('settings').put({ key: 'currentProjectId', value: cur });
        tx.objectStore('blobs').put({ id: 'shell:box', ts: 1, kind: 'box', blob: new Blob([bytes(box)], { type: 'image/jpeg' }) });
        const base = { createdAt: 1, updatedAt: 2, pieceCount: 80, markerMap: null, tableModel: null, tracking: 'pieces', openSpots: null };
        tx.objectStore('projects').put({
          ...base,
          id: 'shell-done',
          name: 'Harbour at dusk',
          grid: { cols: 10, rows: 8, source: 'suggested' },
          box: {
            photoBlobId: 'shell:box',
            rectifiedBlobId: 'shell:box',
            corners: [
              [0, 0],
              [w, 0],
              [w, h],
              [0, h],
            ],
            photoWidth: w,
            photoHeight: h,
            width: w,
            height: h,
          },
          piecePitch: { wMm: 17.8, hMm: 19.4, n: 6 },
          setupStep: 6,
          scaleSource: 'coin',
        });
        tx.objectStore('projects').put({ ...base, id: 'shell-setup', name: 'Half set up', grid: null, box: null, piecePitch: null, setupStep: 3 });
        ps.forEach((p, i) => {
          tx.objectStore('blobs').put({ id: `shell:patch-${p.id}`, ts: 1, kind: 'patch', blob: new Blob([bytes(p.b64)]) });
          tx.objectStore('pieces').put({
            id: p.id,
            projectId: 'shell-done',
            createdAt: 1,
            updatedAt: 1,
            status: 'table',
            table: { x: i * 30, y: 0, angleDeg: 0, lastSeen: 1, snapId: 's1' },
            outlineMm: [0, 0, 1, 0, 1, 1],
            areaMm2: 345,
            sizeMm: [18, 19],
            colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
            thumbBlobId: null,
            seen: 1,
            bestPxPerMm: 5,
            flags: {},
            patch: { blobId: `shell:patch-${p.id}`, flats: [false, false, false, false], sure: false, ts: 5 },
          });
        });
        tx.oncomplete = () => res();
      });
      dbh.close();
      return 'ok';
    },
    [boxJpeg(), patches, art.width, art.height, current] as const,
  );
  expect(ok).toBe('ok');
}

/** Home Screen app safe areas (WebKit in Playwright reports 0). */
const SAFE = ':root { --safe-top: 62px !important; --safe-bottom: 34px !important; }';

/** Opens a puzzle (on a tab: M9 part 4), as after a reload, with the Home Screen app's safe areas. */
async function openPuzzle(page: Page, id = 'shell-done', tab: 'table' | 'picture' | 'pieces' | 'more' | '' = ''): Promise<void> {
  await page.goto(`./#/puzzle/${id}${tab ? `/${tab}` : ''}`);
  await page.reload();
  await page.addStyleTag({ content: SAFE });
  await expect(page.getByTestId('puzzle-screen')).toBeVisible();
}

/** Every visible button and link (in `within`) at least 44 × 44 px; links inside a sentence are left out. */
async function smallTargets(page: Page, within = '#app'): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const root of document.querySelectorAll(sel))
      for (const el of root.querySelectorAll<HTMLElement>('button, a[href], [role=button], input, select')) {
        if (el.classList.contains('link-btn')) continue;
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

test('icons instead of emoji, with their words: the tab bar, Scan, the old actions on their tabs, the answers, the tools list', async ({ page }) => {
  await seed(page, null, true);
  await openPuzzle(page, 'shell-done', 'pieces');
  await expect(page.getByTestId('place-summary')).toContainText(/[1-9]\d* very likely/, { timeout: 60_000 });
  // M9 part 4: the tab bar (it replaced the action bar), and Scan in the navigation bar.
  const bar = page.getByTestId('puzzle-tabs');
  for (const [id, icon, name] of [
    ['tab-table', 'scan-eye', 'Table'],
    ['tab-picture', 'image', 'Picture'],
    ['tab-pieces', 'puzzle', 'Pieces'],
    ['tab-more', 'more-horizontal', 'More'],
  ] as const) {
    const btn = bar.getByTestId(id);
    await expect(btn.locator(`svg[data-icon="${icon}"]`)).toHaveCount(1);
    await expect(btn).toHaveAccessibleName(new RegExp(`^${name}`));
  }
  const scan = page.getByTestId('navbar').getByTestId('scan-pieces');
  await expect(scan.locator('svg[data-icon="camera"]')).toHaveCount(1);
  await expect(scan).toHaveAccessibleName('Scan pieces');
  // The old action bar's other actions, each on its tab with its icon.
  for (const [tab, id, icon, name] of [
    ['pieces', 'matches-toggle', 'link', 'Which pieces join'],
    ['picture', 'fill-toggle', 'target', 'Fill a spot'],
    ['table', 'live-toggle', 'scan-eye', 'Start live view'],
  ] as const) {
    await openTab(page, tab);
    const btn = page.getByTestId(id);
    await expect(btn.locator(`svg[data-icon="${icon}"]`)).toHaveCount(1);
    await expect(btn).toHaveAccessibleName(new RegExp(`^${name}`));
    // No emoji left as words on the tab (the canvas labels of the live view are drawn, not in the page).
    const text = await page.locator('main').innerText();
    expect(text, tab).not.toMatch(/[📷📸👁🎯🧩🎨🗺📈📊💾🔄🖼🖨]/u);
  }
  // "Show my table" on the Table tab, and the Pieces tab's tools: one list, each row with its icon.
  await expect(page.getByTestId('table-toggle').locator('svg[data-icon="map"]')).toHaveCount(1);
  await openTab(page, 'more');
  expect(await page.locator('main').innerText()).not.toMatch(/[📷📸👁🎯🧩🎨🗺📈📊💾🔄🖼🖨]/u);
  await openTab(page, 'pieces');
  const tools = page.getByTestId('puzzle-tools');
  for (const [id, icon] of [
    ['matches-toggle', 'link'],
    ['trays-toggle', 'inbox'],
  ] as const)
    await expect(tools.getByTestId(id).locator(`svg[data-icon="${icon}"]`)).toHaveCount(1);
  // M9 part 4: Sort into trays opens its own page (Back returns to the tab).
  await page.getByTestId('trays-toggle').click();
  await expect(page.getByTestId('trays')).toBeVisible();
  await page.getByTestId('navbar-back').click();
  // A piece's answers (M9 part 3: "It fits" / "Not there"): a check and an x beside the words; It fits is the filled green button.
  await page.locator('[data-testid="catalog"] .thumb-btn').first().click();
  const fits = page.getByTestId('spot-fits');
  await expect(fits).toHaveAccessibleName(/^It fits in column \d+, row \d+$/); // M9 part 6: with the spot, for VoiceOver
  await expect(fits.locator('svg[data-icon="check"]')).toHaveCount(1);
  await expect(fits).toHaveClass(/btn-good/);
  await expect(page.getByTestId('spot-not')).toHaveAccessibleName(/^Not there: column \d+, row \d+$/);
  await expect(page.getByTestId('spot-not').locator('svg[data-icon="x"]')).toHaveCount(1);
  // "Not a piece": a red plain button with a trash icon.
  await expect(page.getByTestId('spot-remove')).toHaveAccessibleName('Not a piece');
  await expect(page.getByTestId('spot-remove').locator('svg[data-icon="trash"]')).toHaveCount(1);
  // It fits: a toast with Undo; Undo puts the piece back on the table.
  const thumbs = page.locator('[data-testid="catalog"] .thumb-btn');
  await expect(thumbs).toHaveCount(6);
  await fits.click();
  await expect(page.getByTestId('toast-text')).toContainText(/Placed at \d+·\d+/);
  await expect(thumbs).toHaveCount(5);
  await page.getByTestId('toast-action').click();
  await expect(thumbs).toHaveCount(6);
  await expect(page.getByTestId('toast')).toHaveCount(0);

  // Something opening over the page closes the toast, so it never covers that layer's own buttons (review
  // 2026-11-11: over the live view it covered "Doesn't fit", and over the delete sheet "Delete puzzle").
  // Switching tabs keeps it (its Undo works from every tab).
  await thumbs.first().click();
  await page.getByTestId('spot-fits').click();
  await expect(page.getByTestId('toast')).toBeVisible();
  await openTab(page, 'more');
  await expect(page.getByTestId('toast')).toBeVisible();
  await page.getByTestId('delete-puzzle').click();
  await expect(page.getByTestId('confirm-sheet')).toBeVisible();
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await page.getByTestId('confirm-sheet-cancel').click();
});

test('NavBar: the puzzle’s name as the title; back goes to the list of puzzles', async ({ page }) => {
  await seed(page, null);
  await openPuzzle(page, 'shell-setup');
  await expect(page.getByTestId('navbar').locator('h1')).toHaveText('Half set up');
  const back = page.getByRole('button', { name: 'Back to home' });
  await expect(back).toContainText('Home');
  await back.click();
  await expect(page.getByTestId('your-puzzles')).toBeVisible();
  // A puzzle that isn't there: the same way back, and the message in a callout.
  await page.goto('./#/puzzle/not-here');
  await page.reload();
  await expect(page.getByTestId('puzzle-missing')).toContainText('not on this iPhone');
  await expect(page.getByTestId('puzzle-missing').locator('.callout-bad')).toHaveAttribute('role', 'alert');
  await page.getByTestId('navbar-back').click();
  await expect(page.getByTestId('your-puzzles')).toBeVisible();
});

test('Delete this puzzle (More tab): an action sheet; Cancel keeps it, Delete puzzle deletes it', async ({ page }) => {
  await seed(page, null);
  await openPuzzle(page, 'shell-setup', 'more');
  await page.getByTestId('delete-puzzle').click();
  const sheet = page.getByTestId('confirm-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('role', 'alertdialog');
  await expect(sheet).toContainText('Delete “Half set up”?');
  await expect(sheet).toContainText('can’t be undone');
  await page.getByTestId('confirm-sheet-cancel').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('puzzle-name')).toHaveText('Half set up');
  await page.reload();
  await expect(page.getByTestId('puzzle-name')).toHaveText('Half set up');
  await page.getByTestId('delete-puzzle').click();
  await page.getByTestId('confirm-sheet-ok').click();
  await expect(page.getByTestId('your-puzzles')).toBeVisible();
  await expect(page.getByTestId('your-puzzles')).not.toContainText('Half set up');
  await expect(page.getByTestId('your-puzzles')).toContainText('Harbour at dusk');
});

test('Delete scanned pieces (More tab): an action sheet; Cancel keeps them, Delete pieces moves them to the bin', async ({ page }) => {
  await seed(page, null, true);
  await openPuzzle(page, 'shell-done', 'pieces');
  await expect(page.getByTestId('puzzle-pieces')).toContainText('6');
  await openTab(page, 'more');
  await page.getByTestId('delete-scan').click();
  const sheet = page.getByTestId('delete-scan-confirm');
  await expect(sheet).toHaveAttribute('role', 'alertdialog');
  await expect(sheet).toContainText('Delete the 6 pieces read so far?');
  await expect(sheet.getByTestId('delete-scan-rescan')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await page.getByTestId('delete-scan').click();
  await page.getByTestId('delete-scan-confirm-cancel').click();
  await expect(page.getByTestId('delete-scan-confirm')).toHaveCount(0);
  await expect(page.getByTestId('scan-bin')).toHaveCount(0);
  await openTab(page, 'pieces');
  await expect(page.getByTestId('puzzle-pieces')).toContainText('6');
  await openTab(page, 'more');
  await page.getByTestId('delete-scan').click();
  await page.getByTestId('delete-scan-yes').click();
  await expect(page.getByTestId('scan-bin-note')).toContainText('6 pieces moved to the bin');
  // M9 part 6: read out from the screen's one status region.
  await expect(page.getByTestId('announce')).toContainText('6 pieces moved to the bin');
  await expect(page.getByTestId('scan-bin')).toContainText('6 pieces');
  // Restore (nothing to swap with): at once.
  await page.getByTestId('restore-scan').click();
  await expect(page.getByTestId('scan-bin-note')).toContainText('6 pieces restored');
  await openTab(page, 'pieces');
  await expect(page.getByTestId('puzzle-pieces')).toContainText('6');
});

test('Start a new batch (More tab): its explanation in a sheet; Cancel keeps the pieces on the table', async ({ page }) => {
  await seed(page, null, true);
  await openPuzzle(page, 'shell-done', 'more');
  await page.getByTestId('new-batch').click();
  const sheet = page.getByTestId('new-batch-confirm');
  await expect(sheet).toHaveAttribute('role', 'dialog');
  await expect(sheet).toContainText('6 pieces on the table are set aside');
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('new-batch')).toBeVisible();
  await openTab(page, 'pieces');
  await expect(page.getByTestId('puzzle-batch')).toHaveCount(0);
});

for (const size of [
  { width: 375, height: 667 },
  { width: 402, height: 874 },
]) {
  test(`${size.width} px: no button or link under 44 px, no sideways scroll on every tab (panels and sheets open too)`, async ({ page }) => {
    await seed(page, null, true);
    await page.setViewportSize(size);
    await openPuzzle(page, 'shell-done', 'pieces');
    await expect(page.getByTestId('place-summary')).toContainText(/[1-9]\d* very likely/, { timeout: 60_000 });
    for (const tab of ['table', 'picture', 'pieces', 'more'] as const) {
      await openTab(page, tab);
      await page.waitForTimeout(300);
      expect(await smallTargets(page), tab).toEqual([]);
      expect(await sideways(page), tab).toBeLessThanOrEqual(0);
    }
    await openTab(page, 'pieces');
    // A piece's card (M9 part 3: a sheet).
    await page.locator('[data-testid="catalog"] .thumb-btn').first().click();
    await expect(page.getByTestId('spot-fits')).toBeVisible();
    expect(await smallTargets(page)).toEqual([]);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.getByTestId('spot-close').click();
    // The panels (Joins and the trays on Pieces: pages of their own since M9 part 4, Fill a spot on Picture).
    await page.getByTestId('matches-toggle').click();
    await expect(page.getByTestId('matches')).toBeVisible();
    expect(await smallTargets(page), 'matches').toEqual([]);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.getByTestId('navbar-back').click();
    await page.getByTestId('trays-toggle').click();
    await expect(page.getByTestId('tray-groups')).toBeVisible({ timeout: 30_000 });
    expect(await smallTargets(page)).toEqual([]);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.getByTestId('navbar-back').click();
    await openTab(page, 'picture');
    await page.getByTestId('fill-toggle').click();
    await expect(page.getByTestId('fill-sheet')).toBeVisible();
    expect(await smallTargets(page), 'fill').toEqual([]);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.getByTestId('fill-sheet-close').click();
    await expect(page.getByTestId('fill-sheet')).toHaveCount(0);
    // The sheets (More tab).
    await openTab(page, 'more');
    await page.getByTestId('new-batch').click();
    expect(await smallTargets(page, '[data-testid=new-batch-confirm]')).toEqual([]);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await page.getByTestId('delete-scan').click();
    expect(await smallTargets(page, '[data-testid=delete-scan-confirm]')).toEqual([]);
    await page.keyboard.press('Escape');
    // ✓ Fits: the toast and its Undo.
    await openTab(page, 'pieces');
    await page.locator('[data-testid="catalog"] .thumb-btn').first().click();
    await page.getByTestId('spot-fits').click();
    await expect(page.getByTestId('toast')).toBeVisible();
    expect(await smallTargets(page, '[data-testid=toast]')).toEqual([]);
  });
}

// ---- M9 part 4: the puzzle's four tabs ----

const TABS = [
  ['table', 'Table'],
  ['picture', 'Picture'],
  ['pieces', 'Pieces'],
  ['more', 'More'],
] as const;

test('four tabs with their names; the selected one is aria-current; Table by default; each address opens its tab, also after a reload', async ({ page }) => {
  await seed(page, null, true);
  await openPuzzle(page);
  const bar = page.getByTestId('puzzle-tabs');
  await expect(bar).toHaveAttribute('aria-label', 'Puzzle');
  await expect(bar.locator('.tabbar-item')).toHaveCount(4);
  await expect(bar.locator('.tabbar-label')).toHaveText(TABS.map(([, name]) => name));
  // #/puzzle/<id>: the Table tab.
  await expect(page.getByTestId('tab-table')).toHaveAttribute('aria-current', 'page');
  await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(page.getByTestId('tab-panel-table')).toBeVisible();
  for (const [tab, name] of TABS) {
    // A deep link to the tab, then a reload: the same tab.
    await page.goto(`./#/puzzle/shell-done/${tab}`);
    await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId(`tab-panel-${tab}`)).toHaveAttribute('aria-label', name);
    await page.reload();
    await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute('aria-current', 'page');
    await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.getByTestId('navbar').locator('h1')).toHaveText('Harbour at dusk');
  }
  // An unknown tab name: the Table tab.
  await page.goto('./#/puzzle/shell-done/nowhere');
  await expect(page.getByTestId('tab-table')).toHaveAttribute('aria-current', 'page');
  // Tapping a tab writes its address (the Table tab's is the puzzle's own).
  await openTab(page, 'pieces');
  expect(new URL(page.url()).hash).toBe('#/puzzle/shell-done/pieces');
  await openTab(page, 'table');
  expect(new URL(page.url()).hash).toBe('#/puzzle/shell-done');
});

test('switching tabs adds no Back step: Back from any tab goes to Home; ‹ Home too; opened from Home, a puzzle starts on Table', async ({ page }) => {
  await seed(page, null, true);
  await page.goto('./#/');
  await page.getByTestId('puzzle-card').filter({ hasText: 'Harbour at dusk' }).click();
  await expect(page.getByTestId('tab-table')).toHaveAttribute('aria-current', 'page');
  for (const [tab] of TABS.slice(1)) await openTab(page, tab);
  // The browser's Back (the edge swipe): Home, not the previous tab.
  await page.goBack();
  await expect(page.getByTestId('your-puzzles')).toBeVisible();
  // Opened again from Home: on Table, whatever tab was open before.
  await page.getByTestId('puzzle-card').filter({ hasText: 'Harbour at dusk' }).click();
  await expect(page.getByTestId('tab-table')).toHaveAttribute('aria-current', 'page');
  // ‹ Home from a tab.
  await openTab(page, 'picture');
  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page.getByTestId('your-puzzles')).toBeVisible();
});

test('the last puzzle reopens at launch on its Table tab, whatever tab was open', async ({ page }) => {
  await seed(page, 'shell-done', true);
  await page.goto('./#/puzzle/shell-done/more');
  await expect(page.getByTestId('tab-more')).toHaveAttribute('aria-current', 'page');
  await page.goto('about:blank');
  await page.goto('./');
  await expect(page.getByTestId('tab-table')).toHaveAttribute('aria-current', 'page');
  expect(new URL(page.url()).hash).toBe('#/puzzle/shell-done');
  await page.goBack();
  await expect(page.getByTestId('your-puzzles')).toBeVisible();
});

test('the old action bar’s actions: Scan in the navigation bar on every tab, Live view on Table, Fill a spot on Picture, Joins on Pieces', async ({ page }) => {
  await seed(page, null, true);
  await openPuzzle(page, 'shell-done', 'pieces');
  await expect(page.getByTestId('place-summary')).toContainText(/[1-9]\d* very likely/, { timeout: 60_000 });
  await expect(page.getByTestId('action-bar')).toHaveCount(0);
  for (const [tab] of TABS) {
    await openTab(page, tab);
    await expect(page.getByTestId('navbar').getByTestId('scan-pieces'), tab).toBeVisible();
  }
  // Joins (Pieces).
  await openTab(page, 'pieces');
  // (M9 part 4: its own page, opened at the top.)
  await page.getByTestId('matches-toggle').click();
  await expect(page.getByTestId('joins-page')).toBeVisible();
  await expect(page.locator('#matches-panel')).toBeInViewport();
  await page.getByTestId('navbar-back').click();
  // Fill a spot (Picture), with Progress below it (the old Progress page).
  await openTab(page, 'picture');
  await expect(page.getByTestId('progress-done')).toContainText(' of 80 · ');
  await expect(page.getByTestId('photo-puzzle')).toBeVisible();
  await page.getByTestId('fill-toggle').click();
  await expect(page.getByTestId('fill-sheet')).toBeInViewport();
  await page.getByTestId('fill-sheet-close').click();
  await expect(page.getByTestId('fill-sheet')).toHaveCount(0);
  // Live view (Table): the camera opens over the tab.
  await openTab(page, 'table');
  await page.getByTestId('live-toggle').click();
  await expect(page.getByTestId('live-table')).toBeVisible();
  await page.getByTestId('live-table-close').click();
  await expect(page.getByTestId('live-table')).toHaveCount(0);
  // Scan opens the camera; its Back returns to the puzzle.
  await page.getByTestId('scan-pieces').click();
  await expect(page.getByTestId('table-camera')).toBeVisible();
  await page.getByTestId('camera-close').click();
  await expect(page.getByTestId('puzzle-screen')).toBeVisible();
});

for (const size of [
  { width: 375, height: 667 },
  { width: 402, height: 874 },
]) {
  test(`${size.width} px: the tab bar never covers a tab's last line or the toast`, async ({ page }) => {
    await seed(page, null, true);
    await page.setViewportSize(size);
    await openPuzzle(page, 'shell-done', 'pieces');
    await expect(page.getByTestId('place-summary')).toContainText(/[1-9]\d* very likely/, { timeout: 60_000 });
    const barTop = async () => (await page.getByTestId('puzzle-tabs').boundingBox())!.y;
    expect(await barTop()).toBeGreaterThan(size.height - 49 - 34 - 4);
    for (const [tab] of TABS) {
      await openTab(page, tab);
      await page.waitForTimeout(500);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      const lastBottom = await page.evaluate(() => {
        let bottom = 0;
        for (const el of document.querySelectorAll('main *')) {
          if ((el as HTMLElement).closest('.tabbar')) continue;
          const r = el.getBoundingClientRect();
          if (r.height > 0) bottom = Math.max(bottom, r.bottom);
        }
        return bottom;
      });
      expect(lastBottom, tab).toBeLessThanOrEqual(await barTop());
      // Another tab starts at the top.
      await openTab(page, tab === 'more' ? 'table' : 'more');
      expect(await page.evaluate(() => scrollY)).toBe(0);
    }
    // The toast above the bar, from any tab (its Undo kept while switching).
    await openTab(page, 'pieces');
    await page.locator('[data-testid="catalog"] .thumb-btn').first().click();
    await page.getByTestId('spot-fits').click();
    for (const [tab] of TABS) {
      await openTab(page, tab);
      const toastBox = (await page.getByTestId('toast').boundingBox())!;
      expect(toastBox.y + toastBox.height, tab).toBeLessThanOrEqual(await barTop());
    }
    await page.getByTestId('toast-action').click();
    await openTab(page, 'pieces');
    await expect(page.locator('[data-testid="catalog"] .thumb-btn')).toHaveCount(6);
  });
}
