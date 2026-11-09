/**
 * "Fill this spot" (M4, PLAN §7): the other way round from a piece's spots: for one spot on the
 * box picture, the pieces that may go there, with their chances.
 *
 * Among the empty spots of a nearly finished puzzle every piece has a chance at every spot, and each
 * spot takes at most one piece (src/cv/openSpots.ts): the piece chosen for the spot comes first.
 * On the whole picture a piece keeps only its best few spots, so only pieces with the spot among
 * those are found.
 */
import type { SpotChoice } from '../cv/openSpots';
import type { Verdict } from '../cv/placement';

export interface SpotCandidate {
  id: string;
  /** Its chance for this spot. */
  p: number;
  /** This spot is the piece's own best (chosen) spot. */
  chosen: boolean;
  /** How sure the piece's own best spot is (when `chosen`). */
  verdict: Verdict;
  /** The piece's own best spot (column, row), when it isn't this one. */
  best: { col: number; row: number } | null;
}

/** Chances below this aren't listed (they would only be noise). */
export const FILL_MIN_P = 0.02;

/** The pieces that may go into the spot at col, row (0-based): the best first. */
export function candidatesFor(shown: Map<string, SpotChoice>, col: number, row: number, minP = FILL_MIN_P): SpotCandidate[] {
  const out: SpotCandidate[] = [];
  for (const [id, choice] of shown) {
    const top = choice.placement.top;
    const k = top.findIndex((t) => t.col === col && t.row === row);
    if (k < 0) continue;
    const chosen = k === 0 && choice.fits;
    const p = top[k]!.p;
    if (!chosen && p < minP) continue;
    out.push({
      id,
      p,
      chosen,
      verdict: choice.placement.verdict,
      best: chosen || !top[0] || !choice.fits ? null : { col: top[0].col, row: top[0].row },
    });
  }
  return out.sort((a, b) => Number(b.chosen) - Number(a.chosen) || b.p - a.p);
}

/** The empty spot nearest a tap (in cells), within `reach` cells, or null. */
export function nearestSpot(spots: Array<[number, number]>, x: number, y: number, reach = 3): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = reach * reach;
  for (const s of spots) {
    const d = (s[0] + 0.5 - x) ** 2 + (s[1] + 0.5 - y) ** 2;
    if (d <= bd) ((bd = d), (best = s));
  }
  return best;
}
