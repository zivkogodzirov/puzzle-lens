/**
 * The learned colour transform (M8, RESEARCH §9.5 step 3): once pieces with a known spot exist
 * (answered ✓ Fits, or counted in from a puzzle photo), fit how the colours of pieces as the phone
 * photographs them map to the box picture's: Lab' = A · [L, a, b, 1], least squares over small
 * blocks of each piece and its spot (in the turn it sits), trimmed twice to drop misaligned blocks.
 * The per-channel match (one mean and spread per channel) can't follow a colour cast that differs
 * between light and dark parts of the picture; this can.
 */
import { applyColourMatch, PATCH_CORE, PATCH_MARGIN, type BoxGrid, type ColourMatch, type PiecePatch } from './placement';
import { rgbToLab } from './tableModel';

/** Blocks across a piece's core. */
const B = 4;
/** Share of the worst-fitting blocks dropped in each refit. */
const TRIM = 0.2;

export interface ColourSample {
  patch: PiecePatch;
  col: number;
  row: number;
  /** Quarter turns clockwise that make the patch sit upright in its spot. */
  rot: 0 | 1 | 2 | 3;
}

export interface ColourFit {
  affine: number[];
  /** Block pairs used, and the colour difference (ΔE) before and after, on the blocks kept. */
  n: number;
  before: number;
  after: number;
  /**
   * Checked on pieces it wasn't fitted from (3 folds by piece): the colour difference with the
   * learned transform and with the current match (`base`). `useful` when the learned one is
   * clearly better (< CV_GAIN × the current one's).
   */
  heldOut: number;
  heldOutBase: number;
  useful: boolean;
}

/** The learned transform is used only if it beats the current match on held-out pieces by this factor. */
export const CV_GAIN = 0.85;

/**
 * 'affine': a full 3 × 3 + offset; 'diagonal': each Lab channel its own gain and offset (keeps the
 * channels' patterns apart, which the placement's correlation scores rely on).
 */
export const COLOUR_FIT = {
  mode: 'affine' as 'affine' | 'diagonal',
  /**
   * Pull towards "no change" on top of the current match (ridge, per pair): pieces from a few areas
   * of the picture cover only some of its colours, and an unpulled fit goes wrong far from them.
   */
  ridge: 3,
};

/** Mean Lab of each of the B × B blocks of a patch's core (null where the piece covers < half; real pieces keep ~55–70 % of their core). */
function patchBlocks(p: PiecePatch): Array<[number, number, number] | null> {
  const S = p.size;
  const k = PATCH_CORE / B;
  const out: Array<[number, number, number] | null> = [];
  for (let by = 0; by < B; by++)
    for (let bx = 0; bx < B; bx++) {
      const s: [number, number, number] = [0, 0, 0];
      let n = 0;
      let tot = 0;
      for (let y = PATCH_MARGIN + by * k; y < PATCH_MARGIN + (by + 1) * k; y++)
        for (let x = PATCH_MARGIN + bx * k; x < PATCH_MARGIN + (bx + 1) * k; x++) {
          tot++;
          const o = (y * S + x) * 4;
          if (!p.rgba[o + 3]) continue;
          const lab = rgbToLab(p.rgba[o]!, p.rgba[o + 1]!, p.rgba[o + 2]!);
          s[0] += lab[0];
          s[1] += lab[1];
          s[2] += lab[2];
          n++;
        }
      out.push(n >= 0.5 * tot ? [s[0] / n, s[1] / n, s[2] / n] : null);
    }
  return out;
}

/** The blocks turned q quarter turns clockwise (as the placement turns patches: new[y][x] = old[B − 1 − x][y]). */
function turn<T>(blocks: T[], q: number): T[] {
  let cur = blocks;
  for (let r = 0; r < q; r++) {
    const next: T[] = new Array(B * B);
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) next[y * B + x] = cur[(B - 1 - x) * B + y]!;
    cur = next;
  }
  return cur;
}

