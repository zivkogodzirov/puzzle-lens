/**
 * The marker-free photo path (owner's decision: no printed markers). Pure function of the decoded
 * photo and the catalog, so it runs in the reader worker and in Node tests alike.
 *
 *  1. Scale: estimatePxPerMm (pieces' median size ↔ the cell pitch). Falls back to the nominal
 *     scale for the zoom (1×: ~4 px/mm, 2×: ~9 px/mm at 12 MP) when too few pieces are seen.
 *  2. Provisional frame: photo px → mm by that scale, origin at the image centre, axes as the
 *     image (the phone is held flat; no tilt correction).
 *  3. findPieces with no marker map.
 *  4. Empty catalog → this photo defines the frame (isNewFrame). Otherwise registerPieces
 *     (src/geo/registerPieces.ts) maps the photo onto the catalog; if it can't, nothing is
 *     returned (no guessing). When the registered scale says the estimate was off by > 15 %,
 *     findPieces runs again at the corrected scale (its size gates and wall model depend on it)
 *     and registration is repeated.
 *  5. Outlines and centres are mapped into the catalog frame; area, size and angle recomputed there.
 */
import type { Cv } from './loadCv';
import type { PixelBuffer } from './frameAnalyser';
import { DEFAULT_PITCH_MM, estimatePxPerMm, findPieces, minAreaRect, type FoundPiece } from './pieceFinder';
import { applyH, IDENTITY, mulH } from '../geo/homography';
import { nominalIntrinsics } from '../geo/pose';
import { registerPieces, type RegCatalogPiece, type Registration } from '../geo/registerPieces';
import type { Mat3, TableModel, Vec2 } from '../project/types';

export type PieceRowLike = RegCatalogPiece;

export interface ScanMarkerlessOptions {
  catalog: PieceRowLike[];
  /** Cell pitch (mm), default 18.6 (Ravensburger 1000: √(17.8 × 19.4)). */
  pitchMm?: number;
  zoom: number;
  kind: 'overview' | 'detail';
  table: TableModel | null;
}

export interface ScanMarkerlessResult {
  /** Pieces with outlineMm / centreMm / areaMm2 / sizeMm / angleDeg in the CATALOG frame. */
  pieces: FoundPiece[];
  /** Photo provisional mm → catalog mm (identity for a new frame), null when not registered. */
  photoToCatalog: Mat3 | null;
  /** Photo px → catalog mm, null when not registered. */
  imgToCatalog: Mat3 | null;
  registered: boolean;
  isNewFrame: boolean;
  /** Photo px per catalog mm (null when not registered). */
  pxPerMm: number | null;
  inliers: number;
  rmsMm: number;
  confidence: number;
  timings: Record<string, number>;
}

/** Re-run detection when the registered scale differs from the estimate by more than this. */
export const RESCALE_LIMIT = 0.15;

function scaleFrame(W: number, H: number, ppm: number): { imgToMm: Mat3; mmToImg: Mat3 } {
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  return {
    imgToMm: [1 / ppm, 0, -cx / ppm, 0, 1 / ppm, -cy / ppm, 0, 0, 1],
    mmToImg: [ppm, 0, cx, 0, ppm, cy, 0, 0, 1],
  };
}

function mapPiece(p: FoundPiece, H: Mat3): FoundPiece {
  const outlineMm: number[] = [];
  for (let i = 0; i < p.outlineMm.length; i += 2) {
    const q = applyH(H, [p.outlineMm[i]!, p.outlineMm[i + 1]!]);
    outlineMm.push(q[0], q[1]);
  }
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = outlineMm.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cr = outlineMm[2 * i]! * outlineMm[2 * j + 1]! - outlineMm[2 * j]! * outlineMm[2 * i + 1]!;
    a += cr;
    cx += (outlineMm[2 * i]! + outlineMm[2 * j]!) * cr;
    cy += (outlineMm[2 * i + 1]! + outlineMm[2 * j + 1]!) * cr;
  }
  const centre: Vec2 = Math.abs(a) > 1e-9 ? [cx / (3 * a), cy / (3 * a)] : applyH(H, p.centreMm);
  const rect = minAreaRect(outlineMm);
  return { ...p, outlineMm, centreMm: centre, areaMm2: Math.abs(a / 2), sizeMm: rect.size, angleDeg: rect.angleDeg };
}

