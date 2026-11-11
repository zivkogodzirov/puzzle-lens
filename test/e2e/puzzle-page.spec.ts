/**
 * The puzzle page in the component kit (M9 part 2, round 2): icons instead of emoji (with their words or a
 * VoiceOver name), the NavBar back to the list of puzzles, action sheets before deleting the puzzle or the
 * scanned pieces (Cancel keeps everything), the new-batch explanation in a sheet, ✓ Fits answered with an
 * Undo toast, and at 375 and 402 px every button and link at least 44 px with no sideways scroll.
 */
import { createCanvas } from '@napi-rs/canvas';
import type { Page } from '@playwright/test';
import { extractPatch } from '../../src/cv/placement';
import type { Vec2 } from '../../src/project/types';
import { generatePuzzle } from '../synth/index';
import { test, expect, gotoScreen } from './fixtures';

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

async function openPuzzle(page: Page, id = 'shell-done'): Promise<void> {
  await page.goto(`./#/puzzle/${id}`);
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

test('icons instead of emoji, with their words: the action bar, the answers, the tools list', async ({ page }) => {
  await seed(page, null, true);
  await openPuzzle(page);
  await expect(page.getByTestId('place-summary')).toContainText(/[1-9]\d* strong/, { timeout: 60_000 });
  const bar = page.getByTestId('action-bar');
  for (const [id, icon, name] of [
    ['scan-pieces', 'camera', 'Scan'],
    ['live-toggle', 'scan-eye', 'Live view'],
    ['fill-toggle', 'target', 'Fill a spot'],
    ['matches-toggle', 'link', 'Joins'],
  ] as const) {
    const btn = bar.getByTestId(id);
    await expect(btn.locator(`svg[data-icon="${icon}"]`)).toHaveCount(1);
    await expect(btn).toHaveAccessibleName(new RegExp(`^${name}`));
  }
  // No emoji left as words on the page (the canvas labels of the live view are drawn, not in the page).
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/[📷📸👁🎯🧩🎨🗺📈📊💾🔄🖼🖨]/u);
  // The tools: one list, each row with its icon.
  const tools = page.getByTestId('puzzle-tools');
  for (const [id, icon] of [
    ['table-toggle', 'map'],
    ['trays-toggle', 'inbox'],
    ['progress-link', 'trending-up'],
  ] as const)
    await expect(tools.getByTestId(id).locator(`svg[data-icon="${icon}"]`)).toHaveCount(1);
  await expect(page.getByTestId('trays-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.getByTestId('trays-toggle').click();
  await expect(page.getByTestId('trays-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('trays')).toBeVisible();
  await page.getByTestId('trays-toggle').click();
  // A piece's answers: a check and an x beside the same words; Fits is the filled green button.
  await page.locator('[data-testid="catalog"] .thumb-btn').first().click();
  const fits = page.getByTestId('spot-fits');
  await expect(fits).toHaveAccessibleName('Fits');
  await expect(fits.locator('svg[data-icon="check"]')).toHaveCount(1);
  await expect(fits).toHaveClass(/btn-good/);
  await expect(page.getByTestId('spot-not')).toHaveAccessibleName("Doesn't fit");
  await expect(page.getByTestId('spot-not').locator('svg[data-icon="x"]')).toHaveCount(1);
  await expect(page.getByTestId('spot-remove')).toHaveClass(/btn-destructive/);
  // ✓ Fits: a toast with Undo; Undo puts the piece back on the table.
  const thumbs = page.locator('[data-testid="catalog"] .thumb-btn');
  await expect(thumbs).toHaveCount(6);
  await fits.click();
  await expect(page.getByTestId('toast-text')).toContainText(/In the puzzle at column \d+, row \d+\./);
  await expect(thumbs).toHaveCount(5);
  await page.getByTestId('toast-action').click();
  await expect(thumbs).toHaveCount(6);
  await expect(page.getByTestId('toast')).toHaveCount(0);

  // Something opening over the page closes the toast, so it never covers that layer's own buttons (review
  // 2026-11-11: over the live view it covered "Doesn't fit", and over the delete sheet "Delete puzzle").
  await thumbs.first().click();
  await page.getByTestId('spot-fits').click();
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

test('Delete this puzzle: an action sheet; Cancel keeps it, Delete puzzle deletes it', async ({ page }) => {
  await seed(page, null);
  await openPuzzle(page, 'shell-setup');
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

test('Delete scanned pieces: an action sheet; Cancel keeps them, Delete pieces moves them to the bin', async ({ page }) => {
  await seed(page, null, true);
  await openPuzzle(page);
  await expect(page.getByTestId('puzzle-pieces')).toContainText('6');
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
  await expect(page.getByTestId('puzzle-pieces')).toContainText('6');
  await expect(page.getByTestId('scan-bin')).toHaveCount(0);
  await page.getByTestId('delete-scan').click();
  await page.getByTestId('delete-scan-yes').click();
  await expect(page.getByTestId('scan-bin-note')).toContainText('6 pieces moved to the bin');
  await expect(page.getByTestId('scan-bin-note')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('puzzle-pieces')).toContainText('0');
  await expect(page.getByTestId('scan-bin')).toContainText('6 pieces');
  // Restore (nothing to swap with): at once.
  await page.getByTestId('restore-scan').click();
  await expect(page.getByTestId('scan-bin-note')).toContainText('6 pieces restored');
  await expect(page.getByTestId('puzzle-pieces')).toContainText('6');
});

test('Start a new batch: its explanation in a sheet; Cancel keeps the pieces on the table', async ({ page }) => {
  await seed(page, null, true);
  await openPuzzle(page);
  await page.getByTestId('new-batch').click();
  const sheet = page.getByTestId('new-batch-confirm');
  await expect(sheet).toHaveAttribute('role', 'dialog');
  await expect(sheet).toContainText('6 pieces on the table are set aside');
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('new-batch')).toBeVisible();
  await expect(page.getByTestId('puzzle-batch')).toHaveCount(0);
});

for (const size of [
  { width: 375, height: 667 },
  { width: 402, height: 874 },
]) {
  test(`${size.width} px: no button or link under 44 px, no sideways scroll (panels and sheets open too)`, async ({ page }) => {
    await seed(page, null, true);
    await page.setViewportSize(size);
    await openPuzzle(page);
    await expect(page.getByTestId('place-summary')).toContainText(/[1-9]\d* strong/, { timeout: 60_000 });
    expect(await smallTargets(page)).toEqual([]);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    // A piece's panel.
    await page.locator('[data-testid="catalog"] .thumb-btn').first().click();
    await expect(page.getByTestId('spot-fits')).toBeVisible();
    expect(await smallTargets(page)).toEqual([]);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.getByTestId('spot-close').click();
    // The panels from the action bar, and the trays.
    for (const id of ['fill-toggle', 'matches-toggle']) {
      await page.getByTestId(id).click();
      expect(await smallTargets(page), id).toEqual([]);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      await page.getByTestId(id).click();
    }
    await page.getByTestId('trays-toggle').click();
    await expect(page.getByTestId('tray-groups')).toBeVisible({ timeout: 30_000 });
    expect(await smallTargets(page)).toEqual([]);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.getByTestId('trays-toggle').click();
    // The sheets.
    await page.getByTestId('new-batch').click();
    expect(await smallTargets(page, '[data-testid=new-batch-confirm]')).toEqual([]);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await page.getByTestId('delete-scan').click();
    expect(await smallTargets(page, '[data-testid=delete-scan-confirm]')).toEqual([]);
    await page.keyboard.press('Escape');
    // ✓ Fits: the toast and its Undo.
    await page.locator('[data-testid="catalog"] .thumb-btn').first().click();
    await page.getByTestId('spot-fits').click();
    await expect(page.getByTestId('toast')).toBeVisible();
    expect(await smallTargets(page, '[data-testid=toast]')).toEqual([]);
  });
}
