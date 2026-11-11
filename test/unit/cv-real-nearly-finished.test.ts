/**
 * The owner's nearly finished puzzle (IMG_9244, 2026-11-07: "The Kiss", 28 × 36, with many pieces
 * still out, loose pieces on the table, in the box lid and lying on the picture). Kept out of git
 * like the other real photos (test/fixtures/real); skipped when absent.
 *
 * Its seams repeat at 36.58 rows (the rows of a real puzzle differ a little in height), which used
 * to round to 28 × 37: nothing was saved and the note asked to check the grid. With the grid known
 * the seams are read at the grid's own count when they fit it clearly better (assembledGrid.ts,
 * gridCountFits). A different grid and a photo that cuts the puzzle off are still refused.
 *
 * Its 88 open spots are all real holes, but about 40 more are not found: loose pieces lie on its
 * picture and in its holes. So they are not saved as the puzzle's empty spots (review 2026-11-11:
 * saved, the progress said 920 in, about 880 really, and the leftover pieces were matched only to
 * them); IMG_9280 and IMG_9281, with no piece on them, save theirs (spotsComplete).
 */
import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { orientSpots, SPOT_THUMB_CELL, straightenQuad } from '../../src/cv/openSpots';
import { buildBoxGrid } from '../../src/cv/placement';
import { finishedPuzzle, piecesOnPuzzle, scanFreePixels } from '../../src/cv/scanFreePixels';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import { eraseAllData } from '../../src/db/db';
import { puzzleProgress } from '../../src/project/progress';
import { createProject, getBlob, updateProject } from '../../src/project/store';
import type { FinishedCheck } from '../../src/shared/apis';
import { getCv, type Cv } from '../helpers/cv';
import { cropBuffer, resizeBuffer } from '../helpers/images';
import { decodeRgba, REAL_DIR } from '../helpers/realFixtures';

const has = (n: string) => existsSync(`${REAL_DIR}${n}.jpeg`);
const PROJECT = { pitchMm: 18.6, zoom: 1, kind: 'overview' as const, table: null, pieceCount: 1000, grid: { cols: 28, rows: 36 }, catalog: [] };

/**
 * The 88 open spots the check finds (column, row; 0-based from the top left), each looked at on a
 * crop of the straightened photo with the grid drawn (2026-11-11): every one shows the table through
 * a missing piece. About 40 more holes are not found (mostly half covered by neighbours' knobs, or
 * with loose pieces lying in them, as in the lower left).
 */
const CHECKED: Record<number, number[]> = {
  1: [9, 10, 11, 16],
  2: [4, 11],
  3: [4, 11],
  4: [3, 10, 20, 21, 22],
  5: [5, 7, 21, 22, 24, 25],
  6: [3, 4, 5, 25],
  7: [3, 4, 6, 21, 22, 23, 24, 25, 26],
  8: [21, 22, 23, 24],
  12: [3, 4, 26],
  13: [4],
  14: [4, 5, 22],
  15: [3, 4, 5],
  16: [3, 4, 5],
  18: [24, 25],
  19: [24, 25, 26],
  20: [22, 24, 25],
  21: [24, 25, 26],
  22: [24, 25, 26],
  23: [24, 25],
  26: [25, 26],
  28: [24],
  29: [23, 24],
  30: [22, 23, 24, 25, 26],
  31: [22, 23, 24, 25, 26],
  32: [23, 24, 25, 26],
  33: [24, 25, 26],
  34: [25],
};
const holes = new Set(Object.entries(CHECKED).flatMap(([r, cs]) => cs.map((c) => `${c},${r}`)));

async function photo(cv: Cv, name: string): Promise<PixelBuffer> {
  const img = await decodeRgba(`${REAL_DIR}${name}.jpeg`);
  const s = 4032 / Math.max(img.width, img.height);
  return s >= 1 ? img : resizeBuffer(cv, img, 4, Math.round(img.width * s), Math.round(img.height * s), cv.INTER_AREA);
}

let scan: typeof import('../../src/app/screens/Scan');

