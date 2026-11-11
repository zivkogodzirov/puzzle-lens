/**
 * The Table tab as the main screen (M9 part 4, design plan §4 item 3): the last scan photo in the tab with its
 * outlines and column·row labels (a tap on a piece opens its card, "Pieces in view", the map button for full
 * screen), "Start live view" under it, the status line and progress ring at the top, the "Next step" chip above
 * the tab bar opening the joins' What next card in a sheet, the empty state, 44 px targets and nothing under the
 * tab bar at 375 and 402 px.
 *
 * Seeded: a 4 × 3 puzzle with one scan photo of the table and 6 pieces on it, their spots stored (no worker needed):
 * four make a square (columns 1–2, rows 1–2), one more is sure (4·3), one is a maybe;
 * one more piece is already in the puzzle (column 4, row 1).
 */
import { createCanvas } from '@napi-rs/canvas';
import type { Page } from '@playwright/test';
import { test, expect, openTab } from './fixtures';

test.use({ persistentStorage: true });
test.setTimeout(120_000);

const PID = 'e2e-tt';
/** Pieces on the table (mm on the table) and their stored spots. */
const PIECES = [
  { id: 'p0', x: 60, y: 50, col: 0, row: 0, verdict: 'strong' },
  { id: 'p1', x: 120, y: 60, col: 1, row: 0, verdict: 'strong' },
  { id: 'p2', x: 180, y: 50, col: 0, row: 1, verdict: 'strong' },
  { id: 'p3', x: 70, y: 130, col: 1, row: 1, verdict: 'strong' },
  { id: 'p4', x: 150, y: 140, col: 3, row: 2, verdict: 'strong' },
  { id: 'p5', x: 230, y: 120, col: 2, row: 2, verdict: 'likely' },
] as const;

/** The overview photo: 600 × 400 px of a 300 × 200 mm table, a grey square per piece. */
function photo(): string {
  const c = createCanvas(600, 400);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ede6d8';
  ctx.fillRect(0, 0, 600, 400);
  ctx.fillStyle = '#6b6b6b';
  for (const p of PIECES) ctx.fillRect((p.x - 9) * 2, (p.y - 9) * 2, 36, 36);
  return c.encodeSync('jpeg', 90).toString('base64');
}

/** A 4 × 3 box picture (one colour per cell). */
function box(): string {
  const c = createCanvas(160, 120);
  const ctx = c.getContext('2d');
  for (let r = 0; r < 3; r++)
    for (let col = 0; col < 4; col++) {
      ctx.fillStyle = `hsl(${(r * 4 + col) * 30}, 60%, 55%)`;
      ctx.fillRect(col * 40, r * 40, 40, 40);
    }
  return c.encodeSync('jpeg', 90).toString('base64');
}

