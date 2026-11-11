/**
 * How many pieces the found outlines stand for (M10 part 1, review FR7): an outline of touching pieces
 * ("clump") holds about `flags.touching` pieces (its area ÷ a single piece's there, src/cv/splitClumps.ts),
 * so "Found N pieces" and the progress line don't count a group of 3 as 1. Older rows without the estimate
 * count as 1, as before.
 */
import type { PieceFlags } from '../project/types';

/** Pieces one outline stands for: 1, or about `touching` for touching pieces. */
export function piecesIn(flags: Pick<PieceFlags, 'clump' | 'touching'> | null | undefined): number {
  return flags?.clump ? Math.max(1, Math.round(flags.touching ?? 1)) : 1;
}

/** Pieces in all these outlines, and how many of them are in outlines of touching pieces beyond one each. */
export function piecesHeld(list: Array<{ flags?: Pick<PieceFlags, 'clump' | 'touching'> | null }>): { total: number; extra: number } {
  let total = 0;
  for (const p of list) total += piecesIn(p.flags);
  return { total, extra: total - list.length };
}

/** "12 pieces", or "about 15 pieces" when some are counted from touching groups. */
export function aboutPieces(total: number, extra: number): string {
  return `${extra > 0 ? 'about ' : ''}${total} piece${total === 1 ? '' : 's'}`;
}
