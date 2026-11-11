/**
 * After the scale is settled (src/cv/scanMarkerless.ts, M10 part 1): what the piece finder's blobs
 * really are — false pieces on the built picture, single pieces flagged as touching, touching pieces
 * split, and how many pieces a blob left touching holds (refineClumps). Pure JS on the decoded photo
 * and the found outlines (no OpenCV), so it runs in the reader worker and in Node tests alike.
 */
import type { PixelBuffer } from './frameAnalyser';
import { minAreaRect, type FoundPiece, type FoundRegion } from './pieceFinder';
import { readShape, READ_OK } from './shapeRead';
import { rgbToLab } from './tableModel';

// ---------------------------------------------------------------- geometry

export function polyArea(o: ArrayLike<number>): number {
  let a = 0;
  for (let i = 0, n = o.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += o[i]! * o[j + 1]! - o[j]! * o[i + 1]!;
  }
  return a / 2;
}

export function polyCentroid(o: ArrayLike<number>): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = o.length; i < n; i += 2) {
    const j = (i + 2) % n;
    const cr = o[i]! * o[j + 1]! - o[j]! * o[i + 1]!;
    a += cr;
    cx += (o[i]! + o[j]!) * cr;
    cy += (o[i + 1]! + o[j + 1]!) * cr;
  }
  if (Math.abs(a) < 1e-9) return [o[0] ?? 0, o[1] ?? 0];
  return [cx / (3 * a), cy / (3 * a)];
}

export function inPoly(o: ArrayLike<number>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, n = o.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = o[i]!;
    const yi = o[i + 1]!;
    const xj = o[j]!;
    const yj = o[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Convex hull (flat x, y), counter-clockwise in image axes. */
export function convexHull(o: ArrayLike<number>): number[] {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < o.length; i += 2) pts.push([o[i]!, o[i + 1]!]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts.flat();
  const cross = (o2: [number, number], a: [number, number], b: [number, number]) => (a[0] - o2[0]) * (b[1] - o2[1]) - (a[1] - o2[1]) * (b[0] - o2[0]);
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].flat();
}

function bboxOf(o: ArrayLike<number>): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < o.length; i += 2) {
    x0 = Math.min(x0, o[i]!);
    x1 = Math.max(x1, o[i]!);
    y0 = Math.min(y0, o[i + 1]!);
    y1 = Math.max(y1, o[i + 1]!);
  }
  return [x0, y0, x1, y1];
}

// ---------------------------------------------------------------- photo samples

function pixel(rgba: PixelBuffer, x: number, y: number): [number, number, number] {
  const q = y * rgba.stride + x * 4;
  return [rgba.data[q]!, rgba.data[q + 1]!, rgba.data[q + 2]!];
}

/** Mean colour and brightness spread (8-bit luma SD) of a (2r+1)² window. */
function patchStats(rgba: PixelBuffer, x: number, y: number, r: number): { rgb: [number, number, number]; sd: number } | null {
  if (x - r < 0 || y - r < 0 || x + r >= rgba.width || y + r >= rgba.height) return null;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let s1 = 0;
  let s2 = 0;
  let n = 0;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const [R, G, B] = pixel(rgba, x + dx, y + dy);
      sr += R;
      sg += G;
      sb += B;
      const l = (R + 2 * G + B) / 4;
      s1 += l;
      s2 += l * l;
      n++;
    }
  const m = s1 / n;
  return { rgb: [sr / n, sg / n, sb / n], sd: Math.sqrt(Math.max(0, s2 / n - m * m)) };
}

// ---------------------------------------------------------------- rasters

/** A blob rasterised in a box of the photo: pixel (u, v) ↔ photo (x0 + (u + 0.5)/s, y0 + (v + 0.5)/s). */
interface Raster {
  w: number;
  h: number;
  x0: number;
  y0: number;
  s: number;
  m: Uint8Array;
}

function rasterise(o: ArrayLike<number>, s: number): Raster {
  const [bx0, by0, bx1, by1] = bboxOf(o);
  const x0 = Math.floor(bx0) - 3;
  const y0 = Math.floor(by0) - 3;
  const w = Math.ceil((bx1 - x0 + 3) * s) + 1;
  const h = Math.ceil((by1 - y0 + 3) * s) + 1;
  const m = new Uint8Array(w * h);
  const n = o.length / 2;
  const xs: number[] = [];
  for (let v = 0; v < h; v++) {
    const y = y0 + (v + 0.5) / s;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = o[2 * i + 1]!;
      const yj = o[2 * j + 1]!;
      if (yi > y !== yj > y) xs.push(o[2 * i]! + ((o[2 * j]! - o[2 * i]!) * (y - yi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const u0 = Math.max(0, Math.ceil((xs[k]! - x0) * s - 0.5));
      const u1 = Math.min(w - 1, Math.floor((xs[k + 1]! - x0) * s - 0.5));
      for (let u = u0; u <= u1; u++) m[v * w + u] = 1;
    }
  }
  return { w, h, x0, y0, s, m };
}

/** Euclidean distance of every pixel to the nearest pixel with m = 0 (Felzenszwalb & Huttenlocher). */
function edt(m: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e12;
  const L = Math.max(w, h);
  const f = new Float64Array(L);
  const d = new Float64Array(L);
  const z = new Float64Array(L + 1);
  const vv = new Int32Array(L);
  const g = new Float64Array(w * h);
  for (let q = 0; q < w * h; q++) g[q] = m[q] ? INF : 0;
  const pass = (n: number) => {
    let k = 0;
    vv[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let sv = (f[q]! + q * q - (f[vv[k]!]! + vv[k]! * vv[k]!)) / (2 * q - 2 * vv[k]!);
      while (sv <= z[k]!) {
        k--;
        sv = (f[q]! + q * q - (f[vv[k]!]! + vv[k]! * vv[k]!)) / (2 * q - 2 * vv[k]!);
      }
      k++;
      vv[k] = q;
      z[k] = sv;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1]! < q) k++;
      d[q] = (q - vv[k]!) * (q - vv[k]!) + f[vv[k]!]!;
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x]!;
    pass(h);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y]!;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x]!;
    pass(w);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]!);
  }
  return out;
}

/** Chamfer (3-4) distance to the nearest pixel with m = 0, in pixels: ~10× cheaper than edt, within ~8 %. */
function chamfer(m: Uint8Array, w: number, h: number): Float32Array {
  const BIG = 1 << 28;
  const d = new Int32Array(w * h);
  for (let q = 0; q < w * h; q++) d[q] = m[q] ? BIG : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const q = y * w + x;
      let v = d[q]!;
      if (!v) continue;
      if (x > 0) v = Math.min(v, d[q - 1]! + 3);
      if (y > 0) {
        v = Math.min(v, d[q - w]! + 3);
        if (x > 0) v = Math.min(v, d[q - w - 1]! + 4);
        if (x < w - 1) v = Math.min(v, d[q - w + 1]! + 4);
      }
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) v = Math.min(v, 3);
      d[q] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const q = y * w + x;
      let v = d[q]!;
      if (!v) continue;
      if (x < w - 1) v = Math.min(v, d[q + 1]! + 3);
      if (y < h - 1) {
        v = Math.min(v, d[q + w]! + 3);
        if (x < w - 1) v = Math.min(v, d[q + w + 1]! + 4);
        if (x > 0) v = Math.min(v, d[q + w - 1]! + 4);
      }
      d[q] = v;
    }
  const out = new Float32Array(w * h);
  for (let q = 0; q < w * h; q++) out[q] = d[q]! / 3;
  return out;
}

