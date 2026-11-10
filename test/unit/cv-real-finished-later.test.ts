/**
 * A photo of the finished puzzle taken after loose pieces were scanned (M7 part 4; owner's photos in
 * test/fixtures/real, kept out of git; skipped when missing). It can't be matched to the loose
 * pieces, but its assembled area must still come back, so the finished-puzzle check runs (it used
 * to be dropped: the owner couldn't update the puzzle photo once pieces were scanned).
 */
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { planMerge } from '../../src/project/catalog';
import { puzzleQuad, readAssembledGrid } from '../../src/cv/assembledGrid';
import { getCv } from '../helpers/cv';
import { decodeRgba, REAL_DIR } from '../helpers/realFixtures';

const HAS = ['IMG_9276.jpeg', 'IMG_9272.jpeg'].every((f) => existsSync(REAL_DIR + f));

it.skipIf(!HAS)(
  'the finished puzzle (IMG_9272) after the loose pieces (IMG_9276): not matched to them, but read as the finished puzzle',
  async () => {
    const cv = await getCv();
    const pieces = await decodeRgba(REAL_DIR + 'IMG_9276.jpeg');
    const r0 = scanMarkerless(cv, pieces, { catalog: [], zoom: 1, kind: 'overview', table: null });
    let n = 0;
    const catalog = planMerge([], r0.pieces, {
      projectId: 'p',
      snapId: 's',
      pxPerMm: r0.pxPerMm ?? 8,
      now: 1,
      newId: () => `p${n++}`,
      thumbId: (id) => id,
    }).added;
    expect(catalog.length).toBeGreaterThan(15);
    const fin = await decodeRgba(REAL_DIR + 'IMG_9272.jpeg');
    const r = scanMarkerless(cv, fin, { catalog, zoom: 1, kind: 'overview', table: null });
    expect(r.registered).toBe(false);
    expect(r.pieces).toHaveLength(0);
    const big = r.regions.filter((g) => g.kind === 'assembled').sort((a, b) => b.areaMm2 - a.areaMm2)[0];
    expect(big).toBeDefined();
    const g = readAssembledGrid(cv, fin, puzzleQuad(cv, fin, big!.outlineImg)!, { pieceCount: 1000, grid: { cols: 28, rows: 36 } })!;
    expect([g.cols, g.rows]).toEqual([28, 36]);
    expect(g.gaps).toHaveLength(0);
  },
  600_000,
);
