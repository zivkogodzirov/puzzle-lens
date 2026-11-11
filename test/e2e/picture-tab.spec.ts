/**
 * The Picture tab (M9 part 4, design plan §4 item 6): the progress ring and count, the box picture as a zoomable
 * map (buttons, double-tap, pinch, drag), a tap on a spot opening the spot sheet with its pieces, "It fits" there
 * counting (with Undo), "Show on my table", "Fill a spot" and Previous / Next (the way in without tapping the
 * picture), "Photograph the puzzle so far" coming back to this tab, 44 px targets, nothing under the tab bar,
 * and a 1000-piece puzzle's map drawn fast.
 */
import { createCanvas } from '@napi-rs/canvas';
import type { Page } from '@playwright/test';
import { test, expect, gotoScreen, openTab } from './fixtures';
import { PROJECT, seedCard } from './place-seed';

test.setTimeout(180_000);
// Blobs in IndexedDB need a persistent WebKit context (as in scan-bin.spec.ts).
test.use({ persistentStorage: true });

/** Home Screen app safe areas (WebKit in Playwright reports 0). */
const SAFE = ':root { --safe-top: 62px !important; --safe-bottom: 34px !important; }';

/** The seeded puzzle, with a piece ("x1") that may go at column 8, row 4 as well (its best spot is column 6, row 3). */
async function seed(page: Page): Promise<void> {
  await seedCard(page, {
    extra: [
      {
        id: 'x1',
        top: [
          { col: 5, row: 2, p: 0.5 },
          { col: 7, row: 3, p: 0.3 },
        ],
        verdict: 'likely',
      },
    ],
  });
  await openTab(page, 'picture');
  // The spots of the pieces are known: a ring on each of their 6 spots.
  await expect(page.getByTestId('progress-map').locator('ellipse')).toHaveCount(6, { timeout: 60_000 });
}

/** Taps the middle of a spot (0-based) on the map, as drawn now (zoomed or not). */
async function tapSpot(page: Page, col: number, row: number, cols = 10, rows = 8): Promise<void> {
  const svg = page.getByTestId('fill-picture');
  // Done zooming (the picture slides to a new zoom over 220 ms): the same box twice in a row.
  let b = (await svg.boundingBox())!;
  await expect
    .poll(async () => {
      const prev = b;
      await page.waitForTimeout(100);
      b = (await svg.boundingBox())!;
      return Math.abs(b.x - prev.x) + Math.abs(b.width - prev.width);
    })
    .toBeLessThan(0.5);
  await svg.click({ position: { x: ((col + 0.5) / cols) * b.width, y: ((row + 0.5) / rows) * b.height } });
}

/** One finger dragging across the map by (dx, dy) px (pointer events, as a finger gives them). */
async function drag(page: Page, dx: number, dy: number): Promise<void> {
  await page.getByTestId('progress-map').evaluate(
    (el, [dx, dy]) => {
      const r = el.getBoundingClientRect();
      const [x0, y0] = [r.left + r.width / 2, r.top + r.height / 2];
      const ev = (type: string, k: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 9,
            clientX: x0 + (dx! * k) / 5,
            clientY: y0 + (dy! * k) / 5,
            bubbles: true,
            pointerType: 'touch',
            isPrimary: true,
          }),
        );
      ev('pointerdown', 0);
      for (let k = 1; k <= 5; k++) ev('pointermove', k);
      ev('pointerup', 5);
    },
    [dx, dy],
  );
}

const scaleOf = async (page: Page) => Number(await page.getByTestId('fill-picture').getAttribute('data-scale'));

/** The spot sheet open and done sliding up (its buttons take taps from then on). */
async function sheetSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('fill-sheet')).toBeVisible();
  await expect.poll(() => page.getByTestId('fill-sheet').evaluate((e) => e.hasAttribute('data-opening'))).toBe(false);
}

