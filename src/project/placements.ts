/**
 * Box placements (M4): where each catalogued piece goes on the box picture, kept in one settings
 * row per puzzle and brought up to date in the photo helper (src/cv/placement.ts).
 *
 * - A piece is (re)placed when it has a patch newer than its stored placement.
 * - Changing the box picture, the grid or the empty spots starts over (all pieces, new colour match).
 * - The colour match between pieces and box picture is measured once, from the first batch of at
 *   least 20 pieces, then kept (RESEARCH §9.5: a later batch of only sky pieces would otherwise
 *   pull it toward the picture's average colour).
 * - Empty spots (a photo of the nearly finished puzzle, Project.openSpots): pieces are scored only
 *   at those spots, their colours are matched to those spots' colours, and each spot takes at most
 *   one piece (src/cv/openSpots.ts). Until the colour match is measured every piece is placed again
 *   (there are few: at most a tenth of the puzzle).
 */
import { db } from '../db/db';
import type { ColourMatch, Placement } from '../cv/placement';
import { chooseSpots, type SpotChoice, type SpotShapes } from '../cv/openSpots';
import type { OpenSpotsInput, PieceToPlace, PlaceReply, ReaderApi } from '../shared/apis';
import { getBlob, placementKey } from './store';
import { placementWithAnswers, spotSidesWithNeighbours, type AnswerView } from './answers';
import type { PieceRow, Project } from './types';

export { placementKey };

/** Knob reads of a piece whose shape read isn't trusted count this much. */
const UNSURE_SHAPE_WEIGHT = 0.6;

export interface PlacementCache {
  /** The box picture, grid and empty spots these placements are for (placeKeyOf). */
  boxKey: string;
  colour: ColourMatch | null;
  /** The empty spots the pieces were placed among (box-picture columns and rows), or null for the whole picture. */
  open?: PlaceReply['open'];
  /** Per piece: the patch time it was placed from, and the result. */
  byPiece: Record<string, { ts: number; placement: Placement }>;
  /**
   * The colour transform learned from pieces in the puzzle (M8): from how many, and the colour
   * difference (ΔE, median over blocks of pieces it wasn't fitted from) with the current match
   * (`before`) and with it (`after`). Its transform is in `colour.affine` when it was better.
   */
  learned?: { n: number; before: number; after: number } | null;
}

/** Pieces in the puzzle at a known spot needed before the colours are learned (M8), and how many more before learning again. */
export const LEARN = { min: 12, step: 10 };

/** Pieces in the puzzle at a known spot, with their straightened picture (the samples for learning colours). */
export function learnSamples(pieces: PieceRow[]): PieceRow[] {
  return pieces.filter((p) => p.status === 'placed' && p.placedAt && p.placedAt.col >= 0 && p.placedAt.by !== 'tap' && p.patch);
}

/**
 * Whether the colours should be learned (again) now: on the whole picture (among empty spots the
 * colours are matched to those spots already), once LEARN.min pieces are in at known spots, and
 * again after every LEARN.step more.
 */
export function learnDue(cache: PlacementCache | null, placeKey: string, pieces: PieceRow[]): boolean {
  if (placeKey.includes('|open:')) return false;
  const n = learnSamples(pieces).length;
  if (n < LEARN.min) return false;
  const fresh = cache && cache.boxKey === placeKey ? cache : null;
  return !fresh?.learned || n >= fresh.learned.n + LEARN.step;
}

/** Identifies the box picture as straightened now, and the grid. */
export function boxKeyOf(p: Pick<Project, 'box' | 'grid'>): string | null {
  if (!p.box || !p.grid) return null;
  return `${p.box.rectifiedBlobId}|${p.box.corners.map((c) => c.map((v) => Math.round(v)).join(',')).join(';')}|${p.grid.cols}x${p.grid.rows}`;
}

/** Identifies what placements depend on: the box picture, the grid and the empty spots. */
export function placeKeyOf(p: Pick<Project, 'box' | 'grid' | 'openSpots'>): string | null {
  const k = boxKeyOf(p);
  return k && (p.openSpots ? `${k}|open:${p.openSpots.ts}` : k);
}

