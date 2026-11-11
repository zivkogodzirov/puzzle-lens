/**
 * Each piece's state for the table view and the progress line (PLAN §5 "Overlay state colours"):
 * found (grey), shape read (violet), its spot on the box known (green); and, for a piece whose known
 * spot is on the picture's edge, which side of the frame it belongs to (brief §7 "Border").
 * The colours are tokens: on photos and the live camera OVERLAY_STATE (src/app/overlay.ts, from --ov-found /
 * --ov-shape / --ov-placed); dots on the page itself use the CSS classes state-found / state-shape /
 * state-placed, which follow light and dark mode. (STATE_COLOUR, no longer drawn anywhere, went in M9 part 2.)
 */
import type { SpotChoice } from '../cv/openSpots';
import type { PieceRow } from './types';

export type PieceState = 'found' | 'shape' | 'placed';

/** The spot is known: the piece fits a spot and it is Strong or Likely. */
export function spotKnown(choice: SpotChoice | null | undefined): boolean {
  return Boolean(choice && choice.fits && choice.placement.top.length && choice.placement.verdict !== 'several');
}

export function pieceState(shapeRead: boolean, choice: SpotChoice | null | undefined): PieceState {
  return spotKnown(choice) ? 'placed' : shapeRead ? 'shape' : 'found';
}

export type FrameSide = 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

/** The side (or corner) of the frame a spot is on, or null inside the picture. */
export function frameSide(col: number, row: number, cols: number, rows: number): FrameSide | null {
  const v = row === 0 ? 'top' : row === rows - 1 ? 'bottom' : null;
  const h = col === 0 ? 'left' : col === cols - 1 ? 'right' : null;
  if (v && h) return `${v}-${h}` as FrameSide;
  return v ?? h;
}

export const SIDE_ARROW: Record<FrameSide, string> = {
  top: '↑',
  right: '→',
  bottom: '↓',
  left: '←',
  'top-left': '↖',
  'top-right': '↗',
  'bottom-right': '↘',
  'bottom-left': '↙',
};

export const SIDE_WORDS: Record<FrameSide, string> = {
  top: 'top edge',
  right: 'right edge',
  bottom: 'bottom edge',
  left: 'left edge',
  'top-left': 'top-left corner',
  'top-right': 'top-right corner',
  'bottom-right': 'bottom-right corner',
  'bottom-left': 'bottom-left corner',
};

/** The frame side of a piece whose spot is known, or null. */
export function pieceSide(choice: SpotChoice | null | undefined, grid: { cols: number; rows: number }): FrameSide | null {
  if (!spotKnown(choice)) return null;
  const t = choice!.placement.top[0]!;
  return frameSide(t.col, t.row, grid.cols, grid.rows);
}

/** "Found · shapes read · placed on box" counts. */
export function progressCounts(states: PieceState[]): { found: number; shape: number; placed: number } {
  return {
    found: states.length,
    shape: states.filter((s) => s !== 'found').length,
    placed: states.filter((s) => s === 'placed').length,
  };
}

/** Short spot label for the table photo ("26·1": column 26, row 1, counted from 1). */
export function spotLabel(choice: SpotChoice | null | undefined): string | null {
  if (!spotKnown(choice)) return null;
  const t = choice!.placement.top[0]!;
  return `${t.col + 1}·${t.row + 1}`;
}

/** What the progress page shows (M7 part 2), from the pieces, their spots and the empty spots. */
export interface ProgressInput {
  grid: { cols: number; rows: number };
  pieces: Pick<PieceRow, 'id' | 'status' | 'placedAt' | 'tray'>[];
  /** Each unplaced piece's spots (shownPlacements). */
  shown: Map<string, SpotChoice>;
  /** The empty spots of the nearly finished puzzle on the box picture (the placement cache), or null for the whole picture. */
  open: Array<[number, number]> | null;
  /** Empty spots counted in the puzzle photo, when they aren't turned onto the box picture yet (no placements). */
  gapCount?: number | null;
  /** Spots filled since (answered "Fits"): "c,r". */
  taken: Set<string>;
  /** A photo of the puzzle showed it complete (no empty spots). */
  finished?: boolean;
}

