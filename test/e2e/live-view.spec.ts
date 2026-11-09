/**
 * M5 part 1 in WebKit: the live view of the table without markers. A puzzle is scanned (overview
 * photo of a simulated table), then the live view opens with the simulated camera looking at the
 * same pieces from another place (moved and turned): the table is found, the pieces are outlined
 * on the live picture, a tapped piece tells what's known and can be pointed out. Also the
 * "What to test" tab (owner's request): the same steps as in the chat, with tick boxes that stay.
 */
import { generatePuzzle, renderScene } from '../synth/index';
import type { SceneOptions } from '../synth/types';
import { test, expect, gotoScreen } from './fixtures';

const W = 4032;
const H = 3024;
let overview = '';
let moved = '';
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
  const m = await renderScene({ ...base, camera: { x: 440, y: 290, heightMm: 640, tiltDeg: 4, tiltDirDeg: 60, yawDeg: 20, imageSize: [W, H] } });
  overview = `data:image/jpeg;base64,${o.jpeg.toString('base64')}`;
  moved = `data:image/jpeg;base64,${m.jpeg.toString('base64')}`;
  visible = o.truth.pieces.filter((p) => !p.faceDown && p.visibleShare > 0.99).length;
});

test.describe('live view of the table', () => {
  test.use({ fakeCameraOptions: { width: W, height: H, fps: 8 }, persistentStorage: true });
  test.setTimeout(300_000);

  test('scanned pieces are outlined on the live picture from another place; tap, point out, close', async ({ page }) => {
    await page.addInitScript((url) => {
      (window as unknown as { __fakeScene?: string }).__fakeScene = url;
    }, overview);
    await gotoScreen(page, '');
    const id = 'e2e-live';
    await page.evaluate(async (pid) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({
          id: pid,
          name: 'Live view',
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
    }, id);
    await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);

    await page.getByTestId('scan-pieces').click();
    await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'overview');
    await page.getByTestId('allow-tilt').click();
    await page.evaluate(() => {
      setInterval(() => dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 1, gamma: -1 })), 50);
    });
    await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
    const n = Number((await page.getByTestId('scan-count').innerText()).match(/\d+/)![0]);
    expect(n).toBeGreaterThanOrEqual(Math.floor(0.85 * visible));

    // The camera now sees the same pieces from another place.
    await page.evaluate((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), moved);
    await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);
    await page.getByTestId('live-toggle').click();
    await expect(page.getByTestId('live-table')).toBeVisible();
    await expect(page.getByTestId('live-status')).toHaveAttribute('data-kind', 'good', { timeout: 60_000 });
    await expect(page.getByTestId('live-status')).toContainText('Tracking ✓');
    const overlay = page.getByTestId('live-table-overlay');
    await expect.poll(async () => Number(await overlay.getAttribute('data-drawn')), { timeout: 20_000 }).toBeGreaterThanOrEqual(Math.floor(0.8 * n));
    await page.screenshot({ path: test.info().outputPath('live-view.png') });

    // Tap a piece: what's known, and "Point it out".
    const first = (await overlay.getAttribute('data-first'))!.split(',').map(Number);
    await page.getByTestId('live-tap').click({ position: { x: first[0]!, y: first[1]! } });
    await expect(page.getByTestId('live-info')).toBeVisible();
    await page.getByTestId('live-find').click();
    await page.getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByTestId('live-finding')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('live-view-find.png') });

    // Closing turns the camera off.
    await page.getByTestId('live-table-close').click();
    await expect(page.getByTestId('live-table')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __fakeCamera: { liveCameraTracks: number } }).__fakeCamera.liveCameraTracks)).toBe(0);
  });
});

test.describe('what to test', () => {
  test('the 🧪 tab shows the current steps; ticks stay; the "new" dot goes once opened', async ({ page }) => {
    await gotoScreen(page, '');
    await expect(page.getByTestId('test-tab')).toBeVisible();
    await expect(page.getByTestId('test-tab-new')).toBeVisible();
    await page.getByTestId('test-tab').click();
    const sheet = page.getByTestId('test-sheet');
    await expect(sheet.locator('h2').first()).toContainText('M5');
    await expect(sheet).toContainText('Live view of my table');
    await expect(sheet).not.toContainText('{version}');
    const ticks = sheet.getByTestId('test-tick');
    expect(await ticks.count()).toBeGreaterThanOrEqual(5);
    await ticks.nth(0).check();
    await expect(sheet).toContainText('1 of');
    await page.getByTestId('test-close').click();
    await expect(page.getByTestId('test-tab-new')).toHaveCount(0);
    await page.reload();
    await page.getByTestId('test-tab').click();
    await expect(page.getByTestId('test-sheet').getByTestId('test-tick').nth(0)).toBeChecked();
    await page.screenshot({ path: test.info().outputPath('test-steps.png') });
  });
});
