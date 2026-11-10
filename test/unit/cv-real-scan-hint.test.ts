/**
 * The marker-free scan on the owner's photos (test/fixtures/real, kept out of git; skipped when
 * missing), review fixes of 2026-11-10 (src/cv/scanFreePixels.ts, src/cv/scanMarkerless.ts):
 * - a stale scale hint no longer spoils a photo: it is scanned again without it (and the scale
 *   pre-pass is shared by the two scans), but a good hint on a photo that doesn't match is not;
 * - a finished puzzle is not scanned again at the other zoom;
 * - the loose pieces lying beside a finished puzzle are counted (they are not catalogued), found
 *   again at the puzzle's own scale when the scan settled far from it;
 * - the scale pre-pass runs at most once per scan.
 * Photos are reduced to 4032 px on the long side, as the app decodes them.
 */
import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as PF from '../../src/cv/pieceFinder';
import * as SM from '../../src/cv/scanMarkerless';
import { gridPxPerMm, loosePiecesBeside, scanFreePixels } from '../../src/cv/scanFreePixels';
import { measurePitch, planMerge } from '../../src/project/catalog';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import { getCv, type Cv } from '../helpers/cv';
import { resizeBuffer } from '../helpers/images';
import { decodeRgba, REAL_DIR } from '../helpers/realFixtures';

const has = (...names: string[]) => names.every((n) => existsSync(`${REAL_DIR}${n}.jpeg`));
const PROJECT = { pitchMm: 18.6, zoom: 1, kind: 'overview' as const, table: null, pieceCount: 1000, grid: { cols: 28, rows: 36 } };

async function photo(cv: Cv, name: string): Promise<PixelBuffer> {
  const img = await decodeRgba(`${REAL_DIR}${name}.jpeg`);
  const s = 4032 / Math.max(img.width, img.height);
  return s >= 1 ? img : resizeBuffer(cv, img, 4, Math.round(img.width * s), Math.round(img.height * s), cv.INTER_AREA);
}
const clean = (r: SM.ScanMarkerlessResult) => r.pieces.filter((p) => !p.flags.cut && !p.flags.clump).length;
/** A catalog of one piece that is in none of the photos. */
const OTHER = [
  {
    id: 'x',
    table: { x: 0, y: 0 },
    areaMm2: 270,
    sizeMm: [18, 19] as [number, number],
    colour: { meanLab: [50, 0, 0] as [number, number, number], hueHist: [1, 0, 0, 0, 0, 0, 0, 0] },
  },
];
const outlines = (r: SM.ScanMarkerlessResult) => r.pieces.map((p) => p.outlineImg);
/** A photo's pieces as the catalog Scan.tsx would pass after saving it, and the pitch it measures from them. */
function catalogOf(r: SM.ScanMarkerlessResult) {
  let n = 0;
  const rows = planMerge([], r.pieces, { projectId: 'p', snapId: 's', pxPerMm: r.pxPerMm!, now: 1, newId: () => `p${n++}`, thumbId: (id) => id }).added.filter(
    (p) => p.status === 'table' || p.status === 'pending',
  );
  const m = measurePitch(rows.filter((p) => p.status === 'table'));
  return { catalog: rows, pitchMm: m ? Math.sqrt(m.wMm * m.hMm) / Math.sqrt(SM.REAL_PIECE_AREA_SHARE) : PROJECT.pitchMm };
}

describe.skipIf(!has('IMG_9226'))('a stale scale hint (IMG_9226, taken from about 2.6 × the height the hint says)', () => {
  it('is dropped: the photo comes out as without a hint, with or without a catalog', async () => {
    const cv = await getCv();
    const img = await photo(cv, 'IMG_9226');
    const plain = scanFreePixels(cv, img, { ...PROJECT, catalog: [] }).r;
    expect(clean(plain)).toBeGreaterThan(15);
    // A close-up's scale (10.5 px/mm) used for this whole-table photo.
    const hint = { pxPerMm: 10.5, maxSide: 4032 };
    const spy = vi.spyOn(SM, 'scanMarkerless');
    const est = vi.spyOn(PF, 'estimatePxPerMm');
    try {
      const { r } = scanFreePixels(cv, img, { ...PROJECT, catalog: [], scaleHint: hint });
      // The hinted scan alone was unusable (1 clean piece of 59 on 2026-11-10).
      expect(clean(spy.mock.results[0]!.value as SM.ScanMarkerlessResult)).toBeLessThan(5);
      expect(spy).toHaveBeenCalledTimes(2);
      // Both scans ask for the scale pre-pass; it runs once.
      expect(est).toHaveBeenCalledTimes(1);
      expect(r.timings.retriedNoHint).toBe(1);
      expect(r.pxPerMm).toBe(plain.pxPerMm);
      expect(outlines(r)).toEqual(outlines(plain));

      // Its own pieces as the catalog: the hinted scan can't be placed, the second one is.
      let n = 0;
      const catalog = planMerge([], plain.pieces, {
        projectId: 'p',
        snapId: 's',
        pxPerMm: plain.pxPerMm!,
        now: 1,
        newId: () => `p${n++}`,
        thumbId: (id) => id,
      }).added;
      spy.mockClear();
      const placed = scanFreePixels(cv, img, { ...PROJECT, catalog, scaleHint: hint }).r;
      expect((spy.mock.results[0]!.value as SM.ScanMarkerlessResult).registered).toBe(false);
      expect(placed.registered).toBe(true);
      expect(placed.inliers).toBeGreaterThan(15);
      expect(placed.timings.retriedNoHint).toBe(1);
    } finally {
      spy.mockRestore();
      est.mockRestore();
    }
  }, 600_000);
});