/** Every visible button and link (in `within`) at least 44 × 44 px. */
async function smallTargets(page: Page, within = '#app'): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const root of document.querySelectorAll(sel))
      for (const el of root.querySelectorAll<HTMLElement>('button, a[href], [role=button], input, select')) {
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

test('the ring and the counts: "0 of 80 · 80 to go", the ring, the pieces by status', async ({ page }) => {
  await seed(page);
  await expect(page.getByTestId('progress-done')).toContainText('0 of 80 · 80 to go');
  await expect(page.getByTestId('progress-done').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByTestId('progress-table')).toContainText('7');
  await expect(page.getByTestId('progress-placed')).toContainText('0');
  await expect(page.getByTestId('progress-left')).toContainText('80 spots still empty');
  // How often the app is right is in Tester mode on More, not here.
  await expect(page.getByTestId('progress-accuracy')).toHaveCount(0);
  // The map's picture is named for VoiceOver.
  await expect(page.getByTestId('fill-picture')).toHaveAccessibleName(/0 of 80 spots in the puzzle, 6 empty spots with their piece waiting/);
});

test('the map zooms (buttons, double-tap, pinch) and drags; a tap on a spot opens its sheet with its pieces', async ({ page }) => {
  await seed(page);
  const map = page.getByTestId('progress-map');
  const svg = page.getByTestId('fill-picture');
  const mb = (await map.boundingBox())!;
  expect(await scaleOf(page)).toBe(1);
  await expect(page.getByTestId('map-zoom-out')).toBeDisabled();
  // + zooms around the middle; the picture grows inside the map (the page doesn't).
  await page.getByTestId('map-zoom-in').click();
  await expect.poll(() => scaleOf(page)).toBeGreaterThan(1.5);
  await expect.poll(async () => (await svg.boundingBox())!.width).toBeGreaterThan(mb.width * 1.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  // A drag moves it (one finger, zoomed in).
  await page.waitForTimeout(400);
  const before = (await svg.boundingBox())!;
  await drag(page, 40, 20);
  await expect.poll(async () => (await svg.boundingBox())!.x).toBeGreaterThan(before.x + 30);
  // A drag is not a tap: no sheet.
  await page.waitForTimeout(400);
  await expect(page.getByTestId('fill-sheet')).toHaveCount(0);
  // Whole picture again.
  await page.getByTestId('map-whole').click();
  await expect.poll(() => scaleOf(page)).toBe(1);
  await expect(page.getByTestId('map-whole')).toHaveCount(0);
  // A double-tap zooms in at that place (and opens no sheet).
  await page.mouse.click(mb.x + mb.width * 0.25, mb.y + mb.height * 0.25);
  await page.mouse.click(mb.x + mb.width * 0.25, mb.y + mb.height * 0.25);
  await expect.poll(() => scaleOf(page)).toBeGreaterThan(1.5);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('fill-sheet')).toHaveCount(0);
  await page.getByTestId('map-whole').click();
  // Two fingers spread apart zoom in (a pinch).
  await map.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const ev = (type: string, id: number, x: number) =>
      el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: cy, bubbles: true, pointerType: 'touch', isPrimary: id === 1 }));
    ev('pointerdown', 1, cx - 20);
    ev('pointerdown', 2, cx + 20);
    for (let k = 1; k <= 5; k++) {
      ev('pointermove', 1, cx - 20 - 10 * k);
      ev('pointermove', 2, cx + 20 + 10 * k);
    }
    ev('pointerup', 1, cx - 70);
    ev('pointerup', 2, cx + 70);
  });
  await expect.poll(() => scaleOf(page)).toBeGreaterThan(2);
  await page.getByTestId('map-whole').click();
  await expect.poll(() => scaleOf(page)).toBe(1);

  // A tap on r3c7's spot (column 8, row 4): its sheet, with that piece first and the other one as "Maybe".
  await tapSpot(page, 7, 3);
  await sheetSettled(page);
  await expect(page.getByTestId('fill-spot-name')).toHaveText('Column 8 · Row 4');
  await expect(page.getByTestId('fill-picture-sel')).toHaveCount(1);
  const best = page.getByTestId('fill-best').getByTestId('fill-cand');
  await expect(best).toHaveCount(1);
  await expect(best).toContainText('Very likely');
  await expect(best.locator('img')).toHaveCount(1);
  await expect(page.getByTestId('fill-others').getByTestId('fill-cand')).toHaveCount(1);
  await expect(page.getByTestId('fill-others')).toContainText('Best: 6 · 3');
  // The answers on screen at the sheet's medium height, "It fits" on the right.
  const vh = page.viewportSize()!.height;
  const fits = (await best.getByTestId('fill-fits').boundingBox())!;
  const not = (await best.getByTestId('fill-not').boundingBox())!;
  expect(fits.y + fits.height).toBeLessThanOrEqual(vh);
  expect(fits.x).toBeGreaterThan(not.x);
  expect(fits.height).toBeGreaterThanOrEqual(55.5);
  // The close-up: a tap on the spot beside it picks that one (whole picture).
  const zoom = page.getByTestId('fill-zoom');
  const [x0, , w] = ((await zoom.getAttribute('data-view')) ?? '').split(' ').map(Number) as [number, number, number, number];
  const zb = (await zoom.boundingBox())!;
  await zoom.click({ position: { x: ((8.5 - x0) / w) * zb.width, y: zb.height / 2 } });
  await expect(page.getByTestId('fill-spot-name')).toHaveText('Column 9 · Row 4');
  await expect(page.getByTestId('fill-best')).toHaveCount(0);
  await page.getByRole('button', { name: 'Left' }).click();
  await expect(page.getByTestId('fill-spot-name')).toHaveText('Column 8 · Row 4');
  // A candidate's picture opens its card on this spot.
  await best.getByTestId('fill-cand-pick').click();
  await expect(page.getByTestId('fill-sheet')).toHaveCount(0);
  await expect(page.getByTestId('spot-name')).toHaveText('Column 8 · Row 4');
  await page.getByTestId('spot-close').click();
  await expect(page.getByTestId('spot')).toHaveCount(0);
});

