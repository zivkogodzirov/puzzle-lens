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

/** The art as a JPEG (base64), optionally turned 180° and shrunk to w × h. */
function jpeg(turn180: boolean, w = art.width, h = art.height): string {
  const full = createCanvas(art.width, art.height);
  const fctx = full.getContext('2d');
  const id = fctx.createImageData(art.width, art.height);
  id.data.set(art.rgba);
  fctx.putImageData(id, 0, 0);
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  if (turn180) {
    ctx.translate(w, h);
    ctx.rotate(Math.PI);
  }
  ctx.drawImage(full, 0, 0, w, h);
  return c.encodeSync('jpeg', 92).toString('base64');
}

/** A puzzle with the box picture and the pieces (patches) in IndexedDB; `open`: empty spots from a finished-puzzle photo. */
async function seed(page: import('@playwright/test').Page, open: { gaps: Array<[number, number]>; thumb: string } | null): Promise<void> {
  const patches = ids.map((pid, i) => ({ id: pid, b64: patchFor(pid, i % 4) }));
  await gotoScreen(page, '');
  const seeded = await page.evaluate(
    async ([box, ps, w, h, spots]) => {
      const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'pieces', 'blobs'], 'readwrite');
        tx.objectStore('blobs').put({ id: 'e2e-place:box-rect', ts: 1, kind: 'box', blob: new Blob([bytes(box)], { type: 'image/jpeg' }) });
        if (spots)
          tx.objectStore('blobs').put({ id: 'e2e-place:open-spots', ts: 1, kind: 'open-spots', blob: new Blob([bytes(spots.thumb)], { type: 'image/jpeg' }) });
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
          openSpots: spots ? { cols: 10, rows: 8, gaps: spots.gaps, thumbBlobId: 'e2e-place:open-spots', ts: 3 } : null,
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
    [jpeg(false), patches, art.width, art.height, open] as const,
  );
  expect(seeded).toBe('ok');
  await page.evaluate(() => (location.hash = '#/puzzle/e2e-place'));
}

/** Each piece's own cell is its best spot (the catalog lists pieces in id order). */
async function eachPieceAtItsCell(page: import('@playwright/test').Page): Promise<void> {
  const shown = [...ids].sort();
  for (const pid of shown) {
    const [row, col] = pid.slice(1).split('c').map(Number);
    await page.locator('[data-testid="catalog"] .thumb-btn').nth(shown.indexOf(pid)).click();
    await expect(page.getByTestId('spot-verdict')).toContainText(`Column ${col! + 1}, row ${row! + 1}`);
    await expect(page.getByTestId('spot-box').locator('rect.spot-best')).toHaveCount(1);
  }
}

/** Taps the middle of a cell (0-based) on a Fill-this-spot picture showing cells [x0, x0 + w) × [y0, y0 + h). */
async function tapCell(page: import('@playwright/test').Page, testId: string, col: number, row: number, view = { x0: 0, y0: 0, w: 10, h: 8 }): Promise<void> {
  const svg = page.getByTestId(testId);
  const b = (await svg.boundingBox())!;
  await svg.click({ position: { x: ((col + 0.5 - view.x0) / view.w) * b.width, y: ((row + 0.5 - view.y0) / view.h) * b.height } });
}

test('pieces are placed on the box picture; tapping one shows its spot', async ({ page }) => {
  await seed(page, null);
  await expect(page.getByTestId('place-summary')).toContainText('On the box picture', { timeout: 60_000 });
  await expect(page.getByTestId('place-summary')).not.toContainText('not placed');
  await expect(page.getByTestId('open-spots')).toHaveCount(0);
  await eachPieceAtItsCell(page);
  await page.screenshot({ path: test.info().outputPath('box-placement.png'), fullPage: true });

  // Fill this spot: tap the cell of piece r3c7 (row 3, column 7): that piece is offered for it.
  await page.getByTestId('fill-toggle').click();
  await tapCell(page, 'fill-picture', 7, 3);
  await expect(page.getByTestId('fill-spot-name')).toContainText('Column 8, row 4');
  await expect(page.getByTestId('fill-best').getByTestId('fill-cand')).toHaveCount(1);
  await expect(page.getByTestId('fill-best')).toContainText('%');
  // One cell to the right (arrow), then back by tapping the close-up (9 × 8 cells, from column 1 here).
  await page.getByRole('button', { name: 'Right' }).click();
  await expect(page.getByTestId('fill-spot-name')).toContainText('Column 9, row 4');
  await expect(page.getByTestId('fill-best')).toHaveCount(0);
  await tapCell(page, 'fill-zoom', 7, 3, { x0: 1, y0: 0, w: 9, h: 8 });
  await expect(page.getByTestId('fill-spot-name')).toContainText('Column 8, row 4');
  await expect(page.getByTestId('fill-best').getByTestId('fill-cand')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('fill-spot.png'), fullPage: true });
});

test('with empty spots from an upside-down finished-puzzle photo: pieces go only there, one per spot', async ({ page }) => {
  // The pieces' own cells and two more, counted in the photo (turned 180°: column 9 − col, row 7 − row).
  const cells: Array<[number, number]> = [...ids.map((pid) => pid.slice(1).split('c').map(Number).reverse() as [number, number]), [0, 7], [9, 0]];
  const gaps = cells.map(([c, r]) => [9 - c, 7 - r] as [number, number]);
  await seed(page, { gaps, thumb: jpeg(true, 10 * 8, 8 * 8) });
  await expect(page.getByTestId('open-spots')).toContainText('8 empty spots', { timeout: 60_000 });
  // Saved before knob shapes were read: the page says how to switch them on.
  await expect(page.getByTestId('knobs-off')).toContainText('choose your photo of the puzzle with its holes again');
  await expect(page.getByTestId('knobs-off')).toContainText('scan your leftover pieces again (all of them');
  await expect(page.getByTestId('place-summary')).toContainText('On the box picture', { timeout: 60_000 });
  await eachPieceAtItsCell(page);
  await expect(page.getByTestId('spot-box').locator('rect.spot-open')).toHaveCount(8);
  await page.screenshot({ path: test.info().outputPath('box-placement-open-spots.png'), fullPage: true });
  // Fill this spot among the empty spots: a tap snaps to the nearest one (a tap far from all is in the unit tests).
  await page.getByTestId('fill-toggle').click();
  await expect(page.getByTestId('fill-picture').locator('rect.spot-open')).toHaveCount(8);
  await tapCell(page, 'fill-picture', 4, 4);
  await expect(page.getByTestId('fill-spot-name')).toContainText('Column 5, row 6');
  await expect(page.getByTestId('fill-best').getByTestId('fill-cand')).toHaveCount(1);
  // A spot whose piece wasn't scanned (one of the two extra gaps): nobody fits it.
  await tapCell(page, 'fill-picture', 0, 7);
  await expect(page.getByTestId('fill-spot-name')).toContainText('Column 1, row 8');
  await expect(page.getByTestId('fill-best')).toHaveCount(0);
  // Back to the whole picture.
  await page.getByTestId('whole-picture').click();
  await expect(page.getByTestId('open-spots')).toHaveCount(0);
  await expect(page.getByTestId('place-summary')).toContainText('On the box picture', { timeout: 60_000 });
});
