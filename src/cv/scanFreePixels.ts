/**
 * One marker-free scan photo after decoding, as the reader worker's scanFree runs it (moved out of
 * the worker 2026-11-10 so its retries can be tested in Node): the pieces placed on the catalog
 * (src/cv/scanMarkerless.ts), the finished-puzzle check, and the retries for a photo that comes out
 * unusable. Coin, patches and pictures stay in the worker.
 */
import type { Cv } from './loadCv';
import type { PixelBuffer } from './frameAnalyser';
import type { FoundPiece, FoundRegion } from './pieceFinder';
import { puzzleQuad, readAssembledGrid, SEAM_OK, type AssembledGrid } from './assembledGrid';
import {
  findPiecesAt,
  flagPartOutlines,
  REAL_PIECE_AREA_SHARE,
  RESCALE_LIMIT,
  scanMarkerless,
  startPxPerMm,
  type PieceRowLike,
  type PrePassMemo,
  type ScanMarkerlessResult,
} from './scanMarkerless';
import type { TableModel } from '../project/types';

export interface FreePixelsOptions {
  catalog: PieceRowLike[];
  pitchMm: number;
  zoom: number;
  kind: 'overview' | 'detail';
  table: TableModel | null;
  /** The box's piece count and the chosen grid: for the finished-puzzle check (none without a count). */
  pieceCount?: number;
  grid?: { cols: number; rows: number } | null;
  /** The scale of an earlier photo (px per mm) and its larger side (px), scaled to this photo's size. */
  scaleHint?: { pxPerMm: number; maxSide: number } | null;
}

export interface FreePixelsResult {
  r: ScanMarkerlessResult;
  /** Set when the photo shows a finished (or nearly finished) puzzle. */
  finished: AssembledGrid | null;
  /**
   * Only for a finished puzzle whose pieces the scan found at a scale far from the puzzle's own
   * (more than RESCALE_LIMIT apart): the pieces found again at the puzzle's scale (photo px), to
   * count the loose ones beside it from (see looseFromGridScale).
   */
  looseFound?: FoundPiece[];
}

/** Finished-puzzle check: the assembled area covers at least this share of the photo… */
export const FINISHED_MIN_SHARE = 0.2;
/** …its seams count within this share of the box's pieces… */
export const FINISHED_COUNT_TOL = 0.06;
/** …and at most this share of its cells look empty. */
export const FINISHED_MAX_GAPS = 0.1;
/** Fewer clean single pieces (not cut, not touching others) than this: the photo can't be used. */
export const MIN_CLEAN_PIECES = 5;
/**
 * A scale hint this close to the nominal starting scale is not retried without it: the scan would
 * start from almost the same place (the same 10 % the scale checks use to decide whether detecting
 * again is worth it).
 */
const HINT_SAME = 0.1;

const isClean = (p: FoundPiece) => !p.flags.cut && !p.flags.clump;
const clean = (r: ScanMarkerlessResult) => r.pieces.filter(isClean).length;
const unusable = (r: ScanMarkerlessResult) => clean(r) < MIN_CLEAN_PIECES;
/** Too few clean single pieces at the scale the scan settled on, whether it was placed or not. */
const spoiled = (r: ScanMarkerlessResult) => (r.registered ? r.pieces : (r.unplaced ?? [])).filter(isClean).length < MIN_CLEAN_PIECES;

