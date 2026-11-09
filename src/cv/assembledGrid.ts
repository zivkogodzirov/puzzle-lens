/**
 * Finished-puzzle check (owner's request 2026-11-08: "capture the whole puzzle when it's completed
 * and count the pieces").
 *
 * Given an assembled area found by the scan (its outline in photo px):
 * 1. Its 4 corners: the box-outline finder's, when each of its corners lies on the outline;
 *    otherwise the 4 sides fitted as straight lines to the outline (a missing corner piece only
 *    cuts the outline's corner off), then snapped to the puzzle's real edge in the photo.
 * 2. Straightened (rectify.ts, true shape from the corner geometry).
 * 3. Rows and columns from the seams: thin dark lines (darker than the pixels 3 px either side),
 *    summed along each axis; the repeat length of each profile (autocorrelation) is one piece.
 * 4. Gaps: cells whose middle is mostly table (colour of the table just outside the puzzle), that
 *    part plain — a missing piece shows the table through it (its neighbours' knobs reach in).
 */
import type { Cv } from './loadCv';
import type { PixelBuffer } from './frameAnalyser';
import { cvGuard } from './loadCv';
import { withScope } from './scope';
import { findBoxQuad, orderCorners, rectifyQuad, type Point } from './rectify';
import { deltaE, rgbToLab } from './tableModel';
import { applyH, fitHomography } from '../geo/homography';
import type { Vec2 } from '../project/types';

export interface AssembledGrid {
  /** Corners in photo px (TL, TR, BR, BL). */
  cornersPx: Point[];
  /** Width : height of the straightened puzzle. */
  aspect: number;
  /** Seams counted across (columns) and down (rows), unrounded. */
  colsExact: number;
  rowsExact: number;
  cols: number;
  rows: number;
  /** How clearly the seams repeat (0–1, autocorrelation at the period / at lag 0). */
  seamStrength: number;
  /** Cells that look like a missing piece (column, row; 0-based from top-left). */
  gaps: Array<[number, number]>;
  /** Each gap's centre in photo px. */
  gapsPx: Array<[number, number]>;
  /**
   * Each gap's sides (top, right, bottom, left, in the reported orientation): what the missing
   * piece has there, read from the hole's outline where it borders a piece still in place:
   * 't' knob out (the hole reaches into the neighbour), 'b' knob in (the neighbour's knob reaches
   * into the hole), 'f' the puzzle's edge, 'o' another gap (unknown), '?' not readable.
   */
  gapSides: string[];
}

/** Below this seam strength the count is not trusted. */
export const SEAM_OK = 0.12;

/** Repeat length of `p` between lo and hi: the strongest autocorrelation peak there, then refined
 *  to a fraction of a pixel from the peak near m × that length (m ≈ half the profile's pieces). */
function period(p: Float64Array, lo: number, hi: number): { lag: number; strength: number } {
  const n = p.length;
  let mean = 0;
  for (const v of p) mean += v;
  mean /= n;
  const d = Float64Array.from(p, (v) => v - mean);
  let v0 = 0;
  for (const v of d) v0 += v * v;
  v0 /= n;
  const ac = (l: number) => {
    let s = 0;
    for (let i = 0; i + l < n; i++) s += d[i]! * d[i + l]!;
    return s / (n - l);
  };
  let best = -Infinity;
  let lag = lo;
  for (let l = lo; l <= hi && l < n - 1; l++) {
    const s = ac(l);
    if (s > best) [best, lag] = [s, l];
  }
  let P = lag;
  const m = Math.floor((0.5 * n) / lag);
  if (m >= 2) {
    let b2 = -Infinity;
    let l2 = m * lag;
    for (let l = Math.round(m * lag - lag / 3); l <= Math.round(m * lag + lag / 3) && l < n - 1; l++) {
      const s = ac(l);
      if (s > b2) [b2, l2] = [s, l];
    }
    P = l2 / m;
  }
  return { lag: P, strength: v0 > 0 ? Math.max(0, best) / v0 : 0 };
}

