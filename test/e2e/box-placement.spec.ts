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
/**
 * Extra pieces (no patch, so never placed again) whose stored placements are Strong and show a box
 * picture 4 % too big across and down: offsets (a − 1)·(x + 0.5) + b with a = 0.96, b = 0.2.
 */
function misfitCache(w: number, h: number): { key: string; value: unknown } {
  const byPiece: Record<string, unknown> = {};
  for (let k = 0; k < 20; k++) {
    const col = (k * 3) % 10;
    const row = (k * 5) % 8;
    byPiece[`x${k}`] = {
      ts: 1,
      placement: {
        top: [{ col, row, rot: 0, score: 0.5, p: 0.9, ox: -0.04 * (col + 0.5) + 0.2, oy: -0.04 * (row + 0.5) + 0.2 }],
        verdict: 'strong',
      },
    };
  }
  const placeKey = `e2e-place:box-rect|0,0;${w},0;${w},${h};0,${h}|10x8`;
  return { key: 'placement:e2e-place', value: { boxKey: placeKey, colour: null, open: null, byPiece } };
}

async function seed(
  page: import('@playwright/test').Page,
  open: { gaps: Array<[number, number]>; thumb: string } | null,
  cache: { key: string; value: unknown } | null = null,
  pieceIds: string[] = ids,
): Promise<void> {
  const patches = pieceIds.map((pid, i) => ({ id: pid, b64: patchFor(pid, i % 4) }));
  await gotoScreen(page, '');
  const seeded = await page.evaluate(
    async ([box, ps, w, h, spots, cacheRow]) => {
      const bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const req = indexedDB.open('puzzle-lens');
      const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      await new Promise<void>((res) => {
        const tx = dbh.transaction(['projects', 'pieces', 'blobs', 'settings'], 'readwrite');
        if (cacheRow) tx.objectStore('settings').put(cacheRow);
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
        if (cacheRow) {
          const extra = Object.keys((cacheRow.value as { byPiece: Record<string, unknown> }).byPiece);
          extra.forEach((id, k) =>
            tx.objectStore('pieces').put({
              id,
              projectId: 'e2e-place',
              createdAt: 1,
              updatedAt: 1,
              status: 'table',
              table: { x: 300 + k * 30, y: 100, angleDeg: 0, lastSeen: 1, snapId: 's1' },
              outlineMm: [0, 0, 1, 0, 1, 1],
              areaMm2: 345,
              sizeMm: [18, 19],
              colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
              thumbBlobId: null,
              seen: 1,
              bestPxPerMm: 5,
              flags: {},
            }),
          );
        }
        tx.oncomplete = () => res();
      });
      dbh.close();
      return 'ok';
    },
    [jpeg(false), patches, art.width, art.height, open, cache] as const,
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

test('a box picture that is too big: the pieces show it, and the app corrects it (or not, on "Not now")', async ({ page }) => {
  await seed(page, null, misfitCache(art.width, art.height));
  await expect(page.getByTestId('place-summary')).toContainText('On the box picture', { timeout: 60_000 });
  await expect(page.getByTestId('box-fit')).toContainText('bigger than the real puzzle', { timeout: 30_000 });
  await expect(page.getByTestId('box-fit')).toContainText('up to 0.2');
  await page.screenshot({ path: test.info().outputPath('box-fit.png'), fullPage: true });
  await page.getByTestId('box-fit-apply').click();
  await expect(page.getByTestId('box-fit')).toHaveCount(0, { timeout: 60_000 });
  const box = await page.evaluate(async () => {
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    const p = await new Promise<{ box: { corners: number[][]; fitted?: number } }>((res) => {
      const q = dbh.transaction('projects').objectStore('projects').get('e2e-place');
      q.onsuccess = () => res(q.result);
    });
    dbh.close();
    return p.box;
  });
  expect(box.fitted).toBe(1);
  // The puzzle covers cells [0.2, 9.8] × [0.2, 7.88] of the old picture: the corners move in.
  const cw = art.width / 10;
  const ch = art.height / 8;
  expect(box.corners[0]![0]).toBeCloseTo(0.2 * cw, -1);
  expect(box.corners[0]![1]).toBeCloseTo(0.2 * ch, -1);
  expect(box.corners[2]![0]).toBeCloseTo(9.8 * cw, -1);
  expect(box.corners[2]![1]).toBeCloseTo(7.88 * ch, -1);
  // The real pieces are placed again on the corrected picture.
  await expect(page.getByTestId('place-summary')).toContainText('On the box picture', { timeout: 60_000 });
});

test('"Not now" on the box picture correction is remembered', async ({ page }) => {
  await seed(page, null, misfitCache(art.width, art.height));
  await expect(page.getByTestId('box-fit')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('box-fit-dismiss').click();
  await expect(page.getByTestId('box-fit')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('place-summary')).toContainText('On the box picture', { timeout: 60_000 });
  await expect(page.getByTestId('box-fit')).toHaveCount(0);
});

test('Fits / Doesn’t fit (M5 part 2): ruled-out spots, a piece into the puzzle and back, Fill this spot, the Accuracy page', async ({ page }) => {
  await seed(page, null);
  await expect(page.getByTestId('place-summary')).toContainText('On the box picture', { timeout: 60_000 });
  const thumbs = page.locator('[data-testid="catalog"] .thumb-btn');
  await expect(thumbs).toHaveCount(6);
  // r1c2 (first in id order): its spot is column 3, row 2.
  await thumbs.nth(0).click();
  await expect(page.getByTestId('spot-verdict')).toContainText('Column 3, row 2');
  await expect(page.getByTestId('spot-answer')).toContainText('Tried it in column 3, row 2?');
  await page.getByTestId('piece-spots').screenshot({ path: test.info().outputPath('spot-answer.png') });
  // Doesn't fit: that spot is ruled out; "Ask again" brings it back.
  await page.getByTestId('spot-not').click();
  await expect(page.getByTestId('spot-ruled-out')).toContainText('1 spot ruled out');
  await expect(page.getByTestId('spot-verdict')).not.toContainText('Column 3, row 2');
  await page.getByTestId('spot-clear').click();
  await expect(page.getByTestId('spot-verdict')).toContainText('Column 3, row 2');
  // Fits: the piece goes into the puzzle (off the table), with Undo.
  await page.getByTestId('spot-fits').click();
  await expect(page.getByTestId('placed-note')).toContainText('In the puzzle at column 3, row 2');
  await expect(page.getByTestId('in-puzzle')).toContainText('1 in the puzzle');
  await expect(thumbs).toHaveCount(5);
  await page.screenshot({ path: test.info().outputPath('fits.png'), fullPage: true });
  await page.getByTestId('placed-undo').click();
  await expect(page.getByTestId('in-puzzle')).toHaveCount(0);
  await expect(thumbs).toHaveCount(6);
  await thumbs.nth(0).click();
  await page.getByTestId('spot-fits').click();
  await expect(page.getByTestId('in-puzzle')).toContainText('1 in the puzzle');

  // Fill this spot: r3c7's spot (column 8, row 4); "Fits" there fills it.
  await page.getByTestId('fill-toggle').click();
  await tapCell(page, 'fill-picture', 7, 3);
  await expect(page.getByTestId('fill-best').getByTestId('fill-cand')).toHaveCount(1);
  await page.getByTestId('fill-best').getByTestId('fill-fits').click();
  await expect(page.getByTestId('fill-filled')).toBeVisible();
  await expect(page.getByTestId('in-puzzle')).toContainText('2 in the puzzle');
  // The filled spot of r1c2 offers nobody either.
  await tapCell(page, 'fill-picture', 2, 1);
  await expect(page.getByTestId('fill-filled')).toBeVisible();

  // "Not a puzzle piece": r6c8 (last in id order now that two are in the puzzle) is removed after a second tap.
  await page.getByTestId('fill-toggle').click();
  await expect(thumbs).toHaveCount(4);
  await thumbs.nth(3).click();
  await page.getByTestId('spot-remove').click();
  await page.getByTestId('spot-remove-yes').click();
  await expect(thumbs).toHaveCount(3);

  // The pieces in the puzzle, with "Take it out".
  await page.getByTestId('in-puzzle').click();
  await expect(page.getByTestId('in-puzzle-row')).toHaveCount(2);
  await expect(page.getByTestId('in-puzzle-list')).toContainText('Column 3, row 2');

  // Accuracy: two first-choice answers, both right (the undone one and the taken-back "doesn't fit" are left out).
  await page.getByTestId('accuracy-link').click();
  await expect(page.getByTestId('accuracy')).toContainText('2 answers');
  await expect(page.getByTestId('acc-all')).toContainText('2 of 2');
  await page.screenshot({ path: test.info().outputPath('accuracy.png'), fullPage: true });
});

test('pieces to check (M5 part 3): "same piece" merges it into the known one, "a different piece" keeps it', async ({ page }) => {
  await seed(page, null);
  await expect(page.getByTestId('place-summary')).toContainText('On the box picture', { timeout: 60_000 });
  // Two sightings a rescan couldn't place: each may be r1c2 or r2c5.
  await page.evaluate(async () => {
    const req = indexedDB.open('puzzle-lens');
    const dbh = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    const get = (id: string) =>
      new Promise<Record<string, unknown>>((res) => {
        const r = dbh.transaction('pieces').objectStore('pieces').get(id);
        r.onsuccess = () => res(r.result);
      });
    const base = await get('r1c2');
    await new Promise<void>((res) => {
      const tx = dbh.transaction('pieces', 'readwrite');
      const st = tx.objectStore('pieces');
      for (const [id, x] of [
        ['seen-1', 400],
        ['seen-2', 450],
      ] as const)
        st.put({ ...base, id, status: 'pending', maybe: ['r1c2', 'r2c5'], patch: null, table: { ...(base.table as object), x } });
      tx.oncomplete = () => res();
    });
    dbh.close();
  });
  await page.reload();
  await expect(page.getByTestId('pending-panel')).toContainText('2 pieces to check', { timeout: 30_000 });
  await expect(page.getByTestId('pending-tag')).toHaveCount(2);
  const thumbs = page.locator('[data-testid="catalog"] .thumb-btn');
  await expect(thumbs).toHaveCount(8);
  await page.getByTestId('pending-toggle').click();
  await expect(page.getByTestId('pending-row')).toHaveCount(2);
  await page.getByTestId('pending-panel').screenshot({ path: test.info().outputPath('pending.png') });
  // The first is r1c2, moved: merged (7 pieces left); the second is a new piece.
  await page.getByTestId('pending-row').nth(0).getByTestId('pending-same').nth(0).click();
  await expect(thumbs).toHaveCount(7);
  await expect(page.getByTestId('pending-panel')).toContainText('1 piece to check');
  await page.getByTestId('pending-new').click();
  await expect(page.getByTestId('pending-panel')).toHaveCount(0);
  await expect(thumbs).toHaveCount(7);
});

test('which pieces join (M6): a square of 4 first, then a pair; They fit / Don’t fit with Undo; partners on the piece; Accuracy', async ({ page }) => {
  // A 2 × 2 block (columns 4–5, rows 3–4), a pair side by side (columns 7–8, row 6) and one piece alone.
  await seed(page, null, null, ['r2c3', 'r2c4', 'r3c3', 'r3c4', 'r5c6', 'r5c7', 'r0c0']);
  await expect(page.getByTestId('place-summary')).toContainText('On the box picture', { timeout: 60_000 });
  await expect(page.getByTestId('matches-toggle')).toContainText('Which pieces join (5)');
  await page.getByTestId('matches-toggle').click();
  // What next: the square, its four spots marked on the box picture.
  const next = page.getByTestId('match-next');
  await expect(next).toContainText('A square of 4 ✓');
  await expect(next).toContainText('columns 4–5, rows 3–4');
  await expect(next.getByTestId('match-block-box').locator('rect.spot-best')).toHaveCount(4);
  // Its four pairs and the other pair are listed, the square's marked ✓.
  await expect(page.getByTestId('match-pair')).toHaveCount(5);
  await expect(page.getByTestId('match-confirmed')).toHaveCount(4);
  await page.getByTestId('matches').screenshot({ path: test.info().outputPath('matches.png') });
  // All 4 fit: joined, and the pair is next.
  await next.getByTestId('match-block-fits').click();
  await expect(page.getByTestId('match-note')).toContainText('the 4 pieces are joined');
  await expect(page.getByTestId('match-joined')).toContainText('4 pairs joined');
  await expect(page.getByTestId('match-next')).toContainText('These two join');
  await expect(page.getByTestId('match-next')).toContainText('side by side');
  await expect(page.getByTestId('match-next')).toContainText('Column 7–8, row 6');
  await expect(page.getByTestId('matches-toggle')).toContainText('Which pieces join (1)');
  // Don't fit: not suggested again; Undo brings it back.
  await page.getByTestId('match-next').getByTestId('match-not').click();
  await expect(page.getByTestId('match-note')).toContainText('isn’t suggested again');
  await expect(page.getByTestId('match-none')).toBeVisible();
  await page.getByTestId('match-undo').click();
  await expect(page.getByTestId('match-next')).toContainText('These two join');
  await page.getByTestId('match-next').getByTestId('match-fits').click();
  await expect(page.getByTestId('match-joined')).toContainText('5 pairs joined');
  // Taking one back.
  await page.getByTestId('match-joined').click();
  await expect(page.getByTestId('match-joined-row')).toHaveCount(5);
  await page.getByTestId('match-unjoin').first().click();
  await expect(page.getByTestId('match-joined')).toContainText('4 pairs joined');
  // A piece's partners: r2c3 (the square's top left; first in id order) has r2c4 on its right and r3c3 below it.
  await page.getByTestId('matches-toggle').click();
  await page.locator('[data-testid="catalog"] .thumb-btn').nth(1).click();
  await expect(page.getByTestId('piece-partners')).toBeVisible();
  await expect(page.getByTestId('piece-partner')).toHaveCount(2);
  await expect(page.getByTestId('piece-partners')).toContainText('on its right');
  await expect(page.getByTestId('piece-partners')).toContainText('below it');
  await expect(page.getByTestId('piece-partners')).toContainText('Partner not scanned yet on 2 sides');
  await page.getByTestId('piece-spots').screenshot({ path: test.info().outputPath('partners.png') });
  // Accuracy: 5 pairs tried and kept (the "don't fit" and the taken-back one are left out), 4 from the square.
  await page.getByTestId('accuracy-link').click();
  await expect(page.getByTestId('acc-pairs')).toContainText('4 pairs tried');
  await expect(page.getByTestId('acc-pairs-square')).toContainText('3 of 3');
  await expect(page.getByTestId('acc-pairs-all')).toContainText('4 of 4');
  await page.screenshot({ path: test.info().outputPath('accuracy-pairs.png'), fullPage: true });
});