export function scanFreePixels(cv: Cv, rgba: PixelBuffer, opts: FreePixelsOptions): FreePixelsResult {
  const base = { catalog: opts.catalog, pitchMm: opts.pitchMm, zoom: opts.zoom, kind: opts.kind, table: opts.table };
  const hint = opts.scaleHint ? (opts.scaleHint.pxPerMm * Math.max(rgba.width, rgba.height)) / opts.scaleHint.maxSide : null;
  // The scale pre-pass depends only on the photo, pitch, zoom and table: the scan with the hint and
  // the one without (below) share it.
  const prePass: PrePassMemo = {};
  let r = scanMarkerless(cv, rgba, { ...base, ppmHint: hint, prePass });
  // The finished check comes first: on a photo of the finished puzzle the pieces are not used, so
  // the retries below can't help it (review 2026-11-10: the other-zoom retry cost 1.4 s on IMG_9272).
  let finished = finishedPuzzle(cv, rgba, r.regions, opts);
  // A stale scale hint (an earlier photo taken from another height) can spoil the photo: too few
  // single pieces come out to measure the scale, so it is not placed either. Then scan once more
  // from the normal starting guess and keep the better result (review 2026-11-10: IMG_9226 with a
  // hint of 10.5 px/mm found 6 pieces instead of 59, 1 of them clean). A photo that can't be placed
  // saves nothing, so a bad hint used to stay for the rest of the batch.
  // Not for every photo that isn't placed: with 5 or more clean pieces its scale was measured, and
  // such a photo usually just doesn't match (a good hint). Scanning those again gave the same answer
  // at 1.4–2× the time (check 2026-11-10: IMG_9127, 9226, 9227 with their own scale as the hint).
  // The cost: IMG_9245 with a stale 3.34 (23 clean pieces at a wrong 3.0 px/mm) stays not placed,
  // as before.
  if (!finished && hint !== null && spoiled(r)) {
    const W = rgba.width;
    const H = rgba.height;
    if (Math.abs(startPxPerMm(W, H, opts.zoom, hint) / startPxPerMm(W, H, opts.zoom, null) - 1) > HINT_SAME) {
      const plain = scanMarkerless(cv, rgba, { ...base, prePass });
      const plainFinished = finishedPuzzle(cv, rgba, plain.regions, opts);
      if (better(plain, plainFinished, r, finished)) {
        r = { ...plain, timings: { ...plain.timings, retriedNoHint: 1 } };
        finished = plainFinished;
      }
    }
  }
  // The camera's zoom reading isn't always right (and a close-up may be taken at 1×): if the
  // photo couldn't be used, try once more assuming the other zoom.
  // Only when it found too few single pieces to measure a scale (a wrong zoom guess); a photo
  // that was measured but didn't match is not retried (that would only double the time).
  if (!finished && unusable(r)) {
    const other = scanMarkerless(cv, rgba, { ...base, zoom: opts.zoom >= 1.5 ? 1 : 2 });
    if (!unusable(other)) {
      r = { ...other, timings: { ...other.timings, retriedOtherZoom: 1 } };
      finished = finishedPuzzle(cv, rgba, r.regions, opts);
    }
  }
  return { r, finished, looseFound: finished ? looseFromGridScale(cv, rgba, r, finished, opts) : undefined };
}

/**
 * The loose pieces beside a finished puzzle are counted from the pieces the scan found, at the
 * scale it settled on. When that is far from the puzzle's own scale (a scale hint from another
 * photo, or a scale measured from the puzzle's picture), the pieces come out as specks or blobs
 * and are not counted, so they are found once more at the puzzle's scale: one more detection, on
 * such photos only (review 2026-11-10: IMG_9244 with the batch's catalog and its overview's
 * 2.86 px/mm as the hint settled at 1.15 px/mm and counted 0 loose pieces; now 16, by eye 14).
 * Undefined when the scan's own pieces will do (within RESCALE_LIMIT, as for all of the owner's
 * finished photos without a hint).
 */
function looseFromGridScale(cv: Cv, rgba: PixelBuffer, r: ScanMarkerlessResult, finished: AssembledGrid, opts: FreePixelsOptions): FoundPiece[] | undefined {
  const at = r.registered ? r.pxPerMm : r.unplacedPxPerMm;
  const own = gridPxPerMm(finished, opts.pitchMm);
  if (!at || Math.abs(at / own - 1) <= RESCALE_LIMIT) return undefined;
  const pieceAreaMm2 = REAL_PIECE_AREA_SHARE * opts.pitchMm * opts.pitchMm;
  return flagPartOutlines(findPiecesAt(cv, rgba, { pxPerMm: own, zoom: opts.zoom, table: opts.table, pieceAreaMm2 }).res.pieces);
}

