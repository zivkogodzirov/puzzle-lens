/**
 * Marker-free registration (owner's decision: no printed markers): the pieces already in the
 * catalog are the reference. A new photo's pieces (in its own provisional mm) are matched to the
 * catalog's pieces (catalog mm) and a photo → catalog homography is fitted. Plain TypeScript,
 * deterministic (seeded), no OpenCV.
 *
 * Method:
 *  1. Shortlist: for each usable found piece (not cut, not a clump), the catalog pieces with the
 *     most similar colour (mean Lab relative to the table + 8-bin hue histogram). Scale is unknown,
 *     so size is not used here.
 *  2. Hypotheses: a found piece f1 and one of its near neighbours f2, against every pair of their
 *     shortlisted partners (c1, c2): the 2-point similarity (any rotation, scale in `scaleRange`),
 *     kept only if both areas agree with the scale (area ∝ scale²).
 *  3. Score: found centres mapped by the similarity that land within `tol` of a catalog centre
 *     whose colour also agrees (one-to-one). Best hypothesis wins.
 *  4. Refine: least-squares similarity on the inliers, then a homography (the table is a plane, the
 *     phone a little tilted) once there are ≥ 8 well-spread inliers, re-collecting inliers with a
 *     tighter tolerance each round.
 *  5. Refuse (null) unless enough pieces agree: ≥ `minInliers` and ≥ `minInlierShare` of the usable
 *     found pieces (a photo of different pieces gets a few chance matches only).
 */
import { applyH, fitHomography, invertH } from './homography';
import type { Mat3, PieceFlags, Vec2 } from '../project/types';

export interface RegFoundPiece {
  /** Centre in the photo's provisional mm. */
  centreMm: Vec2;
  areaMm2: number;
  sizeMm: Vec2;
  meanLab: [number, number, number];
  hueHist: number[];
  flags?: PieceFlags;
}

/** The parts of a PieceRow (src/project/types.ts) that registration uses. */
export interface RegCatalogPiece {
  id: string;
  table: { x: number; y: number };
  areaMm2: number;
  sizeMm: Vec2;
  colour: { meanLab: [number, number, number]; hueHist: number[] };
  status?: string;
}

export interface RegisterOptions {
  /** Allowed photo-mm → catalog-mm scale (default 0.4–3: a 2× close-up vs the 1× overview, unknown px/mm). */
  scaleRange?: [number, number];
  /** Piece pitch in catalog mm (default 18.6), sets the match tolerances. */
  pitchMm?: number;
  /** Colour shortlist length per found piece (default 12). */
  shortlist?: number;
  /** Number of (f1, f2) draws (default 600). */
  draws?: number;
  minInliers?: number;
  minInlierShare?: number;
  seed?: number;
}

export interface Registration {
  /** Photo provisional mm → catalog mm. */
  photoToCatalog: Mat3;
  /** [index into `found`, catalog id] of the pieces that agree. */
  inliers: Array<[number, string]>;
  /** RMS centre residual of the inliers (catalog mm). */
  rmsMm: number;
  /** 0–1: share of usable found pieces that agree, and how many. */
  confidence: number;
  /** Scale and rotation of the fitted map at the photo's centre of inliers. */
  scale: number;
  rotationDeg: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Colour distance between two pieces (ΔE of the mean / 10 + L1 of the hue histograms). */
export function colourDistance(a: { meanLab: readonly number[]; hueHist: readonly number[] }, b: { meanLab: readonly number[]; hueHist: readonly number[] }): number {
  const de = Math.hypot(a.meanLab[0]! - b.meanLab[0]!, a.meanLab[1]! - b.meanLab[1]!, a.meanLab[2]! - b.meanLab[2]!);
  let h = 0;
  const n = Math.min(a.hueHist.length, b.hueHist.length);
  for (let i = 0; i < n; i++) h += Math.abs(a.hueHist[i]! - b.hueHist[i]!);
  return de / 10 + h;
}

/** Similarity as a Mat3: p → s·R(θ)·p + t, written as [a −b tx; b a ty; 0 0 1]. */
function sim(a: number, b: number, tx: number, ty: number): Mat3 {
  return [a, -b, tx, b, a, ty, 0, 0, 1];
}

/** Least-squares similarity (Umeyama, 2-D) src → dst. */
function fitSimilarity(src: Vec2[], dst: Vec2[]): Mat3 | null {
  const n = src.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i]![0];
    sy += src[i]![1];
    dx += dst[i]![0];
    dy += dst[i]![1];
  }
  sx /= n;
  sy /= n;
  dx /= n;
  dy /= n;
  let a = 0;
  let b = 0;
  let q = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i]![0] - sx;
    const y = src[i]![1] - sy;
    const u = dst[i]![0] - dx;
    const v = dst[i]![1] - dy;
    a += x * u + y * v;
    b += x * v - y * u;
    q += x * x + y * y;
  }
  if (q < 1e-9) return null;
  a /= q;
  b /= q;
  return sim(a, b, dx - (a * sx - b * sy), dy - (b * sx + a * sy));
}

