/**
 * Wizard step 5 with a camera (PLAN §5): the fake camera shows a computer-made photo of the empty
 * white table with the 8 markers (test/synth), the photo takes itself once all 8 are in view and
 * steady, and the marker map is measured and saved.
 */
import { generatePuzzle, renderScene } from '../synth/index';
import { test, expect, gotoScreen } from './fixtures';

const W = 1280;
const H = 960;

async function tableScene(): Promise<string> {
  const puzzle = generatePuzzle({ cols: 2, rows: 2, cellMm: [17.8, 19.4], seed: 5 });
  const scene = await renderScene({ puzzle, pieceIds: [], seed: 21, camera: { x: 405, y: 305, heightMm: 700, tiltDeg: 1, imageSize: [W, H] }, light: { dirDeg: 200 } });
  return `data:image/jpeg;base64,${scene.jpeg.toString('base64')}`;
}

let scene = '';
test.beforeAll(async () => {
  scene = await tableScene();
});

test.describe('wizard step 5: marker photo', () => {
  // Photos (Blobs) can only be stored in IndexedDB with a profile on disk in Playwright's WebKit.
  test.use({ fakeCameraOptions: { width: W, height: H }, persistentStorage: true });
  test.setTimeout(150_000);

  test('all 8 markers in view → the photo takes itself → marker map saved → set-up finished', async ({ page }) => {
    // The scene is only known after beforeAll, so install it as an extra init script.
    await page.addInitScript((url) => {
      (window as unknown as { __fakeScene?: string }).__fakeScene = url;
    }, scene);
    await gotoScreen(page, '');
    // A puzzle that has reached step 5, written straight into the app's database.
    const id = 'e2e-table-setup';
    await page.evaluate(async (pid) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      await new Promise<void>((res, rej) => {
        const tx = dbh.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({
          id: pid,
          name: 'Table test',
          createdAt: 1,
          updatedAt: 2,
          pieceCount: 1000,
          grid: { cols: 28, rows: 36, source: 'suggested' },
          box: null,
          markerMap: null,
          tableModel: null,
          piecePitch: null,
          setupStep: 5, tracking: 'markers',
        });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      dbh.close();
    }, id);

    await page.evaluate((pid) => (location.hash = `#/new/${pid}`), id);
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', '5', { timeout: 20_000 });
    await expect(page.getByTestId('step-table')).toBeVisible();
    await page.getByTestId('open-table-camera').click();
    await expect(page.getByTestId('table-camera')).toBeVisible();
    // The gauge counts the markers, then the photo fires by itself.
    await expect(page.getByTestId('level-gauge')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('map-ok')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('map-ok')).toContainText('All 8 markers measured');
    await page.screenshot({ path: test.info().outputPath('step5-done.png') });

    const saved = await page.evaluate(async (pid) => {
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const get = <T,>(store: string, key: string) =>
        new Promise<T>((res) => {
          const r = dbh.transaction(store).objectStore(store).get(key);
          r.onsuccess = () => res(r.result as T);
        });
      const p = await get<{ markerMap: { markers: Array<{ id: number }>; rmsMm: number } | null }>('projects', pid);
      const snaps = await new Promise<number>((res) => {
        const r = dbh.transaction('snaps').objectStore('snaps').count();
        r.onsuccess = () => res(r.result);
      });
      dbh.close();
      return { ids: p.markerMap?.markers.map((m) => m.id), rms: p.markerMap?.rmsMm, snaps };
    }, id);
    expect(saved.ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(saved.rms).toBeLessThan(1.5);
    expect(saved.snaps).toBe(1);

    await page.getByTestId('finish-setup').click();
    await expect(page.getByTestId('puzzle-screen')).toBeVisible();
    // The camera is off after leaving.
    const live = await page.evaluate(() => (window as unknown as { __fakeCamera: { liveCameraTracks: number } }).__fakeCamera.liveCameraTracks);
    expect(live).toBe(0);
  });
});