/** Mean Lab of the B × B blocks of a spot on the box picture. */
function boxBlocks(box: BoxGrid, col: number, row: number): Array<[number, number, number]> {
  const lv = box.levels[2];
  const k = lv.cell / B;
  const out: Array<[number, number, number]> = [];
  for (let by = 0; by < B; by++)
    for (let bx = 0; bx < B; bx++) {
      const s: [number, number, number] = [0, 0, 0];
      let n = 0;
      for (let y = Math.round(row * lv.cell + by * k); y < Math.round(row * lv.cell + (by + 1) * k); y++)
        for (let x = Math.round(col * lv.cell + bx * k); x < Math.round(col * lv.cell + (bx + 1) * k); x++) {
          const i = (y * lv.w + x) * 3;
          s[0] += lv.lab[i]!;
          s[1] += lv.lab[i + 1]!;
          s[2] += lv.lab[i + 2]!;
          n++;
        }
      out.push([s[0] / n, s[1] / n, s[2] / n]);
    }
  return out;
}

/** Solves the 4 × 4 system M x = v (Gaussian elimination with pivoting); null when singular. */
function solve4(M: number[][], v: number[]): number[] | null {
  const a = M.map((r, i) => [...r, v[i]!]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    if (Math.abs(a[p]![c]!) < 1e-9) return null;
    [a[c], a[p]] = [a[p]!, a[c]!];
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / a[c]![c]!;
      for (let k = c; k < 5; k++) a[r]![k]! -= f * a[c]![k]!;
    }
  }
  return a.map((r, i) => r[4]! / r[i]!);
}

/** Least-squares fit of y from x: per channel gain and offset (COLOUR_FIT.mode 'diagonal'), as an affine. */
function fitDiagonal(pairs: Array<{ x: [number, number, number]; y: [number, number, number] }>): number[] | null {
  const A = new Array(12).fill(0);
  for (let c = 0; c < 3; c++) {
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (const { x, y } of pairs) {
      sx += x[c]!;
      sy += y[c]!;
      sxx += x[c]! * x[c]!;
      sxy += x[c]! * y[c]!;
    }
    const n = pairs.length;
    const den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-9) return null;
    const g = (n * sxy - sx * sy) / den;
    A[c * 4 + c] = g;
    A[c * 4 + 3] = (sy - g * sx) / n;
  }
  return A;
}

/** Least-squares affine fit of y from x (3 → 3 with offset). */
function fitAffine(pairs: Array<{ x: [number, number, number]; y: [number, number, number] }>): number[] | null {
  if (COLOUR_FIT.mode === 'diagonal') return fitDiagonal(pairs);
  const M = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  const v = [0, 1, 2].map(() => [0, 0, 0, 0]);
  for (const { x, y } of pairs) {
    const xs = [x[0], x[1], x[2], 1];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) M[i]![j]! += xs[i]! * xs[j]!;
      for (let c = 0; c < 3; c++) v[c]![i]! += xs[i]! * y[c]!;
    }
  }
  // Ridge towards the identity (offset free): adds λ·n to the 3 × 3 diagonal and λ·n·e_c to the right side.
  const lam = COLOUR_FIT.ridge * pairs.length;
  for (let i = 0; i < 3; i++) {
    M[i]![i]! += lam;
    v[i]![i]! += lam;
  }
  const rows = v.map((vc) => solve4(M, vc));
  if (rows.some((r) => !r)) return null;
  return rows.flatMap((r) => r!);
}