/** Local scale and rotation of a map at point p. */
function scaleRot(H: Mat3, p: Vec2): { scale: number; rotationDeg: number } {
  const o = applyH(H, p);
  const ex = applyH(H, [p[0] + 1, p[1]]);
  const ey = applyH(H, [p[0], p[1] + 1]);
  const det = (ex[0] - o[0]) * (ey[1] - o[1]) - (ex[1] - o[1]) * (ey[0] - o[0]);
  return { scale: Math.sqrt(Math.abs(det)), rotationDeg: (Math.atan2(ex[1] - o[1], ex[0] - o[0]) * 180) / Math.PI };
}

class Grid {
  private cells = new Map<number, number[]>();
  constructor(
    private pts: Vec2[],
    private cell: number,
  ) {
    pts.forEach((p, i) => {
      const k = this.key(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
      let a = this.cells.get(k);
      if (!a) this.cells.set(k, (a = []));
      a.push(i);
    });
  }
  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }
  /** Indexes within r (r ≤ cell) of p. */
  near(p: Vec2, r: number, out: number[]): number[] {
    out.length = 0;
    const i0 = Math.floor((p[0] - r) / this.cell);
    const i1 = Math.floor((p[0] + r) / this.cell);
    const j0 = Math.floor((p[1] - r) / this.cell);
    const j1 = Math.floor((p[1] + r) / this.cell);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const a = this.cells.get(this.key(i, j));
        if (!a) continue;
        for (const k of a) {
          const q = this.pts[k]!;
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= r) out.push(k);
        }
      }
    return out;
  }
}

export const REG = {
  /** Match tolerances as shares of the pitch: hypothesis scoring, then refinement rounds. */
  tolScore: 0.3,
  tolRefine: [0.25, 0.18, 0.15],
  /** Colour distance above which a centre match doesn't count. */
  maxColour: 2.5,
  /** Area ratio tolerance (relative to scale²) for hypothesis pairs. */
  areaTol: 0.4,
  minInliers: 6,
  minInlierShare: 0.35,
};