/** 4 corners from an outline (flat x, y, photo px). */
export function quadFromOutline(cv: Cv, outline: number[]): Point[] | null {
  return cvGuard(cv, () =>
    withScope((s) => {
      if (outline.length < 8) return null;
      const pts = s.keep(cv.matFromArray(outline.length / 2, 1, cv.CV_32FC2, outline));
      const hull = s.keep(new cv.Mat());
      cv.convexHull(pts, hull, false, true);
      const peri = cv.arcLength(hull, true);
      for (let eps = 0.01; eps < 0.2; eps *= 1.3) {
        const ap = s.keep(new cv.Mat());
        cv.approxPolyDP(hull, ap, eps * peri, true);
        if (ap.rows === 4) {
          const d: Float32Array = ap.data32F;
          const q = orderCorners([
            [d[0]!, d[1]!],
            [d[2]!, d[3]!],
            [d[4]!, d[5]!],
            [d[6]!, d[7]!],
          ]);
          return q;
        }
        if (ap.rows < 4) return null;
      }
      return null;
    }),
  );
}

/**
 * The puzzle's 4 sides as straight lines fitted to the outline (each through the outline points
 * near that side's extreme, in the frame of the outline's own tilt), intersected. A missing corner
 * piece or two only cut the outline's corner off; the lines still meet where the corner is (owner's
 * IMG_9280: 10 pieces out at the top right).
 */
export function quadByLines(outline: number[]): Point[] | null {
  const n = outline.length / 2;
  if (n < 16) return null;
  // Tilt: the angle that minimises the outline's bounding-box area (search in 0.5° steps over ±45°).
  let bestA = Infinity;
  let th = 0;
  for (let a = -45; a < 45; a += 0.5) {
    const c = Math.cos((a * Math.PI) / 180);
    const s = Math.sin((a * Math.PI) / 180);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = outline[2 * i]!;
      const y = outline[2 * i + 1]!;
      const u = c * x + s * y;
      const v = -s * x + c * y;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    if ((u1 - u0) * (v1 - v0) < bestA) [bestA, th] = [(u1 - u0) * (v1 - v0), (a * Math.PI) / 180];
  }
  const c = Math.cos(th);
  const s = Math.sin(th);
  // Densify (outline points can be far apart along straight runs) so each side has enough points.
  const pts: Array<[number, number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const ax = outline[2 * i]!;
    const ay = outline[2 * i + 1]!;
    const bx = outline[(2 * i + 2) % (2 * n)]!;
    const by = outline[(2 * i + 3) % (2 * n)]!;
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
    for (let j = 0; j < k; j++) {
      const x = ax + ((bx - ax) * j) / k;
      const y = ay + ((by - ay) * j) / k;
      pts.push([x, y, c * x + s * y, -s * x + c * y]);
    }
  }
  const us = pts.map((p) => p[2]).sort((a, b) => a - b);
  const vs = pts.map((p) => p[3]).sort((a, b) => a - b);
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(f * arr.length)))]!;
  const [uLo, uHi, vLo, vHi] = [q(us, 0.005), q(us, 0.995), q(vs, 0.005), q(vs, 0.995)];
  const band = 0.03 * Math.min(uHi - uLo, vHi - vLo);
  // Sides in order top (v low), right (u high), bottom (v high), left (u low).
  const sides: Array<(p: [number, number, number, number]) => boolean> = [
    (p) => p[3] < vLo + band,
    (p) => p[2] > uHi - band,
    (p) => p[3] > vHi - band,
    (p) => p[2] < uLo + band,
  ];
  const lines: Array<[number, number, number]> = [];
  for (const f of sides) {
    const sel = pts.filter(f).map((p) => [p[0], p[1]] as Point);
    if (sel.length < 12) return null;
    const l = fitLine(sel);
    if (!l) return null;
    lines.push(l);
  }
  const corners: Point[] = [];
  for (let e = 0; e < 4; e++) {
    const [a1, b1, c1] = lines[(e + 3) % 4]!;
    const [a2, b2, c2] = lines[e]!;
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-9) return null;
    corners.push([(c1 * b2 - c2 * b1) / det, (a1 * c2 - a2 * c1) / det]);
  }
  return orderCorners(corners);
}

/** Total-least-squares line a x + b y = c through the points, refitted on the closest 70 % (3 times). */
function fitLine(pts: Point[]): [number, number, number] | null {
  let line: [number, number, number] | null = null;
  for (let it = 0; it < 4 && pts.length >= 6; it++) {
    let mx = 0;
    let my = 0;
    for (const [x, y] of pts) ((mx += x), (my += y));
    mx /= pts.length;
    my /= pts.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const [x, y] of pts) {
      sxx += (x - mx) ** 2;
      syy += (y - my) ** 2;
      sxy += (x - mx) * (y - my);
    }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const l: [number, number, number] = [-Math.sin(th), Math.cos(th), -Math.sin(th) * mx + Math.cos(th) * my];
    line = l;
    pts = pts
      .map((p) => [p, Math.abs(l[0] * p[0] + l[1] * p[1] - l[2])] as const)
      .sort((u, v) => u[1] - v[1])
      .slice(0, Math.max(6, Math.round(0.7 * pts.length)))
      .map((u) => u[0]);
  }
  return line;
}