export function scanMarkerless(cv: Cv, rgba: PixelBuffer, opts: ScanMarkerlessOptions): ScanMarkerlessResult {
  const T0 = performance.now();
  const timings: Record<string, number> = {};
  const W = rgba.width;
  const H = rgba.height;
  const pitch = opts.pitchMm ?? DEFAULT_PITCH_MM;
  const pieceAreaMm2 = pitch * pitch;

  let t = performance.now();
  const est = estimatePxPerMm(cv, rgba, { pitchMm: pitch, zoom: opts.zoom, table: opts.table });
  timings.scale = performance.now() - t;
  let ppm = est?.pxPerMm ?? (opts.zoom >= 2 ? 9 : 4) * (Math.max(W, H) / 4032);

  const find = (pxPerMm: number) => {
    const f = scaleFrame(W, H, pxPerMm);
    const t1 = performance.now();
    const r = findPieces(cv, rgba, { imgToTable: f.imgToMm, tableToImg: f.mmToImg, map: null, table: opts.table, pxPerMm, zoom: opts.zoom, pieceAreaMm2, withGlareMask: false });
    timings.find = (timings.find ?? 0) + performance.now() - t1;
    return { frame: f, res: r };
  };
  let { frame, res } = find(ppm);
  const empty = (): ScanMarkerlessResult => ({ pieces: [], photoToCatalog: null, imgToCatalog: null, registered: false, isNewFrame: false, pxPerMm: null, inliers: 0, rmsMm: 0, confidence: 0, timings: { ...timings, total: performance.now() - T0 } });

  if (!opts.catalog.length) {
    // The first photo defines the frame. Undo the phone's small tilt, measured from how piece
    // sizes change across the photo (nearer pieces look bigger), so the frame is metric.
    const Hr = levelFromSizes(res.pieces, { W, H, zoom: opts.zoom, pxPerMm: ppm }) ?? IDENTITY;
    const pieces = res.pieces.map((p) => mapPiece(p, Hr));
    timings.total = performance.now() - T0;
    return { pieces, photoToCatalog: Hr, imgToCatalog: mulH(Hr, frame.imgToMm), registered: true, isNewFrame: true, pxPerMm: ppm, inliers: 0, rmsMm: 0, confidence: 1, timings };
  }

  const register = (pieces: FoundPiece[]): Registration | null => {
    const t2 = performance.now();
    const r = registerPieces(pieces, opts.catalog, { pitchMm: pitch });
    timings.register = (timings.register ?? 0) + performance.now() - t2;
    return r;
  };
  let reg = register(res.pieces);
  if (!reg) return empty();
  if (Math.abs(reg.scale - 1) > RESCALE_LIMIT) {
    // The scale estimate was off: detect again at the scale registration measured.
    ppm = ppm / reg.scale;
    ({ frame, res } = find(ppm));
    const again = register(res.pieces);
    if (!again) return empty();
    reg = again;
  }
  const Hc = reg.photoToCatalog;
  const pieces = res.pieces.map((p) => mapPiece(p, Hc));
  const imgToCatalog = mulH(Hc, frame.imgToMm);
  t = performance.now();
  timings.total = t - T0;
  return {
    pieces,
    photoToCatalog: Hc,
    imgToCatalog,
    registered: true,
    isNewFrame: false,
    pxPerMm: ppm / reg.scale,
    inliers: reg.inliers.length,
    rmsMm: reg.rmsMm,
    confidence: reg.confidence,
    timings,
  };
}

/** Minimum number of whole pieces for levelFromSizes to trust the size gradient. */
export const LEVEL_MIN_PIECES = 30;

/**
 * Tilt from piece sizes (no markers, no gravity): seen through a tilted camera, the table's
 * scale changes across the photo, image area ∝ (n · ray)³ with n the table normal in camera
 * coordinates and ray = (x, y, 1) the normalised image direction. A robust fit of
 * log(area) = c + 3 (a x + b y) over whole pieces gives n ≈ (a, b, 1); the returned homography
 * (provisional mm → levelled mm, scale kept at the image centre) rotates the view to face the
 * table squarely. Pieces' own size scatter (knobs/blanks, ±10 %) averages out over ≥ 30 pieces.
 * Null when there are too few pieces or the fit is not significant.
 */
