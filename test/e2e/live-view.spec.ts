/**
 * M5 part 1 in WebKit: the live view of the table without markers. A puzzle is scanned (overview
 * photo of a simulated table), then the live view opens with the simulated camera looking at the
 * same pieces from another place (moved and turned): the table is found, the pieces are outlined
 * on the live picture, a tapped piece tells what's known and can be pointed out. Also the
 * "What to test" tab (owner's request): the same steps as in the chat, with tick boxes that stay.
 */
import { generatePuzzle, renderScene } from '../synth/index';
import type { SceneOptions } from '../synth/types';
import { test, expect, gotoScreen, openTab } from './fixtures';

const W = 4032;
const H = 3024;
let overview = '';
let moved = '';
let fourGone = '';
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
  // The same view with four pieces taken off the table (M5 part 4: the live view notices).
  const ids = o.truth.pieces.filter((p) => !p.faceDown && p.visibleShare > 0.99).map((p) => p.id);
  const g = await renderScene({ ...base, hidden: [ids[3]!, ids[10]!, ids[20]!, ids[30]!] });
  fourGone = `data:image/jpeg;base64,${g.jpeg.toString('base64')}`;
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

    // Four pieces taken away: their outlines turn dashed ("moved?") and the top line says so.
    await page.getByTestId('live-table-close').click();
    await page.evaluate((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), fourGone);
    await page.getByTestId('live-toggle').click();
    await expect(page.getByTestId('live-status')).toContainText('4 not where they were', { timeout: 60_000 });
    await page.screenshot({ path: test.info().outputPath('live-view-gone.png') });

    // Which pieces join (M6): with a box picture and every piece's spot known (pieces in scan order
    // across the 8 × 6 grid), pieces next to each other on the box get a line between them.
    await page.getByTestId('live-table-close').click();
    await page.evaluate(async (pid) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const c = Object.assign(document.createElement('canvas'), { width: 80, height: 60 });
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg'));
      const pieces = await new Promise<Array<{ id: string; patch?: { ts: number } | null }>>((res) => {
        const r = dbh.transaction('pieces').objectStore('pieces').getAll();
        r.onsuccess = () => res((r.result as Array<{ id: string; projectId: string; patch?: { ts: number } | null }>).filter((q) => q.projectId === pid));
      });
      const project = await new Promise<Record<string, unknown>>((res) => {
        const r = dbh.transaction('projects').objectStore('projects').get(pid);
        r.onsuccess = () => res(r.result as Record<string, unknown>);
      });
      const byPiece: Record<string, unknown> = {};
      pieces.forEach((q, i) => {
        if (i >= 48) return;
        byPiece[q.id] = { ts: q.patch?.ts ?? 0, placement: { top: [{ col: i % 8, row: Math.floor(i / 8), rot: 0, score: 1, p: 0.95 }], verdict: 'strong' } };
      });
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'blobs', 'settings'], 'readwrite');
        tx.objectStore('blobs').put({ id: 'e2e-live:box', ts: 1, kind: 'box', blob });
        tx.objectStore('projects').put({
          ...project,
          updatedAt: Date.now(),
          box: {
            photoBlobId: 'e2e-live:box',
            rectifiedBlobId: 'e2e-live:box',
            corners: [
              [0, 0],
              [80, 0],
              [80, 60],
              [0, 60],
            ],
            photoWidth: 80,
            photoHeight: 60,
            width: 80,
            height: 60,
          },
        });
        tx.objectStore('settings').put({
          key: `placement:${pid}`,
          value: { boxKey: 'e2e-live:box|0,0;80,0;80,60;0,60|8x6', colour: null, open: null, byPiece },
        });
        tx.oncomplete = () => res();
      });
      dbh.close();
    }, id);
    await page.reload();
    await page.evaluate((url) => ((window as unknown as { __fakeScene?: string }).__fakeScene = url), moved);
    // M9 part 4: "Which pieces join" is on the Pieces tab, the live view on the Table tab.
    await openTab(page, 'pieces');
    await expect(page.getByTestId('matches-toggle')).toContainText('Which pieces join');
    await expect(page.getByTestId('matches-count')).toBeVisible();
    await openTab(page, 'table');
    await page.getByTestId('live-toggle').click();
    await expect(page.getByTestId('live-status')).toHaveAttribute('data-kind', 'good', { timeout: 60_000 });
    await expect.poll(async () => Number(await overlay.getAttribute('data-lines')), { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
    await expect(page.getByTestId('live-table')).toContainText('Lines join pieces that fit together');
    await page.screenshot({ path: test.info().outputPath('live-view-lines.png') });

    // Every outline on a dark halo (M9 part 1: pale lines vanish on a cream table): the overlay has
    // pixels of the halo's own 0.6 black (alpha 153) along the outlines.
    await expect
      .poll(
        () =>
          overlay.evaluate((c: HTMLCanvasElement) => {
            const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i]! < 8 && d[i + 1]! < 8 && d[i + 2]! < 8 && Math.abs(d[i + 3]! - 153) <= 3) n++;
            return n;
          }),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(2000);

    // ✓ Fits in the live view, then Undo (M9 part 1): the note (role=status) offers Undo for at least
    // 8 s, and Undo puts the piece back on the table.
    const inView = Number(await overlay.getAttribute('data-drawn'));
    let at = (await overlay.getAttribute('data-first'))!.split(',').map(Number);
    await page.getByTestId('live-tap').click({ position: { x: at[0]!, y: at[1]! } });
    // M9 part 2: the answers carry check / x icons beside the words (M9 part 3: "It fits" / "Not there"), It fits filled green; Close is an icon
    // button with a name; Back in the top row too.
    await expect(page.getByTestId('live-fits')).toHaveClass(/btn-good/);
    await expect(page.getByTestId('live-fits')).toHaveText('It fits');
    await expect(page.getByTestId('live-fits').locator('svg[data-icon="check"]')).toHaveCount(1);
    await expect(page.getByTestId('live-not')).toHaveText('Not there');
    await expect(page.getByTestId('live-not').locator('svg[data-icon="x"]')).toHaveCount(1);
    await expect(page.getByTestId('live-info-close')).toHaveAccessibleName('Close');
    await expect(page.getByTestId('live-info-close').locator('svg[data-icon="x"]')).toHaveCount(1);
    await expect(page.getByTestId('live-table-close')).toHaveAccessibleName('Back');
    for (const id of ['live-fits', 'live-not', 'live-info-close', 'live-table-close']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(Math.min(b.width, b.height), `${id}: at least 44 px`).toBeGreaterThanOrEqual(44);
    }
    await page.getByTestId('live-fits').click();
    const fitsAt = Date.now();
    const note = page.getByTestId('live-note');
    await expect(note).toHaveAttribute('role', 'status');
    await expect(note).toContainText('✓ In the puzzle at');
    await expect.poll(async () => Number(await overlay.getAttribute('data-drawn'))).toBe(inView - 1);
    await page.waitForTimeout(Math.max(0, 8_200 - (Date.now() - fitsAt)));
    await expect(page.getByTestId('live-undo')).toBeVisible();
    await page.getByTestId('live-undo').click();
    await expect(note).toContainText('Undone');
    await expect.poll(async () => Number(await overlay.getAttribute('data-drawn'))).toBe(inView);
    // Not there has an Undo too.
    at = (await overlay.getAttribute('data-first'))!.split(',').map(Number);
    await page.getByTestId('live-tap').click({ position: { x: at[0]!, y: at[1]! } });
    await page.getByTestId('live-not').click();
    await expect(note).toContainText('Noted');
    await page.getByTestId('live-undo').click();
    await expect(note).toContainText('Undone: that spot is offered again.');
    await page.screenshot({ path: test.info().outputPath('live-view-undo.png') });

    // An answer kept: its Undo toast shows on the page when the live view closes; opening the live view again
    // closes that toast (review 2026-11-11: it lay over the live view's "Doesn't fit").
    at = (await overlay.getAttribute('data-first'))!.split(',').map(Number);
    await page.getByTestId('live-tap').click({ position: { x: at[0]!, y: at[1]! } });
    await page.getByTestId('live-fits').click();
    await page.getByTestId('live-table-close').click();
    await expect(page.getByTestId('toast')).toBeVisible();
    await page.getByTestId('live-toggle').click();
    await expect(page.getByTestId('live-table')).toBeVisible();
    await expect(page.getByTestId('toast')).toHaveCount(0);

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
    await expect(sheet.locator('h2').first()).toContainText('M8');
    await expect(sheet).toContainText('Colours learned');
    await expect(sheet).toContainText('only partly outlined');
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