const N8 = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;
const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** 8-connected components of m: label image and sizes (index 0 unused). */
function components(m: Uint8Array, w: number, h: number): { lab: Int32Array; size: number[] } {
  const lab = new Int32Array(w * h);
  const size = [0];
  const stack = new Int32Array(w * h);
  for (let q0 = 0; q0 < w * h; q0++) {
    if (!m[q0] || lab[q0]) continue;
    const id = size.length;
    let n = 0;
    let sp = 0;
    stack[sp++] = q0;
    lab[q0] = id;
    while (sp) {
      const q = stack[--sp]!;
      n++;
      const x = q % w;
      const y = (q - x) / w;
      const x0 = x > 0 ? -1 : 0;
      const x1 = x < w - 1 ? 1 : 0;
      const y0 = y > 0 ? -1 : 0;
      const y1 = y < h - 1 ? 1 : 0;
      for (let dy = y0; dy <= y1; dy++)
        for (let dx = x0; dx <= x1; dx++) {
          const r = q + dy * w + dx;
          if (m[r] && !lab[r]) {
            lab[r] = id;
            stack[sp++] = r;
          }
        }
    }
    size.push(n);
  }
  return { lab, size };
}

/** Keeps the largest 8-connected component of m (in place); returns its size. */
function keepLargest(m: Uint8Array, w: number, h: number): number {
  const { lab, size } = components(m, w, h);
  let best = 0;
  for (let i = 1; i < size.length; i++) if (size[i]! > (size[best] ?? 0)) best = i;
  for (let q = 0; q < w * h; q++) m[q] = best && lab[q] === best ? 1 : 0;
  return best ? size[best]! : 0;
}

/** Fills holes (background not 4-connected to the border). */
function fillHoles(m: Uint8Array, w: number, h: number): void {
  const out = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const seed = (q: number) => {
    if (!m[q] && !out[q]) {
      out[q] = 1;
      stack[sp++] = q;
    }
  };
  for (let x = 0; x < w; x++) (seed(x), seed((h - 1) * w + x));
  for (let y = 0; y < h; y++) (seed(y * w), seed(y * w + w - 1));
  while (sp) {
    const q = stack[--sp]!;
    const x = q % w;
    if (x > 0) seed(q - 1);
    if (x < w - 1) seed(q + 1);
    if (q >= w) seed(q - w);
    if (q < w * (h - 1)) seed(q + w);
  }
  for (let q = 0; q < w * h; q++) m[q] = out[q] ? 0 : 1;
}

/**
 * Thin spurs off a blob (a shadow line, a sliver of a neighbour): what an opening of radius r takes
 * away, where that is more than `minPx` pixels in one piece (the rounding of a corner is a few
 * pixels and stays).
 */
function cutSpurs(m: Uint8Array, w: number, h: number, r: number, minPx: number): void {
  const d = chamfer(m, w, h);
  const notEroded = new Uint8Array(w * h);
  for (let q = 0; q < w * h; q++) notEroded[q] = d[q]! > r ? 0 : 1;
  const d2 = chamfer(notEroded, w, h);
  const removed = new Uint8Array(w * h);
  for (let q = 0; q < w * h; q++) removed[q] = m[q] && d2[q]! > r ? 1 : 0;
  const { lab, size } = components(removed, w, h);
  for (let q = 0; q < w * h; q++) if (lab[q] && size[lab[q]!]! > minPx) m[q] = 0;
}

/** Outer boundary of a blob (one 8-connected component) along the pixel cracks, clockwise on screen. */
function traceBoundary(m: Uint8Array, w: number, h: number): number[] {
  let start = -1;
  for (let q = 0; q < w * h && start < 0; q++) if (m[q]) start = q;
  if (start < 0) return [];
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
  let x = start % w;
  let y = (start - x) / w;
  const sx = x;
  const sy = y;
  let dir = 0; // 0 +x, 1 +y, 2 −x, 3 −y; the blob is on the right
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  // The pixel ahead-right / ahead-left of vertex (x, y) when facing dir.
  const AR = [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, -1],
  ];
  const AL = [
    [0, -1],
    [0, 0],
    [-1, 0],
    [-1, -1],
  ];
  const pts: number[] = [];
  let guard = 0;
  do {
    pts.push(x, y);
    x += DX[dir]!;
    y += DY[dir]!;
    const R = at(x + AR[dir]![0]!, y + AR[dir]![1]!);
    const Lf = at(x + AL[dir]![0]!, y + AL[dir]![1]!);
    if (Lf)
      dir = (dir + 3) % 4; // blob ahead-left too: turn left (keeps diagonal neighbours together)
    else if (!R) dir = (dir + 1) % 4; // nothing ahead: turn right
    if (++guard > 4 * (w + 1) * (h + 1)) break;
  } while (!(x === sx && y === sy && dir === 0));
  return pts;
}

/** Douglas–Peucker on a closed polygon. */
function simplify(o: number[], eps: number): number[] {
  const n = o.length / 2;
  if (n < 8) return o;
  const keep = new Uint8Array(n);
  const P = (i: number): [number, number] => [o[2 * (i % n)]!, o[2 * (i % n) + 1]!];
  const rec = (a: number, b: number) => {
    const [ax, ay] = P(a);
    const [bx, by] = P(b);
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    let best = -1;
    let bd = eps;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = P(i);
      const dd = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L;
      if (dd > bd) [bd, best] = [dd, i];
    }
    if (best >= 0) {
      keep[best % n] = 1;
      rec(a, best);
      rec(best, b);
    }
  };
  const half = n >> 1;
  keep[0] = 1;
  keep[half] = 1;
  rec(0, half);
  rec(half, n);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(o[2 * i]!, o[2 * i + 1]!);
  return out;
}

/** A blob's outline in photo px: the crack boundary, smoothed to the cracks' midpoints. */
function outlineOf(r: Raster, m: Uint8Array): number[] {
  const c = traceBoundary(m, r.w, r.h);
  const n = c.length / 2;
  const mid: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mid.push((c[2 * i]! + c[2 * j]!) / 2, (c[2 * i + 1]! + c[2 * j + 1]!) / 2);
  }
  const simple = simplify(mid, 0.35);
  const out: number[] = [];
  for (let i = 0; i < simple.length; i += 2) out.push(r.x0 + simple[i]! / r.s, r.y0 + simple[i + 1]! / r.s);
  return out;
}

// ---------------------------------------------------------------- splitting one blob