export async function readPlacements(projectId: string): Promise<PlacementCache | null> {
  const v = (await db().settings.get(placementKey(projectId)))?.value as PlacementCache | undefined;
  return v && typeof v === 'object' && v.byPiece ? v : null;
}

/** Pieces still to be put in the puzzle: on the table, or sorted into a tray. */
export const unplacedStatus = (p: Pick<PieceRow, 'status'>): boolean => p.status === 'table' || p.status === 'tray' || p.status === 'pending';

/** Pieces whose placement is missing or older than their patch (or all, among empty spots, until the colour match is known). */
export function stalePieces(cache: PlacementCache | null, placeKey: string, pieces: PieceRow[]): PieceRow[] {
  const fresh = cache && cache.boxKey === placeKey ? cache : null;
  const all = placeKey.includes('|open:') && !fresh?.colour;
  return pieces.filter((p) => unplacedStatus(p) && p.patch && (all || !fresh || fresh.byPiece[p.id]?.ts !== p.patch.ts));
}

/**
 * Places the pieces that need it (in batches, reporting progress) and saves the results.
 * Returns the up-to-date cache, or null when the puzzle has no box picture or grid.
 */
export async function updatePlacements(
  project: Project,
  pieces: PieceRow[],
  reader: Pick<ReaderApi, 'placePieces'> & Partial<Pick<ReaderApi, 'learnColour'>>,
  onProgress?: (done: number, total: number) => void,
  /** Every piece of the puzzle (to learn colours from those in it, M8); defaults to `pieces`. */
  all: PieceRow[] = pieces,
): Promise<PlacementCache | null> {
  const boxKey = boxKeyOf(project);
  const placeKey = placeKeyOf(project);
  if (!boxKey || !placeKey || !project.box || !project.grid) return null;
  const old = await readPlacements(project.id);
  const cache: PlacementCache = old && old.boxKey === placeKey ? old : { boxKey: placeKey, colour: null, open: null, byPiece: {} };
  let todo = stalePieces(cache, placeKey, pieces);
  const learn = Boolean(reader.learnColour) && learnDue(cache, placeKey, all);
  if (!todo.length && !learn) return cache;
  const box = await getBlob(project.box.rectifiedBlobId);
  if (!box) return cache;
  // Learn the colours from the pieces in the puzzle (M8), then place every piece again with them.
  if (learn) {
    const samples: Array<{ rgba: Uint8Array; col: number; row: number; rot: 0 | 1 | 2 | 3 }> = [];
    const used = learnSamples(all);
    for (const p of used) {
      const b = await getBlob(p.patch!.blobId);
      if (b) samples.push({ rgba: new Uint8Array(await b.arrayBuffer()), col: p.placedAt!.col, row: p.placedAt!.row, rot: p.placedAt!.rot });
    }
    const got = await reader.learnColour!(box, boxKeyOf(project)!, { cols: project.grid.cols, rows: project.grid.rows }, samples, cache.colour);
    // Counted even when it isn't used (too few usable pieces, or no better than the current match on
    // pieces it wasn't fitted from), so it isn't tried again before LEARN.step more pieces are in.
    cache.learned = got ? { n: used.length, before: got.heldOutBase, after: got.heldOut } : { n: used.length, before: 0, after: 0 };
    if (got?.useful) {
      cache.colour = got.colour;
      todo = pieces.filter((p) => unplacedStatus(p) && p.patch);
    }
  }
  let open: OpenSpotsInput | null = null;
  if (project.openSpots) {
    const thumb = await getBlob(project.openSpots.thumbBlobId);
    if (thumb) open = { cols: project.openSpots.cols, rows: project.openSpots.rows, gaps: project.openSpots.gaps, gapSides: project.openSpots.gapSides, thumb };
  }
  // Among empty spots, all pieces go in one batch so the colour match is measured from all of them.
  const BATCH = open ? Math.max(40, todo.length) : 40;
  for (let i = 0; i < todo.length; i += BATCH) {
    const part = todo.slice(i, i + BATCH);
    const input: PieceToPlace[] = [];
    for (const p of part) {
      const b = await getBlob(p.patch!.blobId);
      if (!b) continue;
      input.push({ id: p.id, rgba: new Uint8Array(await b.arrayBuffer()), flats: p.patch!.flats, sure: p.patch!.sure });
    }
    if (input.length) {
      const reply = await reader.placePieces(box, boxKey, { cols: project.grid.cols, rows: project.grid.rows }, input, cache.colour, open);
      cache.colour = reply.colour;
      cache.open = reply.open;
      for (const r of reply.results) cache.byPiece[r.id] = { ts: part.find((p) => p.id === r.id)!.patch!.ts, placement: r.placement };
    }
    onProgress?.(Math.min(todo.length, i + BATCH), todo.length);
  }
  await db().settings.put({ key: placementKey(project.id), value: cache });
  return cache;
}

