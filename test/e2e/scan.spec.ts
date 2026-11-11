/**
 * Scanning pieces (PLAN §6 M2) in WebKit: set-up photo of the empty table, then the Scan screen
 * with a simulated table full of pieces. The overview photo takes itself, pieces are catalogued,
 * outlined over the video, and listed on the Puzzle screen.
 */
import { generatePuzzle, renderScene } from '../synth/index';
import type { SceneOptions } from '../synth/types';
import { test, expect, gotoScreen, openTab } from './fixtures';

const W = 4032;
const H = 3024;
let empty = '';
let full = '';
let pieceCount = 0;

test.beforeAll(async () => {
  const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 12 });
  const base: SceneOptions = { puzzle, seed: 44, layout: { areaMm: [700, 500], originMm: [55, 55] }, camera: { x: 405, y: 305, heightMm: 700, tiltDeg: 1, imageSize: [W, H] }, light: { dirDeg: 200 } };
  const e = await renderScene({ ...base, pieceIds: [] });
  const f = await renderScene(base);
  empty = `data:image/jpeg;base64,${e.jpeg.toString('base64')}`;
  full = `data:image/jpeg;base64,${f.jpeg.toString('base64')}`;
  pieceCount = f.truth.pieces.filter((p) => !p.faceDown && p.visibleShare > 0.99).length;
});

test.describe('scan pieces', () => {
  test.use({ fakeCameraOptions: { width: W, height: H, fps: 8 }, persistentStorage: true });
  test.setTimeout(240_000);

  test('set-up photo → overview → pieces catalogued and outlined', async ({ page }) => {
    await page.addInitScript((url) => {
      (window as unknown as { __fakeScene?: string }).__fakeScene = url;
    }, empty);
    await gotoScreen(page, '');
    const id = 'e2e-scan';
    await page.evaluate(async (pid) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({ id: pid, name: 'Scan test', createdAt: 1, updatedAt: 2, pieceCount: 48, grid: { cols: 8, rows: 6, source: 'suggested' }, box: null, markerMap: null, tableModel: null, piecePitch: null, setupStep: 5, tracking: 'markers' });
        tx.oncomplete = () => res();
      });
      dbh.close();
    }, id);

    // Set-up step 5 with the empty table.
    await page.evaluate((pid) => (location.hash = `#/new/${pid}`), id);
    await page.getByTestId('open-table-camera').click();
    await expect(page.getByTestId('map-ok')).toBeVisible({ timeout: 120_000 });
    await page.getByTestId('finish-setup').click();
    await expect(page.getByTestId('scan-pieces')).toBeVisible();

    // Now the pieces are on the table.
    await page.evaluate((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), full);
    await page.getByTestId('scan-pieces').click();
    await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'overview');
    await expect(page.getByTestId('scan-note')).toBeVisible({ timeout: 150_000 });
    await expect(page.getByTestId('scan-note')).toContainText('Found');
    const n = Number((await page.getByTestId('scan-count').innerText()).match(/\d+/)![0]);
    expect(n).toBeGreaterThanOrEqual(Math.floor(0.85 * pieceCount));
    expect(n).toBeLessThanOrEqual(pieceCount + 3);
    // After the overview the screen moves on to close-ups, and outlines are drawn.
    await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'detail');
    await expect(page.getByTestId('piece-overlay')).toBeAttached();
    await page.screenshot({ path: test.info().outputPath('scan-after-overview.png') });

    // M9 part 5: the result is a sheet; "Take another" closes it.
    await page.getByTestId('result-another').click();
    await page.getByTestId('camera-close').click();
    // M9 part 4: the pieces are on the Pieces tab, the measured size on More.
    await openTab(page, 'pieces');
    await expect(page.getByTestId('catalog')).toBeVisible();
    await expect(page.getByTestId('catalog').locator('img')).toHaveCount(n, { timeout: 20_000 });
    await page.screenshot({ path: test.info().outputPath('puzzle-catalog.png'), fullPage: true });
    await openTab(page, 'more');
    await expect(page.getByTestId('puzzle-size')).toContainText('Measured piece size');
  });
});