/** Seeds from the distance map's peaks that stand out by at least h above the saddle to a higher one. */
function distancePeaks(d: Float32Array, m: Uint8Array, w: number, h: number, hMin: number): Array<{ q: number; dyn: number }> {
  const idx: number[] = [];
  for (let q = 0; q < w * h; q++) if (m[q]) idx.push(q);
  idx.sort((a, b) => d[b]! - d[a]!);
  const parent = new Int32Array(w * h).fill(-1);
  const peak = new Int32Array(w * h);
  const dyn = new Map<number, number>();
  const find = (q: number): number => {
    while (parent[q] !== q) {
      parent[q] = parent[parent[q]!]!;
      q = parent[q]!;
    }
    return q;
  };
  for (const q of idx) {
    const x = q % w;
    const y = (q - x) / w;
    const roots = new Set<number>();
    for (const [dx, dy] of N8) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const r = yy * w + xx;
      if (parent[r]! >= 0) roots.add(find(r));
    }
    if (!roots.size) {
      parent[q] = q;
      peak[q] = q;
      continue;
    }
    let top = -1;
    for (const r of roots) if (top < 0 || d[peak[r]!]! > d[peak[top]!]!) top = r;
    parent[q] = top;
    for (const r of roots) {
      if (r === top) continue;
      dyn.set(peak[r]!, d[peak[r]!]! - d[q]!);
      parent[r] = top;
    }
  }
  const out: Array<{ q: number; dyn: number }> = [];
  const seen = new Set<number>();
  for (const q of idx) {
    const r = find(q);
    if (seen.has(r)) continue;
    seen.add(r);
    out.push({ q: peak[r]!, dyn: Infinity });
  }
  for (const [q, v] of dyn) if (v >= hMin) out.push({ q, dyn: v });
  return out.sort((a, b) => b.dyn - a.dyn || d[b.q]! - d[a.q]!);
}

/** Marker flooding from the seeds in order of decreasing distance: the boundaries fall on the necks. */
function floodByDistance(d: Float32Array, m: Uint8Array, w: number, h: number, seeds: number[]): Int32Array {
  const lab = new Int32Array(w * h);
  const NB = 2048;
  let maxD = 0;
  for (let q = 0; q < w * h; q++) if (m[q] && d[q]! > maxD) maxD = d[q]!;
  const key = (q: number) => Math.min(NB - 1, Math.floor((d[q]! / (maxD || 1)) * (NB - 1)));
  const buckets: number[][] = Array.from({ length: NB }, () => []);
  seeds.forEach((q, j) => {
    lab[q] = j + 1;
    buckets[key(q)]!.push(q);
  });
  for (let b = NB - 1; b >= 0; b--) {
    const bk = buckets[b]!;
    while (bk.length) {
      const q = bk.pop()!;
      const x = q % w;
      const y = (q - x) / w;
      for (const [dx, dy] of N8) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const r = yy * w + xx;
        if (!m[r] || lab[r]) continue;
        lab[r] = lab[q]!;
        buckets[Math.min(b, key(r))]!.push(r);
      }
    }
  }
  return lab;
}

/** k-means on the blob's pixels (seeded from its interior, farthest first), then each pixel to its nearest seed along the blob. */
function geodesicRegions(d: Float32Array, m: Uint8Array, w: number, h: number, k: number): Int32Array {
  const pts: number[] = [];
  let maxD = 0;
  for (let q = 0; q < w * h; q++) if (m[q]) maxD = Math.max(maxD, d[q]!);
  const stride = Math.max(1, Math.round(Math.sqrt((w * h) / 6000)));
  for (let y = 0; y < h; y += stride) for (let x = 0; x < w; x += stride) if (m[y * w + x]) pts.push(x, y);
  const n = pts.length / 2;
  // Farthest-point start among interior pixels.
  const inner: number[] = [];
  for (let i = 0; i < n; i++) if (d[pts[2 * i + 1]! * w + pts[2 * i]!]! >= 0.5 * maxD) inner.push(i);
  let first = inner[0] ?? 0;
  for (const i of inner) if (d[pts[2 * i + 1]! * w + pts[2 * i]!]! > d[pts[2 * first + 1]! * w + pts[2 * first]!]!) first = i;
  const cx = [pts[2 * first]!];
  const cy = [pts[2 * first + 1]!];
  while (cx.length < k) {
    let best = -1;
    let bd = -1;
    for (const i of inner.length >= k ? inner : Array.from({ length: n }, (_, j) => j)) {
      let md = Infinity;
      for (let c = 0; c < cx.length; c++) md = Math.min(md, (pts[2 * i]! - cx[c]!) ** 2 + (pts[2 * i + 1]! - cy[c]!) ** 2);
      if (md > bd) [bd, best] = [md, i];
    }
    cx.push(pts[2 * best]!);
    cy.push(pts[2 * best + 1]!);
  }
  const asg = new Int32Array(n);
  for (let it = 0; it < 15; it++) {
    const sx = new Float64Array(k);
    const sy = new Float64Array(k);
    const sn = new Float64Array(k);
    for (let i = 0; i < n; i++) {
      let bc = 0;
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dd = (pts[2 * i]! - cx[c]!) ** 2 + (pts[2 * i + 1]! - cy[c]!) ** 2;
        if (dd < bd) [bd, bc] = [dd, c];
      }
      asg[i] = bc;
      sx[bc]! += pts[2 * i]!;
      sy[bc]! += pts[2 * i + 1]!;
      sn[bc]!++;
    }
    for (let c = 0; c < k; c++)
      if (sn[c]) {
        cx[c] = sx[c]! / sn[c]!;
        cy[c] = sy[c]! / sn[c]!;
      }
  }
  // Seeds: the blob pixel nearest each centre.
  const seeds: number[] = [];
  for (let c = 0; c < k; c++) {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const dd = (pts[2 * i]! - cx[c]!) ** 2 + (pts[2 * i + 1]! - cy[c]!) ** 2;
      if (dd < bd) [bd, best] = [dd, i];
    }
    seeds.push(pts[2 * best + 1]! * w + pts[2 * best]!);
  }
  // Geodesic nearest seed (chamfer 5/7, bucket queue).
  const dist = new Int32Array(w * h).fill(0x3fffffff);
  const lab = new Int32Array(w * h);
  // Dial's queue: steps cost 5 or 7, so 8 rotating buckets hold every pending distance.
  let ring: number[][] = Array.from({ length: 8 }, () => []);
  let pending = 0;
  const push = (q: number, v: number) => {
    ring[v % 8]!.push(q);
    pending++;
  };
  seeds.forEach((q, j) => {
    if (dist[q] === 0) return;
    dist[q] = 0;
    lab[q] = j + 1;
    push(q, 0);
  });
  for (let v = 0; pending; v++) {
    const b = ring[v % 8]!;
    if (!b.length) continue;
    ring[v % 8] = [];
    pending -= b.length;
    for (const q of b) {
      if (dist[q] !== v) continue;
      const x = q % w;
      const y = (q - x) / w;
      for (const [dx, dy] of N8) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const r = yy * w + xx;
        if (!m[r]) continue;
        const nv = v + (dx && dy ? 7 : 5);
        if (nv < dist[r]!) {
          dist[r] = nv;
          lab[r] = lab[q]!;
          push(r, nv);
        }
      }
    }
  }
  return lab;
}

// ---------------------------------------------------------------- the whole pass