export interface PuzzleProgress {
  cells: number;
  /** Pieces in the puzzle: from the puzzle photo (its empty spots) plus those fitted since, or from "Fits" answers only. */
  done: number;
  doneFrom: 'photo' | 'answers';
  /** Pieces by status. */
  status: Record<PieceRow['status'], number>;
  /** Pieces per tray letter. */
  trays: Array<[string, number]>;
  /** Spots still empty whose piece is known (on the table or in a tray). */
  known: number;
  /**
   * Spots still empty with no known piece. Among the empty spots of a puzzle photo it's exact; on
   * the whole picture an estimate (cells − in the puzzle − pieces read), so `toFindExact` is false.
   */
  toFind: number;
  toFindExact: boolean;
  /** Per cell (row by row): 0 not done, 1 in the puzzle, 2 its piece is known. */
  cellState: Uint8Array;
}

export function puzzleProgress(input: ProgressInput): PuzzleProgress {
  const { cols, rows } = input.grid;
  const cells = cols * rows;
  const status = { table: 0, tray: 0, placed: 0, missing: 0, pending: 0, aside: 0 } as Record<PieceRow['status'], number>;
  const trayN = new Map<string, number>();
  for (const p of input.pieces) {
    status[p.status] = (status[p.status] ?? 0) + 1;
    if (p.status === 'tray' && p.tray) trayN.set(p.tray, (trayN.get(p.tray) ?? 0) + 1);
  }
  const at = (c: number, r: number) => r * cols + c;
  const inGrid = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;
  const state = new Uint8Array(cells);
  const filled = new Set(input.taken);
  for (const p of input.pieces) if (p.status === 'placed' && p.placedAt) filled.add(`${p.placedAt.col},${p.placedAt.row}`);
  // The spots of pieces waiting (on the table, in a tray, to check) whose spot is known.
  const knownSpots = new Set<string>();
  for (const p of input.pieces) {
    if (p.status !== 'table' && p.status !== 'tray' && p.status !== 'pending') continue;
    const ch = input.shown.get(p.id);
    if (!spotKnown(ch)) continue;
    const t = ch!.placement.top[0]!;
    knownSpots.add(`${t.col},${t.row}`);
  }
  let done: number;
  let toFind: number;
  let toFindExact: boolean;
  let doneFrom: PuzzleProgress['doneFrom'];
  if (input.finished && !input.open) {
    state.fill(1);
    done = cells;
    toFind = 0;
    toFindExact = true;
    doneFrom = 'photo';
  } else if (input.open) {
    // The puzzle photo: every spot but the empty ones is in, plus those filled since.
    state.fill(1);
    let left = 0;
    toFind = 0;
    for (const [c, r] of input.open) {
      if (!inGrid(c, r)) continue;
      const k = `${c},${r}`;
      if (filled.has(k)) continue;
      left++;
      if (knownSpots.has(k)) state[at(c, r)] = 2;
      else {
        state[at(c, r)] = 0;
        toFind++;
      }
    }
    done = cells - left;
    toFindExact = true;
    doneFrom = 'photo';
  } else if (input.gapCount != null) {
    done = cells - input.gapCount + input.taken.size;
    state.fill(1);
    toFind = Math.max(0, cells - done - knownSpots.size);
    toFindExact = false;
    doneFrom = 'photo';
  } else {
    for (const k of filled) {
      const [c, r] = k.split(',').map(Number) as [number, number];
      if (inGrid(c, r)) state[at(c, r)] = 1;
    }
    for (const k of knownSpots) {
      const [c, r] = k.split(',').map(Number) as [number, number];
      if (inGrid(c, r) && state[at(c, r)] === 0) state[at(c, r)] = 2;
    }
    done = state.reduce((s, v) => s + (v === 1 ? 1 : 0), 0);
    // Pieces read but not in the puzzle (set-aside ones may have been read twice): an estimate.
    toFind = Math.max(0, cells - done - status.table - status.tray - status.pending - status.aside - status.missing);
    toFindExact = false;
    doneFrom = 'answers';
  }
  const known = state.reduce((s, v) => s + (v === 2 ? 1 : 0), 0);
  return { cells, done, doneFrom, status, trays: [...trayN].sort((a, b) => a[0].localeCompare(b[0])), known, toFind, toFindExact, cellState: state };
}
