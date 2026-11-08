/**
 * Shape reading (M3): from one piece's outline, find its 4 corners and say for each side whether
 * it is flat (the puzzle's border), a tab (knob out) or a blank (hole in), with a confidence.
 *
 * Plain TypeScript on the outline only (table mm, any rotation, either winding), so it runs on
 * stored catalog outlines without the photo.
 *
 * 1. Resample the outline to N points evenly spaced along its length.
 * 2. Corner candidates: points where the outline turns sharply outwards (≈ 90°), measured over
 *    ±1.5 mm; local maxima only.
 * 3. Choose the 4 candidates (in outline order) that best form the piece's base rectangle: angles
 *    near 90°, opposite sides equal (and near the expected cell size when known), and every side
 *    running along the chord between its corners near both ends (a side's "shoulders" lie on the
 *    straight line, whatever its knob does in the middle).
 * 4. Each side: the outline's signed distance from the chord (outwards positive). A bump outwards
 *    of more than ~15 % of the side length is a tab, inwards a blank, and an outline that stays
 *    within ~6 % is flat. In between: unsure.
 * 5. Piece type from the flat sides: 2 adjacent → corner, 1 → edge, 0 → interior; anything else
 *    (2 opposite flats, 3+) is not a real piece: the read failed.
 */
import type { Vec2 } from '../project/types';

export type SideKind = 'flat' | 'tab' | 'blank' | 'unsure';
export type PieceKind = 'corner' | 'edge' | 'interior';

export interface SideRead {
  kind: SideKind;
  /** 0–1: how clearly the side is what it is said to be. */
  conf: number;
  /** Largest bump outwards / inwards from the chord (mm, both ≥ 0). */
  outMm: number;
  inMm: number;
  /** Chord length between the side's corners (mm). */
  lengthMm: number;
  /** The same bumps in the side's middle (where knobs are), mm. */
  outMidMm: number;
  inMidMm: number;
  /** The side's curve from its first corner to its second, PROFILE_N points evenly spaced along it,
   *  in the side's own frame: [along the chord (mm), outwards (mm)], flat. For piece-to-piece matching. */
  profile: number[];
}

/** Points in each side's profile. */
export const PROFILE_N = 48;

/**
 * How far apart two sides' shapes are if side `b` were joined to side `a` (mm, mean distance
 * between matching points): b is turned round (it runs the other way along the shared seam, and
 * its "outwards" points into a). A tab and its own blank give ~the tracing noise; other pairs more.
 */
export function sideDistance(a: SideRead, b: SideRead): number {
  const n = PROFILE_N;
  const lb = b.lengthMm;
  // b turned round: along → its length − along, outwards → inwards, in reverse order.
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const bx = new Float64Array(n);
  const by = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = n - 1 - i;
    ax[i] = a.profile[2 * i]!;
    ay[i] = a.profile[2 * i + 1]!;
    bx[i] = lb - b.profile[2 * j]!;
    by[i] = -b.profile[2 * j + 1]!;
  }
  // Best rigid fit of b onto a (rotation + shift, least squares): the corners are found to a few
  // tenths of a mm, and the two pieces' seam is shared exactly only after sliding them together.
  let mxa = 0;
  let mya = 0;
  let mxb = 0;
  let myb = 0;
  for (let i = 0; i < n; i++) ((mxa += ax[i]!), (mya += ay[i]!), (mxb += bx[i]!), (myb += by[i]!));
  mxa /= n;
  mya /= n;
  mxb /= n;
  myb /= n;
  let sc = 0;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const px = bx[i]! - mxb;
    const py = by[i]! - myb;
    const qx = ax[i]! - mxa;
    const qy = ay[i]! - mya;
    sc += px * qx + py * qy;
    ss += px * qy - py * qx;
  }
  const th = Math.atan2(ss, sc);
  const c = Math.cos(th);
  const s = Math.sin(th);
  let d = 0;
  for (let i = 0; i < n; i++) {
    const px = bx[i]! - mxb;
    const py = by[i]! - myb;
    d += Math.hypot(c * px - s * py - (ax[i]! - mxa), s * px + c * py - (ay[i]! - mya));
  }
  return d / n;
}

export interface ShapeRead {
  /** The 4 corners (same frame as the input outline), in outline order. */
  corners: [Vec2, Vec2, Vec2, Vec2];
  /** Sides in outline order: side k runs from corner k to corner k + 1. */
  sides: [SideRead, SideRead, SideRead, SideRead];
  /** Null when the sides don't make a real piece (or a side is unsure). */
  kind: PieceKind | null;
  /** 0–1: rectangle fit × the least sure side. Below READ_OK the read is not trusted. */
  quality: number;
  /** 0–1: how well the 4 corners form the piece's base rectangle (with straight shoulders). */
  fit: number;
}

