/**
 * Marker-free scanning (decision 2026-11-07) in WebKit: no printed markers anywhere. The overview
 * defines the table; a 2× close-up is placed by matching its pieces to the overview's, so it adds
 * almost nothing new; the last photo can be viewed with its outlines.
 */
import { generatePuzzle, renderScene } from '../synth/index';
import type { SceneOptions } from '../synth/types';
import { test, expect, gotoScreen } from './fixtures';

const W = 4032;
const H = 3024;
let overview = '';
let closeUp = '';
let visible = 0;

test.beforeAll(async () => {
  const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 12 });
  const base: SceneOptions = { puzzle, seed: 44, markers: [], layout: { areaMm: [600, 450], originMm: [100, 80] }, camera: { x: 400, y: 305, heightMm: 680, tiltDeg: 1, imageSize: [W, H] }, light: { dirDeg: 200 } };
  const o = await renderScene(base);
  const c = await renderScene({ ...base, camera: { x: 280, y: 220, heightMm: 620, tiltDeg: 2, tiltDirDeg: 40, zoom: 2, imageSize: [W, H] } });
  overview = `data:image/jpeg;base64,${o.jpeg.toString('base64')}`;
  closeUp = `data:image/jpeg;base64,${c.jpeg.toString('base64')}`;
  visible = o.truth.pieces.filter((p) => !p.faceDown && p.visibleShare > 0.99).length;
});

test.describe('scan pieces without markers', () => {
  test.use({ fakeCameraOptions: { width: W, height: H, fps: 8 }, persistentStorage: true });
  test.setTimeout(240_000);

  test('overview defines the table, a close-up is matched to it, results can be checked', async ({ page }) => {
    await page.addInitScript((url) => {
      (window as unknown as { __fakeScene?: string }).__fakeScene = url;
    }, overview);
    await gotoScreen(page, '');
    const id = 'e2e-free';
    await page.evaluate(async (pid) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({ id: pid, name: 'No markers', createdAt: 1, updatedAt: 2, pieceCount: 48, grid: { cols: 8, rows: 6, source: 'suggested' }, box: null, markerMap: null, tableModel: null, piecePitch: null, setupStep: 6, tracking: 'pieces' });
        tx.oncomplete = () => res();
      });
      dbh.close();
    }, id);
    await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);
    await page.getByTestId('scan-pieces').click();
    await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'overview');
    await expect(page.getByTestId('allow-tilt')).toBeVisible();
    // Allow the tilt sensor, and play a phone held almost flat.
    await page.getByTestId('allow-tilt').click();
    await page.evaluate(() => {
      // WebKit here can't construct a DeviceOrientationEvent: a plain event with the same fields.
      setInterval(() => dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 1, gamma: -1 })), 50);
    });
    await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
    const n = Number((await page.getByTestId('scan-count').innerText()).match(/\d+/)![0]);
    expect(n).toBeGreaterThanOrEqual(Math.floor(0.85 * visible));
    expect(n).toBeLessThanOrEqual(visible + 3);
    await expect(page.getByTestId('coverage-map')).toBeVisible();
    await page.getByTestId('show-photo').click();
    await expect(page.getByTestId('photo-result').locator('polygon')).toHaveCount(n, { timeout: 5_000 });
    await page.screenshot({ path: test.info().outputPath('free-photo-result.png') });
    await page.getByTestId('photo-result').click();

    // A 2× close-up of part of the same pieces: placed by matching, (almost) nothing new.
    await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'detail');
    await page.evaluate((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), closeUp);
    await expect(page.getByTestId('scan-note')).toContainText('Close-up read', { timeout: 150_000 });
    const text = await page.getByTestId('scan-note').innerText();
    const added = Number(text.match(/\((\d+) new\)/)![1]);
    expect(added).toBeLessThanOrEqual(2);
    const n2 = Number((await page.getByTestId('scan-count').innerText()).match(/\d+/)![0]);
    expect(n2).toBeLessThanOrEqual(n + 2);
    expect(Number((await page.getByTestId('scan-coverage').innerText()).match(/\d+/)![0])).toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath('free-after-closeup.png') });
  });
});
