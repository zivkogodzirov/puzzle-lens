/**
 * Finished-puzzle check (src/cv/assembledGrid.ts): rows × columns from the seams, and gaps where a
 * piece is missing, on the owner's finished "The Kiss" (IMG_9272, 28 × 36; skipped when absent),
 * then with one piece removed digitally. (The synthetic renderer draws no seams between assembled
 * pieces, so it can't test this.)
 */
import { describe, expect, it } from 'vitest';
import { puzzleQuad, readAssembledGrid } from '../../src/cv/assembledGrid';
import { orientSpots, SPOT_THUMB_CELL, straightenQuad, turnCell } from '../../src/cv/openSpots';
import { buildBoxGrid } from '../../src/cv/placement';
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

  // The owner took 21 pieces out (2026-11-08): 10 at the top-right corner (columns 24–28, rows 1–2)
  // and 11 around the faces (columns 17–20, rows 7–8, and 17–19 in row 9). The corner pieces being
  // out cuts the outline's corner off; the floor shows below the table.
  const holes = listRealPhotos().find((p) => p.name.startsWith('IMG_9280'));
  it.skipIf(!holes)(
    'IMG_9280: the puzzle with 21 pieces out: 28 × 36 and exactly those 21 gaps',
    async () => {
      const cv = await getCv();
      const img = await decodeRgba(holes!.path);
      const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
      const region = r.regions.filter((g) => g.kind === 'assembled').sort((a, b) => b.areaMm2 - a.areaMm2)[0]!;
      const q = puzzleQuad(cv, img, region.outlineImg)!;
      const g = readAssembledGrid(cv, img, q, { pieceCount: 1000, grid: { cols: 28, rows: 36 } })!;
      expect([g.cols, g.rows], `${g.colsExact} × ${g.rowsExact}`).toEqual([28, 36]);
      const want: Array<[number, number]> = [];
      for (const row of [0, 1]) for (let col = 23; col <= 27; col++) want.push([col, row]);
      for (const row of [6, 7]) for (let col = 16; col <= 19; col++) want.push([col, row]);
      for (let col = 16; col <= 18; col++) want.push([col, 8]);
      const key = (a: [number, number]) => a[1] * 100 + a[0];
      expect([...g.gaps].sort((a, b) => key(a) - key(b))).toEqual(want.sort((a, b) => key(a) - key(b)));
      // The missing pieces' sides where a hole borders a piece in place (read by eye from this photo
      // and the complete puzzle's seams, IMG_9272): t knob out, b knob in, f edge, o another hole;
      // '?' = may be unreadable. Top, right, bottom, left; column-row 1-based.
      const sidesWant: Record<string, string> = {
        c24r1: 'foot',
        c25r1: 'fooo',
        c26r1: 'fooo',
        c27r1: 'fooo',
        c28r1: 'ffoo',
        c24r2: 'ootb',
        c25r2: 'oobo',
        c26r2: 'oobo',
        c27r2: 'ooto',
        c28r2: 'ofto',
        c17r7: 'boot',
        c18r7: 'booo',
        c19r7: 'booo',
        c20r7: 'tboo',
        c17r8: 'ooob',
        c18r8: 'oooo',
        c19r8: 'oooo',
        c20r8: 'otto',
        c17r9: 'oo?t',
        c18r9: 'ooto',
        c19r9: 'obbo',
      };
      let unread = 0;
      g.gaps.forEach(([c, r], k) => {
        const want4 = sidesWant[`c${c + 1}r${r + 1}`]!;
        const got4 = g.gapSides[k]!;
        for (let d = 0; d < 4; d++) {
          if (got4[d] === '?') unread++;
          else if (want4[d] !== '?') expect(`c${c + 1}r${r + 1} side ${d}: ${got4[d]}`).toBe(`c${c + 1}r${r + 1} side ${d}: ${want4[d]}`);
        }
      });
      expect(unread, g.gapSides.join(' ')).toBeLessThanOrEqual(4);
      // Turned onto the box picture (the owner's, from a screenshot of the app), as the photo is and
      // as if it had been taken from the other side of the table (upside down).
      const shot = listRealPhotos().find((p) => p.name.startsWith('shot-9294'));
      if (!shot) return;
      const s = await decodeRgba(shot.path);
      const BW = 1120;
      const BH = 1569;
      const boxPx = new Uint8Array(BW * BH * 4);
      for (let y = 0; y < BH; y++) boxPx.set(s.data.subarray((1059 + y) * s.stride + 100 * 4, (1059 + y) * s.stride + (100 + BW) * 4), y * BW * 4);
      const box = buildBoxGrid({ data: boxPx, width: BW, height: BH, stride: BW * 4 }, 28, 36);
      const c = g.cornersPx as Array<[number, number]>;
      const asIs = orientSpots(box, straightenQuad(img, c, 28 * SPOT_THUMB_CELL, 36 * SPOT_THUMB_CELL), 28, 36, g.gaps)!;
      expect(asIs.turn).toBe(0);
      expect([...asIs.cells].sort((a, b) => key(a) - key(b))).toEqual(want);
      const flipped = orientSpots(
        box,
        straightenQuad(img, [c[2]!, c[3]!, c[0]!, c[1]!], 28 * SPOT_THUMB_CELL, 36 * SPOT_THUMB_CELL),
        28,
        36,
        g.gaps.map(([col, row]) => turnCell(col, row, 28, 36, 2)),
      )!;
      expect(flipped.turn).toBe(2);
      expect([...flipped.cells].sort((a, b) => key(a) - key(b))).toEqual(want);
      expect(asIs.fit, `fit ${asIs.fit.toFixed(2)} vs ${asIs.runnerUp.toFixed(2)}`).toBeGreaterThan(asIs.runnerUp + 0.2);
    },
    300_000,
  );
});