/** a is better than b: a finished puzzle, else placed, else more clean single pieces. */
function better(a: ScanMarkerlessResult, aFinished: AssembledGrid | null, b: ScanMarkerlessResult, bFinished: AssembledGrid | null): boolean {
  if (Boolean(aFinished) !== Boolean(bFinished)) return Boolean(aFinished);
  if (a.registered !== b.registered) return a.registered;
  return clean(a) > clean(b);
}

/**
 * A finished puzzle: most of the photo is one assembled area whose seams count up to the box's
 * pieces with few gaps (owner's request 2026-11-08). Checked on close-ups too: after the first
 * overview the scan screen switches to close-ups, and the owner's photo of the puzzle with its
 * holes was then read as a close-up, its holes never looked for and 11 of its spots taken for
 * loose pieces (2026-11-09). A close-up of part of the puzzle can't count up to the box's pieces.
 */
export function finishedPuzzle(
  cv: Cv,
  rgba: PixelBuffer,
  regions: FoundRegion[] | undefined,
  opts: { pieceCount?: number; grid?: { cols: number; rows: number } | null },
): AssembledGrid | null {
  if (!opts.pieceCount) return null;
  const big = (regions ?? []).filter((g) => g.kind === 'assembled').sort((a, b) => outlineArea(b.outlineImg) - outlineArea(a.outlineImg))[0];
  if (!big || outlineArea(big.outlineImg) < FINISHED_MIN_SHARE * rgba.width * rgba.height) return null;
  const q = puzzleQuad(cv, rgba, big.outlineImg);
  const g = q ? readAssembledGrid(cv, rgba, q, { pieceCount: opts.pieceCount, grid: opts.grid ?? null }) : null;
  const cells = g ? g.cols * g.rows : 0;
  if (g && g.seamStrength >= SEAM_OK && Math.abs(cells / opts.pieceCount - 1) <= FINISHED_COUNT_TOL && g.gaps.length <= FINISHED_MAX_GAPS * cells) return g;
  return null;
}

/**
 * Loose pieces beside a finished puzzle: outlines a scan would keep (not cut by the photo's edge,
 * not found only in part) whose centre lies at least LOOSE_MIN_OUTSIDE of a cell outside the
 * puzzle, at least LOOSE_MIN_AREA of a piece's top face (the cell size comes from the seams count).
 * Pieces touching each other count once. Owner's photos (2026-11-10): IMG_9280 8, IMG_9281 18,
 * IMG_9244 14, as counted by eye; the bits of floor and shoes beside IMG_9280 (0.3–0.45 of a
 * piece) and the false "pieces" on the puzzle's own picture are left out.
 */
export function loosePiecesBeside(pieces: Array<Pick<FoundPiece, 'outlineImg' | 'flags'>>, grid: Pick<AssembledGrid, 'cornersPx' | 'cols' | 'rows'>): number {
  const quad = grid.cornersPx;
  const cell = outlineArea(quad.flat()) / Math.max(1, grid.cols * grid.rows);
  const side = Math.sqrt(cell);
  let n = 0;
  for (const p of pieces) {
    if (p.flags.cut || p.flags.part || p.outlineImg.length < 6) continue;
    if (outlineArea(p.outlineImg) < LOOSE_MIN_AREA * REAL_PIECE_AREA_SHARE * cell) continue;
    if (outsideBy(quad, centroid(p.outlineImg)) >= LOOSE_MIN_OUTSIDE * side) n++;
  }
  return n;
}

// M10 fix: pieces lying on a nearly finished puzzle (review 2026-11-11, IMG_9244).
/**
 * Pieces lying on the puzzle (on its picture, or in its holes): outlines a scan would keep (not cut,
 * not found only in part) at least LOOSE_MIN_AREA of a piece's top face whose centre lies at least
 * ON_PUZZLE_MIN_INSIDE of a cell inside the puzzle. The empty spots under and around them can't be
 * seen, so the gaps read from such a photo are not all of them (Scan's saveOpenSpots). Owner's photos
 * (2026-11-11): IMG_9244 14 (its 88 open spots miss about 40 holes, mostly where pieces lie on the
 * picture and in the holes), IMG_9280 0 (its false blobs on the print are 0.25–0.45 of a piece, within
 * 0.6 of a cell of the puzzle's edge), IMG_9281 and IMG_9272 none inside at all.
 */