/** Thresholds (owner's real photos, M10 part 1; see refineClumps). */
export const SPLIT = {
  /** Largest number of pieces a blob is split into (bigger piles stay "spread these apart"). */
  maxPieces: 5,
  /** Working resolution: a piece side at most this many raster pixels. */
  sidePx: 90,
  /** Where the cuts go is worked out at this many pixels per piece side. */
  coarsePx: 40,
  /** A distance-map peak counts as a piece's middle when it stands this × a piece side above its saddle. */
  peakDyn: 0.12,
  /** Each part: area within this range × the local single piece's… */
  partArea: [0.6, 1.32] as [number, number],
  /** A part under this × the local single piece is a piece found only in part (a pale piece on the cream table): marked weak + part, as PART_OUTLINE does. */
  partWhole: 0.72,
  /** …solidity within this range (a piece has knobs; a disc, like the coin, is ~1)… */
  partSolidity: [0.62, 0.94] as [number, number],
  /** …box no more elongated than this, and no longer than this × a piece side (the finder's clump length). */
  partAspect: 2.1,
  partLength: 1.9,
  /** The parts keep at least this share of the blob (spurs and slivers dropped). */
  partsCover: 0.9,
  /** Spurs: narrower than 2 × this (mm), and bigger than spurMm2, are cut off. */
  spurMm: 1,
  spurMm2: 2,
  /** A blob within this × a piece side of an assembled area is not split or un-flagged (an assembled bit, a piece joined to the puzzle). */
  nearAssembled: 0.3,
  /** Local single piece: log-area band round the plane (first round the median), its least width, and the clamp (× the median). */
  areaBand: 0.5,
  areaBandMin: 0.2,
  areaClamp: [0.5, 2.5] as [number, number],
  /** Rescue: a touching blob up to this × the local single piece that reads as one clean piece is one piece. */
  rescueArea: 1.6,
  /** Rescue with spurs and loose bits cut off only when they are less than this much of the blob (more: another piece, IMG_9246). */
  rescueKeep: 0.85,
  /** …or, up to longKnob.area × the local piece, with sides in longKnob.side × its side and knobs up to longKnob.bump × a side (IMG_9224 #8, #36: 1.0–1.02 × a piece, knobs 0.9–1.06 × a side; IMG_9274 #18, a piece with its cast shadow at 1.22, stays touching: as a single its outline no longer matched its own row on the next photo). */
  longKnob: { area: 1.1, side: [0.65, 1.3] as [number, number], bump: 1.15 },
  /**
   * Split into k only when the blob's size is clearly k pieces: within this of k (× the local piece). The owner's labelled photos
   * (review 2026-11-11, each part checked against the hand-counted piece centres): every right split had k − 0.35 … k + 0.27
   * (1.65–2.26 for 2, 2.73–3.25 for 3); the wrong ones on flat photos were 1.56 → 2 (IMG_9245 #17/#18, one piece) and 2.55 → 3
   * (IMG_9246 #29–#31, two pieces).
   */
  kMargin: 0.4,
  /**
   * The local single piece is trusted for splitting and for the count of a blob only when the clean single pieces off the built
   * picture agree with it: their areas ÷ the local piece's, upper quartile ÷ lower quartile, at most `spread` (from at least
   * `spreadMin` pieces), and the local piece changes across them by at most `across` (largest ÷ smallest). Owner's photos: flat
   * and tilted ones 1.12–1.33 (IMG_9224, tilted, 1.14, its local piece 2.2× larger at the near end than at the far end, its
   * splits right); the oblique IMG_9225/9226/9227 (out of spec: whole loose pieces near the camera 2–4× those at the far end,
   * most "single pieces" there fragments of the picture) 2.3 / 1.7 / 2.4: there single pieces were cut in 2–4.
   */
  sizeSpread: { spread: 1.5, spreadMin: 8, across: 3 },
};

export interface RefineContext {
  /**
   * Split touching pieces (step 3). Only on the first photo of a scan (an empty catalog): on a later
   * photo the same touching pieces would be cut a little differently each time, and the parts then
   * didn't match the rows of the pieces already known (synthetic val300 rescans: 30 → 57 pieces added
   * twice, 106 → 335 to check). There an outline of touching pieces stands for the known pieces whose
   * centres it covers (src/project/catalog.ts), as before.
   */
  split: boolean;
  /** A piece's top-face area (mm²) at the scale the scan settled on (its photo-centre scale). */
  pieceAreaMm2: number;
  /** Assembled areas and objects found with the pieces (photo px outlines). */
  regions: FoundRegion[];
}

/** Single-piece area (photo px²) across the photo: a trimmed plane fit of log(area) over clean single pieces (a tilted phone sees nearer pieces bigger). */
export function localPieceArea(pieces: FoundPiece[]): ((x: number, y: number) => number) | null {
  const pts = pieces
    .filter((p) => !p.flags.cut && !p.flags.clump && !p.flags.weak && !p.flags.part && p.sizeMm[0] > 0)
    .filter((p) => Math.max(p.sizeMm[0], p.sizeMm[1]) <= 1.6 * Math.min(p.sizeMm[0], p.sizeMm[1]))
    .map((p) => {
      const c = polyCentroid(p.outlineImg);
      return { x: c[0], y: c[1], l: Math.log(Math.abs(polyArea(p.outlineImg))) };
    })
    .filter((q) => Number.isFinite(q.l));
  if (pts.length < 5) return null;
  const ls = pts.map((q) => q.l).sort((a, b) => a - b);
  const med = ls[ls.length >> 1]!;
  // The band of "single piece" areas follows the plane: on the owner's tilted IMG_9224 whole pieces
  // range from 0.85× the median at the far end to 1.9× at the near end, so a band round the median
  // alone left out the near end's pieces (and their blobs then looked like two pieces).
  const span = Math.max(1, ...pts.map((q) => Math.hypot(q.x, q.y)));
  const at = (f: number[], q: { x: number; y: number }) => f[0]! + (f[1]! * q.x) / span + (f[2]! * q.y) / span;
  let f = [med, 0, 0];
  let band = SPLIT.areaBand;
  for (let iter = 0; iter < 4; iter++) {
    const use = pts.filter((q) => Math.abs(q.l - at(f, q)) < band);
    if (use.length < 12) break;
    const A = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const r = [0, 0, 0];
    for (const q of use) {
      const v = [1, q.x / span, q.y / span];
      for (let i = 0; i < 3; i++) {
        r[i]! += v[i]! * q.l;
        for (let j = 0; j < 3; j++) A[i]![j]! += v[i]! * v[j]!;
      }
    }
    const sol = solve3(A, r);
    if (!sol) break;
    f = sol;
    const res = use.map((q) => Math.abs(q.l - at(f, q))).sort((x, y) => x - y);
    band = Math.max(SPLIT.areaBandMin, 2.5 * 1.48 * res[res.length >> 1]!);
  }
  const lo = Math.exp(med) * SPLIT.areaClamp[0];
  const hi = Math.exp(med) * SPLIT.areaClamp[1];
  return (x, y) => Math.min(hi, Math.max(lo, Math.exp(at(f, { x, y }))));
}

function solve3(A: number[][], b: number[]): number[] | null {
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const k = M[r]![c]! / M[c]![c]!;
      for (let j = c; j < 4; j++) M[r]![j]! -= k * M[c]![j]!;
    }
  }
  return [M[0]![3]! / M[0]![0]!, M[1]![3]! / M[1]![1]!, M[2]![3]! / M[2]![2]!];
}

/** Least-squares affine map photo px → mm from a piece's own outline (its top-plane mapping, locally). */
function affineOf(p: FoundPiece): number[] | null {
  const n = Math.min(p.outlineImg.length, p.outlineMm.length) / 2;
  if (n < 3) return null;
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const v = [p.outlineImg[2 * i]!, p.outlineImg[2 * i + 1]!, 1];
    for (let a = 0; a < 3; a++) {
      bx[a]! += v[a]! * p.outlineMm[2 * i]!;
      by[a]! += v[a]! * p.outlineMm[2 * i + 1]!;
      for (let b = 0; b < 3; b++) A[a]![b]! += v[a]! * v[b]!;
    }
  }
  const sx = solve3(A, bx);
  const sy = solve3(A, by);
  return sx && sy ? [...sx, ...sy] : null;
}

function hullArea(o: number[]): number {
  return Math.abs(polyArea(convexHull(o)));
}

