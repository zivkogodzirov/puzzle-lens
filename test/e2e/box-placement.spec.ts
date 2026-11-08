/**
 * Box placement on the puzzle screen (M4) in WebKit: a puzzle with a box picture (synthetic art)
 * and pieces with patches cut from that art. The photo helper places them; tapping a piece shows
 * its spot (column, row) and the box picture with the spot marked.
 */
import { createCanvas } from '@napi-rs/canvas';
import { extractPatch } from '../../src/cv/placement';
import type { Vec2 } from '../../src/project/types';
import { generatePuzzle } from '../synth/index';
import { test, expect, gotoScreen } from './fixtures';

const pz = generatePuzzle({ cols: 10, rows: 8, cellMm: [17.8, 19.4], seed: 5 });
const art = pz.art;
const picture = { data: art.rgba, width: art.width, height: art.height, stride: art.width * 4 };
const ids = ['r1c2', 'r3c7', 'r5c4', 'r6c8', 'r2c5', 'r4c1'];

function patchFor(id: string, q: number): string {
  const p = pz.pieces.find((x) => x.id === id)!;
  const [sx, sy] = art.pxPerMm;
  const cx = (p.col + 0.5) * pz.cellMm[0];
  const cy = (p.row + 0.5) * pz.cellMm[1];
  const toPx = (x: number, y: number): Vec2 => [(x + cx) * sx, (y + cy) * sy];
  const corners = [0, 1, 2, 3].map((k) => toPx(p.cornersMm[2 * k]!, p.cornersMm[2 * k + 1]!));
  const outline: number[] = [];
  for (let i = 0; i < p.outlineMm.length; i += 2) outline.push(...toPx(p.outlineMm[i]!, p.outlineMm[i + 1]!));
  const patch = extractPatch(
    picture,
    [0, 1, 2, 3].map((k) => corners[(k + q) % 4]!),
    outline,
  )!;
  return Buffer.from(patch.rgba).toString('base64');
}

test.setTimeout(180_000);
// Blobs in IndexedDB need a persistent WebKit context (as in scan-bin.spec.ts).
test.use({ persistentStorage: true });

test('pieces are placed on the box picture; tapping one shows its spot', async ({ page }) => {
  const c = createCanvas(art.width, art.height);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(art.width, art.height);
  id.data.set(art.rgba);
  ctx.putImageData(id, 0, 0);
  const boxJpeg = c.encodeSync('jpeg', 92).toString('base64');
  const patches = ids.map((pid, i) => ({ id: pid, b64: patchFor(pid, i % 4) }));

  await gotoScreen(page, '');
  const seeded = await page.evaluate(
    async ([box, ps, w, h]) => {
      const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'pieces', 'blobs'], 'readwrite');
        tx.objectStore('blobs').put({ id: 'e2e-place:box-rect', ts: 1, kind: 'box', blob: new Blob([bytes(box)], { type: 'image/jpeg' }) });
        tx.objectStore('projects').put({
          id: 'e2e-place',
          name: 'Placement test',
          createdAt: 1,
          updatedAt: 2,
          pieceCount: 80,
          grid: { cols: 10, rows: 8, source: 'suggested' },
          box: {
            photoBlobId: 'e2e-place:box-rect',
            rectifiedBlobId: 'e2e-place:box-rect',
            corners: [
              [0, 0],
              [w, 0],
              [w, h],
              [0, h],
            ],
            photoWidth: w,
            photoHeight: h,
            width: w,
            height: h,
          },
          markerMap: null,
          tableModel: null,
          piecePitch: { wMm: 17.8, hMm: 19.4, n: 6 },
          setupStep: 6,
          tracking: 'pieces',
          scaleSource: 'coin',
        });
        ps.forEach((p, i) => {
          tx.objectStore('blobs').put({ id: `e2e-place:patch-${p.id}`, ts: 1, kind: 'patch', blob: new Blob([bytes(p.b64)]) });
          tx.objectStore('pieces').put({
            id: p.id,
            projectId: 'e2e-place',
            createdAt: 1,
            updatedAt: 1,
            status: 'table',
            table: { x: i * 30, y: 0, angleDeg: 0, lastSeen: 1, snapId: 's1' },
            outlineMm: [0, 0, 1, 0, 1, 1],
            areaMm2: 345,
            sizeMm: [18, 19],
            colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
            thumbBlobId: null,
            seen: 1,
            bestPxPerMm: 5,
            flags: {},
            patch: { blobId: `e2e-place:patch-${p.id}`, flats: [false, false, false, false], sure: false, ts: 5 },
          });
        });
        tx.oncomplete = () => res();
      });
      dbh.close();
      return 'ok';
    },
    [boxJpeg, patches, art.width, art.height] as const,
  );
  expect(seeded).toBe('ok');
  await page.evaluate(() => (location.hash = '#/puzzle/e2e-place'));
  await expect(page.getByTestId('place-summary')).toContainText('On the box picture', { timeout: 60_000 });
  await expect(page.getByTestId('place-summary')).not.toContainText('not placed');
  // Each piece's own cell is its best spot.
  // The catalog lists pieces in id order.
  const shown = [...ids].sort();
  for (const pid of shown) {
    const [row, col] = pid.slice(1).split('c').map(Number);
    await page.locator('[data-testid="catalog"] .thumb-btn').nth(shown.indexOf(pid)).click();
    await expect(page.getByTestId('spot-verdict')).toContainText(`Column ${col! + 1}, row ${row! + 1}`);
    await expect(page.getByTestId('spot-box').locator('rect.spot-best')).toHaveCount(1);
  }
  await page.screenshot({ path: test.info().outputPath('box-placement.png'), fullPage: true });
});
