/**
 * Jigsaw cut: a grid of cells whose inner sides carry a knob made of cubic Béziers (own design,
 * in the spirit of Draradech's CC0 generator), with jitter of knob position, head radius, neck
 * width, knob height, lean and shoulder waviness. Every side is computed ONCE in puzzle mm and
 * shared by the two pieces (one walks it forwards, the other backwards), so neighbouring sides
 * are exact complements by construction.
 */
import { rng } from '../helpers/images';
import type { CutStyle, SideType, SynthPiece } from './types';

type Pt = [number, number];

/** Spacing of outline points along the cut (mm). */
const STEP_MM = 0.15;
const KAPPA = 0.5523;

interface KnobParams {
  /** Knob centre along the side (0..1). */
  c: number;
  /** Lean of the head along the side (mm). */
  lean: number;
  r: number;
  ry: number;
  height: number;
  neckL: number;
  neckR: number;
  baseL: number;
  baseR: number;
  /** Shoulder waviness (mm) near each end and the dip before the neck. */
  a: number;
  e: number;
  dipL: number;
  dipR: number;
}

interface Edge {
  p0: Pt;
  p1: Pt;
  /** +1: knob goes to the side's +normal (right-hand side when walking p0 → p1 on screen); −1: the other way; 0: border. */
  sign: number;
  params: KnobParams | null;
  pts: Pt[];
}

function jitterScale(cut: CutStyle): number {
  return cut === 'uniform' ? 0.15 : 1;
}

function drawParams(r: () => number, S: number, cut: CutStyle): KnobParams {
  const j = jitterScale(cut);
  const u = (a: number) => (r() * 2 - 1) * a * j; // uniform ±a, scaled by style
  const head = 0.145 * S * (1 + u(0.12));
  const neck = 0.092 * S * (1 + u(0.15));
  const asym = u(0.06) * S;
  const base = 0.06 * S * (1 + u(0.25));
  return {
    c: 0.5 + u(0.035),
    lean: u(0.02) * S,
    r: head,
    ry: head * (1 + u(0.07)),
    height: 0.27 * S * (1 + u(0.08)),
    neckL: Math.max(0.06 * S, neck + asym * 0.15),
    neckR: Math.max(0.06 * S, neck - asym * 0.15),
    baseL: base,
    baseR: base * (1 + u(0.15)),
    a: u(0.02) * S,
    e: u(0.02) * S,
    dipL: -Math.abs(u(0.012) * S) - 0.004 * S,
    dipR: -Math.abs(u(0.012) * S) - 0.004 * S,
  };
}

function cubic(out: Pt[], p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 40): void {
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const m = 1 - t;
    const a = m * m * m;
    const b = 3 * m * m * t;
    const c = 3 * m * t * t;
    const d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
}

/** The knob curve in side-local mm: x along the chord (0..L), y towards the knob. */
function knobCurve(L: number, k: KnobParams): Pt[] {
  const X = k.c * L;
  const hx = X + k.lean;
  const hc = k.height - k.ry;
  const hn = 0.45 * hc;
  const xnL = hx - k.neckL;
  const xnR = hx + k.neckR;
  const xL = xnL - k.baseL;
  const xR = xnR + k.baseR;
  const pts: Pt[] = [[0, 0]];
  cubic(pts, [0, 0], [0.35 * xL, k.a], [0.75 * xL, k.dipL], [xL, 0]);
  cubic(pts, [xL, 0], [xL + 0.8 * k.baseL, 0], [xnL, hn - 0.55 * hn], [xnL, hn]);
  cubic(pts, [xnL, hn], [xnL, hn + 0.55 * (hc - hn)], [hx - k.r, hc - 0.6 * (hc - hn)], [hx - k.r, hc]);
  cubic(pts, [hx - k.r, hc], [hx - k.r, hc + KAPPA * k.ry], [hx - KAPPA * k.r, hc + k.ry], [hx, hc + k.ry]);
  cubic(pts, [hx, hc + k.ry], [hx + KAPPA * k.r, hc + k.ry], [hx + k.r, hc + KAPPA * k.ry], [hx + k.r, hc]);
  cubic(pts, [hx + k.r, hc], [hx + k.r, hc - 0.6 * (hc - hn)], [xnR, hn + 0.55 * (hc - hn)], [xnR, hn]);
  cubic(pts, [xnR, hn], [xnR, hn - 0.55 * hn], [xR - 0.8 * k.baseR, 0], [xR, 0]);
  cubic(pts, [xR, 0], [xR + 0.25 * (L - xR), k.dipR], [L - 0.35 * (L - xR), k.e], [L, 0]);
  return pts;
}