function rectOf(o: number[]): { long: number; short: number; angleDeg: number } {
  const h = convexHull(o);
  let best = { area: Infinity, a: 0, b: 0, ang: 0 };
  for (let i = 0; i < h.length; i += 2) {
    const j = (i + 2) % h.length;
    const ang = Math.atan2(h[j + 1]! - h[i + 1]!, h[j]! - h[i]!);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let k = 0; k < h.length; k += 2) {
      const u = h[k]! * c + h[k + 1]! * s;
      const v = -h[k]! * s + h[k + 1]! * c;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    if ((u1 - u0) * (v1 - v0) < best.area) best = { area: (u1 - u0) * (v1 - v0), a: u1 - u0, b: v1 - v0, ang };
  }
  return { long: Math.max(best.a, best.b), short: Math.min(best.a, best.b), angleDeg: (best.ang * 180) / Math.PI };
}

/** Distance from a point to a polygon's edges. */
function distToEdges(o: number[], x: number, y: number): number {
  let d = Infinity;
  for (let i = 0, n = o.length; i < n; i += 2) {
    const j = (i + 2) % n;
    const ex = o[j]! - o[i]!;
    const ey = o[j + 1]! - o[i + 1]!;
    const l2 = ex * ex + ey * ey || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - o[i]!) * ex + (y - o[i + 1]!) * ey) / l2));
    d = Math.min(d, Math.hypot(x - o[i]! - t * ex, y - o[i + 1]! - t * ey));
  }
  return d;
}

/** Ring samples around a box at distance d outside it, `steps` per side. */
function ringPoints(b: [number, number, number, number], d: number, steps: number): Array<[number, number]> {
  const [x0, y0, x1, y1] = [b[0] - d, b[1] - d, b[2] + d, b[3] + d];
  const out: Array<[number, number]> = [];
  for (let k = 0; k < steps; k++) {
    const t = k / steps;
    out.push([x0 + t * (x1 - x0), y0], [x1, y0 + t * (y1 - y0)], [x1 - t * (x1 - x0), y1], [x0, y1 - t * (y1 - y0)]);
  }
  return out;
}

/**
 * Whether the local single piece (localPieceArea) can be trusted on this photo (SPLIT.sizeSpread): the clean single pieces
 * agree with it, and it does not change too much across them (a photo taken at a steep angle).
 */
export function localSizeSure(pieces: FoundPiece[], A1: (x: number, y: number) => number): boolean {
  const L = SPLIT.sizeSpread;
  const at: Array<{ rel: number; a1: number }> = [];
  for (const p of pieces) {
    if (p.flags.cut || p.flags.clump || p.flags.weak || p.flags.part || p.outlineImg.length < 6) continue;
    const [x, y] = polyCentroid(p.outlineImg);
    const a1 = A1(x, y);
    at.push({ rel: Math.abs(polyArea(p.outlineImg)) / a1, a1 });
  }
  if (at.length < L.spreadMin) return false;
  const rel = at.map((q) => q.rel).sort((a, b) => a - b);
  const q = (f: number) => rel[Math.floor((rel.length - 1) * f)]!;
  const a1s = at.map((q2) => q2.a1);
  return q(0.75) <= L.spread * q(0.25) && Math.max(...a1s) <= L.across * Math.min(...a1s);
}

/** One clean piece by its shape alone: its outline scaled to `areaMm2` (a single piece's area) reads as one piece of that size. */
function shapedAsOnePiece(p: FoundPiece, areaMm2: number): boolean {
  if (!(p.areaMm2 > 0) || !(areaMm2 > 0)) return false;
  const f = Math.sqrt(areaMm2 / p.areaMm2);
  const [cx, cy] = polyCentroid(p.outlineMm);
  const o = p.outlineMm.map((v, j) => (j % 2 ? cy + (v - cy) * f : cx + (v - cx) * f));
  return readsAsOnePiece(o, areaMm2, Math.sqrt(areaMm2), SPLIT.rescueArea * areaMm2);
}

/** What refineClumps did (counts, for the scan's log and the tests). */
export interface RefineStats {
  dropped: number;
  rescued: number;
  split: number;
  parts: number;
  kept: number;
}

/** A found piece with a new outline (photo px), mapped to mm by the source blob's own local map. */
function withOutline(src: FoundPiece, outlineImg: number[], aff: number[], extra: Partial<FoundPiece>): FoundPiece {
  const outlineMm: number[] = [];
  for (let i = 0; i < outlineImg.length; i += 2) {
    const x = outlineImg[i]!;
    const y = outlineImg[i + 1]!;
    outlineMm.push(aff[0]! * x + aff[1]! * y + aff[2]!, aff[3]! * x + aff[4]! * y + aff[5]!);
  }
  const rect = minAreaRect(outlineMm);
  const [x0, y0, x1, y1] = bboxOf(outlineImg);
  return {
    ...src,
    outlineImg,
    outlineMm,
    centreMm: polyCentroid(outlineMm),
    areaMm2: Math.abs(polyArea(outlineMm)),
    sizeMm: rect.size,
    angleDeg: rect.angleDeg,
    bboxImg: [x0, y0, x1 - x0, y1 - y0],
    ...extra,
  };
}

/** One clean piece by its shape read: sides about a piece side long (as the M3 part 2 rule, at the given side and area). */
function readsAsOnePiece(outlineMm: number[], areaMm2: number, sideMm: number, maxAreaMm2: number): boolean {
  const rd = readShape(outlineMm, null);
  if (areaMm2 > maxAreaMm2 || !rd?.kind || rd.quality < READ_OK) return false;
  if (rd.sides.every((sd) => sd.lengthMm > 0.75 * sideMm && sd.lengthMm < 1.25 * sideMm && Math.max(sd.outMm, sd.inMm) < 0.55 * sd.lengthMm)) return true;
  // No bigger than one piece there: a piece with long knobs (owner's IMG_9224 #8 and #36: a knob
  // 0.9–1.06 × its side, sides 0.67–0.93 × the local piece's) is still one piece. Two whole pieces
  // are twice the area.
  const L = SPLIT.longKnob;
  return (
    areaMm2 <= L.area * sideMm * sideMm &&
    rd.sides.every((sd) => sd.lengthMm > L.side[0] * sideMm && sd.lengthMm < L.side[1] * sideMm && Math.max(sd.outMm, sd.inMm) < L.bump * sd.lengthMm)
  );
}