export function levelFromSizes(pieces: FoundPiece[], o: { W: number; H: number; zoom: number; pxPerMm: number }): Mat3 | null {
  const K = nominalIntrinsics(o.W, o.H, o.zoom);
  const k = o.pxPerMm / K.f; // provisional mm → normalised image coords (origin at the centre)
  let pts = pieces
    .filter((p) => !p.flags.cut && !p.flags.clump && !p.flags.weak && p.areaMm2 > 0)
    .map((p) => ({ x: p.centreMm[0] * k, y: p.centreMm[1] * k, l: Math.log(p.areaMm2) }));
  if (pts.length < LEVEL_MIN_PIECES) return null;
  let sol: number[] | null = null;
  for (let iter = 0; iter < 3; iter++) {
    // Least squares l = c + 3a x + 3b y.
    const A = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const r = [0, 0, 0];
    for (const p of pts) {
      const v = [1, 3 * p.x, 3 * p.y];
      for (let i = 0; i < 3; i++) {
        r[i]! += v[i]! * p.l;
        for (let j = 0; j < 3; j++) A[i]![j]! += v[i]! * v[j]!;
      }
    }
    sol = solve3(A, r);
    if (!sol) return null;
    const res = pts.map((p) => p.l - (sol![0]! + 3 * sol![1]! * p.x + 3 * sol![2]! * p.y));
    const mad = median(res.map((e) => Math.abs(e))) * 1.48 || 1e-6;
    const kept = pts.filter((_, i) => Math.abs(res[i]!) < 2.5 * mad);
    if (kept.length === pts.length || kept.length < LEVEL_MIN_PIECES) break;
    pts = kept;
  }
  if (!sol) return null;
  const a = sol[1]!;
  const b = sol[2]!;
  const tilt = Math.atan(Math.hypot(a, b));
  // Beyond ~12° the phone wasn't held flat (or the fit is nonsense): don't "correct".
  if (tilt > (12 * Math.PI) / 180 || tilt < 0.002) return null;
  // Rotation R with third row n = (a, b, 1)/|·| (Rodrigues about n × e_z).
  const nz = 1 / Math.hypot(a, b, 1);
  const n = [a * nz, b * nz, nz];
  const ax = [n[1]!, -n[0]!, 0];
  const al = Math.hypot(ax[0]!, ax[1]!);
  const ux = ax[0]! / al;
  const uy = ax[1]! / al;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const C = 1 - c;
  const R = [c + ux * ux * C, ux * uy * C, uy * s, uy * ux * C, c + uy * uy * C, -ux * s, -uy * s, ux * s, c];
  // R maps n to e_z? Check the third row; flip the angle if needed.
  const Rn = R[6]! * n[0]! + R[7]! * n[1]! + R[8]! * n[2]!;
  const Rf = Rn > 0.999 ? R : [c + ux * ux * C, ux * uy * C, -uy * s, uy * ux * C, c + uy * uy * C, ux * s, uy * s, -ux * s, c];
  // provisional mm → normalised → levelled → mm, keeping the scale at the image centre (1/n_z).
  const S: Mat3 = [k, 0, 0, 0, k, 0, 0, 0, 1];
  const Sinv: Mat3 = [1 / k, 0, 0, 0, 1 / k, 0, 0, 0, 1];
  const Hn = mulH(Sinv, mulH(Rf, S));
  // Normalise so the image centre stays put and its local scale is 1.
  const o0 = applyH(Hn, [0, 0]);
  const o1 = applyH(Hn, [1, 0]);
  const o2 = applyH(Hn, [0, 1]);
  const sc = Math.sqrt(Math.abs((o1[0] - o0[0]) * (o2[1] - o0[1]) - (o1[1] - o0[1]) * (o2[0] - o0[0])));
  return mulH([1 / sc, 0, -o0[0] / sc, 0, 1 / sc, -o0[1] / sc, 0, 0, 1], Hn);
}

function median(v: number[]): number {
  const s = [...v].sort((x, y) => x - y);
  return s[s.length >> 1] ?? 0;
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
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k < 4; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return [M[0]![3]! / M[0]![0]!, M[1]![3]! / M[1]![1]!, M[2]![3]! / M[2]![2]!];
}