/** A read at least this good is used for groups (Border mode). */
export const READ_OK = 0.5;
/** A rectangle fit at least this good doesn't lower the read's quality. */
const FIT_OK = 0.1;

const N = 240;
/** Turning measured over ±this arc (mm). */
const TURN_MM = 1.5;
/** Corner candidates turn at least this much (deg). */
const MIN_TURN = 45;
/** Points near the chord at a side's ends ("shoulders"): within this distance (mm)… */
const SHOULDER_MM = 0.9;
/** …over this share of the side at each end. */
const SHOULDER_SHARE = 0.18;
/** In a side's middle (× side length): out at least TAB_REL is a tab (≈ 2.5 mm on 18.6 mm), in at
 *  least BLANK_REL a blank (≈ 0.6 mm); flat stays out less than FLAT_OUT_REL (≈ 1.5 mm) and in less than BLANK_REL. */
const TAB_REL = 0.135;
const BLANK_REL = 0.032;
const FLAT_OUT_REL = 0.08;
/** A side's middle (share of its length), where knobs and blanks are. */
const MID = [0.3, 0.7] as const;

function resample(poly: ArrayLike<number>, n: number): Float64Array {
  const m = poly.length / 2;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    cum[i + 1] = cum[i]! + Math.hypot(poly[2 * j]! - poly[2 * i]!, poly[2 * j + 1]! - poly[2 * i + 1]!);
  }
  const L = cum[m]!;
  const out = new Float64Array(2 * n);
  let s = 0;
  for (let k = 0; k < n; k++) {
    const t = (k / n) * L;
    while (s < m - 1 && cum[s + 1]! < t) s++;
    const j = (s + 1) % m;
    const f = (t - cum[s]!) / Math.max(1e-9, cum[s + 1]! - cum[s]!);
    out[2 * k] = poly[2 * s]! + f * (poly[2 * j]! - poly[2 * s]!);
    out[2 * k + 1] = poly[2 * s + 1]! + f * (poly[2 * j + 1]! - poly[2 * s + 1]!);
  }
  return out;
}

/** An open polyline re-spaced to n points evenly along its length (first and last kept). */
function respaceOpen(poly: number[], n: number): number[] {
  const m = poly.length / 2;
  const cum = [0];
  for (let i = 1; i < m; i++) cum.push(cum[i - 1]! + Math.hypot(poly[2 * i]! - poly[2 * i - 2]!, poly[2 * i + 1]! - poly[2 * i - 1]!));
  const L = cum[m - 1]!;
  const out: number[] = [];
  let s = 0;
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * L;
    while (s < m - 2 && cum[s + 1]! < t) s++;
    const f = Math.min(1, Math.max(0, (t - cum[s]!) / Math.max(1e-9, cum[s + 1]! - cum[s]!)));
    out.push(poly[2 * s]! + f * (poly[2 * s + 2]! - poly[2 * s]!), poly[2 * s + 1]! + f * (poly[2 * s + 3]! - poly[2 * s + 1]!));
  }
  return out;
}

function signedArea(p: Float64Array): number {
  const n = p.length / 2;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[2 * i]! * p[2 * j + 1]! - p[2 * j]! * p[2 * i + 1]!;
  }
  return a / 2;
}

function perimeter(poly: ArrayLike<number>): number {
  const m = poly.length / 2;
  let L = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    L += Math.hypot(poly[2 * j]! - poly[2 * i]!, poly[2 * j + 1]! - poly[2 * i + 1]!);
  }
  return L;
}

/**
 * Reads one outline. `cellMm` (the puzzle's cell size, e.g. [17.8, 19.4]) helps choose the corners
 * when known. Null when no 4 corners form a believable piece rectangle.
 */
