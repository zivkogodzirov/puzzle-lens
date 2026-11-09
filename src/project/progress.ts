/**
 * Each piece's state for the table view and the progress line (PLAN §5 "Overlay state colours"):
 * found (grey), shape read (blue), its spot on the box known (green); and, for a piece whose known
 * spot is on the picture's edge, which side of the frame it belongs to (brief §7 "Border").
 */
import type { SpotChoice } from '../cv/openSpots';

export type PieceState = 'found' | 'shape' | 'placed';

export const STATE_COLOUR: Record<PieceState, string> = { found: '#9aa7b4', shape: '#4fb3ff', placed: '#3ccf7a' };

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
