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
let respread = '';
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
  const c = await renderScene({ ...base, camera: { x: 280, y: 220, heightMm: 620, tiltDeg: 2, tiltDirDeg: 40, zoom: 2, imageSize: [W, H] } });
  overview = `data:image/jpeg;base64,${o.jpeg.toString('base64')}`;
  closeUp = `data:image/jpeg;base64,${c.jpeg.toString('base64')}`;
  // The same kind of pieces spread out anew (another layout): a new batch (M7).
  const b = await renderScene({ ...base, seed: 4242, light: { dirDeg: 80 } });
  respread = `data:image/jpeg;base64,${b.jpeg.toString('base64')}`;
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
        tx.objectStore('projects').put({
          id: pid,
          name: 'No markers',
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
    // The note leaves the gauge and the mode buttons free (it covered them, M8 part 4): it sits at
    // the top of the panel, and the map with the next close-up's dashed box stays in view beside it.
    await expect(page.getByTestId('coverage-map')).toBeVisible();
    await expect(page.getByTestId('coverage-map').locator('.cov-target')).toHaveCount(1);
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const apart = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1 || a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1;
    const note = await box('[data-testid="scan-note"]');
    for (const sel of ['.gauge', '[data-testid="mode-overview"]', '[data-testid="mode-detail"]', '[data-testid="scan-count"]', '[data-testid="coverage-map"]'])
      expect(apart(note, await box(sel)), sel).toBe(true);
    // None of it is cut off without a sign: it all fits, or "More ▾" says there is more (review 2026-11-10).
    expect(
      await page
        .getByTestId('scan-note')
        .evaluate((n) => n.scrollHeight <= n.clientHeight + 2 || document.querySelector('[data-testid="scan-note-more"]') !== null),
    ).toBe(true);
    await page.getByTestId('mode-detail').click({ trial: true });
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

test.describe('scan mode (M5 part 4)', () => {
  test.use({ fakeCameraOptions: { width: W, height: H, fps: 8 }, persistentStorage: true });
  test.setTimeout(240_000);

  test('Quick: one overview photo, and the camera stays on overviews', async ({ page }) => {
    await page.addInitScript((url) => {
      (window as unknown as { __fakeScene?: string }).__fakeScene = url;
    }, overview);
    await gotoScreen(page, '');
    const id = 'e2e-quick';
    await page.evaluate(async (pid) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'settings'], 'readwrite');
        tx.objectStore('projects').put({
          id: pid,
          name: 'Quick',
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
        tx.objectStore('settings').put({ key: 'scanMode', value: 'quick' });
        tx.oncomplete = () => res();
      });
      dbh.close();
    }, id);
    await page.reload();
    await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);
    await page.getByTestId('scan-pieces').click();
    await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'overview');
    await page.getByTestId('allow-tilt').click();
    await expect(page.getByTestId('snap')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('snap').click();
    await expect(page.getByTestId('scan-note')).toContainText('Quick scan done', { timeout: 150_000 });
    await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'overview');
  });
});

test.describe('batches (M7)', () => {
  test.use({ fakeCameraOptions: { width: W, height: H, fps: 8 }, persistentStorage: true });
  test.setTimeout(600_000);

  test('a table spread anew can’t be matched; a new batch sets the pieces aside and the next photo starts a fresh table', async ({ page }) => {
    await page.addInitScript((url) => {
      (window as unknown as { __fakeScene?: string }).__fakeScene = url;
    }, overview);
    await gotoScreen(page, '');
    const id = 'e2e-batch';
    await page.evaluate(async (pid) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({
          id: pid,
          name: 'Batches',
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
    const tilt = async () => {
      await page.getByTestId('allow-tilt').click();
      await page.evaluate(() => {
        setInterval(() => dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 1, gamma: -1 })), 50);
      });
    };
    // Batch 1.
    await page.getByTestId('scan-pieces').click();
    await tilt();
    await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
    const n1 = Number((await page.getByTestId('scan-count').innerText()).match(/\d+/)![0]);
    // The pieces swept together and spread anew: that photo can't be placed on the old table.
    await page.evaluate((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), respread);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('snap')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('snap').click();
    await expect(page.getByTestId('scan-note')).toContainText('could not be matched', { timeout: 150_000 });

    // A new batch.
    await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);
    await expect(page.getByTestId('puzzle-pieces')).toContainText(String(n1));
    await page.getByTestId('new-batch').click();
    await expect(page.getByTestId('new-batch-confirm')).toContainText(`${n1} pieces on the table are set aside`);
    await page.getByTestId('new-batch-confirm').screenshot({ path: test.info().outputPath('new-batch-confirm.png') });
    await page.getByTestId('new-batch-yes').click();
    await expect(page.getByTestId('scan-bin-note')).toContainText(`Batch 2 started: ${n1} pieces set aside`);
    await expect(page.getByTestId('puzzle-status-counts')).toContainText(`0 on the table, ${n1} set aside`);
    await expect(page.getByTestId('puzzle-batch')).toContainText('Batch 2');
    await expect(page.getByTestId('new-batch')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('new-batch-started.png'), fullPage: true });

    // The next photo starts a fresh table: its pieces are read (as new ones).
    await page.getByTestId('scan-pieces').click();
    await expect(page.getByTestId('table-camera')).toHaveAttribute('data-mode', 'overview');
    // (The tilt sensor is allowed already, and the phone still held flat.)
    await expect(page.getByTestId('scan-note')).toContainText('Found', { timeout: 150_000 });
    await expect(page.getByTestId('scan-note')).not.toContainText('could not be matched');
    const text = await page.getByTestId('scan-note').innerText();
    const added = Number(text.match(/\((\d+) new\)/)![1]);
    expect(added).toBeGreaterThanOrEqual(Math.floor(0.85 * visible));
    await page.evaluate((pid) => (location.hash = `#/puzzle/${pid}`), id);
    await expect(page.getByTestId('puzzle-status-counts')).toContainText(`${added} on the table, ${n1} set aside`);
  });
});
