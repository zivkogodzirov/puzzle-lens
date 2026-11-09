/**
 * The empty spots of a nearly finished puzzle (M4, "leftover pieces into the empty spots").
 *
 * The finished-puzzle check (src/cv/assembledGrid.ts) finds the empty spots counted from the photo's
 * top-left, but the photo may show the puzzle turned (sideways or upside down) compared with the box
 * picture. The puzzle is straightened into a small picture (SPOT_THUMB_CELL px per cell) and
 * compared with the box picture in each quarter turn whose shape fits; the turn that looks most like
 * it turns the spots into box-picture columns and rows.
 *
 * Then each leftover piece is scored only at the empty spots, and every piece gets at most one spot
 * and every spot at most one piece (src/cv/assign.ts).
 */
import { applyH, fitHomography } from '../geo/homography';
import type { Vec2 } from '../project/types';
import type { PixelBuffer } from './frameAnalyser';
import { labImage, PLACE, type BoxGrid, type Placement, type PlacementSpot } from './placement';
import { bestAssignment, pairChances } from './assign';

/** Pixels per cell of the straightened finished-puzzle picture kept for turning the spots. */
export const SPOT_THUMB_CELL = 8;

/** A cell (col, row) of a cols × rows grid after turning the grid `t` quarter turns clockwise. */
export function turnCell(col: number, row: number, cols: number, rows: number, t: number): [number, number] {
  switch (((t % 4) + 4) % 4) {
    case 1:
      return [rows - 1 - row, col];
    case 2:
      return [cols - 1 - col, rows - 1 - row];
    case 3:
      return [row, cols - 1 - col];
    default:
      return [col, row];
  }
}

/**
 * The puzzle inside `corners` (photo px: its top-left, top-right, bottom-right, bottom-left)
 * straightened into a W × H RGBA picture (each pixel the average of 3 × 3 samples).
 */
export function straightenQuad(photo: PixelBuffer, corners: Vec2[], W: number, H: number): PixelBuffer {
  const Hm = fitHomography(
    [
      [0, 0],
      [W, 0],
      [W, H],
      [0, H],
    ],
    corners,
  );
  const out = new Uint8Array(W * H * 4);
  if (!Hm) return { data: out, width: W, height: H, stride: W * 4 };
  const { data, stride, width: PW, height: PH } = photo;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 3; i++) {
          const [px, py] = applyH(Hm, [x + (i + 0.5) / 3, y + (j + 0.5) / 3]);
          const ix = Math.round(px - 0.5);
          const iy = Math.round(py - 0.5);
          if (ix < 0 || iy < 0 || ix >= PW || iy >= PH) continue;
          const k = iy * stride + ix * 4;
          r += data[k]!;
          g += data[k + 1]!;
          b += data[k + 2]!;
          n++;
        }
      const o = (y * W + x) * 4;
      if (n) {
        out[o] = r / n;
        out[o + 1] = g / n;
        out[o + 2] = b / n;
      }
      out[o + 3] = 255;
    }
  return { data: out, width: W, height: H, stride: W * 4 };
}

export interface OrientedSpots {
  /** Quarter turns clockwise from the photo's grid to the box picture's. */
  turn: number;
  /** The empty spots in box-picture columns and rows (0-based). */
  cells: Array<[number, number]>;
  /** Their sides (top, right, bottom, left on the box picture), when read in the photo. */
  sides?: string[];
  /** How alike the turned photo and the box picture are (−1…1), and the next best turn's. */
  fit: number;
  runnerUp: number;
}

/**
 * Turns the empty spots found in a photo of the finished puzzle (`cols` × `rows` as counted in the
 * photo, `thumb` its straightened picture) to match the box picture. Null when the photo's grid
 * doesn't fit the box's in any turn.
 */
