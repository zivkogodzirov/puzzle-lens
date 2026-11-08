/**
 * Box placements (M4): where each catalogued piece goes on the box picture, kept in one settings
 * row per puzzle and brought up to date in the photo helper (src/cv/placement.ts).
 *
 * - A piece is (re)placed when it has a patch newer than its stored placement.
 * - Changing the box picture or the grid starts over (all pieces, and a new colour match).
 * - The colour match between pieces and box picture is measured once, from the first batch of at
 *   least 20 pieces, then kept (RESEARCH §9.5: a later batch of only sky pieces would otherwise
 *   pull it toward the picture's average colour).
 */
import { db } from '../db/db';
import type { ColourMatch, Placement } from '../cv/placement';
import type { PieceToPlace, ReaderApi } from '../shared/apis';
import { getBlob, placementKey } from './store';
import type { PieceRow, Project } from './types';

export { placementKey };

export interface PlacementCache {
  /** The box picture and grid these placements are for. */
  boxKey: string;
  colour: ColourMatch | null;
  /** Per piece: the patch time it was placed from, and the result. */
  byPiece: Record<string, { ts: number; placement: Placement }>;
}

/** Identifies the box picture as straightened now, and the grid. */
export function boxKeyOf(p: Pick<Project, 'box' | 'grid'>): string | null {
  if (!p.box || !p.grid) return null;
  return `${p.box.rectifiedBlobId}|${p.box.corners.map((c) => c.map((v) => Math.round(v)).join(',')).join(';')}|${p.grid.cols}x${p.grid.rows}`;
}

export async function readPlacements(projectId: string): Promise<PlacementCache | null> {
  const v = (await db().settings.get(placementKey(projectId)))?.value as PlacementCache | undefined;
  return v && typeof v === 'object' && v.byPiece ? v : null;
}

/** Pieces whose placement is missing or older than their patch. */
export function stalePieces(cache: PlacementCache | null, boxKey: string, pieces: PieceRow[]): PieceRow[] {
  const fresh = cache && cache.boxKey === boxKey ? cache : null;
  return pieces.filter((p) => p.status === 'table' && p.patch && (!fresh || fresh.byPiece[p.id]?.ts !== p.patch.ts));
}

/**
 * Places the pieces that need it (in batches, reporting progress) and saves the results.
 * Returns the up-to-date cache, or null when the puzzle has no box picture or grid.
 */
export async function updatePlacements(
  project: Project,
  pieces: PieceRow[],
  reader: Pick<ReaderApi, 'placePieces'>,
  onProgress?: (done: number, total: number) => void,
): Promise<PlacementCache | null> {
  const boxKey = boxKeyOf(project);
  if (!boxKey || !project.box || !project.grid) return null;
  const old = await readPlacements(project.id);
  const cache: PlacementCache = old && old.boxKey === boxKey ? old : { boxKey, colour: null, byPiece: {} };
  const todo = stalePieces(cache, boxKey, pieces);
  if (!todo.length) return cache;
  const box = await getBlob(project.box.rectifiedBlobId);
  if (!box) return cache;
  const BATCH = 40;
  for (let i = 0; i < todo.length; i += BATCH) {
    const part = todo.slice(i, i + BATCH);
    const input: PieceToPlace[] = [];
    for (const p of part) {
      const b = await getBlob(p.patch!.blobId);
      if (!b) continue;
      input.push({ id: p.id, rgba: new Uint8Array(await b.arrayBuffer()), flats: p.patch!.flats, sure: p.patch!.sure });
    }
    if (input.length) {
      const reply = await reader.placePieces(box, boxKey, { cols: project.grid.cols, rows: project.grid.rows }, input, cache.colour);
      cache.colour = reply.colour;
      for (const r of reply.results) cache.byPiece[r.id] = { ts: part.find((p) => p.id === r.id)!.patch!.ts, placement: r.placement };
    }
    onProgress?.(Math.min(todo.length, i + BATCH), todo.length);
  }
  await db().settings.put({ key: placementKey(project.id), value: cache });
  return cache;
}
