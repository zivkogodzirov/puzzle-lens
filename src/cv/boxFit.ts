/**
 * Box-to-grid correction (M4, RESEARCH §9 step 1): box art is often a little bigger or smaller than
 * the real puzzle (it shows more or less of the scene), so the box picture's grid drifts off the
 * real pieces toward its edges. A 1 % difference each side cost 83 → 74 % right spots on synthetic
 * 300-piece puzzles.
 *
 * Every confident placement says where the piece fits best relative to its spot (PlacementSpot.ox,
 * oy). Per axis, those offsets grow linearly across the picture: offset = (a − 1)·x + b at the spot
 * centre x (cells). A robust line fit gives a and b; the puzzle then covers [b, a·n + b] of the box
 * picture's n cells, which gives new corners for straightening the box picture again.
 */
import { applyH, fitHomography } from '../geo/homography';
import type { Vec2 } from '../project/types';

export const BOX_FIT = {
  /** Confident placements needed (per axis, after dropping outliers). */
  minSamples: 15,
  /** An offset this far (cells) from the fitted line is an outlier (a wrong spot, a misread piece). */
  inlier: 0.06,
  /** The fitted samples must spread over this share of the picture (else the slope isn't known). */
  minSpread: 0.4,
  /** Worth correcting when the grid is off by this much (cells) somewhere along the picture's edges. */
  minEdgeShift: 0.1,
};

export interface AxisFit {
  /** Box picture position (cells) = a · puzzle position + b. */
  a: number;
  b: number;
  n: number;
}

export interface BoxFit {
  x: AxisFit;
  y: AxisFit;
  /** The largest shift (cells) at the picture's edges. */
  edgeShift: number;
}

export interface FitSample {
  col: number;
  row: number;
  ox: number;
  oy: number;
}

/** Robust line fit of offsets against spot centres (RANSAC over pairs, then least squares on the inliers). */
function fitAxis(pos: number[], off: number[], n: number): AxisFit | null {
  const m = pos.length;
  if (m < BOX_FIT.minSamples) return null;
  let best: number[] = [];
  // Every pair for small sets; a fixed sample of pairs for large ones.
  let s = 12345;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pairs = m <= 60 ? (m * (m - 1)) / 2 : 1500;
  for (let t = 0; t < pairs; t++) {
    let i: number;
    let j: number;
    if (m <= 60) {
      // t → (i, j), i < j.
      i = 0;
      let k = t;
      while (k >= m - 1 - i) ((k -= m - 1 - i), i++);
      j = i + 1 + k;
    } else {
      i = Math.floor(rnd() * m);
      j = Math.floor(rnd() * m);
    }
    if (pos[i] === pos[j]) continue;
    const slope = (off[j]! - off[i]!) / (pos[j]! - pos[i]!);
    const icpt = off[i]! - slope * pos[i]!;
    const inl: number[] = [];
    for (let k = 0; k < m; k++) if (Math.abs(off[k]! - (slope * pos[k]! + icpt)) <= BOX_FIT.inlier) inl.push(k);
    if (inl.length > best.length) best = inl;
  }
  if (best.length < BOX_FIT.minSamples) return null;
  const xs = best.map((k) => pos[k]!);
  if (Math.max(...xs) - Math.min(...xs) < BOX_FIT.minSpread * n) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = best.reduce((a, k) => a + off[k]!, 0) / best.length;
  let sxy = 0;
  let sxx = 0;
  for (const k of best) {
    sxy += (pos[k]! - mx) * (off[k]! - my);
    sxx += (pos[k]! - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { a: 1 + slope, b: my - slope * mx, n: best.length };
}

/** The box-to-grid fit from confident placements, or null when there are too few or they are too bunched up. */
export function fitBoxCorrection(samples: FitSample[], cols: number, rows: number): BoxFit | null {
  const x = fitAxis(
    samples.map((q) => q.col + 0.5),
    samples.map((q) => q.ox),
    cols,
  );
  const y = fitAxis(
    samples.map((q) => q.row + 0.5),
    samples.map((q) => q.oy),
    rows,
  );
  if (!x || !y) return null;
  const shift = (f: AxisFit, n: number) => Math.max(Math.abs(f.b), Math.abs((f.a - 1) * n + f.b));
  return { x, y, edgeShift: Math.max(shift(x, cols), shift(y, rows)) };
}

/** Worth offering: off by at least BOX_FIT.minEdgeShift somewhere. */
export function fitMatters(fit: BoxFit | null): boolean {
  return Boolean(fit && fit.edgeShift >= BOX_FIT.minEdgeShift);
}

/**
 * New corners (photo px; top-left, top-right, bottom-right, bottom-left) of the puzzle within the box
 * photo: the current corners map the straightened picture (cols × rows cells) onto the photo; the
 * puzzle covers cells [b, a·n + b] of it on each axis.
 */
export function correctedCorners(corners: Vec2[], cols: number, rows: number, fit: BoxFit): Vec2[] | null {
  const H = fitHomography(
    [
      [0, 0],
      [cols, 0],
      [cols, rows],
      [0, rows],
    ],
    corners,
  );
  if (!H) return null;
  const x0 = fit.x.b;
  const x1 = fit.x.a * cols + fit.x.b;
  const y0 = fit.y.b;
  const y1 = fit.y.a * rows + fit.y.b;
  return (
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ] as Vec2[]
  ).map((p) => applyH(H, p) as Vec2);
}

/** The puzzle's part of a straightened picture, resampled to the same size (for tests; the app straightens the photo again). */
export function refitPicture(
  pic: { data: Uint8Array; width: number; height: number; stride: number },
  cols: number,
  rows: number,
  fit: BoxFit,
): { data: Uint8Array; width: number; height: number; stride: number } {
  const { width: W, height: H, data, stride } = pic;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const bx = (fit.x.a * ((x + 0.5) / W) * cols + fit.x.b) * (W / cols) - 0.5;
      const by = (fit.y.a * ((y + 0.5) / H) * rows + fit.y.b) * (H / rows) - 0.5;
      const k = Math.min(H - 1, Math.max(0, Math.round(by))) * stride + Math.min(W - 1, Math.max(0, Math.round(bx))) * 4;
      out.set(data.subarray(k, k + 4), (y * W + x) * 4);
    }
  return { data: out, width: W, height: H, stride: W * 4 };
}