/** Seeds the puzzle (`withPieces` false: set up, but nothing scanned yet; `setup` false: stopped at step 3). */
async function seed(page: Page, opts: { withPieces?: boolean; setup?: boolean; touching?: boolean } = {}): Promise<void> {
  const withPieces = opts.withPieces ?? true;
  const setup = opts.setup ?? true;
  const touching = opts.touching ?? false;
  await page.goto('./#/');
  await expect(page.locator('#app > .app.route-home')).toBeAttached();
  const ok = await page.evaluate(
    async ([pid, ps, jpg, boxJpg, withPieces, setup, touching]) => {
      const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'pieces', 'blobs', 'snaps', 'settings'], 'readwrite');
        tx.oncomplete = () => res();
        tx.objectStore('blobs').put({ id: `${pid}:box`, ts: 1, kind: 'box', blob: new Blob([bytes(boxJpg)], { type: 'image/jpeg' }) });
        tx.objectStore('projects').put({
          id: pid,
          name: 'Harbour at dusk',
          createdAt: 1,
          updatedAt: 2,
          pieceCount: 12,
          grid: setup ? { cols: 4, rows: 3, source: 'suggested' } : null,
          box: setup
            ? {
                photoBlobId: `${pid}:box`,
                rectifiedBlobId: `${pid}:box`,
                corners: [
                  [0, 0],
                  [160, 0],
                  [160, 120],
                  [0, 120],
                ],
                photoWidth: 160,
                photoHeight: 120,
                width: 160,
                height: 120,
              }
            : null,
          markerMap: null,
          tableModel: null,
          piecePitch: setup ? { wMm: 18, hMm: 18, n: 6 } : null,
          setupStep: setup ? 6 : 3,
          tracking: 'pieces',
          scaleSource: 'coin',
          openSpots: null,
        });
        if (!withPieces) return;
        tx.objectStore('blobs').put({ id: `${pid}:scan-s1`, ts: 1, kind: 'scan', blob: new Blob([bytes(jpg)], { type: 'image/jpeg' }) });
        tx.objectStore('snaps').put({
          id: 'tt-s1',
          projectId: pid,
          kind: 'overview',
          ts: 5,
          width: 600,
          height: 400,
          zoom: 1,
          imgToTable: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 1],
          quality: null,
          blobId: `${pid}:scan-s1`,
          pieceIds: ps.map((p) => p.id),
        });
        const row = (id: string, x: number, y: number, extra: Record<string, unknown>) => ({
          id,
          projectId: pid,
          createdAt: 1,
          updatedAt: 1,
          status: 'table',
          table: { x, y, angleDeg: 0, lastSeen: 1, snapId: 'tt-s1' },
          outlineMm: [-9, -9, 9, -9, 9, 9, -9, 9],
          areaMm2: 324,
          sizeMm: [18, 18],
          colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
          thumbBlobId: null,
          seen: 1,
          bestPxPerMm: 5,
          flags: {},
          patch: null,
          ...extra,
        });
        for (const p of ps) tx.objectStore('pieces').put(row(p.id, p.x, p.y, {}));
        // M10 fix: an outline of about 3 touching pieces (the scan's estimate by its size).
        if (touching) tx.objectStore('pieces').put(row('c1', 260, 170, { flags: { clump: true, touching: 3 } }));
        // One piece already in the puzzle.
        tx.objectStore('pieces').put(row('in1', 0, 0, { status: 'placed', placedAt: { col: 3, row: 0, rot: 0, at: 1, from: 'table' } }));
        const byPiece: Record<string, unknown> = {};
        for (const p of ps)
          byPiece[p.id] = {
            ts: 0,
            placement: {
              top:
                p.verdict === 'strong'
                  ? [{ col: p.col, row: p.row, rot: 0, score: 1, p: 0.95 }]
                  : [
                      { col: p.col, row: p.row, rot: 0, score: 0.5, p: 0.3 },
                      { col: 3, row: 1, rot: 0, score: 0.5, p: 0.28 },
                    ],
              verdict: p.verdict,
            },
          };
        tx.objectStore('settings').put({
          key: `placement:${pid}`,
          value: { boxKey: `${pid}:box|0,0;160,0;160,120;0,120|4x3`, colour: null, open: null, byPiece },
        });
      });
      dbh.close();
      return 'ok';
    },
    [PID, PIECES, photo(), box(), withPieces, setup, touching] as const,
  );
  expect(ok).toBe('ok');
}

/** Home Screen app safe areas (WebKit in Playwright reports 0). */
const SAFE = ':root { --safe-top: 62px !important; --safe-bottom: 34px !important; }';

async function openTable(page: Page, safe = false): Promise<void> {
  await page.goto(`./#/puzzle/${PID}`);
  await page.reload();
  if (safe) await page.addStyleTag({ content: SAFE });
  await expect(page.getByTestId('tab-panel-table')).toBeVisible();
}