/**
 * Snaps each side of a first quad to the puzzle's real edge in the photo: along the side, the
 * strongest step from darker (puzzle) to brighter (table) within ±6 % of the side across it; a
 * straight line through those points (stray bumps drop out); the 4 lines intersected. The
 * scan's outline can run along the photo's edge where the puzzle nearly touches it (IMG_9272).
 */
export function snapQuad(rgba: PixelBuffer, q: Point[]): Point[] | null {
  const W = rgba.width;
  const H = rgba.height;
  const lum = (x: number, y: number): number | null => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
    const k = yi * rgba.stride + xi * 4;
    return 0.299 * rgba.data[k]! + 0.587 * rgba.data[k + 1]! + 0.114 * rgba.data[k + 2]!;
  };
  const cx = (q[0]![0] + q[1]![0] + q[2]![0] + q[3]![0]) / 4;
  const cy = (q[0]![1] + q[1]![1] + q[2]![1] + q[3]![1]) / 4;
  const lines: Array<[number, number, number]> = [];
  for (let e = 0; e < 4; e++) {
    const A = q[e]!;
    const B = q[(e + 1) % 4]!;
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const tx = (B[0] - A[0]) / len;
    const ty = (B[1] - A[1]) / len;
    let nx = ty;
    let ny = -tx;
    if (((A[0] + B[0]) / 2 - cx) * nx + ((A[1] + B[1]) / 2 - cy) * ny < 0) ((nx = -nx), (ny = -ny));
    const reach = Math.round(0.06 * len);
    const w = Math.max(2, Math.round(len / 600));
    const pts: Point[] = [];
    for (let t = 0.08; t <= 0.92; t += 0.01) {
      const px = A[0] + t * (B[0] - A[0]);
      const py = A[1] + t * (B[1] - A[1]);
      const prof: Array<number | null> = [];
      for (let s = -reach - 2 * w; s <= reach + 2 * w; s++) prof.push(lum(px + s * nx, py + s * ny));
      let best = 0;
      let at = NaN;
      for (let s = -reach; s <= reach; s++) {
        let o = 0;
        let i = 0;
        let ok = true;
        for (let k = 1; k <= 2 * w && ok; k++) {
          const a = prof[s + k + reach + 2 * w];
          const b = prof[s - k + reach + 2 * w];
          if (a == null || b == null) ok = false;
          else ((o += a), (i += b));
        }
        if (!ok) continue;
        const step = (o - i) / (2 * w);
        if (step > best) [best, at] = [step, s];
      }
      if (best > 12 && Number.isFinite(at)) pts.push([px + at * nx, py + at * ny]);
    }
    if (pts.length < 20) return null;
    const l = fitLine(pts);
    if (!l) return null;
    lines.push(l);
  }
  const out: Point[] = [];
  for (let k = 0; k < 4; k++) {
    const [a1, b1, c1] = lines[(k + 3) % 4]!;
    const [a2, b2, c2] = lines[k]!;
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-6) return null;
    out.push([(c1 * b2 - c2 * b1) / det, (a1 * c2 - a2 * c1) / det]);
  }
  const size = Math.hypot(q[2]![0] - q[0]![0], q[2]![1] - q[0]![1]);
  for (let k = 0; k < 4; k++) if (Math.hypot(out[k]![0] - q[k]![0], out[k]![1] - q[k]![1]) > 0.1 * size) return null;
  return out;
}

function polyArea(c: ArrayLike<number>): number {
  let a = 0;
  for (let i = 0, n = c.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += c[i]! * c[j + 1]! - c[j]! * c[i + 1]!;
  }
  return Math.abs(a) / 2;
}

/**
 * The finished puzzle's 4 corners for an assembled area (outline in photo px): the box-picture
 * outline finder (straight strong edges) when its quad agrees with the area (similar size, same
 * place), else the area's own simplified outline snapped to the photo's edges.
 */