export function readShape(outline: ArrayLike<number>, cellMm?: Vec2 | null): ShapeRead | null {
  if (outline.length < 16) return null;
  const L = perimeter(outline);
  if (!(L > 0)) return null;
  const p = resample(outline, N);
  // Counter-clockwise in maths axes (positive area): outwards is to the right of the direction of travel.
  if (signedArea(p) < 0) {
    for (let i = 0, j = N - 1; i < j; i++, j--) {
      const x = p[2 * i]!;
      const y = p[2 * i + 1]!;
      p[2 * i] = p[2 * j]!;
      p[2 * i + 1] = p[2 * j + 1]!;
      p[2 * j] = x;
      p[2 * j + 1] = y;
    }
  }
  const step = L / N;
  const at = (i: number): Vec2 => {
    const k = ((i % N) + N) % N;
    return [p[2 * k]!, p[2 * k + 1]!];
  };

  // 2. Turning angle (convex positive) over ±TURN_MM.
  const k = Math.max(2, Math.round(TURN_MM / step));
  const turn = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = at(i - k);
    const b = at(i);
    const c = at(i + k);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    turn[i] = (Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI;
  }
  const cand: number[] = [];
  const w = Math.max(2, Math.round(k * 0.8));
  for (let i = 0; i < N; i++) {
    if (turn[i]! < MIN_TURN) continue;
    let max = true;
    for (let d = -w; d <= w && max; d++) if (d && turn[(i + d + N) % N]! > turn[i]!) max = false;
    if (max) cand.push(i);
  }
  if (cand.length < 4) return null;
  // Keep the sharpest 18 (enough for knob shoulders and the 4 corners).
  if (cand.length > 18) {
    cand.sort((a, b) => turn[b]! - turn[a]!);
    cand.length = 18;
    cand.sort((a, b) => a - b);
  }

  // 3. Best 4.
  const sideFit = (i0: number, i1: number): { shoulder: number; len: number } => {
    const a = at(i0);
    const b = at(i1);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = (i1 - i0 + N) % N;
    if (len < 1e-6 || n < 4) return { shoulder: 0, len };
    const tx = (b[0] - a[0]) / len;
    const ty = (b[1] - a[1]) / len;
    let ok = 0;
    let tot = 0;
    for (let j = 1; j < n; j++) {
      const q = at(i0 + j);
      const along = (q[0] - a[0]) * tx + (q[1] - a[1]) * ty;
      const rel = along / len;
      if (rel > SHOULDER_SHARE && rel < 1 - SHOULDER_SHARE) continue;
      tot++;
      if (Math.abs((q[0] - a[0]) * ty - (q[1] - a[1]) * tx) < SHOULDER_MM) ok++;
    }
    return { shoulder: tot ? ok / tot : 0, len };
  };
  const cache = new Map<number, { shoulder: number; len: number }>();
  const fit = (i0: number, i1: number) => {
    const key = i0 * N + i1;
    let v = cache.get(key);
    if (!v) cache.set(key, (v = sideFit(i0, i1)));
    return v;
  };
  let best: { idx: number[]; score: number; rect: number } | null = null;
  const C = cand.length;
  for (let a = 0; a < C; a++)
    for (let b = a + 1; b < C; b++)
      for (let c = b + 1; c < C; c++)
        for (let d = c + 1; d < C; d++) {
          const idx = [cand[a]!, cand[b]!, cand[c]!, cand[d]!];
          // Each side spans a reasonable share of the outline (a side with a tab can be ~40 %).
          let bad = false;
          for (let s = 0; s < 4; s++) {
            const span = (idx[(s + 1) % 4]! - idx[s]! + N) % N;
            if (span < 0.08 * N || span > 0.5 * N) bad = true;
          }
          if (bad) continue;
          const P = idx.map(at);
          const lens: number[] = [];
          let angPen = 0;
          let convex = true;
          for (let s = 0; s < 4; s++) {
            const u = P[s]!;
            const v = P[(s + 1) % 4]!;
            const q = P[(s + 3) % 4]!;
            lens.push(Math.hypot(v[0] - u[0], v[1] - u[1]));
            const e1x = v[0] - u[0];
            const e1y = v[1] - u[1];
            const e0x = u[0] - q[0];
            const e0y = u[1] - q[1];
            const cr = e0x * e1y - e0y * e1x;
            if (cr <= 0) convex = false;
            const ang = (Math.atan2(cr, e0x * e1x + e0y * e1y) * 180) / Math.PI;
            angPen += Math.abs(ang - 90);
          }
          if (!convex) continue;
          const opp = Math.abs(lens[0]! - lens[2]!) / Math.max(lens[0]!, lens[2]!) + Math.abs(lens[1]! - lens[3]!) / Math.max(lens[1]!, lens[3]!);
          let sizePen = 0;
          if (cellMm) {
            const w0 = (lens[0]! + lens[2]!) / 2;
            const h0 = (lens[1]! + lens[3]!) / 2;
            const e1 = Math.abs(w0 / cellMm[0] - 1) + Math.abs(h0 / cellMm[1] - 1);
            const e2 = Math.abs(w0 / cellMm[1] - 1) + Math.abs(h0 / cellMm[0] - 1);
            sizePen = Math.min(e1, e2);
          } else {
            // Without a cell size: a piece's base is near-square (aspect ≤ ~1.3).
            const w0 = (lens[0]! + lens[2]!) / 2;
            const h0 = (lens[1]! + lens[3]!) / 2;
            sizePen = Math.max(0, Math.max(w0, h0) / Math.min(w0, h0) - 1.3);
          }
          let shoulder = 0;
          for (let s = 0; s < 4; s++) shoulder += fit(idx[s]!, idx[(s + 1) % 4]!).shoulder;
          shoulder /= 4;
          // Corner sharpness: each corner turns near 90°.
          let sharp = 0;
          for (const i of idx) sharp += Math.min(1, turn[i]! / 80);
          sharp /= 4;
          const rect = Math.exp(-angPen / 40) * Math.exp(-opp / 0.25) * Math.exp(-sizePen / 0.2);
          const score = rect * (0.3 + 0.7 * shoulder) * (0.5 + 0.5 * sharp);
          if (!best || score > best.score) best = { idx, score, rect: rect * (0.3 + 0.7 * shoulder) };
        }
  if (!best) return null;

  // 4. Sides.
  const P = best.idx.map(at);
  const cx = (P[0]![0] + P[1]![0] + P[2]![0] + P[3]![0]) / 4;
  const cy = (P[0]![1] + P[1]![1] + P[2]![1] + P[3]![1]) / 4;
  const sides: SideRead[] = [];
  for (let s = 0; s < 4; s++) {
    const i0 = best.idx[s]!;
    const i1 = best.idx[(s + 1) % 4]!;
    const a = P[s]!;
    const b = P[(s + 1) % 4]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tx = (b[0] - a[0]) / len;
    const ty = (b[1] - a[1]) / len;
    // Outward normal: away from the base rectangle's centre.
    let nx = ty;
    let ny = -tx;
    if (((a[0] + b[0]) / 2 - cx) * nx + ((a[1] + b[1]) / 2 - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    let out = 0;
    let inn = 0;
    let outMid = 0;
    let inMid = 0;
    const n = (i1 - i0 + N) % N;
    for (let j = 1; j < n; j++) {
      const q = at(i0 + j);
      const along = ((q[0] - a[0]) * tx + (q[1] - a[1]) * ty) / len;
      // Ignore the rounded corners themselves.
      if (along < 0.1 || along > 0.9) continue;
      const dv = (q[0] - a[0]) * nx + (q[1] - a[1]) * ny;
      if (dv > out) out = dv;
      if (-dv > inn) inn = -dv;
      if (along > MID[0] && along < MID[1]) {
        if (dv > outMid) outMid = dv;
        if (-dv > inMid) inMid = -dv;
      }
    }
    // Decided on the side's middle, in units of the side length (traced outlines, val48: a flat
    // side never dips inwards there — 99 % < 0.9 mm — but may bulge out ≤ 1 mm with its wall or
    // shadow; tabs reach out ≥ 3 mm; a blank whose hollow is partly filled by a shadow still dips).
    const o = outMid / len;
    const i = inMid / len;
    let kind: SideKind;
    let conf: number;
    if (o >= TAB_REL && o > i) {
      kind = 'tab';
      conf = Math.min(1, 0.5 + (o - TAB_REL) / TAB_REL) * (1 - Math.min(1, i / o));
    } else if (i >= BLANK_REL && i > o) {
      kind = 'blank';
      conf = Math.min(1, (i - BLANK_REL) / (TAB_REL - BLANK_REL)) * (1 - Math.min(1, o / i));
    } else if (o < FLAT_OUT_REL && i < BLANK_REL) {
      kind = 'flat';
      conf = 1 - 0.7 * Math.max(o / FLAT_OUT_REL, i / BLANK_REL);
    } else {
      kind = 'unsure';
      conf = 0;
    }
    // Profile: the side's points (corner to corner) evenly re-spaced along their own length.
    const raw: number[] = [];
    for (let j = 0; j <= n; j++) {
      const q = at(i0 + j);
      raw.push((q[0] - a[0]) * tx + (q[1] - a[1]) * ty, (q[0] - a[0]) * nx + (q[1] - a[1]) * ny);
    }
    const profile = respaceOpen(raw, PROFILE_N);
    sides.push({ kind, conf: Math.max(0, Math.min(1, conf)), outMm: out, inMm: inn, lengthMm: len, outMidMm: outMid, inMidMm: inMid, profile });
  }

  // 5. Piece type.
  const flats = sides.map((s) => s.kind === 'flat');
  const nFlat = flats.filter(Boolean).length;
  let kind: PieceKind | null = null;
  if (sides.every((s) => s.kind !== 'unsure')) {
    if (nFlat === 0) kind = 'interior';
    else if (nFlat === 1) kind = 'edge';
    else if (nFlat === 2 && flats.some((f, i) => f && flats[(i + 1) % 4])) kind = 'corner';
  }
  const minConf = Math.min(...sides.map((s) => s.conf));
  // Calibrated on traced val48 outlines: reads with a rectangle fit ≥ FIT_OK and every side ≥ 0.5
  // sure were right 97 % of the time (91 % of reads); the rest are shown as not sure.
  const quality = kind ? Math.min(1, best.rect / FIT_OK) * minConf : 0;
  return {
    corners: [P[0]!, P[1]!, P[2]!, P[3]!],
    sides: [sides[0]!, sides[1]!, sides[2]!, sides[3]!],
    kind,
    quality,
    fit: best.rect,
  };
}