/** Every visible button (in the page) at least 44 × 44 px. */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('#app button, #app a[href], #app [role=button]')) {
      if (el.classList.contains('link-btn')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.width < 43.5 || r.height < 43.5)
        out.push(`"${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  });
}

test('the last scan photo in the tab: outlines and labels, a tap on a piece opens its card, Pieces in view, full screen, Start live view', async ({ page }) => {
  await seed(page);
  await openTable(page);
  const inline = page.getByTestId('table-photo');
  await expect(inline).toHaveClass(/table-photo-inline/);
  // In the page between the navigation bar and the tab bar, not over it.
  await expect(page.locator('.photo-result')).toHaveCount(0);
  const svg = inline.getByTestId('table-photo-svg');
  await expect(svg.locator('.lit-outline')).toHaveCount(6);
  // Five sure spots get a label (one goes under the one-time tip's meaning), the unsure one a dot.
  await expect(svg.getByTestId('photo-label')).toHaveCount(5);
  await expect(svg.getByTestId('photo-dot')).toHaveCount(1);
  await expect(svg.getByTestId('photo-label').first()).toHaveText(/^\d·\d$/);
  const nav = (await page.getByTestId('navbar').boundingBox())!;
  const bar = (await page.getByTestId('puzzle-tabs').boundingBox())!;
  const box = (await svg.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(nav.y + nav.height - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  // The one-time tip shows on it.
  await expect(page.getByTestId('overlay-tip')).toBeVisible();
  await page.getByTestId('overlay-tip-ok').click();

  // A tap on a piece: its card (no zooming in first).
  await svg.locator('.lit-outline[data-id="p4"]').click();
  await expect(page.getByTestId('spot')).toBeVisible();
  await expect(page.getByTestId('spot')).toContainText(/Column 4/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('spot')).toHaveCount(0);

  // Pieces in view: a list, each with its name; a tap opens the card.
  await expect(page.getByTestId('table-photo-inview')).toHaveText('Pieces in view (6)');
  await page.getByTestId('table-photo-inview').click();
  const items = page.getByTestId('table-photo-piece-item');
  await expect(items).toHaveCount(6);
  await expect(page.getByTestId('table-photo-pieces')).toContainText('column 4 row 3');
  await expect(page.getByTestId('table-photo-pieces')).toContainText('maybe column 3 row 3');
  await items.filter({ hasText: 'column 4 row 3' }).click();
  await expect(page.getByTestId('spot')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('spot')).toHaveCount(0);

  // "?" opens the legend.
  await expect(inline.getByTestId('table-photo-legend-open')).toHaveAccessibleName('What the outlines mean');
  await inline.getByTestId('table-photo-legend-open').click();
  await expect(page.getByTestId('overlay-legend')).toBeVisible();
  await page.getByTestId('overlay-legend-close').click();
  await expect(page.getByTestId('overlay-legend')).toHaveCount(0);

  // The map button: the photo full screen (as before, with Close); back to the tab's photo.
  await expect(page.getByTestId('table-toggle')).toHaveAccessibleName('Show my table full screen');
  await page.getByTestId('table-toggle').click();
  await expect(page.locator('.photo-result.table-photo')).toBeVisible();
  await expect(page.getByTestId('table-photo')).toHaveCount(1);
  await page.getByTestId('table-photo-close').click();
  await expect(page.getByTestId('table-photo')).toHaveClass(/table-photo-inline/);

  // Start live view, under the photo: the live camera over the tab (it doesn't start by itself).
  await expect(page.getByTestId('live-table')).toHaveCount(0);
  const live = page.getByTestId('live-toggle');
  await expect(live).toHaveClass(/btn-filled/);
  const now = (await svg.boundingBox())!;
  expect((await live.boundingBox())!.y).toBeGreaterThan(now.y + now.height - 1);
  await live.click();
  await expect(page.getByTestId('live-table')).toBeVisible();
  await page.getByTestId('live-table-close').click();
  await expect(page.getByTestId('live-table')).toHaveCount(0);
});

test('the status line and the progress ring: pieces on the table, sure spots, in the puzzle of all', async ({ page }) => {
  await seed(page);
  await openTable(page);
  await expect(page.getByTestId('table-status-on')).toHaveText('6 pieces on the table');
  await expect(page.getByTestId('table-status-sure')).toHaveText('5 with a sure spot');
  const ring = page.getByTestId('table-ring');
  await expect(ring).toHaveAttribute('data-done', '1');
  await expect(ring).toHaveAttribute('data-total', '12');
  await expect(ring).toContainText('1 of 12 pieces in the puzzle');
  expect(await ring.locator('.table-ring-figure').evaluate((e) => getComputedStyle(e).fontVariantNumeric)).toContain('tabular-nums');
  // The arc: 1/12 of the circle.
  const dash = (await page.getByTestId('table-ring-arc').getAttribute('stroke-dasharray'))!.split(' ').map(Number);
  expect(dash[0]! / dash[1]!).toBeCloseTo(1 / 12, 2);
  // Scan stays in the navigation bar.
  await expect(page.getByTestId('navbar').getByTestId('scan-pieces')).toBeVisible();
});

test('touching pieces count as the pieces they hold, the same way on the Table and Pieces tabs (review 2026-11-11)', async ({ page }) => {
  await seed(page, { touching: true });
  await openTable(page);
  // 6 single pieces and an outline of about 3 touching ones.
  await expect(page.getByTestId('table-status-on')).toHaveText('about 9 pieces on the table');
  await openTab(page, 'pieces');
  // 8 rows read (one in the puzzle): about 10 pieces.
  await expect(page.getByTestId('puzzle-pieces')).toContainText('about 10 pieces read: about 9 on the table, 1 in the puzzle');
});

test('the Next step chip above the tab bar opens the joins’ What next card in a sheet; They fit, with Undo above the chip', async ({ page }) => {
  await seed(page);
  await openTable(page);
  const chip = page.getByTestId('table-next');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('4 pieces join');
  await expect(chip).toContainText('Show me');
  // Just above the tab bar.
  const bar = (await page.getByTestId('puzzle-tabs').boundingBox())!;
  const c = (await chip.boundingBox())!;
  expect(c.y + c.height).toBeLessThanOrEqual(bar.y);
  expect(bar.y - (c.y + c.height)).toBeLessThan(16);
  expect(c.height).toBeGreaterThanOrEqual(44);

  await chip.click();
  const sheet = page.getByTestId('table-next-sheet');
  await expect(sheet).toBeVisible();
  // The same card as on the Pieces tab: the 4 pieces, the box crop, Point them out, They fit.
  const card = sheet.getByTestId('match-next');
  await expect(card).toContainText('A square of 4');
  await expect(card.getByTestId('match-block-box')).toBeVisible();
  await expect(card.locator('.match-thumb')).toHaveCount(4);
  await expect(card.getByTestId('match-find')).toBeVisible();
  // Its four pairs follow it (a wrong one can be answered "Not there").
  await expect(sheet.getByTestId('match-pair')).toHaveCount(4);
  await expect(sheet.getByTestId('match-not').first()).toBeVisible();
  await card.getByTestId('match-block-fits').click();
  const toast = page.getByTestId('toast');
  await expect(toast).toContainText('the 4 pieces are joined');
  // The square is answered: the sheet goes on to what's next (nothing here).
  await expect(sheet.getByTestId('match-none')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  // No step left: no chip; the toast sits above the tab bar.
  await expect(chip).toHaveCount(0);
  const t = (await toast.boundingBox())!;
  expect(t.y + t.height).toBeLessThanOrEqual(bar.y);
  // Undo: the chip is back, and a toast now sits above it, not over it.
  await page.getByTestId('toast-action').click();
  await expect(chip).toBeVisible();
  await chip.click();
  await sheet.getByTestId('match-pair').first().getByTestId('match-not').click();
  await expect(toast).toContainText('isn’t suggested again');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(chip).toBeVisible();
  const c2 = (await chip.boundingBox())!;
  const t2 = (await toast.boundingBox())!;
  expect(t2.y + t2.height).toBeLessThanOrEqual(c2.y);

  // Point them out: the sheet closes, the live view points out the pieces.
  await chip.click();
  await sheet.getByTestId('match-next').getByTestId('match-find').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('live-table')).toBeVisible();
  await page.getByTestId('live-table-close').click();
});

test('no pieces yet: the big Scan your pieces card; before the set-up: Continue set-up', async ({ page }) => {
  await seed(page, { withPieces: false });
  await openTable(page);
  const card = page.getByTestId('scan-card');
  await expect(card).toContainText('Scan your pieces');
  await expect(card).toContainText('No pieces yet.');
  await expect(page.getByTestId('table-photo')).toHaveCount(0);
  await expect(page.getByTestId('table-next')).toHaveCount(0);
  await expect(page.getByTestId('table-status')).toHaveCount(0);
  await page.getByTestId('scan-card-scan').click();
  await expect(page.getByTestId('table-camera')).toBeVisible();
  await page.getByTestId('camera-close').click();
  await expect(page.getByTestId('scan-card')).toBeVisible();

  await seed(page, { withPieces: false, setup: false });
  await openTable(page);
  await expect(page.getByTestId('table-setup')).toBeVisible();
  await expect(page.getByTestId('table-continue-setup')).toBeVisible();
  await expect(page.getByTestId('scan-card')).toHaveCount(0);
});

for (const size of [
  { width: 375, height: 667, safe: false },
  { width: 402, height: 874, safe: true },
]) {
  test(`${size.width} px: 44 px targets, no sideways scroll, nothing under the tab bar or the Next step chip`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await seed(page);
    await openTable(page, size.safe);
    await expect(page.getByTestId('table-photo-svg')).toBeVisible();
    await expect(page.getByTestId('table-next')).toBeVisible();
    await page.waitForTimeout(400);
    expect(await smallTargets(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    // Scrolled to the end: the last line of the tab is above the chip, the chip above the tab bar.
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    const barTop = (await page.getByTestId('puzzle-tabs').boundingBox())!.y;
    const chip = (await page.getByTestId('table-next').boundingBox())!;
    expect(chip.y + chip.height).toBeLessThanOrEqual(barTop);
    const live = (await page.getByTestId('live-toggle').boundingBox())!;
    expect(live.y + live.height).toBeLessThanOrEqual(chip.y);
    // At the top: the photo and Start live view fit on the screen together with the status line.
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(200);
    if (size.height >= 800) expect((await page.getByTestId('live-toggle').boundingBox())!.y + 52).toBeLessThanOrEqual(chip.y + 1);
  });
}

test('switching tabs: another tab has no chip; back on Table the photo shows again', async ({ page }) => {
  await seed(page);
  await openTable(page);
  await expect(page.getByTestId('table-next')).toBeVisible();
  await openTab(page, 'more');
  await expect(page.getByTestId('table-next')).toHaveCount(0);
  await openTab(page, 'table');
  await expect(page.getByTestId('table-photo-svg').locator('.lit-outline')).toHaveCount(6);
});