export function puzzleQuad(cv: Cv, rgba: PixelBuffer, outline: number[]): Point[] | null {
  const area = polyArea(outline);
  // Area centroid (outline points are unevenly spaced).
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (let i = 0, n = outline.length; i < n; i += 2) {
    const j = (i + 2) % n;
    const cr = outline[i]! * outline[j + 1]! - outline[j]! * outline[i + 1]!;
    a2 += cr;
    cx += (outline[i]! + outline[j]!) * cr;
    cy += (outline[i + 1]! + outline[j + 1]!) * cr;
  }
  cx /= 3 * a2;
  cy /= 3 * a2;
  const box = findBoxQuad(cv, rgba, 'RGBA');
  if (box) {
    const q = box.map(([x, y]) => [x * rgba.width, y * rgba.height] as Point);
    const a = polyArea(q.flat());
    const qx = (q[0]![0] + q[1]![0] + q[2]![0] + q[3]![0]) / 4;
    const qy = (q[0]![1] + q[1]![1] + q[2]![1] + q[3]![1]) / 4;
    // …and each corner near the outline: a quad that agrees only on average can still be the table
    // or the floor on one side (owner's IMG_9280, with pieces out at a corner).
    const near = q.every((c) => distToPoly(outline, c) < 0.06 * Math.sqrt(area));
    if (a > 0.75 * area && a < 1.25 * area && Math.hypot(qx - cx, qy - cy) < 0.1 * Math.sqrt(area) && near) return q;
  }
  const q0 = quadByLines(outline) ?? quadFromOutline(cv, outline);
  return q0 ? (snapQuad(rgba, q0) ?? q0) : null;
}

/** Distance from a point to a closed polygon's boundary (flat x, y). */
function distToPoly(poly: number[], [px, py]: Point): number {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i += 2) {
    const ax = poly[i]!;
    const ay = poly[i + 1]!;
    const bx = poly[(i + 2) % n]!;
    const by = poly[(i + 3) % n]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - px, ay + t * dy - py));
  }
  return best;
}

/**
 * Counts rows and columns of an assembled puzzle and looks for gaps. `pieceCount` (from the box)
 * sets the search range; `grid` (the puzzle's known columns × rows) only decides which way round
 * the count is reported. Neither is forced on the result.
 */
