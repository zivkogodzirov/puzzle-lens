/**
 * Box placement (M4, RESEARCH §9): where on the box picture does a piece go?
 *
 * 1. Piece patch: the piece straightened by its 4 corners (from shape reading) into a square
 *    "core" of PATCH_CORE px (one grid cell) with a PATCH_MARGIN px border for its knobs; a mask
 *    keeps only the piece itself (its outline, eroded a little: the edge mixes wall and table).
 * 2. Box grid: the straightened box picture resampled to exactly CELL px per cell, in Lab.
 * 3. Score (cell, quarter turn, small shift): masked zero-mean normalised cross-correlation (ZNCC)
 *    of lightness and of the two colour channels (each weighted by how much texture the piece has
 *    in it, so plain pieces aren't scored on noise), minus a penalty for different mean colour.
 *    Coarse to fine: 8 px per cell, every cell × 4 turns → best 48; 16 px, ±2 px shifts → best 12;
 *    32 px, ±2 px shifts → final scores.
 * 4. Border rule: a piece read as corner/edge goes only where its flat sides face the picture's
 *    edges (and an inside piece not on the edge), when the read is trusted; otherwise a penalty.
 * 5. Probabilities: softmax over the finalists plus "somewhere else"; verdict Strong / Likely /
 *    Several spots look alike.
 *
 * Plain TypeScript on typed arrays (no OpenCV), so it runs in the reader worker.
 */
import type { PixelBuffer } from './frameAnalyser';
import { applyH, fitHomography, invertH } from '../geo/homography';
import type { Vec2 } from '../project/types';

/** Patch core (one cell) and margin, in px; the patch is PATCH_SIZE square. */
export const PATCH_CORE = 32;
export const PATCH_MARGIN = 12;
export const PATCH_SIZE = PATCH_CORE + 2 * PATCH_MARGIN;

export type Verdict = 'strong' | 'likely' | 'several';

export interface PlacementSpot {
  col: number;
  row: number;
  /** Quarter turns clockwise that make the piece (as photographed, straightened) sit upright. */
  rot: 0 | 1 | 2 | 3;
  score: number;
  /** Probability (finalists plus "somewhere else"). */
  p: number;
  /** With `full`: the score in each of the 4 turns (−Infinity where a turn isn't allowed). */
  rotScores?: number[];
  /**
   * Where the piece fits best on the box picture relative to the spot (cells, ±0.19): the box
   * picture's misfit there (box-to-grid correction, src/cv/boxFit.ts).
   */
  ox?: number;
  oy?: number;
}

export interface Placement {
  top: PlacementSpot[];
  verdict: Verdict;
}

/** Tuned on the synthetic validation sets (see test/unit/cv-placement*.test.ts) and the owner's real photos. */
export const PLACE = {
  /**
   * Softmax temperature on scores and "somewhere else" (as likely as a finalist scoring elseBelow
   * under the best). Fitted on real photos (2026-11-08): spots cut from the owner's finished puzzle
   * (IMG_9272) placed on their box picture, and their 21 loose pieces (IMG_9276) against the 21
   * holes they came from (IMG_9280). Real scores are much noisier than synthetic ones: the first
   * fit (0.008 / 0.04, synthetic only) called 74 % of the real spots Strong (27 % of those wrong)
   * and 14 of the 21 loose pieces Strong (9 of those wrong).
   */
  temperature: 0.02,
  elseBelow: 0.06,
  /**
   * Strong: right 25 / 25 on the real finished-puzzle spots, 3 of 4 on the loose pieces, 96–97 % on
   * val48 / val300. Likely: 82 % right on the real spots, 82–92 % on synthetic.
   */
  strongP: 0.75,
  likelyP: 0.55,
  /** Channel weights (lightness, a, b). */
  wL: 1,
  wC: 0.6,
  /** A channel's ZNCC counts fully once the piece's spread in it reaches this (Lab units). */
  texL: 6,
  texC: 3,
  /** Mean-colour penalty: ΔE / meanDE. */
  meanDE: 60,
  /** Penalty per wrong border side when the shape read isn't trusted. */
  borderSoft: 0.15,
  /** Mask erosion (px at PATCH_CORE scale). */
  erode: 2,
  /**
   * Candidates kept after the coarse level and after the middle level, and shifts tried at the
   * coarse level (± px at 8 px per cell). A wider search (150 / 30, ±1 px) placed 2–3 % fewer
   * synthetic pieces right (val300: 82.8 → 80.1 %: the coarse level's strict alignment weeds out
   * look-alikes) and no more of the owner's 21 real pieces once their outlines were right (2026-11-08).
   */
  keep0: 48,
  keep1: 12,
  shift0: 0,
  /**
   * Leftover pieces into the empty spots of a nearly finished puzzle (src/cv/openSpots.ts): a piece
   * scoring below gapMinScore at every free spot stays unpaired; chances of the one-piece-per-spot
   * pairing at temperature gapTemperature; Strong / Likely from those chances.
   */
  gapMinScore: -0.2,
  gapTemperature: 0.04,
  gapStrongP: 0.75,
  gapLikelyP: 0.55,
  /**
   * Knob fit among empty spots (M4 part 3), per side, times how sure both reads are: a side that
   * can't fit (knob out where the hole or the neighbour needs knob in, or the same against each
   * other) costs knobMismatch; one that fits gains knobMatch (by chance half of all sides fit).
   */
  knobMismatch: 0.12,
  knobMatch: 0.025,
};

