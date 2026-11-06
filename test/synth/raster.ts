/**
 * Small polygon helpers in plain JS (flat x,y arrays): area, centroid, bounding box, scanline
 * rasterisation and IoU. Used for ground truth (visible share, glare share), layout and scoring.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function bbox(poly: number[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    const x = poly[i]!;
    const y = poly[i + 1]!;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Signed area (positive = clockwise on screen, y down). */
export function signedArea(poly: number[]): number {
  let a = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += poly[2 * i]! * poly[2 * j + 1]! - poly[2 * j]! * poly[2 * i + 1]!;
  }
  return a / 2;
}

export function centroid(poly: number[]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = poly[2 * i]!;
    const y0 = poly[2 * i + 1]!;
    const x1 = poly[2 * j]!;
    const y1 = poly[2 * j + 1]!;
    const c = x0 * y1 - x1 * y0;
    a += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  if (Math.abs(a) < 1e-12) return [poly[0] ?? 0, poly[1] ?? 0];
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * Even-odd scanline fill sampled at cell centres: cell (i, j) covers
 * [x0 + i·cell, x0 + (i+1)·cell) × [y0 + j·cell, …). Returns w × h bytes (1 = inside).
 */
export function rasterize(poly: number[], x0: number, y0: number, cell: number, w: number, h: number, out?: Uint8Array): Uint8Array {
  const mask = out ?? new Uint8Array(w * h);
  const n = poly.length / 2;
  const xs: number[] = [];
  for (let j = 0; j < h; j++) {
    const y = y0 + (j + 0.5) * cell;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      const ay = poly[2 * i + 1]!;
      const by = poly[2 * k + 1]!;
      if (ay <= y === by <= y) continue;
      const ax = poly[2 * i]!;
      const bx = poly[2 * k]!;
      xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const row = j * w;
    for (let p = 0; p + 1 < xs.length; p += 2) {
      // Cells whose centre lies in [xs[p], xs[p+1]).
      const i0 = Math.max(0, Math.ceil((xs[p]! - x0) / cell - 0.5));
      const i1 = Math.min(w - 1, Math.ceil((xs[p + 1]! - x0) / cell - 0.5) - 1);
      for (let i = i0; i <= i1; i++) mask[row + i] = 1;
    }
  }
  return mask;
}

/** Intersection over union of two polygons, by rasterising both on a common grid of ~`res` cells across. */
export function polygonIoU(a: number[], b: number[], res = 256): number {
  const A = bbox(a);
  const B = bbox(b);
  if (A.x1 < B.x0 || B.x1 < A.x0 || A.y1 < B.y0 || B.y1 < A.y0) return 0;
  const x0 = Math.min(A.x0, B.x0);
  const y0 = Math.min(A.y0, B.y0);
  const x1 = Math.max(A.x1, B.x1);
  const y1 = Math.max(A.y1, B.y1);
  const cell = Math.max(x1 - x0, y1 - y0) / res;
  if (!(cell > 0)) return 0;
  const w = Math.ceil((x1 - x0) / cell) + 1;
  const h = Math.ceil((y1 - y0) / cell) + 1;
  const ma = rasterize(a, x0, y0, cell, w, h);
  const mb = rasterize(b, x0, y0, cell, w, h);
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < ma.length; i++) {
    const p = ma[i]!;
    const q = mb[i]!;
    if (p & q) inter++;
    if (p | q) uni++;
  }
  return uni ? inter / uni : 0;
}

export function pointInPolygon(poly: number[], x: number, y: number): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i]!;
    const yi = poly[2 * i + 1]!;
    const xj = poly[2 * j]!;
    const yj = poly[2 * j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Maps a flat polygon through a 3 × 3 homography. */
export function mapPoly(H: number[], poly: number[]): number[] {
  const out = new Array<number>(poly.length);
  for (let i = 0; i < poly.length; i += 2) {
    const x = poly[i]!;
    const y = poly[i + 1]!;
    const w = H[6]! * x + H[7]! * y + H[8]!;
    out[i] = (H[0]! * x + H[1]! * y + H[2]!) / w;
    out[i + 1] = (H[3]! * x + H[4]! * y + H[5]!) / w;
  }
  return out;
}

/** Rotates (degrees, clockwise on screen) and translates a flat polygon; mirror flips x first. */
export function placePoly(local: number[], cx: number, cy: number, angleDeg: number, mirror = false): number[] {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const n = local.length / 2;
  const out = new Array<number>(local.length);
  for (let i = 0; i < n; i++) {
    // Mirroring reverses the order so the polygon stays clockwise.
    const k = mirror ? n - 1 - i : i;
    const x = mirror ? -local[2 * k]! : local[2 * k]!;
    const y = local[2 * k + 1]!;
    out[2 * i] = cx + x * c - y * s;
    out[2 * i + 1] = cy + x * s + y * c;
  }
  return out;
}