/**
 * Touching pieces and pieces on the built picture, once the scale is settled (M10 part 1; owner's
 * real photos, review 2026-11-10). In this order:
 *
 *  1. **False pieces on the built picture** are dropped: a blob whose middle lies inside an
 *     assembled area's convex hull and whose surroundings (ring samples off other found pieces) are
 *     printed: median brightness spread ≥ SURROUND.minSd, median ΔE ≥ SURROUND.minDeltaE from the
 *     table, and under SURROUND.maxPlain of the samples plain table; unless it reads as one clean
 *     piece. Measured on the owner's photos: false blobs IMG_9280 spread 6.3–33 (all but one ≥ 12),
 *     IMG_9281 18–25, IMG_9244 7–30, plain share ≤ 0.15 but one; real pieces in holes 1.1–3.9, inside
 *     IMG_9224's frame ≤ 6.7, beside it and in the lid plain share 0.22–0.41. The review's ring of
 *     assembled-area pixels (the finder's rule for pale blobs) dropped 0 of IMG_9280's 23 and 2 real
 *     pieces on IMG_9224: the false blobs sit where the print isn't part of the assembled blob at all.
 *     Here: IMG_9280 16 of 26 dropped, 9281 2 of 2, 9244 5 of 8, IMG_9224 1 assembled bit; no loose
 *     piece off the picture.
 *  2. **Single pieces flagged as touching** (a tilted photo's near pieces, long knobs, a sliver of a
 *     neighbour joined on): a blob up to SPLIT.rescueArea × the local single piece that reads as one
 *     clean piece — with spurs and loose bits cut off (that outline is then kept), or as found.
 *  3. **Touching pieces split** (on the first photo of a scan only: RefineContext.split): k = the blob's area ÷ the local single piece's (never more than by
 *     the scale alone), rounded, 2 to SPLIT.maxPieces, and only when that ratio is within SPLIT.kMargin of k and the local single
 *     piece can be trusted on this photo (SPLIT.sizeSpread: not on a photo taken at a steep angle). Where the cuts go is worked out on a coarse
 *     copy: the distance map's k most distinct peaks flooded downhill, so the cuts fall on the necks;
 *     if it has fewer than k distinct peaks or that fails, k-means seeds and the regions nearest each
 *     along the blob — only for the blob's own k. Every part must be piece-shaped (SPLIT.part*:
 *     size, solidity, length; spurs cut off), else the blob stays one ("spread these apart"). Parts
 *     are marked `split`, with the cut (`cutImg`) so the side along it is not read (readPiece); a
 *     part under SPLIT.partWhole of a piece is a piece found only in part (`weak` + `part`).
 *  4. Blobs left touching get `touching`: about how many pieces they hold (by area, as in step 3; 1 for a blob shaped like one
 *     clean piece where the local single piece can't be trusted).
 *
 * Blobs within SPLIT.nearAssembled of an assembled area or with printed surroundings on part of
 * their ring (assembled bits, pieces against the puzzle) and round blobs (the coin) are left as they
 * are. The "local single piece" is a plane fit of the clean single pieces' areas across the photo (a
 * tilted phone sees nearer pieces bigger), from the pieces off the built picture.
 *
 * Owner's photos (cv-real-counts.test.ts, 479 pieces counted by eye): outlined one by one 252 → 300,
 * false pieces 43 → 22; IMG_9127 27 → 49 of 60. About 0.02–0.06 s a photo on the Mac.
 */
export function refineClumps(rgba: PixelBuffer, pieces: FoundPiece[], ctx: RefineContext): { pieces: FoundPiece[]; stats: RefineStats } {
  const stats: RefineStats = { dropped: 0, rescued: 0, split: 0, parts: 0, kept: 0 };
  const A0 = localPieceArea(pieces);
  if (!A0) return { pieces, stats };
  const assembled = ctx.regions.filter((g) => g.kind === 'assembled' && g.outlineImg.length >= 6);
  const hulls = assembled.map((g) => convexHull(g.outlineImg));
  const boxes = pieces.map((p) => bboxOf(p.outlineImg));
  const centres = pieces.map((p) => polyCentroid(p.outlineImg));
  const sideAt = (x: number, y: number) => Math.sqrt(A0(x, y));

  // 1. False pieces on the built picture.
  // A blob that reads as one clean piece is a piece, even lying on the picture (owner's IMG_9244: a
  // loose piece put down on the built picture).
  const whole = (i: number) => {
    const p = pieces[i]!;
    const aff = affineOf(p);
    if (!aff || p.flags.clump) return false;
    const mmPerPx = Math.sqrt(Math.abs(aff[0]! * aff[4]! - aff[1]! * aff[3]!));
    const a1Mm = A0(centres[i]![0], centres[i]![1]) * mmPerPx * mmPerPx;
    return readsAsOnePiece(p.outlineMm, p.areaMm2, Math.sqrt(a1Mm), SPLIT.rescueArea * a1Mm);
  };
  const { drop, printed } = onPicture(rgba, pieces, boxes, centres, hulls, sideAt, whole);
  stats.dropped = drop.size;
  // The local single piece again, from the pieces off the built picture only: on the owner's oblique
  // IMG_9225/9227 most "single pieces" are fragments of the picture, and whole loose pieces then looked
  // like 2–4 pieces each.
  const loose = pieces.filter((_, i) => !drop.has(i) && (printed.get(i) ?? 0) < SURROUND.nearShare);
  const A1 = localPieceArea(loose) ?? A0;
  // Review 2026-11-11: on a photo where it can't be trusted (steep angle), no blob is split, and one shaped like a single piece counts as one.
  const sizeSure = localSizeSure(loose, A1);

  const out: FoundPiece[] = [];
  pieces.forEach((p, i) => {
    if (drop.has(i)) return;
    if (!p.flags.clump || p.flags.cut || p.outlineImg.length < 6) {
      out.push(p);
      return;
    }
    const [cx, cy] = centres[i]!;
    const a1 = A1(cx, cy);
    const side = Math.sqrt(a1);
    const areaPx = Math.abs(polyArea(p.outlineImg));
    // Pieces it holds: by the local single piece, but never more than by the scale itself (on the owner's
    // oblique IMG_9225/9226 the "single pieces" near the far end are fragments of the picture, and whole
    // loose pieces at the near end then looked like 3 pieces each and were cut in 3).
    const rel = Math.min(areaPx / a1, p.areaMm2 / ctx.pieceAreaMm2);
    // Where the local piece can't be trusted, a blob shaped like one clean piece (its outline scaled to a single piece's area at the
    // photo's centre) counts as one: on the owner's oblique IMG_9227 whole loose pieces near the camera counted 2–3 each ("Found about 68").
    const touching = !sizeSure && shapedAsOnePiece(p, ctx.pieceAreaMm2) ? 1 : Math.max(1, Math.round(rel));
    const est = { ...p, flags: { ...p.flags, touching } };
    // Next to the built picture: close to an assembled area's outline, or (inside its outline, where
    // the holes are not drawn) with printed surroundings on part of its ring.
    const near =
      (printed.get(i) ?? 0) >= SURROUND.nearShare ||
      assembled.some((g, j) => {
        const b = boxes[i]!;
        const hb = bboxOf(hulls[j]!);
        const d = SPLIT.nearAssembled * side;
        if (b[2] < hb[0] - d || b[0] > hb[2] + d || b[3] < hb[1] - d || b[1] > hb[3] + d) return false;
        for (let k = 0; k < p.outlineImg.length; k += 8) if (distToEdges(g.outlineImg, p.outlineImg[k]!, p.outlineImg[k + 1]!) < d) return true;
        return false;
      });
    const solidity = areaPx / Math.max(1, hullArea(p.outlineImg));
    const aff = affineOf(p);
    if (near || solidity > SPLIT.partSolidity[1] || !aff) {
      stats.kept++;
      out.push(est);
      return;
    }
    const mmPerPx = Math.sqrt(Math.abs(aff[0]! * aff[4]! - aff[1]! * aff[3]!));
    const a1Mm = a1 * mmPerPx * mmPerPx;
    const sideMm = Math.sqrt(a1Mm);
    const s = Math.min(1, SPLIT.sidePx / side);
    const r = rasterise(p.outlineImg, s);
    const sideR = side * s;
    const spurR = Math.max(1, Math.round((SPLIT.spurMm / mmPerPx) * s));
    const spurMin = Math.round((SPLIT.spurMm2 / (mmPerPx * mmPerPx)) * s * s);

    // 2. One piece flagged as touching.
    if (rel < SPLIT.rescueArea) {
      // Its outline cleaned first: spurs and loose bits (a sliver of a neighbour joined on, IMG_9127 #42)
      // cut off, and loops of the traced outline that cross it filled (they hide the middle of the piece).
      const m = r.m.slice();
      keepLargest(m, r.w, r.h);
      cutSpurs(m, r.w, r.h, spurR, spurMin);
      const n = keepLargest(m, r.w, r.h);
      fillHoles(m, r.w, r.h);
      let all = 0;
      let filled = 0;
      for (let q = 0; q < r.w * r.h; q++) {
        all += r.m[q]!;
        filled += m[q]!;
      }
      const changed = n < 0.98 * all || filled > 1.02 * n;
      if (changed && n >= SPLIT.rescueKeep * all) {
        const q = withOutline(p, outlineOf(r, m), aff, { flags: { ...p.flags, clump: false } });
        if (readsAsOnePiece(q.outlineMm, q.areaMm2, sideMm, SPLIT.rescueArea * a1Mm)) {
          stats.rescued++;
          out.push(q);
          return;
        }
      }
      if (readsAsOnePiece(p.outlineMm, p.areaMm2, sideMm, SPLIT.rescueArea * a1Mm)) {
        stats.rescued++;
        out.push({ ...p, flags: { ...p.flags, clump: false } });
        return;
      }
    }

    // 3. Touching pieces split.
    const k = Math.round(rel);
    const clearly = sizeSure && Math.abs(rel - k) <= SPLIT.kMargin;
    const parts = ctx.split && clearly && k >= 2 && k <= SPLIT.maxPieces ? splitBlob(rgba, r, p, aff, k, sideR, spurR, spurMin) : null;
    if (parts) {
      stats.split++;
      stats.parts += parts.length;
      out.push(...parts);
      return;
    }
    stats.kept++;
    out.push(est);
  });
  return { pieces: out, stats };
}