export function readAssembledGrid(
  cv: Cv,
  rgba: PixelBuffer,
  corners: Point[],
  opts: { pieceCount: number; grid?: { cols: number; rows: number } | null },
): AssembledGrid | null {
  const rect = rectifyQuad(cv, rgba, 'RGBA', corners, { maxSide: 3000 });
  const { width: W, height: H, data } = rect;
  if (W < 64 || H < 64) return null;
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  // Seam width ~ 2–4 px here; compare with 3 px either side.
  const R = Math.max(2, Math.round(Math.min(W, H) / 700));
  const m = Math.round(0.02 * Math.min(W, H));
  const px = new Float64Array(W);
  const py = new Float64Array(H);
  for (let y = Math.max(R, m); y < H - Math.max(R, m); y++)
    for (let x = Math.max(R, m); x < W - Math.max(R, m); x++) {
      const v = g[y * W + x]!;
      px[x] = px[x]! + Math.max(0, Math.min(g[y * W + x - R]!, g[y * W + x + R]!) - v);
      py[y] = py[y]! + Math.max(0, Math.min(g[(y - R) * W + x]!, g[(y + R) * W + x]!) - v);
    }
  // Search near the size a piece must have for the box's piece count (knob outlines also repeat,
  // at about a third of a piece, so an open search can lock onto them). A count off by up to
  // ~35 % either way is still found.
  const side = Math.sqrt((W * H) / Math.max(1, opts.pieceCount));
  const cx = period(px, Math.max(4, Math.floor(0.65 * side)), Math.ceil(1.5 * side));
  const cy = period(py, Math.max(4, Math.floor(0.65 * side)), Math.ceil(1.5 * side));
  let colsExact = W / cx.lag;
  let rowsExact = H / cy.lag;
  let cornersPx = corners;
  // Report in the puzzle's own orientation when the grid is known and the photo is turned.
  if (opts.grid) {
    const asIs = Math.abs(Math.round(colsExact) - opts.grid.cols) + Math.abs(Math.round(rowsExact) - opts.grid.rows);
    const turned = Math.abs(Math.round(rowsExact) - opts.grid.cols) + Math.abs(Math.round(colsExact) - opts.grid.rows);
    if (turned < asIs) {
      [colsExact, rowsExact] = [rowsExact, colsExact];
      cornersPx = [corners[1]!, corners[2]!, corners[3]!, corners[0]!];
    }
  }
  const cols = Math.round(colsExact);
  const rows = Math.round(rowsExact);
  const turnedNow = cornersPx !== corners;

  // Gaps: the table's colour from a ring just outside the puzzle.
  const tableLab = ringLab(rgba, corners);
  const gaps: Array<[number, number]> = [];
  const gapsPx: Array<[number, number]> = [];
  const gapRect: Array<[number, number]> = [];
  const toPhoto = fitHomography(
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    corners as Vec2[],
  );
  if (tableLab) {
    const nX = Math.round(W / cx.lag);
    const nY = Math.round(H / cy.lag);
    const cw = W / nX;
    const ch = H / nY;
    for (let j = 0; j < nY; j++)
      for (let i = 0; i < nX; i++) {
        // Most of the cell's middle is plain table (neighbours' knobs reach into a missing piece's
        // cell, so not all of it: owner's IMG_9280).
        let n = 0;
        let m = 0;
        let r = 0;
        let gg = 0;
        let b = 0;
        let s1 = 0;
        let s2 = 0;
        for (let y = Math.round((j + 0.25) * ch); y < (j + 0.75) * ch; y += 2)
          for (let x = Math.round((i + 0.25) * cw); x < (i + 0.75) * cw; x += 2) {
            const k = (y * W + x) * 4;
            n++;
            if (deltaE(rgbToLab(data[k]!, data[k + 1]!, data[k + 2]!), tableLab) >= GAP_PIXEL_DELTA_E) continue;
            m++;
            r += data[k]!;
            gg += data[k + 1]!;
            b += data[k + 2]!;
            const l = g[y * W + x]!;
            s1 += l;
            s2 += l * l;
          }
        if (!n || m < GAP_SHARE * n) continue;
        const lab = rgbToLab(r / m, gg / m, b / m);
        const sd = Math.sqrt(Math.max(0, s2 / m - (s1 / m) ** 2));
        if (deltaE(lab, tableLab) / GAP_DELTA_E + sd / GAP_SD < 1) {
          // In the reported orientation (turned: the straightened picture's x runs down the puzzle).
          // Turned: the puzzle's columns run down the straightened picture and its rows right to left.
          gaps.push(turnedNow ? [j, nX - 1 - i] : [i, j]);
          gapRect.push([i, j]);
          if (toPhoto) gapsPx.push(applyH(toPhoto, [(i + 0.5) / nX, (j + 0.5) / nY]));
        }
      }
  }
  let gapSides: string[] = [];
  if (tableLab && gapRect.length) {
    const nX = Math.round(W / cx.lag);
    const nY = Math.round(H / cy.lag);
    const sidesRect = holeSides(data, W, H, nX, nY, gapRect, tableLab);
    // Turned: the reported top is the straightened picture's right side, and so on round.
    gapSides = sidesRect.map((sd) => (turnedNow ? [1, 2, 3, 0].map((k) => sd[k]).join('') : sd));
  }
  return { cornersPx, aspect: rect.aspect, colsExact, rowsExact, cols, rows, seamStrength: Math.min(cx.strength, cy.strength), gaps, gapsPx, gapSides };
}

/**
 * The missing pieces' sides, from the holes' outlines in the straightened puzzle (`data`, W × H,
 * nX × nY cells). Where a hole borders a piece still in place, that piece's knob either reaches
 * into the hole (the missing piece had a knob in: 'b') or the hole reaches into it (knob out:
 * 't'). The side's true line is first found from the table edge away from the knob (the grid can
 * be a tenth of a piece off), then two boxes on the knob's axis are compared: table just outside
 * the line = knob out; piece just inside = knob in.
 */