export function registerPieces(found: RegFoundPiece[], catalog: RegCatalogPiece[], opts: RegisterOptions = {}): Registration | null {
  const [sMin, sMax] = opts.scaleRange ?? [0.4, 3];
  const pitch = opts.pitchMm ?? 18.6;
  const K = opts.shortlist ?? 12;
  const draws = opts.draws ?? 600;
  const rand = rng(opts.seed ?? 12345);
  const cat = catalog.filter((c) => !c.status || c.status === 'table' || c.status === 'pending');
  const use = found.map((f, i) => i).filter((i) => !found[i]!.flags?.cut && !found[i]!.flags?.clump && found[i]!.areaMm2 > 0);
  if (use.length < 3 || cat.length < 3) return null;
  const catPts: Vec2[] = cat.map((c) => [c.table.x, c.table.y]);
  const grid = new Grid(catPts, pitch);

  // 1. Colour shortlists and colour distances (found × catalog), kept for scoring.
  const colD = new Float32Array(found.length * cat.length).fill(Infinity);
  const short: number[][] = found.map(() => []);
  for (const i of use) {
    const f = found[i]!;
    const d = cat.map((c, j) => {
      const v = colourDistance(f, c.colour);
      colD[i * cat.length + j] = v;
      return [v, j] as const;
    });
    d.sort((a, b) => a[0] - b[0]);
    short[i] = d.slice(0, K).map((x) => x[1]);
  }
  // Near neighbours among usable found pieces (photo mm).
  const usePts: Vec2[] = use.map((i) => found[i]!.centreMm);
  const neighbours: number[][] = use.map((_, a) =>
    use
      .map((_, b) => [Math.hypot(usePts[a]![0] - usePts[b]![0], usePts[a]![1] - usePts[b]![1]), b] as const)
      .filter(([d, b]) => b !== a && d > 0)
      .sort((x, y) => x[0] - y[0])
      .slice(0, 6)
      .map(([, b]) => b),
  );

  const tmp: number[] = [];
  /** One-to-one matches of found centres under H (nearest first), within tol, colour agreeing. */
  const collect = (H: Mat3, tol: number): Array<[number, number, number]> => {
    const cands: Array<[number, number, number]> = [];
    for (const i of use) {
      const q = applyH(H, found[i]!.centreMm);
      for (const j of grid.near(q, tol, tmp)) {
        if (colD[i * cat.length + j]! > REG.maxColour) continue;
        cands.push([i, j, Math.hypot(q[0] - catPts[j]![0], q[1] - catPts[j]![1])]);
      }
    }
    cands.sort((a, b) => a[2] - b[2]);
    const fi = new Set<number>();
    const cj = new Set<number>();
    const out: Array<[number, number, number]> = [];
    for (const c of cands) {
      if (fi.has(c[0]) || cj.has(c[1])) continue;
      fi.add(c[0]);
      cj.add(c[1]);
      out.push(c);
    }
    return out;
  };
  const countInliers = (H: Mat3, tol: number): number => {
    let n = 0;
    const taken = new Set<number>();
    for (const i of use) {
      const q = applyH(H, found[i]!.centreMm);
      let best = -1;
      let bd = tol;
      for (const j of grid.near(q, tol, tmp)) {
        if (taken.has(j) || colD[i * cat.length + j]! > REG.maxColour) continue;
        const d = Math.hypot(q[0] - catPts[j]![0], q[1] - catPts[j]![1]);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      if (best >= 0) {
        taken.add(best);
        n++;
      }
    }
    return n;
  };

  // 2–3. Hypotheses from pairs of neighbouring pieces.
  let bestH: Mat3 | null = null;
  let bestN = 0;
  const tolS = REG.tolScore * pitch;
  for (let t = 0; t < draws; t++) {
    const a = Math.floor(rand() * use.length);
    const nb = neighbours[a]!;
    if (!nb.length) continue;
    const b = nb[Math.floor(rand() * nb.length)]!;
    const i1 = use[a]!;
    const i2 = use[b]!;
    const f1 = found[i1]!;
    const f2 = found[i2]!;
    const fdx = f2.centreMm[0] - f1.centreMm[0];
    const fdy = f2.centreMm[1] - f1.centreMm[1];
    const fd = Math.hypot(fdx, fdy);
    for (const j1 of short[i1]!) {
      const c1 = cat[j1]!;
      for (const j2 of short[i2]!) {
        if (j1 === j2) continue;
        const c2 = cat[j2]!;
        const cdx = c2.table.x - c1.table.x;
        const cdy = c2.table.y - c1.table.y;
        const s = Math.hypot(cdx, cdy) / fd;
        if (s < sMin || s > sMax) continue;
        const s2 = s * s;
        if (Math.abs(c1.areaMm2 / (f1.areaMm2 * s2) - 1) > REG.areaTol || Math.abs(c2.areaMm2 / (f2.areaMm2 * s2) - 1) > REG.areaTol) continue;
        const th = Math.atan2(cdy, cdx) - Math.atan2(fdy, fdx);
        const ca = s * Math.cos(th);
        const sb = s * Math.sin(th);
        const H = sim(ca, sb, c1.table.x - (ca * f1.centreMm[0] - sb * f1.centreMm[1]), c1.table.y - (sb * f1.centreMm[0] + ca * f1.centreMm[1]));
        const n = countInliers(H, tolS);
        if (n > bestN) {
          bestN = n;
          bestH = H;
        }
      }
    }
    if (bestN >= 0.85 * use.length) break;
  }
  if (!bestH || bestN < (opts.minInliers ?? REG.minInliers)) return null;

  // 4. Refine: similarity, then homography when there are enough spread-out inliers.
  let H = bestH;
  let inl = collect(H, tolS);
  for (const k of REG.tolRefine) {
    const src = inl.map(([i]) => found[i]!.centreMm);
    const dst = inl.map(([, j]) => catPts[j]!);
    let next: Mat3 | null = null;
    if (inl.length >= 8) {
      next = fitHomography(src, dst);
      // Sanity: a hand-held, nearly flat phone gives a nearly-similarity map.
      if (next) {
        const c: Vec2 = [src.reduce((a, p) => a + p[0], 0) / src.length, src.reduce((a, p) => a + p[1], 0) / src.length];
        const s0 = scaleRot(next, c).scale;
        const span = Math.max(...src.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
        const s1 = scaleRot(next, [c[0] + span, c[1]]).scale;
        const s2 = scaleRot(next, [c[0], c[1] + span]).scale;
        if (!(Math.abs(s1 / s0 - 1) < 0.3 && Math.abs(s2 / s0 - 1) < 0.3)) next = null;
      }
    }
    next ??= fitSimilarity(src, dst);
    if (!next) break;
    const more = collect(next, k * pitch);
    if (more.length < Math.min(inl.length, opts.minInliers ?? REG.minInliers)) break;
    H = next;
    inl = more;
  }

  // 5. Accept or refuse.
  const share = inl.length / use.length;
  if (inl.length < (opts.minInliers ?? REG.minInliers) || share < (opts.minInlierShare ?? REG.minInlierShare)) return null;
  const errs = inl.map(([i, j]) => {
    const q = applyH(H, found[i]!.centreMm);
    return Math.hypot(q[0] - catPts[j]![0], q[1] - catPts[j]![1]);
  });
  const rmsMm = Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length);
  const cx = inl.reduce((a, [i]) => a + found[i]!.centreMm[0], 0) / inl.length;
  const cy = inl.reduce((a, [i]) => a + found[i]!.centreMm[1], 0) / inl.length;
  const sr = scaleRot(H, [cx, cy]);
  if (!invertH(H)) return null;
  return {
    photoToCatalog: H,
    inliers: inl.map(([i, j]) => [i, cat[j]!.id] as [number, string]),
    rmsMm,
    confidence: Math.min(1, share / 0.7) * Math.min(1, inl.length / 15),
    scale: sr.scale,
    rotationDeg: sr.rotationDeg,
  };
}
