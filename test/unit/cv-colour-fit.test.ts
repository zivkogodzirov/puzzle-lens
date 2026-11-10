/** The learned colour transform (M8, src/cv/colourFit.ts) on a computer-made picture with a known colour cast. */
import { describe, expect, it } from 'vitest';
import { buildBoxGrid, extractPatch, placePiece, type PiecePatch } from '../../src/cv/placement';
import { fitColour, type ColourSample } from '../../src/cv/colourFit';
import { learnDue, LEARN } from '../../src/project/placements';
import type { PieceRow, Vec2 } from '../../src/project/types';
import { generatePuzzle } from '../synth/index';

const pz = generatePuzzle({ cols: 10, rows: 8, cellMm: [17.8, 19.4], seed: 5 });
const art = pz.art;
const box = buildBoxGrid({ data: art.rgba, width: art.width, height: art.height, stride: art.width * 4 }, pz.cols, pz.rows);
// The pieces as a phone photographs them: warmer, darker in the shadows, less saturated.
const cast = new Uint8Array(art.rgba.length);
for (let i = 0; i < art.rgba.length; i += 4) {
  const [r, g, b] = [art.rgba[i]!, art.rgba[i + 1]!, art.rgba[i + 2]!];
  const y = 0.3 * r + 0.59 * g + 0.11 * b;
  cast[i] = Math.min(255, (y + (r - y) * 0.7) * 0.85 + 30);
  cast[i + 1] = Math.min(255, (y + (g - y) * 0.7) * 0.8 + 18);
  cast[i + 2] = Math.min(255, (y + (b - y) * 0.7) * 0.65 + 5);
  cast[i + 3] = 255;
}
const photo = { data: cast, width: art.width, height: art.height, stride: art.width * 4 };

/** A piece's patch from the cast picture (or the clean one), straightened upright (turn 0). */
function patchOf(col: number, row: number, from: { data: Uint8Array; width: number; height: number; stride: number } = photo): PiecePatch {
  const p = pz.pieces.find((q) => q.col === col && q.row === row)!;
  const [sx, sy] = art.pxPerMm;
  const cx = (col + 0.5) * pz.cellMm[0];
  const cy = (row + 0.5) * pz.cellMm[1];
  const toPx = (x: number, y: number): Vec2 => [(x + cx) * sx, (y + cy) * sy];
  const corners = [0, 1, 2, 3].map((k) => toPx(p.cornersMm[2 * k]!, p.cornersMm[2 * k + 1]!));
  const outline: number[] = [];
  for (let i = 0; i < p.outlineMm.length; i += 2) outline.push(...toPx(p.outlineMm[i]!, p.outlineMm[i + 1]!));
  return extractPatch(from, corners, outline)!;
}

describe('learned colour transform', () => {
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < pz.rows; r++) for (let c = 0; c < pz.cols; c++) cells.push([c, r]);
  const samples: ColourSample[] = cells.filter((_, i) => i % 3 === 0).map(([col, row]) => ({ patch: patchOf(col, row), col, row, rot: 0 }));

  it('fits the cast from pieces whose spot is known', () => {
    const fit = fitColour(box, samples)!;
    expect(fit).not.toBeNull();
    expect(fit.before).toBeGreaterThan(8);
    expect(fit.after).toBeLessThan(fit.before / 3);
  });

  it('with a current match that already fits, learning isn’t used (no clear gain on held-out pieces)', () => {
    const clean = { data: art.rgba, width: art.width, height: art.height, stride: art.width * 4 };
    const same: ColourSample[] = cells.filter((_, i) => i % 3 === 0).map(([col, row]) => ({ patch: patchOf(col, row, clean), col, row, rot: 0 }));
    const fit = fitColour(box, same, 12, { from: box.stats, to: box.stats })!;
    expect(fit.useful).toBe(false);
    // With the cast, it is.
    expect(fitColour(box, samples, 12, { from: box.stats, to: box.stats })!.useful).toBe(true);
  });

  it('too few pieces: no fit', () => {
    expect(fitColour(box, samples.slice(0, 5))).toBeNull();
  });

  it('a held-out piece is placed at least as well with the learned colours', () => {
    const fit = fitColour(box, samples)!;
    let plain = 0;
    let learned = 0;
    for (const [col, row] of cells.filter((_, i) => i % 3 === 1).slice(0, 12)) {
      const patch = patchOf(col, row);
      if (placePiece(box, patch, {}).top[0]?.col === col && placePiece(box, patch, {}).top[0]?.row === row) plain++;
      const t = placePiece(box, patch, { colour: { from: box.stats, to: box.stats, affine: fit.affine } }).top[0];
      if (t?.col === col && t?.row === row) learned++;
    }
    expect(learned).toBeGreaterThanOrEqual(plain);
  });

  it('learning is due on the whole picture once enough pieces are in at known spots, then every few more', () => {
    const placed = (n: number) =>
      Array.from(
        { length: n },
        (_, i) =>
          ({
            id: `p${i}`,
            status: 'placed',
            placedAt: { col: i, row: 0, rot: 0, at: 1, from: 'table', tray: null },
            patch: { blobId: 'b' },
          }) as unknown as PieceRow,
      );
    expect(learnDue(null, 'box|grid', placed(LEARN.min - 1))).toBe(false);
    expect(learnDue(null, 'box|grid', placed(LEARN.min))).toBe(true);
    // Among empty spots: never.
    expect(learnDue(null, 'box|grid|open:5', placed(50))).toBe(false);
    const cache = { boxKey: 'box|grid', colour: null, byPiece: {}, learned: { n: LEARN.min, before: 20, after: 4 } };
    expect(learnDue(cache, 'box|grid', placed(LEARN.min + LEARN.step - 1))).toBe(false);
    expect(learnDue(cache, 'box|grid', placed(LEARN.min + LEARN.step))).toBe(true);
    // Pieces put in without a spot ("It's in the puzzle") don't count.
    const tapped = placed(LEARN.min).map((p) => ({ ...p, placedAt: { ...p.placedAt!, by: 'tap' as const } }));
    expect(learnDue(null, 'box|grid', tapped)).toBe(false);
  });
});