export function orientSpots(
  box: BoxGrid,
  thumb: PixelBuffer,
  cols: number,
  rows: number,
  gaps: Array<[number, number]>,
  gapSides?: string[],
): OrientedSpots | null {
  const lv = box.levels[0];
  const c = lv.cell;
  // The photo's puzzle at the same scale as the box picture's coarse level, in Lab.
  const ph = labImage(thumb, cols * c, rows * c);
  const gapSet = new Set(gaps.map(([gc, gr]) => gr * cols + gc));
  const fits: Array<{ t: number; z: number }> = [];
  for (let t = 0; t < 4; t++) {
    const [bc, br] = t % 2 ? [rows, cols] : [cols, rows];
    if (bc !== box.cols || br !== box.rows) continue;
    // Per Lab channel, the correlation over every pixel of the photo's puzzle (empty spots left out),
    // compared with the box pixel it lands on after the turn.
    const s = [0, 0, 0];
    const ss = [0, 0, 0];
    const sb = [0, 0, 0];
    const sbb = [0, 0, 0];
    const spb = [0, 0, 0];
    let n = 0;
    const W = cols * c;
    const H = rows * c;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (gapSet.has(Math.floor(y / c) * cols + Math.floor(x / c))) continue;
        // Pixel (x, y) turns like a cell of a W × H grid.
        const [tx, ty] = turnCell(x, y, W, H, t);
        const pi = (y * W + x) * 3;
        const bi = (ty * lv.w + tx) * 3;
        for (let k = 0; k < 3; k++) {
          const p = ph[pi + k]!;
          const b = lv.lab[bi + k]!;
          s[k] = s[k]! + p;
          ss[k] = ss[k]! + p * p;
          sb[k] = sb[k]! + b;
          sbb[k] = sbb[k]! + b * b;
          spb[k] = spb[k]! + p * b;
        }
        n++;
      }
    if (!n) continue;
    let z = 0;
    for (let k = 0; k < 3; k++) {
      const mp = s[k]! / n;
      const mb = sb[k]! / n;
      const vp = Math.max(1e-6, ss[k]! / n - mp * mp);
      const vb = Math.max(1e-6, sbb[k]! / n - mb * mb);
      z += ((spb[k]! / n - mp * mb) / Math.sqrt(vp * vb)) * (k === 0 ? 0.5 : 0.25);
    }
    fits.push({ t, z });
  }
  if (!fits.length) return null;
  fits.sort((a, b) => b.z - a.z);
  const best = fits[0]!;
  return {
    turn: best.t,
    cells: gaps.map(([gc, gr]) => turnCell(gc, gr, cols, rows, best.t)),
    // Turned t quarter turns clockwise, the side that faced d now faces d + t.
    sides: gapSides?.length === gaps.length ? gapSides.map((sd) => [0, 1, 2, 3].map((e) => sd[(e - best.t + 4) % 4]).join('')) : undefined,
    fit: best.z,
    runnerUp: fits[1]?.z ?? -1,
  };
}

/** A piece's spot once each empty spot takes at most one piece. */
export interface SpotChoice {
  /** The spots, the chosen one first, with p = its chance in the one-piece-per-spot pairing. */
  placement: Placement;
  /** False when the piece is better left unpaired (it matches none of the empty spots well). */
  fits: boolean;
}

/** The pieces' and the spots' side shapes, for knob fit (M4 part 3). */
export interface SpotShapes {
  /** Per piece id: its sides in patch order (top, right, bottom, left: 't', 'b', 'f', 'u') and how sure (0–1). */
  pieces: Map<string, { sides: string; conf: number[] }>;
  /** Per spot (same order as the cells): its sides on the box picture ('t', 'b', 'f', 'o' open, '?'), or null. */
  spots: string[] | null;
}

/** Side kind facing direction e (0 top … 3 left) for a piece turned q quarter turns clockwise. */
const facing = (sides: string, q: number, e: number): string => sides[(e - q + 4) % 4] ?? 'u';

/**
 * One piece per empty spot: `byPiece` holds each piece's scores at every empty spot (placePiece
 * with `full`). Returns each piece's spot, its chance and verdict (PLACE.gapStrongP / gapLikelyP).
 *
 * With `shapes` (M4 part 3), the knobs must fit too: a piece's side must be what the hole's outline
 * shows there (read from the photo of the puzzle with its holes), and two pieces in neighbouring
 * empty spots must interlock (knob out against knob in). The best pairing and turns are found by
 * improving the plain pairing one move at a time (swap two pieces, move one to a free spot, turn
 * one); the chances then count each spot's neighbours as placed.
 */