describe.skipIf(!has('IMG_9127'))('a good scale hint on a photo that does not match the catalog (IMG_9127)', () => {
  it('is not scanned again without the hint, only at the other zoom as before', async () => {
    const cv = await getCv();
    const img = await photo(cv, 'IMG_9127');
    // The photo's own scale (5.87 px/mm) as the hint, and a catalog of a piece it doesn't show.
    const spy = vi.spyOn(SM, 'scanMarkerless');
    try {
      const { r } = scanFreePixels(cv, img, { ...PROJECT, catalog: OTHER, scaleHint: { pxPerMm: 5.8701, maxSide: 4032 } });
      const hinted = spy.mock.results[0]!.value as SM.ScanMarkerlessResult;
      expect(hinted.registered).toBe(false);
      // Its scale was measured from enough single pieces: the hint did not spoil it.
      expect((hinted.unplaced ?? []).filter((p) => !p.flags.cut && !p.flags.clump).length).toBeGreaterThanOrEqual(5);
      // Scanning it again from the nominal scale took 2× the time for the same answer (2026-11-10).
      expect(spy.mock.calls.map(([, , o]) => [o.ppmHint ?? null, o.zoom])).toEqual([
        [5.8701, 1],
        [null, 2],
      ]);
      expect(r.registered).toBe(false);
      expect(r.timings.retriedNoHint).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  }, 600_000);
});

describe.skipIf(!has('IMG_9272'))('a finished puzzle (IMG_9272)', () => {
  it('is found without scanning again at the other zoom; nothing lies beside it', async () => {
    const cv = await getCv();
    const img = await photo(cv, 'IMG_9272');
    const spy = vi.spyOn(SM, 'scanMarkerless');
    try {
      const { r, finished, looseFound } = scanFreePixels(cv, img, { ...PROJECT, catalog: [] });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(clean(r)).toBeLessThan(5);
      expect(finished && [finished.cols, finished.rows, finished.gaps.length]).toEqual([28, 36, 0]);
      expect(looseFound).toBeUndefined();
      expect(loosePiecesBeside(r.pieces, finished!)).toBe(0);

      // A stale hint: the scan settles at 1.33 px/mm, the puzzle's own scale is 4.3. Its pieces are
      // found again at the puzzle's scale, and still none lies beside it (2026-11-10).
      const h = scanFreePixels(cv, img, { ...PROJECT, catalog: [], scaleHint: { pxPerMm: 2.8635, maxSide: 4032 } });
      expect(h.finished && [h.finished.cols, h.finished.rows, h.finished.gaps.length]).toEqual([28, 36, 0]);
      expect(h.looseFound).toBeDefined();
      expect(loosePiecesBeside(h.looseFound!, h.finished!)).toBe(0);
    } finally {
      spy.mockRestore();
    }
  }, 600_000);
});

describe.skipIf(!has('IMG_9244', 'IMG_9226'))('a finished puzzle photo after an overview of loose pieces (IMG_9226, then IMG_9244)', () => {
  it('counts the loose pieces beside it at the puzzle’s own scale when the batch’s hint spoiled the scan’s', async () => {
    const cv = await getCv();
    // The batch so far: IMG_9226 saved as the first overview (its catalog, pitch and 2.86 px/mm).
    const first = scanFreePixels(cv, await photo(cv, 'IMG_9226'), { ...PROJECT, catalog: [] }).r;
    const batch = catalogOf(first);
    expect(batch.catalog.length).toBeGreaterThan(30);
    const img = await photo(cv, 'IMG_9244');
    const find = vi.spyOn(PF, 'findPieces');
    try {
      const { r, finished, looseFound } = scanFreePixels(cv, img, { ...PROJECT, ...batch, scaleHint: { pxPerMm: first.pxPerMm!, maxSide: 4032 } });
      expect(finished && [finished.cols, finished.rows]).toEqual([28, 36]);
      expect(r.registered).toBe(false);
      // The scan settled at about 1.15 px/mm, a third of the puzzle's own 3.49: its own pieces show
      // none of the loose ones (0 counted on 2026-11-10, the review's finding).
      const own = gridPxPerMm(finished!, batch.pitchMm);
      expect(Math.abs(r.unplacedPxPerMm! / own - 1)).toBeGreaterThan(SM.RESCALE_LIMIT);
      expect(loosePiecesBeside(r.unplaced ?? [], finished!)).toBe(0);
      // One more detection, at the puzzle's scale: about the 14 counted by eye (16 on 2026-11-10;
      // 13–16 at the other scales this photo was scanned at).
      expect(find.mock.calls.at(-1)![2].pxPerMm).toBeCloseTo(own, 6);
      const loose = loosePiecesBeside(looseFound!, finished!);
      expect(loose).toBeGreaterThanOrEqual(12);
      expect(loose).toBeLessThanOrEqual(17);
    } finally {
      find.mockRestore();
    }
  }, 600_000);
});

describe.skipIf(!has('shot-9294', 'shot-9273', 'coin-shot-9262'))('a hint less than RESCALE_LIMIT off the nominal scale', () => {
  it('can still spoil a photo, so it is scanned again without it there too (check 2026-11-10)', async () => {
    // Why the second scan is not skipped for hints near the nominal scale (review 2026-11-10: a
    // correct hint on an unusable photo costs a scan more): these photos came out unusable at a
    // hint 15–28 % off the nominal 4 px/mm (scaled to the photo) and usable without it.
    const cv = await getCv();
    for (const [name, k, own] of [
      ['shot-9294', 1.15, false],
      ['shot-9273', 1.28, false],
      ['coin-shot-9262', 0.85, true],
    ] as const) {
      const img = await photo(cv, name);
      const cat = own ? catalogOf(scanFreePixels(cv, img, { ...PROJECT, catalog: [] }).r) : { catalog: [], pitchMm: PROJECT.pitchMm };
      const spy = vi.spyOn(SM, 'scanMarkerless');
      try {
        const { r } = scanFreePixels(cv, img, { ...PROJECT, ...cat, scaleHint: { pxPerMm: 4 * k, maxSide: 4032 } });
        const hinted = spy.mock.results[0]!.value as SM.ScanMarkerlessResult;
        expect((hinted.registered ? hinted.pieces : (hinted.unplaced ?? [])).filter((p) => !p.flags.cut && !p.flags.clump).length, name).toBeLessThan(5);
        expect(r.timings.retriedNoHint, name).toBe(1);
        expect(r.registered, name).toBe(true);
        expect(clean(r), name).toBeGreaterThanOrEqual(10);
      } finally {
        spy.mockRestore();
      }
    }
  }, 600_000);
});

describe.skipIf(!has('IMG_9280', 'IMG_9281'))('loose pieces beside the puzzle so far (counted by eye: IMG_9280 8, IMG_9281 18)', () => {
  it('are counted, placed on the catalog or not; the scale pre-pass runs once per scan', async () => {
    const cv = await getCv();
    for (const [name, loose] of [
      ['IMG_9280', 8],
      ['IMG_9281', 18],
    ] as const) {
      const img = await photo(cv, name);
      const est = vi.spyOn(PF, 'estimatePxPerMm');
      try {
        const { r, finished, looseFound } = scanFreePixels(cv, img, { ...PROJECT, catalog: [] });
        expect(finished && [finished.cols, finished.rows, finished.gaps.length], name).toEqual([28, 36, 21]);
        expect(loosePiecesBeside(r.pieces, finished!), name).toBe(loose);
        // Found at about the puzzle's own scale: no detection more for the count.
        expect(looseFound, name).toBeUndefined();
        // IMG_9280 asks for the pre-pass twice; it ran twice (about 1.7 s) before 2026-11-10.
        expect(est.mock.calls.length, name).toBeLessThanOrEqual(1);
        // Not placed on a catalog of other pieces: the pieces found are still counted.
        const u = scanFreePixels(cv, img, { ...PROJECT, catalog: OTHER });
        expect(u.finished, name).not.toBeNull();
        if (!u.r.registered) {
          expect(u.r.pieces).toHaveLength(0);
          expect(loosePiecesBeside(u.r.unplaced ?? [], u.finished!), name).toBe(loose);
        }
      } finally {
        est.mockRestore();
      }
    }
  }, 600_000);
});