beforeAll(async () => {
  // The screen module reads the address, the window and the document when imported.
  vi.stubGlobal('location', { hash: '#/' });
  vi.stubGlobal('addEventListener', () => {});
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' });
  scan = await import('../../src/app/screens/Scan');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe.skipIf(!has('IMG_9244'))('the nearly finished puzzle (IMG_9244)', () => {
  it('is read at its grid, 28 × 36, with 88 open spots that are all real holes; a different grid and a cut-off photo are refused', async () => {
    const cv = await getCv();
    const img = await photo(cv, 'IMG_9244');
    const { r, finished } = scanFreePixels(cv, img, PROJECT);
    expect(finished).not.toBeNull();
    const f = finished!;
    // The seams' own repeat says 36.6 rows: the even comb of 36 fits them, that of 37 doesn't.
    expect(f.rowsExact, 'the repeat count that used to round to 37').toBeGreaterThan(36.5);
    expect([f.cols, f.rows]).toEqual([28, 36]);
    expect(scan.gridMatches({ cols: 28, rows: 36 }, f)).toBe(true);
    const wrong = f.gaps.filter(([c, row]) => !holes.has(`${c},${row}`));
    expect(wrong, 'open spots not on a hole checked by eye').toEqual([]);
    expect(f.gaps.length).toBeGreaterThanOrEqual(80);

    // Another puzzle's grid one column more: not read at it (the comb of 29 fits worse), so the
    // count doesn't match and nothing would be saved.
    const other = finishedPuzzle(cv, img, r.regions, { pieceCount: 1000, grid: { cols: 29, rows: 36 } });
    expect(other && [other.cols, other.rows]).toEqual([28, 36]);
    expect(scan.gridMatches({ cols: 29, rows: 36 }, other!)).toBe(false);

    // The photo's bottom edge cuts off the puzzle's last row (photo 3250 px high: the bottom left
    // corner is out, the bottom right one 8 px in): not read as 28 × 36.
    const cut = cropBuffer(img, 4, 0, 0, img.width, 3250);
    const fc = scanFreePixels(cv, cut, PROJECT).finished;
    expect(fc === null || !scan.gridMatches({ cols: 28, rows: 36 }, fc), fc ? `${fc.cols} × ${fc.rows}` : '').toBe(true);
  }, 600_000);

  it('with pieces lying on it, its open spots are not saved; from a photo without them they would be, turned onto the box picture as they are', async () => {
    const cv = await getCv();
    const img = await photo(cv, 'IMG_9244');
    const { r, finished, looseFound } = scanFreePixels(cv, img, PROJECT);
    const f = finished!;
    // As the reader worker counts them.
    const onPuzzle = piecesOnPuzzle(looseFound ?? (r.registered ? r.pieces : (r.unplaced ?? [])), f);
    expect(onPuzzle).toBeGreaterThan(scan.OPEN_SPOTS_MAX_ON_PUZZLE);
    // As the reader worker makes the thumbnail (straightened, SPOT_THUMB_CELL px per cell).
    const thumb = straightenQuad(img, f.cornersPx as Array<[number, number]>, f.cols * SPOT_THUMB_CELL, f.rows * SPOT_THUMB_CELL);
    const fin: FinishedCheck = {
      thumb: new Blob([new Uint8Array([1, 2, 3])]),
      cols: f.cols,
      rows: f.rows,
      colsExact: f.colsExact,
      rowsExact: f.rowsExact,
      seamStrength: f.seamStrength,
      gaps: f.gaps,
      gapSides: f.gapSides,
      gapsPreview: f.gapsPx,
      cornersPreview: f.cornersPx as Array<[number, number]>,
      onPuzzle,
    };
    await eraseAllData();
    let project = await createProject({ name: 'The Kiss', pieceCount: 1000 });
    project = await updateProject(project.id, { grid: { cols: 28, rows: 36, source: 'suggested' } });
    const kept = await scan.saveOpenSpots(project, fin);
    expect(kept.openSpots ?? null).toBeNull();
    const lines = scan.finishedLines(fin, kept);
    expect(lines.join(' ')).toContain(`About ${onPuzzle} loose pieces lie on the puzzle, so the empty spots under them can't be seen`);
    expect(lines.join(' ')).not.toContain('Saved');

    // The same spots from a photo with no piece on the puzzle are saved.
    const saved = await scan.saveOpenSpots(project, { ...fin, onPuzzle: 0 });
    expect(saved.openSpots).toMatchObject({ cols: 28, rows: 36, gaps: f.gaps, gapSides: f.gapSides });
    expect(await getBlob(saved.openSpots!.thumbBlobId)).toBeDefined();
    expect(scan.finishedLines({ ...fin, onPuzzle: 0 }, saved)).toContain(
      'Saved these 88 empty spots: add the box picture and your leftover pieces will be matched only to them.',
    );

    // Turned onto the box picture (the owner's, from a screenshot of the app) as placement does it:
    // the photo is the right way up.
    if (has('shot-9294')) {
      const s = await decodeRgba(`${REAL_DIR}shot-9294.jpeg`);
      const BW = 1120;
      const BH = 1569;
      const boxPx = new Uint8Array(BW * BH * 4);
      for (let y = 0; y < BH; y++) boxPx.set(s.data.subarray((1059 + y) * s.stride + 100 * 4, (1059 + y) * s.stride + (100 + BW) * 4), y * BW * 4);
      const box = buildBoxGrid({ data: boxPx, width: BW, height: BH, stride: BW * 4 }, 28, 36);
      const o = orientSpots(box, thumb, 28, 36, saved.openSpots!.gaps, saved.openSpots!.gapSides)!;
      expect(o.turn).toBe(0);
      const key = (a: [number, number]) => a[1] * 100 + a[0];
      expect([...o.cells].sort((a, b) => key(a) - key(b))).toEqual([...f.gaps].sort((a, b) => key(a) - key(b)));
      expect(o.fit, `fit ${o.fit.toFixed(2)} vs ${o.runnerUp.toFixed(2)}`).toBeGreaterThan(o.runnerUp + 0.2);
      // The progress page: every spot but the open ones is in.
      const p = puzzleProgress({ grid: { cols: 28, rows: 36 }, pieces: [], shown: new Map(), open: o.cells, taken: new Set() });
      expect([p.cells, p.done, p.toFind]).toEqual([1008, 1008 - 88, 88]);
    }
  }, 600_000);
});

describe.skipIf(!has('IMG_9280') || !has('IMG_9281'))('finished puzzles with no piece lying on them (IMG_9280, IMG_9281)', () => {
  it('keep saving their open spots (review 2026-11-11)', async () => {
    const cv = await getCv();
    for (const n of ['IMG_9280', 'IMG_9281']) {
      const { r, finished, looseFound } = scanFreePixels(cv, await photo(cv, n), PROJECT);
      expect(finished, n).not.toBeNull();
      expect(finished!.gaps.length, n).toBeGreaterThan(0);
      const onPuzzle = piecesOnPuzzle(looseFound ?? (r.registered ? r.pieces : (r.unplaced ?? [])), finished!);
      expect(scan.spotsComplete({ onPuzzle }), `${n}: ${onPuzzle} pieces on the puzzle`).toBe(true);
    }
  }, 600_000);
});
