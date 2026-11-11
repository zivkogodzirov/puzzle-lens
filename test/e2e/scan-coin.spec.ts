/**
 * A coin for true size (marker-free puzzle): pieces 25 % bigger than a typical Ravensburger piece
 * make the size estimate wrong; with a 5-denar coin in the overview, sizes become measured.
 */
import { createCanvas } from '@napi-rs/canvas';
import { generatePuzzle, renderScene } from '../synth/index';
import { withCoin } from '../helpers/coinImage';
import { test, expect, gotoScreen, openTab } from './fixtures';

const W = 4032;
const H = 3024;
const CELL: [number, number] = [17.8 * 1.25, 19.4 * 1.25];
let scene = '';

test.beforeAll(async () => {
  const puzzle = generatePuzzle({ cols: 7, rows: 5, cellMm: CELL, seed: 21 });
  const s = await renderScene({ puzzle, seed: 51, markers: [], layout: { areaMm: [600, 450], originMm: [100, 80] }, camera: { x: 400, y: 305, heightMm: 700, tiltDeg: 1, imageSize: [W, H] }, light: { dirDeg: 200 } });
  const img = withCoin({ data: s.rgba, width: s.width, height: s.height, stride: s.width * 4 }, [260, 2760], 27.5 * s.truth.pxPerMm, 'silver');
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(W, H);
  id.data.set(img.data.subarray(0, W * H * 4));
  ctx.putImageData(id, 0, 0);
  scene = `data:image/jpeg;base64,${c.encodeSync('jpeg', 92).toString('base64')}`;
});

test.describe('coin for true size', () => {
  test.use({ fakeCameraOptions: { width: W, height: H, fps: 8 }, persistentStorage: true });
  test.setTimeout(240_000);

  test('a 5-denar coin in the overview turns estimated sizes into measured ones', async ({ page }) => {
    await page.addInitScript((url) => {
      (window as unknown as { __fakeScene?: string }).__fakeScene = url;
    }, scene);
    await gotoScreen(page, '');
    const id = 'e2e-coin';
    await page.evaluate(async (pid) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({ id: pid, name: 'Coin', createdAt: 1, updatedAt: 2, pieceCount: 35, grid: { cols: 7, rows: 5, source: 'suggested' }, box: null, markerMap: null, tableModel: null, piecePitch: null, setupStep: 6, tracking: 'pieces' });
        tx.oncomplete = () => res();
      });
      dbh.close();
    }, id);
    await page.evaluate((pid) => (location.hash = `#/scan/${pid}`), id);
    await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'overview');
    // M9 part 5: the coin chooser is behind the gear (Coin and help).
    await page.getByTestId('camera-settings').click();
    await page.getByTestId('coin-select').selectOption('mk-5');
    await page.getByTestId('camera-settings-sheet-close').click();
    await page.getByTestId('allow-tilt').click();
    await page.evaluate(() => {
      setInterval(() => dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 1, gamma: -1 })), 50);
    });
    await expect(page.getByTestId('scan-note')).toContainText('Coin found', { timeout: 150_000 });
    await page.screenshot({ path: test.info().outputPath('coin-found.png') });
    // M9 part 5: the result is a sheet; "Take another" closes it.
    await page.getByTestId('result-another').click();
    await page.getByTestId('camera-close').click();
    await openTab(page, 'more');
    const size = await page.getByTestId('puzzle-size').innerText();
    expect(size).toContain('measured with your coin');
    const m = size.match(/([\d.]+) × ([\d.]+) mm/)!;
    const measured = Math.sqrt(Number(m[1]) * Number(m[2]));
    // The app turns a piece's found top face into its cell size with REAL_PIECE_AREA_SHARE (0.79,
    // measured on the owner's real pieces); the generator draws the top face as the whole cell, so
    // here the app reports truth / √0.79. Without the coin it would be ~18.6 mm whatever the truth.
    const truth = Math.sqrt(CELL[0] * CELL[1]) / Math.sqrt(0.79);
    expect(Math.abs(measured / truth - 1)).toBeLessThan(0.05);
  });
});
