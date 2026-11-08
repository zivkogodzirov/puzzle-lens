/**
 * Finished-puzzle check (src/cv/assembledGrid.ts): rows × columns from the seams, and gaps where a
 * piece is missing, on the owner's finished "The Kiss" (IMG_9272, 28 × 36; skipped when absent),
 * then with one piece removed digitally. (The synthetic renderer draws no seams between assembled
 * pieces, so it can't test this.)
 */
import { describe, expect, it } from 'vitest';
import { puzzleQuad, readAssembledGrid } from '../../src/cv/assembledGrid';
import { applyH, fitHomography } from '../../src/geo/homography';
import type { Vec2 } from '../../src/project/types';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { getCv } from '../helpers/cv';
import { resizeBuffer } from '../helpers/images';
import { decodeRgba, listRealPhotos } from '../helpers/realFixtures';

describe('finished-puzzle check', () => {
  const photo = listRealPhotos().find((p) => p.name.startsWith('IMG_9272'));
  it.skipIf(!photo)(
    'IMG_9272: the finished 1000-piece puzzle: 28 × 36, no gaps',
    async () => {
      const cv = await getCv();
      let img = await decodeRgba(photo!.path);
      const k = 4032 / Math.max(img.width, img.height);
      if (k < 1) img = resizeBuffer(cv, img, 4, Math.round(img.width * k), Math.round(img.height * k), cv.INTER_AREA);
      const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
      const region = r.regions.filter((g) => g.kind === 'assembled').sort((a, b) => b.areaMm2 - a.areaMm2)[0]!;
      const q = puzzleQuad(cv, img, region.outlineImg)!;
      const g = readAssembledGrid(cv, img, q, { pieceCount: 1000, grid: { cols: 28, rows: 36 } })!;
      expect([g.cols, g.rows], `${g.colsExact} × ${g.rowsExact}`).toEqual([28, 36]);
      expect(g.gaps).toEqual([]);

      // Take one piece out digitally: paint cell (column 10, row 20) with the table's colour (and a
      // little noise), as a missing piece would show the table.
      // Unit square (puzzle fractions) → photo px, as the straightening maps it.
      const Hq = fitHomography(
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        g.cornersPx as Vec2[],
      )!;
      const cell = [
        applyH(Hq, [10.08 / 28, 20.08 / 36]),
        applyH(Hq, [10.92 / 28, 20.08 / 36]),
        applyH(Hq, [10.92 / 28, 20.92 / 36]),
        applyH(Hq, [10.08 / 28, 20.92 / 36]),
      ];
      const tl = [Math.min(...cell.map((p) => p[0])), Math.min(...cell.map((p) => p[1]))] as const;
      const br = [Math.max(...cell.map((p) => p[0])), Math.max(...cell.map((p) => p[1]))] as const;
      const tab = [
        img.data[Math.round(q[0]![1] - 40) * img.stride + Math.round(q[0]![0] + 300) * 4]!,
        img.data[Math.round(q[0]![1] - 40) * img.stride + Math.round(q[0]![0] + 300) * 4 + 1]!,
        img.data[Math.round(q[0]![1] - 40) * img.stride + Math.round(q[0]![0] + 300) * 4 + 2]!,
      ];
      let seed = 5;
      const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 6;
      for (let y = Math.round(tl[1]); y < br[1]; y++)
        for (let x = Math.round(tl[0]); x < br[0]; x++)
          for (let c = 0; c < 3; c++) img.data[y * img.stride + x * 4 + c] = Math.max(0, Math.min(255, tab[c]! + noise()));
      const g2 = readAssembledGrid(cv, img, q, { pieceCount: 1000, grid: { cols: 28, rows: 36 } })!;
      expect([g2.cols, g2.rows]).toEqual([28, 36]);
      expect(g2.gaps).toEqual([[10, 20]]);
    },
    300_000,
  );
});
