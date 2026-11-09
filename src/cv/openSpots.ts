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
  /** How alike the turned photo and the box picture are (−1…1), and the next best turn's. */
  fit: number;
  runnerUp: number;
}

/**
 * Turns the empty spots found in a photo of the finished puzzle (`cols` × `rows` as counted in the
 * photo, `thumb` its straightened picture) to match the box picture. Null when the photo's grid
 * doesn't fit the box's in any turn.
 */
export function orientSpots(box: BoxGrid, thumb: PixelBuffer, cols: number, rows: number, gaps: Array<[number, number]>): OrientedSpots | null {
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

/**
 * One piece per empty spot: `byPiece` holds each piece's scores at every empty spot (placePiece
 * with `full`). Returns each piece's spot, its chance and verdict (PLACE.gapStrongP / gapLikelyP).
 */
export function chooseSpots(byPiece: Array<{ id: string; placement: Placement }>, cells: Array<[number, number]>): Map<string, SpotChoice> {
  const key = (c: number, r: number) => `${c},${r}`;
  const index = new Map(cells.map(([c, r], j) => [key(c, r), j]));
  const spots = new Map<string, Map<number, PlacementSpot>>();
  const score = byPiece.map(({ id, placement }) => {
    const row = new Array<number>(cells.length).fill(Number.NEGATIVE_INFINITY);
    const m = new Map<number, PlacementSpot>();
    for (const t of placement.top) {
      const j = index.get(key(t.col, t.row));
      if (j === undefined) continue;
      row[j] = t.score;
      m.set(j, t);
    }
    spots.set(id, m);
    return row;
  });
  const out = new Map<string, SpotChoice>();
  if (!byPiece.length) return out;
  const pick = bestAssignment(score, PLACE.gapMinScore);
  const chance = pairChances(score, PLACE.gapMinScore, PLACE.gapTemperature);
  byPiece.forEach(({ id }, i) => {
    const m = spots.get(id)!;
    const order = [...m.keys()].sort((a, b) => chance[i]![b]! - chance[i]![a]! || score[i]![b]! - score[i]![a]!);
    const j = pick[i]!;
    if (j >= 0) (order.splice(order.indexOf(j), 1), order.unshift(j));
    const top = order.map((k) => ({ ...m.get(k)!, p: chance[i]![k]! }));
    const p1 = j >= 0 ? chance[i]![j]! : 0;
    out.set(id, {
      placement: { top, verdict: p1 >= PLACE.gapStrongP ? 'strong' : p1 >= PLACE.gapLikelyP ? 'likely' : 'several' },
      fits: j >= 0,
    });
  });
  return out;
}