/**
 * What to show for each piece: its own placement, or, among empty spots, the spot it gets when each
 * spot takes at most one piece (with `fits` false for a piece that matches none of them well). Pass
 * every piece not yet in the puzzle, those in trays too: they still compete for the empty spots.
 *
 * With `answers` (M5 part 2): spots taken by pieces that fit are left out, spots a piece doesn't
 * fit are ruled out for it, and placed pieces' knobs tell their neighbouring spots what they need.
 */
export function shownPlacements(
  cache: PlacementCache | null,
  pieces: PieceRow[],
  answers: { view: AnswerView; placed: Map<string, PieceRow> } | null = null,
): Map<string, SpotChoice> {
  const out = new Map<string, SpotChoice>();
  if (!cache) return out;
  const view = answers?.view;
  const placed = pieces
    .filter((p) => cache.byPiece[p.id])
    .map((p) => {
      let placement = cache.byPiece[p.id]!.placement;
      const not = view?.notHere.get(p.id);
      if (cache.open?.cells.length) {
        if (not) placement = { ...placement, top: placement.top.filter((t) => !not.has(`${t.col},${t.row}`)) };
      } else if (view && answers) placement = placementWithAnswers(p, placement, view, answers.placed);
      return { id: p.id, placement };
    });
  if (cache.open?.cells.length) {
    // Spots already filled by a piece that fits are no longer empty.
    const keep = cache.open.cells.map(([c, r]) => !view?.taken.has(`${c},${r}`));
    const cells = cache.open.cells.filter((_, j) => keep[j]);
    const sides0 = cache.open.sides?.length === cache.open.cells.length ? cache.open.sides.filter((_, j) => keep[j]) : null;
    const sides = view && answers ? spotSidesWithNeighbours(cells, sides0, view, answers.placed) : sides0;
    if (!cells.length) return out;
    // Knob fit (M4 part 3): pieces scanned since then carry their sides; an unsure shape read counts less.
    const shapes: SpotShapes = { pieces: new Map(), spots: sides };
    for (const p of pieces)
      if (p.patch?.sides && p.patch.sideConf)
        shapes.pieces.set(p.id, { sides: p.patch.sides, conf: p.patch.sideConf.map((c) => c * (p.patch!.sure ? 1 : UNSURE_SHAPE_WEIGHT)) });
    const result = chooseSpots(placed, cells, shapes);
    // A piece the owner has tried in every spot it was offered: offer the other empty spots too (its
    // shape may have been misread, e.g. an edge piece whose flat side wasn't seen: owner's piece #8,
    // simulated 2026-11-09). Equal chances, "several spots look alike".
    if (view?.notHere.size)
      for (const { id } of placed) {
        const not = view.notHere.get(id);
        if (!not || result.get(id)?.placement.top.length) continue;
        const rest = cells.filter(([c, r]) => !not.has(`${c},${r}`));
        if (!rest.length) continue;
        result.set(id, {
          placement: { top: rest.map(([c, r]) => ({ col: c, row: r, rot: 0 as const, score: 0, p: 1 / rest.length })), verdict: 'several' },
          fits: true,
        });
      }
    return result;
  }
  for (const p of placed) out.set(p.id, { placement: p.placement, fits: p.placement.top.length > 0 });
  return out;
}