export function piecesOnPuzzle(pieces: Array<Pick<FoundPiece, 'outlineImg' | 'flags'>>, grid: Pick<AssembledGrid, 'cornersPx' | 'cols' | 'rows'>): number {
  const quad = grid.cornersPx;
  const cell = outlineArea(quad.flat()) / Math.max(1, grid.cols * grid.rows);
  const side = Math.sqrt(cell);
  let n = 0;
  for (const p of pieces) {
    if (p.flags.cut || p.flags.part || p.outlineImg.length < 6) continue;
    if (outlineArea(p.outlineImg) < LOOSE_MIN_AREA * REAL_PIECE_AREA_SHARE * cell) continue;
    const c = centroid(p.outlineImg);
    if (outsideBy(quad, c) === 0 && insideBy(quad, c) >= ON_PUZZLE_MIN_INSIDE * side) n++;
  }
  return n;
}

/** A piece on the puzzle lies at least this many cells inside its outline (false blobs on the print hug its edge). */
export const ON_PUZZLE_MIN_INSIDE = 1;

/** Distance from p to the nearest side of the polygon. */
function insideBy(poly: ReadonlyArray<readonly [number, number]>, p: [number, number]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!;
    const [bx, by] = poly[(i + 1) % poly.length]!;
    const ex = bx - ax;
    const ey = by - ay;
    const l2 = ex * ex + ey * ey || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * ex + (p[1] - ay) * ey) / l2));
    d = Math.min(d, Math.hypot(p[0] - ax - t * ex, p[1] - ay - t * ey));
  }
  return d;
}

/** The finished puzzle's scale (photo px per mm): a cell is one piece pitch across. */
export function gridPxPerMm(grid: Pick<AssembledGrid, 'cornersPx' | 'cols' | 'rows'>, pitchMm: number): number {
  return Math.sqrt(outlineArea(grid.cornersPx.flat()) / Math.max(1, grid.cols * grid.rows)) / pitchMm;
}

/** A loose piece's centre lies at least this many cells outside the puzzle (an edge piece of the puzzle sits on its border). */
export const LOOSE_MIN_OUTSIDE = 0.5;
/** …and its outline is at least this share of a piece's top face (whole loose pieces measured 0.86–1.7 on the owner's photos). */
export const LOOSE_MIN_AREA = 0.6;

function outlineArea(o: number[]): number {
  let a = 0;
  for (let i = 0, n = o.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += o[i]! * o[j + 1]! - o[j]! * o[i + 1]!;
  }
  return Math.abs(a) / 2;
}

function centroid(o: number[]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = o.length; i < n; i += 2) {
    const j = (i + 2) % n;
    const cr = o[i]! * o[j + 1]! - o[j]! * o[i + 1]!;
    a += cr;
    cx += (o[i]! + o[j]!) * cr;
    cy += (o[i + 1]! + o[j + 1]!) * cr;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < o.length; i += 2) {
      sx += o[i]!;
      sy += o[i + 1]!;
    }
    return [(2 * sx) / o.length, (2 * sy) / o.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** How far p lies outside the convex polygon (0 inside). */
function outsideBy(poly: ReadonlyArray<readonly [number, number]>, p: [number, number]): number {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += poly[i]![0] * poly[(i + 1) % n]![1] - poly[(i + 1) % n]![0] * poly[i]![1];
  const s = area >= 0 ? 1 : -1;
  let out = false;
  let d = Infinity;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[i]!;
    const [bx, by] = poly[(i + 1) % n]!;
    const ex = bx - ax;
    const ey = by - ay;
    if ((ex * (p[1] - ay) - ey * (p[0] - ax)) * s < 0) out = true;
    const l2 = ex * ex + ey * ey || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * ex + (p[1] - ay) * ey) / l2));
    d = Math.min(d, Math.hypot(p[0] - ax - t * ex, p[1] - ay - t * ey));
  }
  return out ? d : 0;
}