/** Resamples a polyline at (nearly) equal spacing, keeping both ends exactly. */
function resample(pts: Pt[], step: number): Pt[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const total = cum[cum.length - 1]!;
  const n = Math.max(2, Math.round(total / step));
  const out: Pt[] = [pts[0]!];
  let j = 1;
  for (let i = 1; i < n; i++) {
    const s = (total * i) / n;
    while (j < pts.length - 1 && cum[j]! < s) j++;
    const s0 = cum[j - 1]!;
    const s1 = cum[j]!;
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const a = pts[j - 1]!;
    const b = pts[j]!;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

function buildEdgePoints(e: Edge): Pt[] {
  const dx = e.p1[0] - e.p0[0];
  const dy = e.p1[1] - e.p0[1];
  const L = Math.hypot(dx, dy);
  const ux = dx / L;
  const uy = dy / L;
  // Right-hand normal on screen (y down): (x, y) → (−y, x).
  const nx = -uy * (e.sign || 1);
  const ny = ux * (e.sign || 1);
  const local: Pt[] = e.params ? knobCurve(L, e.params) : [[0, 0], [L, 0]];
  const world = local.map(([x, y]): Pt => [e.p0[0] + ux * x + nx * y, e.p0[1] + uy * x + ny * y]);
  return resample(world, STEP_MM);
}

export interface CutResult {
  pieces: SynthPiece[];
}

/**
 * Cuts a cols × rows grid. Pieces are returned row by row. Outlines are in piece-local mm
 * (origin at the nominal cell centre).
 */
export function cutPuzzle(cols: number, rows: number, cellMm: [number, number], seed: number, cut: CutStyle): CutResult {
  const [w, h] = cellMm;
  const S = (w + h) / 2;
  const r = rng(seed * 2654435761 + 17);
  const j = jitterScale(cut);
  const cornerJ = 0.25 * j;

  // Grid vertices, jittered (border vertices only along the border; puzzle corners fixed).
  const V: Pt[][] = [];
  for (let y = 0; y <= rows; y++) {
    const row: Pt[] = [];
    for (let x = 0; x <= cols; x++) {
      const jx = x === 0 || x === cols ? 0 : (r() * 2 - 1) * cornerJ;
      const jy = y === 0 || y === rows ? 0 : (r() * 2 - 1) * cornerJ;
      row.push([x * w + jx, y * h + jy]);
    }
    V.push(row);
  }

  // Horizontal edges H[y][x]: V[y][x] → V[y][x+1]; +normal = +y (into row y).
  // Vertical edges Vt[y][x]: V[y][x] → V[y+1][x]; +normal = −x (into column x − 1).
  const mkEdge = (p0: Pt, p1: Pt, border: boolean): Edge => {
    const e: Edge = { p0, p1, sign: 0, params: null, pts: [] };
    if (!border) {
      e.sign = r() < 0.5 ? 1 : -1;
      e.params = drawParams(r, S, cut);
    }
    e.pts = buildEdgePoints(e);
    return e;
  };
  const Hz: Edge[][] = [];
  for (let y = 0; y <= rows; y++) {
    const row: Edge[] = [];
    for (let x = 0; x < cols; x++) row.push(mkEdge(V[y]![x]!, V[y]![x + 1]!, y === 0 || y === rows));
    Hz.push(row);
  }
  const Vt: Edge[][] = [];
  for (let y = 0; y < rows; y++) {
    const row: Edge[] = [];
    for (let x = 0; x <= cols; x++) row.push(mkEdge(V[y]![x]!, V[y + 1]![x]!, x === 0 || x === cols));
    Vt.push(row);
  }

  const outlineOf = (x: number, y: number) => {
    const top = Hz[y]![x]!.pts;
    const right = Vt[y]![x + 1]!.pts;
    const bottom = [...Hz[y + 1]![x]!.pts].reverse();
    const left = [...Vt[y]![x]!.pts].reverse();
    const pts: Pt[] = [];
    const idx: number[] = [];
    for (const side of [top, right, bottom, left]) {
      idx.push(pts.length);
      for (let i = 0; i < side.length - 1; i++) pts.push(side[i]!);
    }
    return { pts, idx: idx as [number, number, number, number] };
  };

  // Re-draw knobs of pieces whose outline comes too close to itself (two knobs meeting near a corner).
  const redraw = (e: Edge) => {
    if (!e.params) return;
    e.params = drawParams(r, S, cut);
    e.pts = buildEdgePoints(e);
  };
  for (let pass = 0; pass < 20; pass++) {
    let bad = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (!tooClose(outlineOf(x, y).pts, 0.6, 30)) continue;
        bad++;
        redraw(Hz[y]![x]!);
        redraw(Hz[y + 1]![x]!);
        redraw(Vt[y]![x]!);
        redraw(Vt[y]![x + 1]!);
      }
    if (!bad) break;
    if (pass === 19) throw new Error('cutPuzzle: could not make non-touching knobs');
  }

  const pieces: SynthPiece[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const { pts, idx } = outlineOf(x, y);
      const cx = (x + 0.5) * w;
      const cy = (y + 0.5) * h;
      const outlineMm: number[] = [];
      for (const p of pts) outlineMm.push(p[0] - cx, p[1] - cy);
      const cornersMm: number[] = [];
      for (const i of idx) cornersMm.push(pts[i]![0] - cx, pts[i]![1] - cy);
      const top: SideType = y === 0 ? 'flat' : Hz[y]![x]!.sign > 0 ? 'blank' : 'tab';
      const bottom: SideType = y === rows - 1 ? 'flat' : Hz[y + 1]![x]!.sign > 0 ? 'tab' : 'blank';
      const right: SideType = x === cols - 1 ? 'flat' : Vt[y]![x + 1]!.sign > 0 ? 'blank' : 'tab';
      const left: SideType = x === 0 ? 'flat' : Vt[y]![x]!.sign > 0 ? 'tab' : 'blank';
      pieces.push({ id: `r${y}c${x}`, col: x, row: y, sides: [top, right, bottom, left], outlineMm, cornersMm, cornerIdx: idx });
    }
  return { pieces };
}

/** True if two points of the closed outline that are > `skip` points apart are closer than `minMm`. */
function tooClose(pts: Pt[], minMm: number, skip: number): boolean {
  const n = pts.length;
  const cell = minMm;
  const grid = new Map<number, number[]>();
  const key = (gx: number, gy: number) => gx * 100003 + gy;
  for (let i = 0; i < n; i++) {
    const gx = Math.floor(pts[i]![0] / cell);
    const gy = Math.floor(pts[i]![1] / cell);
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++) {
        const list = grid.get(key(gx + ox, gy + oy));
        if (!list) continue;
        for (const k of list) {
          const d = Math.abs(i - k);
          if (Math.min(d, n - d) <= skip) continue;
          if (Math.hypot(pts[i]![0] - pts[k]![0], pts[i]![1] - pts[k]![1]) < minMm) return true;
        }
      }
    const k0 = key(gx, gy);
    const l = grid.get(k0);
    if (l) l.push(i);
    else grid.set(k0, [i]);
  }
  return false;
}