const apply = (A: number[], x: [number, number, number]): [number, number, number] => [
  A[0]! * x[0] + A[1]! * x[1] + A[2]! * x[2] + A[3]!,
  A[4]! * x[0] + A[5]! * x[1] + A[6]! * x[2] + A[7]!,
  A[8]! * x[0] + A[9]! * x[1] + A[10]! * x[2] + A[11]!,
];
/** The learned correction after the current match, as one affine on the pieces' own Lab. */
function compose(A: number[], base: ColourMatch | null): number[] {
  if (!base) return A;
  // The current match as an affine: its own, or per channel v ↦ v · s + t.
  const B =
    base.affine?.length === 12
      ? base.affine
      : [0, 1, 2].flatMap((c) => {
          const s = base.to.std[c]! / base.from.std[c]!;
          const row = [0, 0, 0, base.to.mean[c]! - base.from.mean[c]! * s];
          row[c] = s;
          return row;
        });
  const out = new Array(12).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let v = c === 3 ? A[r * 4 + 3]! : 0;
      for (let k = 0; k < 3; k++) v += A[r * 4 + k]! * B[k * 4 + c]!;
      out[r * 4 + c] = v;
    }
  }
  return out;
}

const dE = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

type Pair = { x: [number, number, number]; y: [number, number, number]; piece: number };

/** Fit, then refit twice without the worst TRIM share (misaligned blocks). */
function robustFit(all: Pair[]): { A: number[]; kept: Pair[] } | null {
  let pairs = all;
  let A = fitAffine(pairs);
  for (let round = 0; A && round < 2; round++) {
    const r = pairs.map((p) => ({ p, e: dE(apply(A!, p.x), p.y) })).sort((x, y) => x.e - y.e);
    pairs = r.slice(0, Math.max(60, Math.round(r.length * (1 - TRIM)))).map((q) => q.p);
    A = fitAffine(pairs);
  }
  return A ? { A, kept: pairs } : null;
}

/** Median of the colour differences (robust to misaligned blocks). */
const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1] ?? Infinity;

/**
 * The colour transform from pieces whose spot is known; null with fewer than `minPieces`. `base`:
 * the current match, to tell whether the learned one is better (ColourFit.useful).
 */
export function fitColour(box: BoxGrid, samples: ColourSample[], minPieces = 12, base: ColourMatch | null = null): ColourFit | null {
  const pairs: Pair[] = [];
  let pieces = 0;
  // Learned on top of the current match: the pieces' colours as the current match puts them.
  const onBase = (x: [number, number, number]): [number, number, number] => {
    if (!base) return x;
    const v = Float32Array.from(x);
    applyColourMatch(v, base);
    return [v[0]!, v[1]!, v[2]!];
  };
  samples.forEach((s, k) => {
    if (s.col < 0 || s.row < 0 || s.col >= box.cols || s.row >= box.rows) return;
    const pb = turn(patchBlocks(s.patch), s.rot);
    const bb = boxBlocks(box, s.col, s.row);
    let used = 0;
    pb.forEach((x, i) => {
      if (x) (pairs.push({ x: onBase(x), y: bb[i]!, piece: k }), used++);
    });
    if (used >= 4) pieces++;
  });
  if (pieces < minPieces || pairs.length < 60) return null;
  const before = pairs.reduce((s, p) => s + dE(p.x, p.y), 0) / pairs.length;
  const fit = robustFit(pairs);
  if (!fit) return null;
  const after = fit.kept.reduce((s, p) => s + dE(apply(fit.A, p.x), p.y), 0) / fit.kept.length;
  // Held out: three folds by piece.
  const errL: number[] = [];
  const errB: number[] = [];
  for (let f = 0; f < 3; f++) {
    const train = pairs.filter((p) => p.piece % 3 !== f);
    const test = pairs.filter((p) => p.piece % 3 === f);
    const ff = train.length >= 60 ? robustFit(train) : null;
    if (!ff) continue;
    for (const p of test) {
      errL.push(dE(apply(ff.A, p.x), p.y));
      errB.push(dE(p.x, p.y));
    }
  }
  const heldOut = median(errL);
  const heldOutBase = median(errB);
  return {
    affine: compose(fit.A, base).map((v) => Math.round(v * 1e5) / 1e5),
    n: fit.kept.length,
    before,
    after,
    heldOut,
    heldOutBase,
    useful: heldOut < CV_GAIN * heldOutBase,
  };
}