// ---- Colour --------------------------------------------------------------------------------------

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  LIN[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
const f3 = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** sRGB (0–255, may be fractional) → Lab, written into out at k. */
function labInto(r: number, g: number, b: number, out: Float32Array, k: number): void {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const x = f3((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f3(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f3((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  out[k] = 116 * y - 16;
  out[k + 1] = 500 * (x - y);
  out[k + 2] = 200 * (y - z);
}
function lin(v: number): number {
  const i = Math.max(0, Math.min(255, v));
  const lo = Math.floor(i);
  const hi = Math.min(255, lo + 1);
  return LIN[lo]! + (LIN[hi]! - LIN[lo]!) * (i - lo);
}

// ---- Piece patch ---------------------------------------------------------------------------------

/** A straightened piece: RGBA, PATCH_SIZE square; alpha 255 = piece, 0 = not. */
export interface PiecePatch {
  size: number;
  rgba: Uint8Array;
}

/**
 * Straightens one piece from the photo. `corners`: the piece's 4 corners in photo px, in outline
 * order clockwise on screen (shape reading's order: side k runs from corner k to k + 1); corner 0
 * goes to the patch's top-left, so side 0 is the patch's top. `outline`: the piece outline (photo px).
 */
export function extractPatch(photo: PixelBuffer, corners: Vec2[], outline: ArrayLike<number>): PiecePatch | null {
  const S = PATCH_SIZE;
  const m = PATCH_MARGIN;
  const c = PATCH_CORE;
  const H = fitHomography(
    [
      [m, m],
      [m + c, m],
      [m + c, m + c],
      [m, m + c],
    ],
    corners,
  );
  if (!H) return null;
  const out = new Uint8Array(S * S * 4);
  const mask = new Uint8Array(S * S);
  // Photo px per patch px (for supersampling).
  const scale = Math.hypot(corners[1]![0] - corners[0]![0], corners[1]![1] - corners[0]![1]) / c;
  const sub = Math.max(1, Math.min(4, Math.round(scale)));
  const { data, stride, width: W, height: Hh } = photo;
  // The outline in patch coordinates, filled row by row (even-odd), once per piece.
  const Hinv = invertH(H);
  if (!Hinv) return null;
  const poly: number[] = [];
  for (let i = 0; i < outline.length; i += 2) poly.push(...applyH(Hinv, [outline[i]!, outline[i + 1]!]));
  const inside = new Uint8Array(S * S);
  const xs: number[] = [];
  for (let y = 0; y < S; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0, n = poly.length / 2, j = n - 1; i < n; j = i++) {
      const yi = poly[2 * i + 1]!;
      const yj = poly[2 * j + 1]!;
      if (yi > yc !== yj > yc) xs.push(poly[2 * i]! + ((yc - yi) * (poly[2 * j]! - poly[2 * i]!)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.max(0, Math.ceil(xs[k]! - 0.5)); x < Math.min(S, Math.ceil(xs[k + 1]! - 0.5)); x++) inside[y * S + x] = 1;
  }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (!inside[y * S + x]) continue;
      mask[y * S + x] = 1;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let j = 0; j < sub; j++)
        for (let i = 0; i < sub; i++) {
          const q = applyH(H, [x + (i + 0.5) / sub, y + (j + 0.5) / sub]);
          const px = Math.round(q[0] - 0.5);
          const py = Math.round(q[1] - 0.5);
          if (px < 0 || py < 0 || px >= W || py >= Hh) continue;
          const k = py * stride + px * 4;
          r += data[k]!;
          g += data[k + 1]!;
          b += data[k + 2]!;
          n++;
        }
      if (!n) {
        mask[y * S + x] = 0;
        continue;
      }
      const o = (y * S + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  // Erode the mask: the outline's edge mixes the piece's wall, its shadow and the table.
  let cur = mask;
  for (let e = 0; e < PLACE.erode; e++) {
    const next = new Uint8Array(S * S);
    for (let y = 1; y < S - 1; y++)
      for (let x = 1; x < S - 1; x++) {
        const k = y * S + x;
        next[k] = cur[k]! && cur[k - 1]! && cur[k + 1]! && cur[k - S]! && cur[k + S]! ? 1 : 0;
      }
    cur = next;
  }
  for (let k = 0; k < S * S; k++) out[k * 4 + 3] = cur[k] ? 255 : 0;
  return { size: S, rgba: out };
}

// ---- Box grid ------------------------------------------------------------------------------------

interface Level {
  /** px per cell at this level. */
  cell: number;
  w: number;
  h: number;
  /** Lab, w × h × 3. */
  lab: Float32Array;
}

export interface BoxGrid {
  cols: number;
  rows: number;
  levels: [Level, Level, Level];
  /** Mean and spread of the picture's Lab (for colour matching). */
  stats: { mean: [number, number, number]; std: [number, number, number] };
}

/** Area-average resize of RGBA (any scale ≤ ~1 per axis; upscaling falls back to nearest). */
function resizeRgb(src: { data: ArrayLike<number>; width: number; height: number; stride: number }, w: number, h: number): Float32Array {
  const fx = src.width / w;
  const fy = src.height / h;
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const y0 = y * fy;
    const y1 = Math.min(src.height, (y + 1) * fy);
    for (let x = 0; x < w; x++) {
      const x0 = x * fx;
      const x1 = Math.min(src.width, (x + 1) * fx);
      let r = 0;
      let g = 0;
      let b = 0;
      let ws = 0;
      for (let yy = Math.floor(y0); yy < Math.max(Math.floor(y0) + 1, Math.ceil(y1)); yy++) {
        const wy = Math.max(0, Math.min(yy + 1, y1) - Math.max(yy, y0)) || (fy < 1 ? 1 : 0);
        if (!wy) continue;
        for (let xx = Math.floor(x0); xx < Math.max(Math.floor(x0) + 1, Math.ceil(x1)); xx++) {
          const wx = Math.max(0, Math.min(xx + 1, x1) - Math.max(xx, x0)) || (fx < 1 ? 1 : 0);
          if (!wx) continue;
          const k = Math.min(src.height - 1, yy) * src.stride + Math.min(src.width - 1, xx) * 4;
          const wgt = wx * wy;
          r += src.data[k]! * wgt;
          g += src.data[k + 1]! * wgt;
          b += src.data[k + 2]! * wgt;
          ws += wgt;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r / ws;
      out[o + 1] = g / ws;
      out[o + 2] = b / ws;
    }
  }
  return out;
}

function toLab(rgb: Float32Array): Float32Array {
  const out = new Float32Array(rgb.length);
  for (let k = 0; k < rgb.length; k += 3) labInto(rgb[k]!, rgb[k + 1]!, rgb[k + 2]!, out, k);
  return out;
}

/** A picture resized (area average) to w × h, in Lab (w × h × 3). */
export function labImage(picture: { data: ArrayLike<number>; width: number; height: number; stride: number }, w: number, h: number): Float32Array {
  return toLab(resizeRgb(picture, w, h));
}

/** The straightened box picture (exactly the puzzle's picture) cut into cols × rows cells. */
export function buildBoxGrid(picture: { data: ArrayLike<number>; width: number; height: number; stride: number }, cols: number, rows: number): BoxGrid {
  const levels = [8, 16, 32].map((cell) => {
    const w = cols * cell;
    const h = rows * cell;
    return { cell, w, h, lab: labImage(picture, w, h) };
  }) as [Level, Level, Level];
  return { cols, rows, levels, stats: labStats(levels[2].lab, null)! };
}

// ---- Matching ------------------------------------------------------------------------------------

/**
 * A colour transform from the pieces' Lab to the box picture's: per channel (v − m1) / s1 × s2 + m2;
 * or, once learned from pieces whose spot is known (M8, src/cv/colourFit.ts), a full affine map
 * Lab' = A · [L, a, b, 1] (`affine`, 12 numbers row by row), which then replaces the per-channel one.
 */
export interface ColourMatch {
  from: { mean: [number, number, number]; std: [number, number, number] };
  to: { mean: [number, number, number]; std: [number, number, number] };
  affine?: number[] | null;
}

/** Applies a colour match to Lab values in place (3 per pixel). */
export function applyColourMatch(lab: Float32Array, cm: ColourMatch): void {
  const n = lab.length / 3;
  const A = cm.affine;
  if (A && A.length === 12) {
    for (let i = 0; i < n; i++) {
      const L = lab[i * 3]!;
      const a = lab[i * 3 + 1]!;
      const b = lab[i * 3 + 2]!;
      lab[i * 3] = A[0]! * L + A[1]! * a + A[2]! * b + A[3]!;
      lab[i * 3 + 1] = A[4]! * L + A[5]! * a + A[6]! * b + A[7]!;
      lab[i * 3 + 2] = A[8]! * L + A[9]! * a + A[10]! * b + A[11]!;
    }
    return;
  }
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) lab[i * 3 + c] = ((lab[i * 3 + c]! - cm.from.mean[c]!) / cm.from.std[c]!) * cm.to.std[c]! + cm.to.mean[c]!;
}

/** Mean and spread of the piece pixels' Lab over many patches (for a one-time colour match, RESEARCH §9.5). */
export function patchStats(patches: PiecePatch[]): { mean: [number, number, number]; std: [number, number, number] } | null {
  const parts: Float32Array[] = [];
  for (const p of patches) {
    const n = p.rgba.length / 4;
    const lab = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) labInto(p.rgba[i * 4]!, p.rgba[i * 4 + 1]!, p.rgba[i * 4 + 2]!, lab, i * 3);
    const keep = new Uint8Array(n);
    for (let i = 0; i < n; i++) keep[i] = p.rgba[i * 4 + 3] ? 1 : 0;
    parts.push(lab, keep as unknown as Float32Array);
  }
  const all: number[] = [];
  for (let j = 0; j < parts.length; j += 2) {
    const lab = parts[j]!;
    const keep = parts[j + 1]! as unknown as Uint8Array;
    for (let i = 0; i < keep.length; i++) if (keep[i]) all.push(lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!);
  }
  return all.length >= 300 ? labStats(Float32Array.from(all), null) : null;
}

/**
 * Mean and spread of the box picture's Lab over some cells only (e.g. the empty spots of a nearly
 * finished puzzle: the leftover pieces come from there, so their colours should be matched to those
 * cells' colours, not the whole picture's).
 */
export function spotStats(box: BoxGrid, cells: Array<[number, number]>): ColourMatch['to'] | null {
  const lv = box.levels[2];
  const keep = new Uint8Array(lv.w * lv.h);
  for (const [col, row] of cells) {
    if (col < 0 || row < 0 || col >= box.cols || row >= box.rows) continue;
    for (let y = row * lv.cell; y < (row + 1) * lv.cell; y++) keep.fill(1, y * lv.w + col * lv.cell, y * lv.w + (col + 1) * lv.cell);
  }
  return labStats(lv.lab, keep);
}

/** Mean and spread per Lab channel of a packed Lab array (optionally only where keep[i]). */
function labStats(lab: Float32Array, keep: Uint8Array | null): { mean: [number, number, number]; std: [number, number, number] } | null {
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < lab.length / 3; i++) {
    if (keep && !keep[i]) continue;
    for (let c = 0; c < 3; c++) {
      const v = lab[i * 3 + c]!;
      sum[c] = sum[c]! + v;
      sq[c] = sq[c]! + v * v;
    }
    n++;
  }
  if (!n) return null;
  const mean = sum.map((v) => v / n) as [number, number, number];
  const std = sq.map((v, c) => Math.sqrt(Math.max(1e-6, v / n - mean[c]! ** 2))) as [number, number, number];
  return { mean, std };
}

interface PatchLevel {
  size: number;
  margin: number;
  /** The piece's pixels in each of the 4 quarter turns. */
  turns: PatchTurn[];
}

/**
 * One quarter turn of a patch level as score() reads it: only the pixels on the piece, row by row
 * (the order score() always added them up in, so scores stay the same to the last bit).
 * Built once per piece and level instead of at every one of the ~4000 spots × turns tried (2026-11-10).
 */
interface PatchTurn {
  /** Number of piece pixels. */
  n: number;
  /** Their x and y in the patch. */
  xs: Int32Array;
  ys: Int32Array;
  /** Their offset in the box level's Lab from the patch's top-left pixel: (y × level width + x) × 3. */
  off: Int32Array;
  /** Their Lab (3 per pixel). */
  lab: Float64Array;
  /**
   * Sums of their L, a, b and of L², a², b²: the piece's side of the score, the same wherever the
   * piece lies fully on the picture.
   */
  sums: Float64Array;
  /** The piece pixels' bounding box in the patch (inclusive). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A turn's piece pixels (weight 1), for a box level `boxW` px wide. */
function patchTurn(lab: Float32Array, w: Float32Array, size: number, boxW: number): PatchTurn {
  let n = 0;
  for (let i = 0; i < size * size; i++) if (w[i]) n++;
  const xs = new Int32Array(n);
  const ys = new Int32Array(n);
  const off = new Int32Array(n);
  const pl = new Float64Array(n * 3);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  let k = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!w[i]) continue;
      const p0 = lab[i * 3]!;
      const p1 = lab[i * 3 + 1]!;
      const p2 = lab[i * 3 + 2]!;
      xs[k] = x;
      ys[k] = y;
      off[k] = (y * boxW + x) * 3;
      pl[k * 3] = p0;
      pl[k * 3 + 1] = p1;
      pl[k * 3 + 2] = p2;
      s0 = s0 + p0;
      s1 = s1 + p1;
      s2 = s2 + p2;
      q0 = q0 + p0 * p0;
      q1 = q1 + p1 * p1;
      q2 = q2 + p2 * p2;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
      k++;
    }
  return { n, xs, ys, off, lab: pl, sums: Float64Array.of(s0, s1, s2, q0, q1, q2), minX, minY, maxX, maxY };
}

/**
 * Patch at a box level (area-averaged), its Lab (colour-matched), rotated 0–3 quarter turns
 * clockwise, as the piece pixels of each turn.
 */
function patchLevel(patch: PiecePatch, lv: Level, cm: ColourMatch | null): PatchLevel {
  const cell = lv.cell;
  const k = PATCH_CORE / cell;
  const size = Math.round(PATCH_SIZE / k);
  const margin = Math.round(PATCH_MARGIN / k);
  const S = patch.size;
  const rgb = new Float32Array(size * size * 3);
  const w0 = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      let tot = 0;
      for (let yy = Math.floor(y * k); yy < Math.floor((y + 1) * k); yy++)
        for (let xx = Math.floor(x * k); xx < Math.floor((x + 1) * k); xx++) {
          tot++;
          const o = (yy * S + xx) * 4;
          if (!patch.rgba[o + 3]) continue;
          r += patch.rgba[o]!;
          g += patch.rgba[o + 1]!;
          b += patch.rgba[o + 2]!;
          n++;
        }
      const i = y * size + x;
      if (n) {
        rgb[i * 3] = r / n;
        rgb[i * 3 + 1] = g / n;
        rgb[i * 3 + 2] = b / n;
        // A pixel only partly on the piece counts only if mostly on it.
        w0[i] = n / tot >= 0.75 ? 1 : 0;
      }
    }
  const lab0 = toLab(rgb);
  if (cm) applyColourMatch(lab0, cm);
  const lab: Float32Array[] = [lab0];
  const w: Float32Array[] = [w0];
  for (let r = 1; r < 4; r++) {
    const pl = lab[r - 1]!;
    const pw = w[r - 1]!;
    const nl = new Float32Array(size * size * 3);
    const nw = new Float32Array(size * size);
    // Quarter turn clockwise: new[y][x] = old[size − 1 − x][y].
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const src = (size - 1 - x) * size + y;
        const dst = y * size + x;
        nw[dst] = pw[src]!;
        nl[dst * 3] = pl[src * 3]!;
        nl[dst * 3 + 1] = pl[src * 3 + 1]!;
        nl[dst * 3 + 2] = pl[src * 3 + 2]!;
      }
    lab.push(nl);
    w.push(nw);
  }
  return { size, margin, turns: lab.map((l, r) => patchTurn(l, w[r]!, size, lv.w)) };
}

/**
 * Score of a patch level placed with its core's top-left at box pixel (x0, y0). The hot loop of
 * placement (every spot × turn, then 25 shifts per finalist): plain number sums over the piece
 * pixels only, and the piece's own sums taken from patchTurn() where it lies fully on the picture;
 * same sums in the same order as before, so the same scores to the last bit (2026-11-10: placing a
 * piece about 3× as fast on a Mac, about 6× in Safari's engine).
 */
function score(lv: Level, pl: PatchLevel, rot: number, x0: number, y0: number): number {
  const t = pl.turns[rot]!;
  const m = t.n;
  const P = t.lab;
  const B = lv.lab;
  const LW = lv.w;
  const LH = lv.h;
  const bx0 = x0 - pl.margin;
  const by0 = y0 - pl.margin;
  let n = 0;
  let outside = 0;
  let sp0 = 0;
  let sp1 = 0;
  let sp2 = 0;
  let spp0 = 0;
  let spp1 = 0;
  let spp2 = 0;
  let sb0 = 0;
  let sb1 = 0;
  let sb2 = 0;
  let sbb0 = 0;
  let sbb1 = 0;
  let sbb2 = 0;
  let spb0 = 0;
  let spb1 = 0;
  let spb2 = 0;
  if (bx0 + t.minX >= 0 && by0 + t.minY >= 0 && bx0 + t.maxX < LW && by0 + t.maxY < LH) {
    // Every piece pixel on the picture.
    const off = t.off;
    const base = (by0 * LW + bx0) * 3;
    for (let k = 0, j = 0; k < m; k++, j += 3) {
      const bi = base + off[k]!;
      const p0 = P[j]!;
      const p1 = P[j + 1]!;
      const p2 = P[j + 2]!;
      const b0 = B[bi]!;
      const b1 = B[bi + 1]!;
      const b2 = B[bi + 2]!;
      sb0 = sb0 + b0;
      sb1 = sb1 + b1;
      sb2 = sb2 + b2;
      sbb0 = sbb0 + b0 * b0;
      sbb1 = sbb1 + b1 * b1;
      sbb2 = sbb2 + b2 * b2;
      spb0 = spb0 + p0 * b0;
      spb1 = spb1 + p1 * b1;
      spb2 = spb2 + p2 * b2;
    }
    const s = t.sums;
    sp0 = s[0]!;
    sp1 = s[1]!;
    sp2 = s[2]!;
    spp0 = s[3]!;
    spp1 = s[4]!;
    spp2 = s[5]!;
    n = m;
  } else {
    // Partly off the picture (a cell on the edge): count what's off.
    const xs = t.xs;
    const ys = t.ys;
    for (let k = 0, j = 0; k < m; k++, j += 3) {
      const bx = bx0 + xs[k]!;
      const by = by0 + ys[k]!;
      if (bx < 0 || by < 0 || bx >= LW || by >= LH) {
        outside++;
        continue;
      }
      const bi = (by * LW + bx) * 3;
      const p0 = P[j]!;
      const p1 = P[j + 1]!;
      const p2 = P[j + 2]!;
      const b0 = B[bi]!;
      const b1 = B[bi + 1]!;
      const b2 = B[bi + 2]!;
      sp0 = sp0 + p0;
      sp1 = sp1 + p1;
      sp2 = sp2 + p2;
      spp0 = spp0 + p0 * p0;
      spp1 = spp1 + p1 * p1;
      spp2 = spp2 + p2 * p2;
      sb0 = sb0 + b0;
      sb1 = sb1 + b1;
      sb2 = sb2 + b2;
      sbb0 = sbb0 + b0 * b0;
      sbb1 = sbb1 + b1 * b1;
      sbb2 = sbb2 + b2 * b2;
      spb0 = spb0 + p0 * b0;
      spb1 = spb1 + p1 * b1;
      spb2 = spb2 + p2 * b2;
      n++;
    }
  }
  if (n < 8) return -1;
  const sp = [sp0, sp1, sp2];
  const sb = [sb0, sb1, sb2];
  const spp = [spp0, spp1, spp2];
  const sbb = [sbb0, sbb1, sbb2];
  const spb = [spb0, spb1, spb2];
  let z = 0;
  let wz = 0;
  const meanP = [0, 0, 0];
  const meanB = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    meanP[c] = sp[c]! / n;
    meanB[c] = sb[c]! / n;
    const vp = Math.max(1e-6, spp[c]! / n - meanP[c]! ** 2);
    const vb = Math.max(1e-6, sbb[c]! / n - meanB[c]! ** 2);
    const cov = spb[c]! / n - meanP[c]! * meanB[c]!;
    const zc = cov / Math.sqrt(vp * vb);
    // Texture gate: a channel the piece has hardly any variation in says little.
    const gate = Math.min(1, Math.sqrt(vp) / (c === 0 ? PLACE.texL : PLACE.texC));
    const wc = (c === 0 ? PLACE.wL : PLACE.wC) * gate;
    z += wc * zc;
    wz += wc;
  }
  const zn = wz > 0 ? z / wz : 0;
  // Mean colour: plain pieces are placed mostly by it.
  const dE = Math.hypot(meanP[0]! - meanB[0]!, meanP[1]! - meanB[1]!, meanP[2]! - meanB[2]!);
  const gateAll = Math.min(1, wz / (PLACE.wL + 2 * PLACE.wC));
  return gateAll * zn - dE / PLACE.meanDE - outside / (n + outside);
}

/**
 * Border rule for a quarter turn: which sides of the piece (after turning) are flat must match
 * which picture edges the cell touches. `flats`: the piece's sides (patch top, right, bottom, left)
 * read as flat. Returns the number of sides that disagree.
 */
function borderMismatch(flats: boolean[], rot: number, col: number, row: number, cols: number, rows: number): number {
  const atEdge = [row === 0, col === cols - 1, row === rows - 1, col === 0];
  let bad = 0;
  for (let d = 0; d < 4; d++) {
    // After `rot` quarter turns clockwise, the side now facing d was side d − rot.
    const flat = flats[(d - rot + 4) % 4]!;
    if (flat !== atEdge[d]) bad++;
  }
  return bad;
}

/**
 * The first k candidates best score first, ties in their order: exactly what sorting them all (a
 * stable sort) and keeping the first k gives, without sorting all ~4000 of level 0, which took
 * about a fifth of a piece's placement (2026-11-10).
 */
function bestFirst<T extends { s: number }>(cands: T[], k: number): T[] {
  if (k * 8 >= cands.length) return cands.sort((a, b) => b.s - a.s).slice(0, k);
  const top: T[] = [];
  for (const c of cands) {
    if (top.length === k && !(c.s > top[k - 1]!.s)) continue;
    // After every kept one scoring the same or more (those came first).
    let i = top.length;
    while (i > 0 && top[i - 1]!.s < c.s) i--;
    top.splice(i, 0, c);
    if (top.length > k) top.pop();
  }
  return top;
}

export interface PlaceOptions {
  /** The piece's sides (patch top, right, bottom, left) read as flat, and whether that read is trusted. */
  flats?: boolean[] | null;
  flatsSure?: boolean;
  colour?: ColourMatch | null;
  /** How many spots to return (default 5). */
  topN?: number;
  /** Only these cells are candidates (e.g. a zone of the picture); default every cell. */
  only?: (col: number, row: number) => boolean;
  /**
   * Score every candidate cell in full detail and return them all (best turn each), best first:
   * for a short list of spots (the empty spots of a nearly finished puzzle).
   */
  full?: boolean;
}

/** Where a piece goes on the box picture: the best spots with probabilities, and a verdict. */
export function placePiece(box: BoxGrid, patch: PiecePatch, opts: PlaceOptions = {}): Placement {
  const { cols, rows } = box;
  const flats = opts.flats ?? null;
  const pen = (rot: number, col: number, row: number): number => {
    if (!flats) return 0;
    const bad = borderMismatch(flats, rot, col, row, cols, rows);
    if (!bad) return 0;
    return opts.flatsSure ? Infinity : PLACE.borderSoft * bad;
  };
  const cm = opts.colour ?? null;
  const pls = box.levels.map((lv) => patchLevel(patch, lv, cm));

  // Level 0: every cell × 4 turns.
  type Cand = { col: number; row: number; rot: number; dx: number; dy: number; s: number };
  let cands: Cand[] = [];
  const l0 = box.levels[0];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      if (opts.only && !opts.only(col, row)) continue;
      for (let rot = 0; rot < 4; rot++) {
        const pn = pen(rot, col, row);
        if (pn === Infinity) continue;
        let s0 = -Infinity;
        let b0x = 0;
        let b0y = 0;
        for (let dy = -PLACE.shift0; dy <= PLACE.shift0; dy++)
          for (let dx = -PLACE.shift0; dx <= PLACE.shift0; dx++) {
            const v = score(l0, pls[0]!, rot, col * l0.cell + dx, row * l0.cell + dy);
            if (v > s0) [s0, b0x, b0y] = [v, dx, dy];
          }
        cands.push({ col, row, rot, dx: b0x, dy: b0y, s: s0 - pn });
      }
    }
  const all = opts.full ? cands.length : 0;
  cands = bestFirst(cands, Math.max(all, PLACE.keep0));
  // Levels 1 and 2: refine with ±2 px shifts.
  for (const [li, keep] of [
    [1, Math.max(all, PLACE.keep1)],
    [2, Math.max(all, PLACE.keep1)],
  ] as const) {
    const lv = box.levels[li];
    const pl = pls[li]!;
    for (const c of cands) {
      const bx = c.dx * 2;
      const by = c.dy * 2;
      let best = -Infinity;
      let bdx = bx;
      let bdy = by;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const s = score(lv, pl, c.rot, c.col * lv.cell + bx + dx, c.row * lv.cell + by + dy);
          if (s > best) [best, bdx, bdy] = [s, bx + dx, by + dy];
        }
      c.s = best - pen(c.rot, c.col, c.row);
      c.dx = bdx;
      c.dy = bdy;
    }
    cands.sort((a, b) => b.s - a.s);
    cands = cands.slice(0, keep);
  }
  // One entry per cell (its best turn).
  const seen = new Set<number>();
  const finals = cands.filter((c) => {
    const k = c.row * cols + c.col;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const T = PLACE.temperature;
  const best = finals[0]?.s ?? 0;
  const ex = finals.map((c) => Math.exp((c.s - best) / T));
  const exElse = Math.exp(-PLACE.elseBelow / T) * Math.max(1, cols * rows - finals.length) ** 0.25;
  const Z = ex.reduce((a, b) => a + b, 0) + exElse;
  // Every turn's score per cell (full: all candidates were refined).
  const rotScores = new Map<number, number[]>();
  if (opts.full)
    for (const c of cands) {
      const k = c.row * cols + c.col;
      const r = rotScores.get(k) ?? [-Infinity, -Infinity, -Infinity, -Infinity];
      r[c.rot] = Math.max(r[c.rot]!, c.s);
      rotScores.set(k, r);
    }
  const top = finals.slice(0, opts.full ? finals.length : (opts.topN ?? 5)).map((c, i) => {
    const fine = box.levels[2].cell;
    const spot: PlacementSpot = {
      col: c.col,
      row: c.row,
      rot: c.rot as 0 | 1 | 2 | 3,
      score: c.s,
      p: ex[i]! / Z,
      ox: Math.round((c.dx / fine) * 1000) / 1000,
      oy: Math.round((c.dy / fine) * 1000) / 1000,
    };
    if (opts.full) spot.rotScores = rotScores.get(c.row * cols + c.col)!;
    return spot;
  });
  const p1 = top[0]?.p ?? 0;
  return { top, verdict: p1 >= PLACE.strongP ? 'strong' : p1 >= PLACE.likelyP ? 'likely' : 'several' };
}
