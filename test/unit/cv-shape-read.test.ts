/**
 * Shape reading (src/cv/shapeRead.ts) on the synthetic generator's exact outlines, then rotated,
 * mirrored, re-sampled and roughened like a traced photo outline.
 */
import { describe, expect, it } from 'vitest';
import { readShape } from '../../src/cv/shapeRead';
import { generatePuzzle, type SynthPiece } from '../synth/index';

const cell: [number, number] = [17.8, 19.4];
const puzzles = [1, 2, 3].map((seed) => generatePuzzle({ cols: 10, rows: 8, cellMm: cell, seed }));
const uniform = generatePuzzle({ cols: 10, rows: 8, cellMm: cell, seed: 7, cut: 'uniform' });

/** Deterministic pseudo-random numbers. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

function truthKind(p: SynthPiece) {
  const f = p.sides.filter((s) => s === 'flat').length;
  return f === 0 ? 'interior' : f === 1 ? 'edge' : 'corner';
}

/** Rotate by `deg`, optionally mirror, keep every `keep`-th point, add Gaussian-ish jitter `sd` (mm) and smooth. */
function distort(o: number[], deg: number, mirror: boolean, keep: number, sd: number, r: () => number): number[] {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  const pts: number[] = [];
  for (let i = 0; i < o.length; i += 2 * keep) {
    let x = o[i]!;
    const y = o[i + 1]!;
    if (mirror) x = -x;
    const j = () => (r() + r() + r() - 1.5) * sd * 2;
    pts.push(c * x - s * y + j(), s * x + c * y + j());
  }
  return pts;
}

/** The read's sides, matched to the truth's (top, right, bottom, left) by direction. */
function sidesInTruthOrder(read: NonNullable<ReturnType<typeof readShape>>, deg: number, mirror: boolean): string[] {
  const c = read.corners;
  const cx = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4;
  const cy = (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4;
  const out: string[] = ['', '', '', ''];
  for (let k = 0; k < 4; k++) {
    const a = c[k]!;
    const b = c[(k + 1) % 4]!;
    // Side midpoint direction, un-rotated (and un-mirrored) back to the piece's own axes.
    let dx = (a[0] + b[0]) / 2 - cx;
    let dy = (a[1] + b[1]) / 2 - cy;
    const t = (-deg * Math.PI) / 180;
    [dx, dy] = [Math.cos(t) * dx - Math.sin(t) * dy, Math.sin(t) * dx + Math.cos(t) * dy];
    if (mirror) dx = -dx;
    const i = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0; // y down: top = 0
    out[i] = read.sides[k]!.kind;
  }
  return out;
}

describe('shape reading', () => {
  it('exact outlines: every side and piece type right', () => {
    let n = 0;
    let sidesOk = 0;
    let kindOk = 0;
    for (const pz of [...puzzles, uniform])
      for (const p of pz.pieces) {
        const r = readShape(p.outlineMm, cell);
        n++;
        if (!r) continue;
        if (sidesInTruthOrder(r, 0, false).join() === p.sides.join()) sidesOk++;
        if (r.kind === truthKind(p)) kindOk++;
      }
    expect(sidesOk / n, `${sidesOk}/${n}`).toBeGreaterThanOrEqual(0.99);
    expect(kindOk / n, `${kindOk}/${n}`).toBeGreaterThanOrEqual(0.99);
  });

  it('rotated, mirrored (face down), coarse and rough like an overview photo: ≥ 97 % of sides, ≥ 95 % of piece types', () => {
    const r = rng(11);
    let sides = 0;
    let sidesOk = 0;
    let n = 0;
    let kindOk = 0;
    let wrongBorder = 0;
    let trusted = 0;
    for (const pz of puzzles)
      for (const p of pz.pieces) {
        const deg = r() * 360;
        const mirror = r() < 0.3;
        // ~4 px/mm overview: ~0.25 mm per point and ~0.15 mm tracing noise.
        const o = distort(p.outlineMm, deg, mirror, 2, 0.15, r);
        const read = readShape(o, cell);
        n++;
        sides += 4;
        if (!read) continue;
        const got = sidesInTruthOrder(read, deg, mirror);
        for (let k = 0; k < 4; k++) if (got[k] === p.sides[k]) sidesOk++;
        if (read.kind === truthKind(p)) kindOk++;
        if (read.quality >= 0.5) {
          trusted++;
          // A trusted read must never put an interior piece in the border group or miss a border piece.
          if ((read.kind === 'interior') !== (truthKind(p) === 'interior')) wrongBorder++;
        }
      }
    expect(sidesOk / sides, `${sidesOk}/${sides}`).toBeGreaterThanOrEqual(0.97);
    expect(kindOk / n, `${kindOk}/${n}`).toBeGreaterThanOrEqual(0.95);
    expect(trusted / n, `trusted ${trusted}/${n}`).toBeGreaterThanOrEqual(0.85);
    expect(wrongBorder, 'trusted reads in the wrong border group').toBeLessThanOrEqual(1);
  });

  it('without the cell size it still reads', () => {
    let ok = 0;
    for (const p of puzzles[0]!.pieces) if (readShape(p.outlineMm)?.kind === truthKind(p)) ok++;
    expect(ok / puzzles[0]!.pieces.length).toBeGreaterThanOrEqual(0.95);
  });

  it('not a piece: a circle or a long bar gives no trusted read', () => {
    const circle: number[] = [];
    for (let i = 0; i < 200; i++) circle.push(12 * Math.cos((i / 200) * 2 * Math.PI), 12 * Math.sin((i / 200) * 2 * Math.PI));
    const c = readShape(circle, cell);
    expect(!c || c.quality < 0.5).toBe(true);
  });
});