function holeSides(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  nX: number,
  nY: number,
  gaps: Array<[number, number]>,
  tableLab: [number, number, number],
): string[] {
  const cw = W / nX;
  const ch = H / nY;
  const isGap = new Set(gaps.map(([i, j]) => j * nX + i));
  const table = (x: number, y: number): number | null => {
    const X = Math.round(x);
    const Y = Math.round(y);
    if (X < 0 || Y < 0 || X >= W || Y >= H) return null;
    const k = (Y * W + X) * 4;
    return deltaE(rgbToLab(data[k]!, data[k + 1]!, data[k + 2]!), tableLab) < GAP_PIXEL_DELTA_E ? 1 : 0;
  };
  return gaps.map(([i, j]) =>
    [0, 1, 2, 3]
      .map((d) => {
        const [di, dj] = [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ][d]!;
        const ni = i + di!;
        const nj = j + dj!;
        if (ni < 0 || nj < 0 || ni >= nX || nj >= nY) return 'f';
        if (isGap.has(nj * nX + ni)) return 'o';
        // Side middle, outward normal and the side's direction, in px; sizes across and along.
        const sN = d % 2 ? cw : ch;
        const sL = d % 2 ? ch : cw;
        const mx = (i + 0.5 + di! * 0.5) * cw;
        const my = (j + 0.5 + dj! * 0.5) * ch;
        const at = (t: number, u: number): number | null => table(mx + di! * t * sN - dj! * u * sL, my + dj! * t * sN + di! * u * sL);
        // The line: along normals away from the knob, how far the table reaches.
        const edges: number[] = [];
        for (const u of [-0.34, -0.28, 0.28, 0.34]) {
          let n = 0;
          let tab = 0;
          for (let t = -0.25; t <= 0.25; t += 0.01) {
            const v = at(t, u);
            if (v === null) continue;
            n++;
            tab += v;
          }
          if (n > 30) edges.push(-0.25 + (tab / n) * 0.5);
        }
        if (edges.length < 2) return '?';
        edges.sort((a, b) => a - b);
        const t0 = Math.max(-0.15, Math.min(0.15, (edges[(edges.length - 1) >> 1]! + edges[edges.length >> 1]!) / 2));
        const share = (a: number, b: number): number => {
          let n = 0;
          let s = 0;
          for (let t = a; t <= b; t += 0.02)
            for (let u = -0.07; u <= 0.0701; u += 0.035) {
              const v = at(t0 + t, u);
              if (v === null) continue;
              n++;
              s += v;
            }
          return n ? s / n : 0;
        };
        const out = share(0.1, 0.3);
        const intrude = 1 - share(-0.3, -0.1);
        if (out > intrude + HOLE_SIDE_MARGIN) return 't';
        if (intrude > out + HOLE_SIDE_MARGIN) return 'b';
        return '?';
      })
      .join(''),
  );
}

/** A hole side is read only when one kind's evidence (share of the box) beats the other's by this. */
const HOLE_SIDE_MARGIN = 0.2;

/**
 * The table-like part of the cell must be the table's colour and plain, together:
 * ΔE / GAP_DELTA_E + σ / GAP_SD < 1 (σ: 8-bit luma). Owner's photos: the 21 holes in IMG_9280
 * score 0.63–0.81 (ΔE ≤ 2.4, σ 2–8 with the hole edges' shadows); white and pale-blue print on
 * IMG_9272 / IMG_9280 ≥ 1.5 (ΔE 4–11).
 */
const GAP_DELTA_E = 5;
const GAP_SD = 12;
/** Table-like pixels (ΔE from the table below this) must be at least this share of the cell's middle. */
const GAP_PIXEL_DELTA_E = 15;
const GAP_SHARE = 0.55;

/** Median Lab of a ring 2–5 % of the puzzle's size outside its corners (the table around it). */
function ringLab(rgba: PixelBuffer, c: Point[]): [number, number, number] | null {
  const cx = (c[0]![0] + c[1]![0] + c[2]![0] + c[3]![0]) / 4;
  const cy = (c[0]![1] + c[1]![1] + c[2]![1] + c[3]![1]) / 4;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let e = 0; e < 4; e++) {
    const a = c[e]!;
    const b = c[(e + 1) % 4]!;
    for (let t = 0.1; t <= 0.9; t += 0.02)
      for (const f of [1.03, 1.05]) {
        const x = Math.round(cx + (a[0] + t * (b[0] - a[0]) - cx) * f);
        const y = Math.round(cy + (a[1] + t * (b[1] - a[1]) - cy) * f);
        if (x < 0 || y < 0 || x >= rgba.width || y >= rgba.height) continue;
        const k = y * rgba.stride + x * 4;
        rs.push(rgba.data[k]!);
        gs.push(rgba.data[k + 1]!);
        bs.push(rgba.data[k + 2]!);
      }
  }
  if (rs.length < 20) return null;
  const med = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1]!;
  return rgbToLab(med(rs), med(gs), med(bs));
}