/** Thresholds for the surroundings of a blob on the built picture (refineClumps step 1). */
export const SURROUND = {
  /** Ring distances outside the blob's box (× a piece side) and samples per box side. */
  ring: [0.3, 0.5] as [number, number],
  steps: 12,
  /** Patch radius for each sample (× a piece side). */
  patch: 0.04,
  /** Printed surroundings: median brightness spread (8-bit luma SD) and median ΔE from the table at least these. */
  minSd: 8,
  minDeltaE: 10,
  /** …and under this share of its samples plain table (spread < plainSd, ΔE < plainDeltaE): pieces beside the built puzzle have
   *  table on their open side (owner's IMG_9224: 0.22–0.41 next to the frame and in the lid; false ones on IMG_9280/9281/9244 ≤ 0.15
   *  but one at 0.34). */
  maxPlain: 0.2,
  plainSd: 6,
  plainDeltaE: 15,
  /** At least this many samples off other pieces. */
  minSamples: 16,
  /** A blob inside an assembled area's outline with at least this share of printed samples around it touches the picture: not split or un-flagged. */
  nearShare: 0.15,
};

function onPicture(
  rgba: PixelBuffer,
  pieces: FoundPiece[],
  boxes: Array<[number, number, number, number]>,
  centres: Array<[number, number]>,
  hulls: number[][],
  sideAt: (x: number, y: number) => number,
  whole: (i: number) => boolean,
): { drop: Set<number>; printed: Map<number, number> } {
  const drop = new Set<number>();
  const printed = new Map<number, number>();
  if (!hulls.length) return { drop, printed };
  const inHull = (x: number, y: number) => hulls.some((h) => inPoly(h, x, y));
  const cand = pieces.map((p, i) => !p.flags.cut && inHull(centres[i]![0], centres[i]![1]));
  if (!cand.some(Boolean)) return { drop, printed };
  const onPiece = (x: number, y: number, self: number) =>
    pieces.some((p, j) => j !== self && x >= boxes[j]![0] && x <= boxes[j]![2] && y >= boxes[j]![1] && y <= boxes[j]![3] && inPoly(p.outlineImg, x, y));
  const sample = (i: number, d: number, steps: number) => {
    const side = sideAt(centres[i]![0], centres[i]![1]);
    const r = Math.max(2, Math.round(SURROUND.patch * side));
    const out: Array<{ rgb: [number, number, number]; sd: number }> = [];
    for (const [x, y] of ringPoints(boxes[i]!, d * side, steps)) {
      if (onPiece(x, y, i)) continue;
      const s = patchStats(rgba, Math.round(x), Math.round(y), r);
      if (s) out.push(s);
    }
    return out;
  };
  // The table's colour: around the clean single pieces off the built picture (all of them if too few).
  const clean = pieces.map((p, i) => i).filter((i) => !pieces[i]!.flags.cut && !pieces[i]!.flags.clump && !pieces[i]!.flags.weak);
  let around = clean.filter((i) => !cand[i]).flatMap((i) => sample(i, SURROUND.ring[0], 6));
  if (around.length < 20) around = clean.flatMap((i) => sample(i, SURROUND.ring[0], 6));
  if (around.length < 20) return { drop, printed };
  const med = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]!;
  const t = rgbToLab(med(around.map((s) => s.rgb[0])), med(around.map((s) => s.rgb[1])), med(around.map((s) => s.rgb[2])));
  pieces.forEach((_, i) => {
    if (!cand[i]) return;
    const ss = SURROUND.ring.flatMap((d) => sample(i, d, SURROUND.steps));
    if (ss.length < SURROUND.minSamples) return;
    const des = ss.map((s) => {
      const L = rgbToLab(s.rgb[0], s.rgb[1], s.rgb[2]);
      return Math.hypot(L[0] - t[0], L[1] - t[1], L[2] - t[2]);
    });
    const sd = med(ss.map((s) => s.sd));
    const plain = ss.filter((s, k) => s.sd < SURROUND.plainSd && des[k]! < SURROUND.plainDeltaE).length / ss.length;
    if (sd >= SURROUND.minSd && med(des) >= SURROUND.minDeltaE && plain < SURROUND.maxPlain && !whole(i)) drop.add(i);
    printed.set(i, ss.filter((s, k) => s.sd >= SURROUND.minSd && des[k]! >= SURROUND.minDeltaE).length / ss.length);
  });
  return { drop, printed };
}

/** Splits one blob into k piece-shaped parts, or null. */
function splitBlob(rgba: PixelBuffer, r: Raster, p: FoundPiece, aff: number[], k: number, sideR: number, spurR: number, spurMin: number): FoundPiece[] | null {
  // Where the cuts go is decided on a coarse copy (SPLIT.coarsePx per piece side: the distance map,
  // its peaks and the flooding cost ~10× less), the parts are then cut and cleaned at the working
  // resolution.
  const sc = Math.min(r.s, (SPLIT.coarsePx * r.s) / sideR);
  const c = rasterise(p.outlineImg, sc);
  const { w, h } = c;
  const m = c.m;
  keepLargest(m, w, h);
  const d = edt(m, w, h);
  const sideC = (sideR * sc) / r.s;
  const tries: Array<() => Int32Array> = [];
  const peaks = distancePeaks(d, m, w, h, SPLIT.peakDyn * sideC);
  if (peaks.length >= k)
    tries.push(() =>
      floodByDistance(
        d,
        m,
        w,
        h,
        peaks.slice(0, k).map((q) => q.q),
      ),
    );
  tries.push(() => geodesicRegions(d, m, w, h, k));
  for (const run of tries) {
    const parts = partsOf(rgba, r, p, aff, toFine(run(), c, r), k, sideR, spurR, spurMin);
    if (parts) return parts;
  }
  return null;
}

