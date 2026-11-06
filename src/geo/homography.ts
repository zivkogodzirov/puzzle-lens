/**
 * Plane-to-plane mappings (homographies) in plain TypeScript: no OpenCV, so they run anywhere
 * (main thread, any worker, Node tests) and cost nothing per frame. PLAN §3.2.
 *
 * Mat3 is a 3 × 3 matrix in row-major order. A point (x, y) maps to
 * ((h0 x + h1 y + h2) / w, (h3 x + h4 y + h5) / w), w = h6 x + h7 y + h8.
 */
import type { Mat3, Vec2 } from '../project/types';

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function applyH(H: Mat3, p: Vec2): Vec2 {
  const w = H[6]! * p[0] + H[7]! * p[1] + H[8]!;
  return [(H[0]! * p[0] + H[1]! * p[1] + H[2]!) / w, (H[3]! * p[0] + H[4]! * p[1] + H[5]!) / w];
}

export function mulH(A: Mat3, B: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) out[r * 3 + c] = A[r * 3]! * B[c]! + A[r * 3 + 1]! * B[3 + c]! + A[r * 3 + 2]! * B[6 + c]!;
  return out;
}

export function invertH(H: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = H as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return normaliseH(inv.map((v) => v / det));
}

/** Scales H so that h8 = 1 (when possible), which keeps numbers comparable. */
export function normaliseH(H: Mat3): Mat3 {
  const s = Math.abs(H[8]!) > 1e-12 ? H[8]! : Math.hypot(...H);
  return H.map((v) => v / s);
}

/** Similarity that moves the points' centroid to 0 and their mean distance to √2 (Hartley). */
function normaliser(pts: Vec2[]): Mat3 {
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p[0];
    my += p[1];
  }
  mx /= pts.length;
  my /= pts.length;
  let d = 0;
  for (const p of pts) d += Math.hypot(p[0] - mx, p[1] - my);
  d /= pts.length;
  const s = d > 1e-12 ? Math.SQRT2 / d : 1;
  return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
}

/** Solves the n × n system M x = v in place (Gaussian elimination with partial pivoting). */
export function solveLinear(M: number[][], v: number[]): number[] | null {
  const n = v.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    [v[col], v[piv]] = [v[piv]!, v[col]!];
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / M[col]![col]!;
      if (f === 0) continue;
      for (let c = col; c < n; c++) M[r]![c]! -= f * M[col]![c]!;
      v[r]! -= f * v[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = v[r]!;
    for (let c = r + 1; c < n; c++) s -= M[r]![c]! * x[c]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}

/**
 * Least-squares homography mapping src[i] → dst[i] (≥ 4 pairs, not all on a line), by the
 * normalised direct linear method with h8 = 1. Returns null for degenerate input.
 */
export function fitHomography(src: Vec2[], dst: Vec2[]): Mat3 | null {
  const n = src.length;
  if (n < 4 || dst.length !== n) return null;
  const Ts = normaliser(src);
  const Td = normaliser(dst);
  const s = src.map((p) => applyH(Ts, p));
  const d = dst.map((p) => applyH(Td, p));
  // Normal equations AᵀA h = Aᵀb for the 8 unknowns.
  const AtA = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const Atb = new Array<number>(8).fill(0);
  const addRow = (row: number[], b: number) => {
    for (let i = 0; i < 8; i++) {
      if (row[i] === 0) continue;
      Atb[i]! += row[i]! * b;
      for (let j = 0; j < 8; j++) AtA[i]![j]! += row[i]! * row[j]!;
    }
  };
  for (let i = 0; i < n; i++) {
    const [x, y] = s[i]!;
    const [u, v] = d[i]!;
    addRow([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    addRow([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solveLinear(AtA, Atb);
  if (!h || h.some((v) => !Number.isFinite(v))) return null;
  const Hn = [...h, 1];
  const TdInv = invertH(Td);
  if (!TdInv) return null;
  return normaliseH(mulH(TdInv, mulH(Hn, Ts)));
}

export function reprojectionErrors(H: Mat3, src: Vec2[], dst: Vec2[]): number[] {
  return src.map((p, i) => {
    const q = applyH(H, p);
    return Math.hypot(q[0] - dst[i]![0], q[1] - dst[i]![1]);
  });
}

export function rms(values: number[]): number {
  if (!values.length) return 0;
  return Math.sqrt(values.reduce((a, v) => a + v * v, 0) / values.length);
}

/**
 * Homography from point groups (e.g. the 4 corners of each marker), robust to whole groups that
 * are wrong (a marker that was moved or misread): fits with all groups, then repeatedly drops the
 * group with the largest error while it is above `maxErr`, refitting each time. With few groups
 * this is as good as RANSAC and fully deterministic.
 */
export function fitHomographyGroups(
  groups: Array<{ key: number; src: Vec2[]; dst: Vec2[] }>,
  maxErr: number,
): { H: Mat3; used: number[]; dropped: number[]; rms: number } | null {
  let active = groups.filter((g) => g.src.length === g.dst.length && g.src.length > 0);
  const dropped: number[] = [];
  for (;;) {
    const src = active.flatMap((g) => g.src);
    const dst = active.flatMap((g) => g.dst);
    const H = fitHomography(src, dst);
    if (!H) return null;
    let worst = -1;
    let worstErr = 0;
    active.forEach((g, i) => {
      const e = Math.max(...reprojectionErrors(H, g.src, g.dst));
      if (e > worstErr) {
        worstErr = e;
        worst = i;
      }
    });
    // Keep at least one group: with one marker there is nothing to compare it with.
    if (worstErr <= maxErr || active.length <= 1) {
      return { H, used: active.map((g) => g.key), dropped, rms: rms(reprojectionErrors(H, src, dst)) };
    }
    dropped.push(active[worst]!.key);
    active = active.filter((_, i) => i !== worst);
  }
}
