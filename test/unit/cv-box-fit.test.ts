/**
 * Box-to-grid correction (src/cv/boxFit.ts): from confident pieces' small offsets to the box
 * picture's scale and shift against the real puzzle, and the corrected corners.
 */
import { describe, expect, it } from 'vitest';
import { correctedCorners, fitBoxCorrection, fitMatters, refitPicture, type FitSample } from '../../src/cv/boxFit';
import type { Vec2 } from '../../src/project/types';

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** Pieces of a 28 × 36 puzzle seen on a box picture whose grid is a·x + b of the real one, with noise and some wrong spots. */
function samples(ax: number, bx: number, ay: number, by: number, n: number, wrong: number, seed = 1, area = { c0: 0, c1: 28, r0: 0, r1: 36 }): FitSample[] {
  const r = rng(seed);
  const out: FitSample[] = [];
  for (let i = 0; i < n; i++) {
    const col = area.c0 + Math.floor(r() * (area.c1 - area.c0));
    const row = area.r0 + Math.floor(r() * (area.r1 - area.r0));
    const bad = i < wrong;
    out.push({
      col,
      row,
      ox: bad ? (r() - 0.5) * 0.38 : (ax - 1) * (col + 0.5) + bx + (r() - 0.5) * 0.03,
      oy: bad ? (r() - 0.5) * 0.38 : (ay - 1) * (row + 0.5) + by + (r() - 0.5) * 0.03,
    });
  }
  return out;
}

describe('box-to-grid correction', () => {
  it('a box picture showing 0.5 % more on each side: scale and shift found, through noise and some wrong pieces', () => {
    // The puzzle covers 99 % of the box picture, starting 0.5 % in.
    const ax = 0.99;
    const bx = 0.005 * 28;
    const ay = 0.99;
    const by = 0.005 * 36;
    const fit = fitBoxCorrection(samples(ax, bx, ay, by, 60, 12), 28, 36)!;
    expect(fit).not.toBeNull();
    expect(fit.x.a).toBeCloseTo(ax, 2);
    expect(fit.x.b).toBeCloseTo(bx, 1);
    expect(fit.y.a).toBeCloseTo(ay, 2);
    expect(fit.y.b).toBeCloseTo(by, 1);
    expect(fit.edgeShift).toBeGreaterThan(0.14);
    expect(fitMatters(fit)).toBe(true);
  });

  it('a box picture that fits: nothing to correct', () => {
    const fit = fitBoxCorrection(samples(1, 0, 1, 0, 60, 10, 2), 28, 36);
    expect(fit).not.toBeNull();
    expect(fitMatters(fit)).toBe(false);
  });

  it('too few pieces, or all from one area: no fit (the slope isn’t known)', () => {
    expect(fitBoxCorrection(samples(0.99, 0.14, 0.99, 0.18, 10, 0), 28, 36)).toBeNull();
    expect(fitBoxCorrection(samples(0.99, 0.14, 0.99, 0.18, 60, 0, 3, { c0: 20, c1: 28, r0: 0, r1: 4 }), 28, 36)).toBeNull();
  });

  it('the corrected corners: the puzzle’s part of the box photo', () => {
    const corners: Vec2[] = [
      [100, 50],
      [380, 50],
      [380, 410],
      [100, 410],
    ];
    const same = correctedCorners(corners, 28, 36, { x: { a: 1, b: 0, n: 20 }, y: { a: 1, b: 0, n: 20 }, edgeShift: 0 })!;
    same.forEach((c, i) => {
      expect(c[0]).toBeCloseTo(corners[i]![0], 6);
      expect(c[1]).toBeCloseTo(corners[i]![1], 6);
    });
    // 10 px per cell: the puzzle covers cells [1, 27] across and [0.5, 35.5] down.
    const fit = { x: { a: 26 / 28, b: 1, n: 20 }, y: { a: 35 / 36, b: 0.5, n: 20 }, edgeShift: 1 };
    const c = correctedCorners(corners, 28, 36, fit)!;
    expect(c[0]![0]).toBeCloseTo(110, 6);
    expect(c[0]![1]).toBeCloseTo(55, 6);
    expect(c[2]![0]).toBeCloseTo(370, 6);
    expect(c[2]![1]).toBeCloseTo(405, 6);
  });

  it('refitting a picture takes the puzzle’s part of it', () => {
    // 4 × 2 cells at 10 px: white columns at the sides, the puzzle (black) in the middle 2 columns.
    const W = 40;
    const H = 20;
    const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(x >= 10 && x < 30 ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * W + x) * 4);
    const out = refitPicture({ data, width: W, height: H, stride: W * 4 }, 4, 2, { x: { a: 0.5, b: 1, n: 20 }, y: { a: 1, b: 0, n: 20 }, edgeShift: 1 });
    expect([...out.data.slice(0, 3)]).toEqual([0, 0, 0]);
    expect([...out.data.slice((W - 1) * 4, (W - 1) * 4 + 3)]).toEqual([0, 0, 0]);
  });
});