export function chooseSpots(
  byPiece: Array<{ id: string; placement: Placement }>,
  cells: Array<[number, number]>,
  shapes: SpotShapes | null = null,
): Map<string, SpotChoice> {
  const key = (c: number, r: number) => `${c},${r}`;
  const index = new Map(cells.map(([c, r], j) => [key(c, r), j]));
  const P = byPiece.length;
  const S = cells.length;
  const spots = new Map<string, Map<number, PlacementSpot>>();
  // Unary scores per piece × spot × turn.
  const NEG = Number.NEGATIVE_INFINITY;
  const U: number[][][] = byPiece.map(({ id, placement }) => {
    const rows = Array.from({ length: S }, () => [NEG, NEG, NEG, NEG]);
    const m = new Map<number, PlacementSpot>();
    for (const t of placement.top) {
      const j = index.get(key(t.col, t.row));
      if (j === undefined) continue;
      m.set(j, t);
      if (t.rotScores) for (let q = 0; q < 4; q++) rows[j]![q] = t.rotScores[q]!;
      else rows[j]![t.rot] = t.score;
    }
    spots.set(id, m);
    return rows;
  });
  const out = new Map<string, SpotChoice>();
  if (!P) return out;
  const pieceShape = byPiece.map(({ id }) => shapes?.pieces.get(id) ?? null);
  const useShapes = Boolean(shapes && (pieceShape.some(Boolean) || shapes.spots));
  // Knob fit of a piece side against what's needed there.
  const fit = (a: string, ca: number, b: string, cb: number, interlock: boolean): number => {
    if ((a !== 't' && a !== 'b') || (b !== 't' && b !== 'b')) return 0;
    const ok = interlock ? a !== b : a === b;
    return ok ? PLACE.knobMatch * ca * cb : -PLACE.knobMismatch * ca * cb;
  };
  if (useShapes && shapes!.spots)
    for (let i = 0; i < P; i++) {
      const ps = pieceShape[i];
      if (!ps) continue;
      for (let j = 0; j < S; j++) {
        const ss = shapes!.spots[j];
        if (!ss) continue;
        for (let q = 0; q < 4; q++) {
          if (U[i]![j]![q] === NEG) continue;
          let add = 0;
          for (let e = 0; e < 4; e++) add += fit(facing(ps.sides, q, e), ps.conf[(e - q + 4) % 4] ?? 0, ss[e] ?? '?', 1, false);
          U[i]![j]![q]! += add;
        }
      }
    }
  // Neighbouring spots: for spot j and direction e, the spot next to it (or −1).
  const nb = cells.map(([c, r]) => [0, 1, 2, 3].map((e) => index.get(key(c + [0, 1, 0, -1][e]!, r + [-1, 0, 1, 0][e]!)) ?? -1));
  const ub = U.map((rows) => rows.map((r) => Math.max(...r)));
  const minS = PLACE.gapMinScore;
  let a = bestAssignment(ub, minS);
  const turn = a.map((j, i) => (j >= 0 ? U[i]![j]!.indexOf(ub[i]![j]!) : 0));
  const at = new Int32Array(S).fill(-1);
  a.forEach((j, i) => j >= 0 && (at[j] = i));
  /** Knob fit of piece i (turn q) at spot j with whatever pieces are on the neighbouring spots (except `skip`). */
  const pairAt = (i: number, j: number, q: number, skip = -1): number => {
    const ps = pieceShape[i];
    if (!ps) return 0;
    let s = 0;
    for (let e = 0; e < 4; e++) {
      const n = nb[j]![e]!;
      if (n < 0) continue;
      const k = at[n]!;
      if (k < 0 || k === i || k === skip || !pieceShape[k]) continue;
      const kq = turn[k]!;
      const back = (e + 2) % 4;
      s += fit(
        facing(ps.sides, q, e),
        ps.conf[(e - q + 4) % 4] ?? 0,
        facing(pieceShape[k]!.sides, kq, back),
        pieceShape[k]!.conf[(back - kq + 4) % 4] ?? 0,
        true,
      );
    }
    return s;
  };
  if (useShapes) {
    // A piece's part of the total: its score above "unpaired" and its knob fit with its neighbours
    // (with `skip`'s fit left out, so a pair of moved pieces counts their shared side once).
    const part = (i: number, skip = -1): number => (a[i]! >= 0 ? U[i]![a[i]!]![turn[i]!]! - minS + pairAt(i, a[i]!, turn[i]!, skip) : 0);
    const bestTurn = (i: number, j: number, skip = -1): number => {
      let bq = 0;
      let bv = NEG;
      for (let q = 0; q < 4; q++) {
        if (U[i]![j]![q] === NEG) continue;
        const v = U[i]![j]![q]! + pairAt(i, j, q, skip);
        if (v > bv) [bv, bq] = [v, q];
      }
      return bq;
    };
    for (let round = 0; round < 30; round++) {
      let improved = false;
      // Turn each piece.
      for (let i = 0; i < P; i++) {
        if (a[i]! < 0) continue;
        const q0 = turn[i]!;
        const before = part(i);
        turn[i] = bestTurn(i, a[i]!);
        if (part(i) > before + 1e-9) improved = true;
        else turn[i] = q0;
      }
      // Swap two pieces' spots (either may be unpaired), or move a piece to a free spot.
      for (let i1 = 0; i1 < P; i1++)
        for (let i2 = i1 + 1; i2 <= P; i2++) {
          const free = i2 === P;
          const targets = free ? [...Array(S).keys()].filter((j) => at[j]! < 0).concat([-1]) : [a[i2]!];
          for (const j2 of targets) {
            const j1 = a[i1]!;
            if (j1 === j2 || (!free && j1 < 0 && j2 < 0)) continue;
            if (j2 >= 0 && ub[i1]![j2]! === NEG) continue;
            if (!free && j1 >= 0 && ub[i2]![j1]! === NEG) continue;
            const before = part(i1) + (free ? 0 : part(i2, i1));
            const save = { a1: a[i1]!, a2: free ? -2 : a[i2]!, q1: turn[i1]!, q2: free ? 0 : turn[i2]! };
            // Apply.
            if (j1 >= 0) at[j1] = free ? -1 : i2;
            if (j2 >= 0) at[j2] = i1;
            a[i1] = j2;
            if (!free) a[i2] = j1;
            if (j2 >= 0) turn[i1] = bestTurn(i1, j2);
            if (!free && j1 >= 0) turn[i2] = bestTurn(i2, j1);
            if (part(i1) + (free ? 0 : part(i2, i1)) > before + 1e-9) {
              improved = true;
              continue;
            }
            // Undo.
            if (j2 >= 0) at[j2] = free ? -1 : i2;
            if (j1 >= 0) at[j1] = i1;
            a[i1] = save.a1;
            turn[i1] = save.q1;
            if (!free) ((a[i2] = save.a2), (turn[i2] = save.q2));
          }
        }
      if (!improved) break;
    }
  }
  // Chances: each piece's best turn at each spot, counting knob fit with the pieces placed around it.
  const cond = byPiece.map((_, i) =>
    cells.map((__, j) => Math.max(...[0, 1, 2, 3].map((q) => (U[i]![j]![q]! === NEG ? NEG : U[i]![j]![q]! + (useShapes ? pairAt(i, j, q) : 0))))),
  );
  const chance = pairChances(cond, minS, PLACE.gapTemperature);
  if (!useShapes) a = bestAssignment(cond, minS);
  byPiece.forEach(({ id }, i) => {
    const m = spots.get(id)!;
    const order = [...m.keys()].sort((x, y) => chance[i]![y]! - chance[i]![x]! || cond[i]![y]! - cond[i]![x]!);
    const j = a[i]!;
    if (j >= 0) (order.splice(order.indexOf(j), 1), order.unshift(j));
    const top = order.map((k) => {
      const q = k === j ? turn[i]! : (U[i]![k]!.indexOf(Math.max(...U[i]![k]!)) as 0 | 1 | 2 | 3);
      return { ...m.get(k)!, rot: q as 0 | 1 | 2 | 3, p: chance[i]![k]! };
    });
    const p1 = j >= 0 ? chance[i]![j]! : 0;
    out.set(id, {
      placement: { top, verdict: p1 >= PLACE.gapStrongP ? 'strong' : p1 >= PLACE.gapLikelyP ? 'likely' : 'several' },
      fits: j >= 0,
    });
  });
  return out;
}
