/**
 * Marking pieces placed without tapping each one (M7 part 4, PLAN §6 M7 "then optional reading of
 * the assembly board"). Without markers, the assembly board is read from a new photo of the nearly
 * finished puzzle (M4's finished check): the empty spots it shows replace the old ones.
 *
 * - **A new puzzle photo:** an empty spot of the old photo that is filled in the new one had a piece
 *   put in. The piece the app had matched to that spot (one piece per spot, Strong or Likely) and
 *   that is still listed on the table or in a tray is marked as in the puzzle (by: 'photo'), with
 *   Undo. Spots whose piece wasn't sure stay as they are (that piece may still be on the table).
 * - **"It's in the puzzle":** a piece put in where the app didn't know is marked placed with no spot
 *   (−1, −1), so it counts as done without guessing where.
 */
import { db } from '../db/db';
import type { SpotChoice } from '../cv/openSpots';
import { spotKnown } from './progress';
import { readPlacements, shownPlacements, unplacedStatus } from './placements';
import { answerView, placedPieces } from './answers';
import { getProject } from './store';
import type { PieceRow } from './types';

export interface FilledSpot {
  id: string;
  col: number;
  row: number;
  rot: 0 | 1 | 2 | 3;
}

/**
 * The pieces that went into spots the new photo shows filled: `before` = each piece's spot under the
 * old empty spots (shownPlacements of the old placements), `oldOpen` / `newOpen` the empty spots on
 * the box picture before and after.
 */
export function piecesInFilledSpots(
  before: Map<string, SpotChoice>,
  oldOpen: Array<[number, number]>,
  newOpen: Array<[number, number]>,
  pieces: Pick<PieceRow, 'id' | 'status'>[],
): FilledSpot[] {
  const still = new Set(newOpen.map(([c, r]) => `${c},${r}`));
  const filled = new Set(oldOpen.filter(([c, r]) => !still.has(`${c},${r}`)).map(([c, r]) => `${c},${r}`));
  if (!filled.size) return [];
  const waiting = new Set(pieces.filter((p) => p.status === 'table' || p.status === 'tray' || p.status === 'pending').map((p) => p.id));
  const out: FilledSpot[] = [];
  const used = new Set<string>();
  for (const [id, ch] of before) {
    if (!waiting.has(id) || !spotKnown(ch)) continue;
    const t = ch.placement.top[0]!;
    const k = `${t.col},${t.row}`;
    if (!filled.has(k) || used.has(k)) continue;
    used.add(k);
    out.push({ id, col: t.col, row: t.row, rot: t.rot });
  }
  return out;
}

/** Marks pieces as in the puzzle: at their spot (from a photo), or with no spot ("It's in the puzzle"). */
export async function markPlaced(
  projectId: string,
  list: Array<{ id: string; col?: number; row?: number; rot?: 0 | 1 | 2 | 3 }>,
  by: 'photo' | 'tap',
): Promise<string[]> {
  const d = db();
  const now = Date.now();
  return d.transaction('rw', d.pieces, async () => {
    const done: string[] = [];
    for (const s of list) {
      const row = await d.pieces.get(s.id);
      if (!row || row.projectId !== projectId || (row.status !== 'table' && row.status !== 'tray' && row.status !== 'pending')) continue;
      await d.pieces.put({
        ...row,
        status: 'placed',
        maybe: null,
        placedAt: { col: s.col ?? -1, row: s.row ?? -1, rot: s.rot ?? 0, at: now, from: row.status === 'tray' ? 'tray' : 'table', tray: row.tray ?? null, by },
        updatedAt: now,
      });
      done.push(s.id);
    }
    return done;
  });
}

/**
 * A new puzzle photo showing no empty spots at all (the puzzle is finished): every spot of the old
 * photo was filled, so the pieces the app had matched to them (Strong or Likely) are marked as in
 * the puzzle. Call before or after the old empty spots are cleared; the old placements are read
 * from their cache.
 */
export async function markFromFinishedPhoto(projectId: string): Promise<{ filled: number; ids: string[] }> {
  const cache = await readPlacements(projectId);
  const project = await getProject(projectId);
  if (!cache?.open?.cells.length || !project) return { filled: 0, ids: [] };
  const pieces = await db().pieces.where('projectId').equals(projectId).toArray();
  const view = answerView(project);
  const before = shownPlacements(cache, pieces.filter(unplacedStatus), { view, placed: placedPieces(pieces) });
  const list = piecesInFilledSpots(before, cache.open.cells, [], pieces);
  const ids = list.length ? await markPlaced(projectId, list, 'photo') : [];
  return { filled: cache.open.cells.filter(([c, r]) => !view.taken.has(`${c},${r}`)).length, ids };
}