/** A coarse label image carried over to the working raster (nearest coarse pixel; gaps filled from neighbours). */
function toFine(lab: Int32Array, c: Raster, r: Raster): Int32Array {
  const out = new Int32Array(r.w * r.h);
  const k = c.s / r.s;
  let open = 0;
  for (let v = 0; v < r.h; v++)
    for (let u = 0; u < r.w; u++) {
      const q = v * r.w + u;
      if (!r.m[q]) continue;
      const uc = Math.floor((r.x0 - c.x0) * c.s + (u + 0.5) * k);
      const vc = Math.floor((r.y0 - c.y0) * c.s + (v + 0.5) * k);
      if (uc >= 0 && vc >= 0 && uc < c.w && vc < c.h) out[q] = lab[vc * c.w + uc]!;
      if (!out[q]) open++;
    }
  for (let pass = 0; open && pass < 20; pass++) {
    const fill: number[] = [];
    for (let q = 0; q < r.w * r.h; q++) {
      if (!r.m[q] || out[q]) continue;
      const x = q % r.w;
      const y = (q - x) / r.w;
      for (const [dx, dy] of N4) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < r.w && yy < r.h && out[yy * r.w + xx]) {
          fill.push(q, out[yy * r.w + xx]!);
          break;
        }
      }
    }
    for (let i = 0; i < fill.length; i += 2) out[fill[i]!] = fill[i + 1]!;
    open -= fill.length / 2;
    if (!fill.length) break;
  }
  return out;
}

function partsOf(
  rgba: PixelBuffer,
  r: Raster,
  p: FoundPiece,
  aff: number[],
  lab: Int32Array,
  k: number,
  sideR: number,
  spurR: number,
  spurMin: number,
): FoundPiece[] | null {
  const { w, h } = r;
  const a1R = sideR * sideR;
  let total = 0;
  for (let q = 0; q < w * h; q++) total += r.m[q]!;
  let kept = 0;
  const outlines: Array<{ o: number[]; m: Uint8Array; sub: Raster; cut: number[]; rel: number }> = [];
  for (let j = 1; j <= k; j++) {
    // Each part in its own box (a few pixels round it): the cleaning passes then cost ~1/k each.
    let u0 = w;
    let v0 = h;
    let u1 = -1;
    let v1 = -1;
    for (let q = 0; q < w * h; q++)
      if (lab[q] === j) {
        const x = q % w;
        const y = (q - x) / w;
        if (x < u0) u0 = x;
        if (x > u1) u1 = x;
        if (y < v0) v0 = y;
        if (y > v1) v1 = y;
      }
    if (u1 < 0) return null;
    u0 = Math.max(0, u0 - 2);
    v0 = Math.max(0, v0 - 2);
    u1 = Math.min(w - 1, u1 + 2);
    v1 = Math.min(h - 1, v1 + 2);
    const sw = u1 - u0 + 1;
    const sh = v1 - v0 + 1;
    const m = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) m[y * sw + x] = lab[(y + v0) * w + x + u0] === j ? 1 : 0;
    const sub: Raster = { w: sw, h: sh, x0: r.x0 + u0 / r.s, y0: r.y0 + v0 / r.s, s: r.s, m };
    keepLargest(m, sw, sh);
    cutSpurs(m, sw, sh, spurR, spurMin);
    const n = keepLargest(m, sw, sh);
    fillHoles(m, sw, sh);
    const rel = n / a1R;
    if (rel < SPLIT.partArea[0] || rel > SPLIT.partArea[1]) return null;
    const o = outlineOf(sub, m);
    if (o.length < 12) return null;
    const area = Math.abs(polyArea(o)) * r.s * r.s;
    const solidity = area / Math.max(1, hullArea(o) * r.s * r.s);
    if (solidity < SPLIT.partSolidity[0] || solidity > SPLIT.partSolidity[1]) return null;
    const rc = rectOf(o);
    if (rc.long > SPLIT.partAspect * rc.short || rc.long * r.s > SPLIT.partLength * sideR) return null;
    {
      const mm: number[] = [];
      for (let i = 0; i < o.length; i += 2) mm.push(aff[0]! * o[i]! + aff[1]! * o[i + 1]! + aff[2]!, aff[3]! * o[i]! + aff[4]! * o[i + 1]! + aff[5]!);
      const rd = readShape(mm, null);
    }
    // The cut: this part's pixels next to another part.
    const cut: number[] = [];
    for (let q = 0; q < w * h; q++) {
      if (lab[q] !== j) continue;
      const x = q % w;
      const y = (q - x) / w;
      const other = (r: number) => lab[r]! > 0 && lab[r] !== j;
      if ((x > 0 && other(q - 1)) || (x < w - 1 && other(q + 1)) || (y > 0 && other(q - w)) || (y < h - 1 && other(q + w)))
        cut.push(r.x0 + (x + 0.5) / r.s, r.y0 + (y + 0.5) / r.s);
    }
    kept += n;
    outlines.push({ o, m, sub, cut: thin(cut, 48), rel });
  }
  if (kept < SPLIT.partsCover * total) return null;
  // Colour of each part: the blob's colour (white-balanced by the finder) moved by how this part differs from the whole blob in the photo.
  const all = meanRgb(rgba, r, r.m);
  return outlines.map(({ o, m, sub, cut, rel }) => {
    const mine = meanRgb(rgba, sub, m);
    let meanLab = p.meanLab;
    if (all && mine) {
      const a = rgbToLab(...all);
      const b = rgbToLab(...mine);
      meanLab = [p.meanLab[0] + b[0] - a[0], p.meanLab[1] + b[1] - a[1], p.meanLab[2] + b[2] - a[2]];
    }
    const { touching: _t, ...flags } = p.flags;
    void _t;
    const partly = rel < SPLIT.partWhole ? { weak: true, part: true } : {};
    return withOutline(p, o, aff, { flags: { ...flags, ...partly, clump: false, split: true }, meanLab, cutImg: cut });
  });
}

function thin(pts: number[], max: number): number[] {
  const n = pts.length / 2;
  if (n <= max) return pts;
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const j = Math.floor((i * n) / max);
    out.push(pts[2 * j]!, pts[2 * j + 1]!);
  }
  return out;
}

/** Mean photo colour over a blob's inner pixels (≥ 2 raster px from its edge). */
function meanRgb(rgba: PixelBuffer, r: Raster, m: Uint8Array): [number, number, number] | null {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  const w = r.w;
  for (let v = 2; v < r.h - 2; v += 2)
    for (let u = 2; u < w - 2; u += 2) {
      const q = v * w + u;
      if (!m[q] || !m[q - 2] || !m[q + 2] || !m[q - 2 * w] || !m[q + 2 * w]) continue;
      const x = Math.round(r.x0 + (u + 0.5) / r.s);
      const y = Math.round(r.y0 + (v + 0.5) / r.s);
      if (x < 0 || y < 0 || x >= rgba.width || y >= rgba.height) continue;
      const [R, G, B] = pixel(rgba, x, y);
      sr += R;
      sg += G;
      sb += B;
      n++;
    }
  return n ? [sr / n, sg / n, sb / n] : null;
}