test('"It fits" on the sheet counts (the ring goes up) and Undo takes it back; "Not there" keeps the sheet open', async ({ page }) => {
  await seed(page);
  await tapSpot(page, 7, 3);
  await sheetSettled(page);
  await page.getByTestId('fill-best').getByTestId('fill-fits').click();
  await expect(page.getByTestId('fill-sheet')).toHaveCount(0);
  await expect(page.getByTestId('toast-text')).toHaveText('Placed at 8·4');
  await expect(page.getByTestId('progress-done')).toContainText('1 of 80 · 79 to go');
  await expect(page.getByTestId('progress-done').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await expect(page.getByTestId('progress-placed')).toContainText('1');
  // The spot is bright now: 5 rings left.
  await expect(page.getByTestId('progress-map').locator('ellipse')).toHaveCount(5);
  // The toast sits above the tab bar.
  const toast = (await page.getByTestId('toast').boundingBox())!;
  const bar = (await page.getByTestId('puzzle-tabs').boundingBox())!;
  expect(toast.y + toast.height).toBeLessThanOrEqual(bar.y + 1);
  await page.getByTestId('toast-action').click();
  await expect(page.getByTestId('progress-done')).toContainText('0 of 80 · 80 to go');
  await expect(page.getByTestId('progress-map').locator('ellipse')).toHaveCount(6);
  // Filled again, then the sheet on that spot says so.
  await tapSpot(page, 7, 3);
  await sheetSettled(page);
  await page.getByTestId('fill-best').getByTestId('fill-fits').click();
  await expect(page.getByTestId('progress-done')).toContainText('1 of 80');
  await tapSpot(page, 7, 3);
  await sheetSettled(page);
  await expect(page.getByTestId('fill-filled')).toBeVisible();
  await expect(page.getByTestId('fill-spot-sub')).toHaveText('In the puzzle');
  await page.getByTestId('fill-sheet-close').click();
  await expect(page.getByTestId('fill-sheet')).toHaveCount(0);
  // "Not there" for the best piece of r1c2's spot: the sheet stays, with Undo above it.
  await tapSpot(page, 2, 1);
  await sheetSettled(page);
  await page.getByTestId('fill-best').getByTestId('fill-not').click();
  await expect(page.getByTestId('toast-text')).toHaveText('Not at 3·2');
  await expect(page.getByTestId('fill-sheet')).toBeVisible();
  await expect(page.getByTestId('fill-best')).toHaveCount(0);
  const t2 = (await page.getByTestId('toast').boundingBox())!;
  const sheet = (await page.getByTestId('fill-sheet').boundingBox())!;
  expect(t2.y + t2.height).toBeLessThanOrEqual(sheet.y + 1);
  await page.getByTestId('toast-action').click();
  await expect(page.getByTestId('fill-best').getByTestId('fill-cand')).toHaveCount(1);
});

test('"Show on my table": the live view over Picture points the pieces out (best green), and closing it brings the spot\'s sheet back', async ({ page }) => {
  await seed(page);
  await tapSpot(page, 7, 3);
  await sheetSettled(page);
  const name = await page.getByTestId('fill-spot-name').innerText();
  await page.getByTestId('fill-show').click();
  // It stays on Picture (review 2026-11-11: it switched to Table and left the spot behind).
  await expect(page.getByTestId('tab-picture')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('live-table')).toBeVisible();
  await expect(page.getByTestId('live-table')).toContainText(/Pieces? for this spot|The piece for this spot/);
  await page.getByTestId('live-table-close').click();
  await expect(page.getByTestId('live-table')).toHaveCount(0);
  await expect(page.getByTestId('fill-sheet')).toBeVisible();
  await expect(page.getByTestId('fill-spot-name')).toHaveText(name);
});

test('"Fill a spot" opens the sheet on the first spot whose piece is waiting; Previous / Next go through them', async ({ page }) => {
  await seed(page);
  await expect(page.getByTestId('fill-toggle')).toHaveAccessibleName('Fill a spot: 6 with a piece waiting');
  await page.getByTestId('fill-toggle').click();
  await sheetSettled(page);
  // Reading order: r1c2 (column 3, row 2), then r2c5 (column 6, row 3) …
  await expect(page.getByTestId('fill-spot-name')).toHaveText('Column 3 · Row 2');
  await page.getByTestId('fill-next').click();
  await expect(page.getByTestId('fill-spot-name')).toHaveText('Column 6 · Row 3');
  await expect(page.getByTestId('fill-next')).toHaveAccessibleName('Next spot with a piece waiting');
  await page.getByTestId('fill-prev').click();
  await page.getByTestId('fill-prev').click();
  // … and round to the last one, r6c8 (column 9, row 7).
  await expect(page.getByTestId('fill-spot-name')).toHaveText('Column 9 · Row 7');
  expect(await smallTargets(page, '[data-testid=fill-sheet]')).toEqual([]);
});

test('"Photograph the puzzle so far" opens Scan, whose Back comes back to the Picture tab', async ({ page }) => {
  await seed(page);
  await expect(page.getByTestId('open-spots-tip')).toContainText('One photo of the whole puzzle with its holes');
  await page.getByTestId('photo-puzzle').click();
  await expect(page).toHaveURL(new RegExp(`#/scan/${PROJECT}/picture$`));
  await page.getByTestId('camera-close').click();
  await expect(page).toHaveURL(new RegExp(`#/puzzle/${PROJECT}/picture$`));
  await expect(page.getByTestId('tab-picture')).toHaveAttribute('aria-current', 'page');
});

for (const size of [
  { width: 402, height: 874 },
  { width: 375, height: 667 },
])
  test(`${size.width} px: 44 px targets, no sideways scroll, and the tab bar covers nothing`, async ({ page }) => {
    await page.setViewportSize(size);
    await seed(page);
    if (size.width === 402) await page.addStyleTag({ content: SAFE });
    await page.waitForTimeout(1000);
    expect(await smallTargets(page, '[data-testid=tab-panel-picture]')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    // Scrolled to the end, the last line is above the tab bar.
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const last = (await page.getByTestId('progress-batch').boundingBox())!;
    const bar = (await page.getByTestId('puzzle-tabs').boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(bar.y);
    // Zoomed in, the zoom buttons are still on the page and the map still fits it.
    await page.getByTestId('map-zoom-in').scrollIntoViewIfNeeded();
    await page.getByTestId('map-zoom-in').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(await smallTargets(page, '[data-testid=tab-panel-picture]')).toEqual([]);
    await page.getByTestId('fill-toggle').click();
    await sheetSettled(page);
    expect(await smallTargets(page, '[data-testid=fill-sheet]')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });

/** A 40 × 25 puzzle (1000 spots) with 1000 pieces on the table, 500 of them with a sure spot (stored placements). */
async function seedBig(page: Page): Promise<void> {
  const c = createCanvas(800, 500);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 800, 500);
  g.addColorStop(0, 'rgb(40, 80, 120)');
  g.addColorStop(1, 'rgb(200, 150, 90)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 800, 500);
  const box = c.encodeSync('jpeg', 80).toString('base64');
  await gotoScreen(page, '');
  const ok = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    const byPiece: Record<string, unknown> = {};
    await new Promise<void>((res) => {
      const tx = dbh.transaction(['projects', 'pieces', 'blobs', 'settings'], 'readwrite');
      tx.objectStore('blobs').put({ id: 'big:box', ts: 1, kind: 'box', blob: new Blob([bytes], { type: 'image/jpeg' }) });
      tx.objectStore('projects').put({
        id: 'big',
        name: 'Big puzzle',
        createdAt: 1,
        updatedAt: 2,
        pieceCount: 1000,
        grid: { cols: 40, rows: 25, source: 'suggested' },
        box: {
          photoBlobId: 'big:box',
          rectifiedBlobId: 'big:box',
          corners: [
            [0, 0],
            [800, 0],
            [800, 500],
            [0, 500],
          ],
          photoWidth: 800,
          photoHeight: 500,
          width: 800,
          height: 500,
        },
        markerMap: null,
        tableModel: null,
        piecePitch: { wMm: 18, hMm: 18, n: 6 },
        setupStep: 6,
        tracking: 'pieces',
        scaleSource: 'coin',
        openSpots: null,
      });
      for (let i = 0; i < 1000; i++) {
        const id = `p${String(i).padStart(4, '0')}`;
        const col = i % 40;
        const row = Math.floor(i / 40);
        byPiece[id] = {
          ts: 1,
          placement: { top: [{ col, row, rot: 0, score: 0.5, p: i % 2 ? 0.2 : 0.9, ox: 0, oy: 0 }], verdict: i % 2 ? 'several' : 'strong' },
        };
        tx.objectStore('pieces').put({
          id,
          projectId: 'big',
          createdAt: 1,
          updatedAt: 1,
          status: 'table',
          table: { x: (i % 40) * 30, y: Math.floor(i / 40) * 30, angleDeg: 0, lastSeen: 1, snapId: 's1' },
          outlineMm: [0, 0, 1, 0, 1, 1],
          areaMm2: 345,
          sizeMm: [18, 18],
          colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
          thumbBlobId: null,
          seen: 1,
          bestPxPerMm: 5,
          flags: {},
        });
      }
      tx.objectStore('settings').put({ key: 'placement:big', value: { boxKey: 'big:box|0,0;800,0;800,500;0,500|40x25', colour: null, open: null, byPiece } });
      tx.oncomplete = () => res();
    });
    dbh.close();
    return 'ok';
  }, box);
  expect(ok).toBe('ok');
}

test('a 1000-piece puzzle: the map is drawn fast, and zooming and dragging stay fast', async ({ page }) => {
  await seedBig(page);
  await page.evaluate(() => (location.hash = '#/puzzle/big/more'));
  await expect(page.getByTestId('tab-panel-more')).toBeAttached();
  // Wait until the pieces are read (the Picture tab then draws everything at once).
  await page.waitForTimeout(1500);
  const t0 = Date.now();
  await page.getByTestId('tab-picture').click();
  await expect(page.getByTestId('progress-map').locator('ellipse')).toHaveCount(500, { timeout: 30_000 });
  const drawMs = Date.now() - t0;
  // Drawing the tab again (one answer would): measured in the page.
  const redrawMs = await page.evaluate(async () => {
    const t = performance.now();
    (document.querySelector('[data-testid="tab-table"]') as HTMLElement).click();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    (document.querySelector('[data-testid="tab-picture"]') as HTMLElement).click();
    while (document.querySelectorAll('[data-testid="progress-map"] ellipse').length < 500) await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    return performance.now() - t;
  });
  // A drag zoomed in: 60 moves, each with its frame.
  await page.getByTestId('map-zoom-in').click();
  await page.getByTestId('map-zoom-in').click();
  const dragMs = await page.getByTestId('progress-map').evaluate(async (el) => {
    const r = el.getBoundingClientRect();
    const ev = (type: string, x: number) =>
      el.dispatchEvent(
        new PointerEvent(type, { pointerId: 7, clientX: x, clientY: r.top + r.height / 2, bubbles: true, pointerType: 'touch', isPrimary: true }),
      );
    const frames: number[] = [];
    ev('pointerdown', r.left + 20);
    for (let k = 1; k <= 60; k++) {
      const t = performance.now();
      ev('pointermove', r.left + 20 + k * 3);
      await new Promise((res) => requestAnimationFrame(() => res(null)));
      frames.push(performance.now() - t);
    }
    ev('pointerup', r.left + 200);
    frames.sort((a, b) => a - b);
    return frames[Math.floor(frames.length * 0.9)]!;
  });
  test.info().annotations.push({
    type: 'speed',
    description: `1000 spots: tab drawn in ${drawMs} ms, redrawn in ${Math.round(redrawMs)} ms; drag frame p90 ${dragMs.toFixed(1)} ms`,
  });
  console.log(`[speed] 1000 spots: tab drawn in ${drawMs} ms, redrawn in ${Math.round(redrawMs)} ms; drag frame p90 ${dragMs.toFixed(1)} ms`);
  expect(drawMs).toBeLessThan(3000);
  expect(redrawMs).toBeLessThan(1000);
  expect(dragMs).toBeLessThan(50);
});
