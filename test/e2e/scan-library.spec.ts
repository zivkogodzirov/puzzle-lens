/**
 * Scanning a photo chosen from the library (owner's request 2026-11-08: test with photos already
 * taken, away from the puzzle). The chosen file goes through the same reading as a camera photo.
 */
import { generatePuzzle, renderScene } from '../synth/index';
import type { SceneOptions } from '../synth/types';
import { test, expect, gotoScreen } from './fixtures';

const W = 4032;
const H = 3024;
let jpeg: Buffer;
let visible = 0;

test.beforeAll(async () => {
  const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 12 });
  const base: SceneOptions = {
    puzzle,
    seed: 44,
    markers: [],
    layout: { areaMm: [600, 450], originMm: [100, 80] },
    camera: { x: 400, y: 305, heightMm: 680, tiltDeg: 1, imageSize: [W, H] },
    light: { dirDeg: 200 },
  };
  const o = await renderScene(base);
  jpeg = o.jpeg;
  visible = o.truth.pieces.filter((p) => !p.faceDown && p.visibleShare > 0.99).length;
});

test.describe('scan a photo from the library', () => {
  test.use({ fakeCameraOptions: { width: 1280, height: 960, fps: 4 }, persistentStorage: true });
  test.setTimeout(240_000);

  test('Choose a photo: pieces found as from the camera', async ({ page }) => {
    await gotoScreen(page, '');
    await page.evaluate(async () => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({
          id: 'e2e-lib',
          name: 'Library',
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
    });
    await page.evaluate(() => (location.hash = '#/puzzle/e2e-lib'));
    await page.getByTestId('scan-pieces').click();
    await expect(page.getByTestId('pick-photo')).toBeVisible();
    await page.getByTestId('pick-photo-input').setInputFiles({ name: 'IMG_0001.jpeg', mimeType: 'image/jpeg', buffer: jpeg });
    await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
    const n = Number((await page.getByTestId('scan-count').innerText()).match(/\d+/)![0]);
    expect(n).toBeGreaterThanOrEqual(Math.floor(0.85 * visible));
    expect(n).toBeLessThanOrEqual(visible + 3);
  });
});
