/**
 * Box placement core (src/cv/placement.ts): pieces cut straight from a synthetic puzzle's art (its
 * true outline, turned a random number of quarter turns and with a little noise) must be found at
 * their cell, the right way round; corner pieces only at corners; probabilities add up.
 */
import { describe, expect, it } from 'vitest';
import { buildBoxGrid, extractPatch, placePiece, PATCH_SIZE } from '../../src/cv/placement';
import type { Vec2 } from '../../src/project/types';
import { generatePuzzle } from '../synth/index';

const pz = generatePuzzle({ cols: 10, rows: 8, cellMm: [17.8, 19.4], seed: 5 });
const art = pz.art;
const picture = { data: art.rgba, width: art.width, height: art.height, stride: art.width * 4 };
const box = buildBoxGrid(picture, pz.cols, pz.rows);

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** The art with a little noise, as a "photo" of the pieces lying in place. */
function noisy(seed: number) {
  const r = rng(seed);
  const d = new Uint8Array(art.rgba);
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, d[i + c]! + (r() - 0.5) * 16));
  return { data: d, width: art.width, height: art.height, stride: art.width * 4 };
}

/** A piece's 4 corners and outline in art px, and its corners listed starting from corner `q` (as if photographed turned). */
function pieceInArt(id: string, q: number) {
  const p = pz.pieces.find((x) => x.id === id)!;
  const [sx, sy] = art.pxPerMm;
  const cx = (p.col + 0.5) * pz.cellMm[0];
  const cy = (p.row + 0.5) * pz.cellMm[1];
  const toPx = (x: number, y: number): Vec2 => [(x + cx) * sx, (y + cy) * sy];
  const corners: Vec2[] = [0, 1, 2, 3].map((k) => toPx(p.cornersMm[2 * k]!, p.cornersMm[2 * k + 1]!));
  const outline: number[] = [];
  for (let i = 0; i < p.outlineMm.length; i += 2) outline.push(...toPx(p.outlineMm[i]!, p.outlineMm[i + 1]!));
  return { p, corners: [0, 1, 2, 3].map((k) => corners[(k + q) % 4]!), outline };
}

describe('box placement', () => {
  it('pieces cut from the art are found at their cell and turned the right way (≥ 95 %)', () => {
    const photo = noisy(3);
    const r = rng(9);
    let n = 0;
    let cellOk = 0;
    let rotOk = 0;
    for (const p of pz.pieces) {
      const q = Math.floor(r() * 4);
      const { corners, outline } = pieceInArt(p.id, q);
      const patch = extractPatch(photo, corners, outline)!;
      expect(patch.size).toBe(PATCH_SIZE);
      const pl = placePiece(box, patch);
      n++;
      const t = pl.top[0]!;
      if (t.col === p.col && t.row === p.row) {
        cellOk++;
        // Corner 0 of the patch was the piece's corner q: the patch shows the piece turned q quarter
        // turns anticlockwise, so q turns clockwise set it upright.
        if (t.rot === q) rotOk++;
      }
      const sum = pl.top.reduce((a, b) => a + b.p, 0);
      expect(sum).toBeLessThanOrEqual(1.0001);
    }
    expect(cellOk / n, `${cellOk}/${n}`).toBeGreaterThanOrEqual(0.95);
    expect(rotOk / cellOk, `${rotOk}/${cellOk}`).toBeGreaterThanOrEqual(0.95);
  });

  it('a corner piece read as a corner (trusted) is only placed at a corner, the right way round', () => {
    const { corners, outline } = pieceInArt('r0c9', 2);
    const patch = extractPatch(noisy(4), corners, outline)!;
    // Sides in patch order (from corner 2 of r0c9: its bottom, left, top, right): top and right are flat.
    const p = pz.pieces.find((x) => x.id === 'r0c9')!;
    const flats = [0, 1, 2, 3].map((k) => p.sides[(k + 2) % 4] === 'flat');
    const pl = placePiece(box, patch, { flats, flatsSure: true });
    if (process.env.DBG) console.log(JSON.stringify(pl.top), JSON.stringify(placePiece(box, patch).top.slice(0, 3)), flats);
    expect([pl.top[0]!.col, pl.top[0]!.row, pl.top[0]!.rot]).toEqual([9, 0, 2]);
    // Only corners are candidates.
    for (const t of pl.top) (expect([0, 9]).toContain(t.col), expect([0, 7]).toContain(t.row));
  });
});
