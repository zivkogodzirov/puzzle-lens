/**
 * Fits / Doesn't fit (src/project/answers.ts, M5 part 2) on an in-memory IndexedDB: answers are kept
 * with what the app said, a piece that fits goes into the puzzle (and can be taken out again), its
 * spot is taken, ruled-out spots move the next one up, placed pieces' knobs tell their neighbours
 * what they need, and the Accuracy numbers.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, eraseAllData } from '../../src/db/db';
import { createProject, getProject, updateProject } from '../../src/project/store';
import {
  accuracyOf,
  answerSpot,
  answerView,
  clearNotHere,
  placedPieces,
  removeNotAPiece,
  placementWithAnswers,
  spotSidesWithNeighbours,
  undoAnswer,
  undoFits,
  wilson,
} from '../../src/project/answers';
import { shownPlacements, type PlacementCache } from '../../src/project/placements';
import type { Placement } from '../../src/cv/placement';
import type { PieceRow, SpotAnswer } from '../../src/project/types';

beforeEach(async () => {
  await eraseAllData();
});

function piece(projectId: string, id: string, sides?: string, status: PieceRow['status'] = 'table'): PieceRow {
  return {
    id,
    projectId,
    createdAt: 1,
    updatedAt: 1,
    status,
    table: { x: 0, y: 0, angleDeg: 0, lastSeen: 1, snapId: 's1' },
    outlineMm: [-9, -9, 9, -9, 9, 9, -9, 9],
    areaMm2: 324,
    sizeMm: [18, 18],
    colour: { meanLab: [50, 0, 0], hueHist: [] },
    thumbBlobId: null,
    seen: 1,
    bestPxPerMm: 5,
    flags: {},
    patch: { blobId: `patch-${id}`, flats: [false, false, false, false], sure: true, ts: 100, ...(sides ? { sides, sideConf: [1, 1, 1, 1] } : {}) },
  };
}

const spot = (col: number, row: number, p: number, rot: 0 | 1 | 2 | 3 = 0) => ({ col, row, rot, score: 0, p });
const placement = (verdict: Placement['verdict'], ...top: ReturnType<typeof spot>[]): Placement => ({ top, verdict });

async function puzzle() {
  const p = await createProject({ name: 'The Kiss', pieceCount: 1000, setupStep: 6 });
  return updateProject(p.id, { grid: { cols: 28, rows: 36, source: 'suggested' } as never });
}

describe('answers', () => {
  it('a piece that fits goes into the puzzle with what the app said; Undo takes it back to its tray', async () => {
    const pz = await puzzle();
    const a = { ...piece(pz.id, 'a'), status: 'tray' as const, tray: 'B' };
    await db().pieces.put(a);
    const shown = { placement: placement('strong', spot(3, 4, 0.9, 1), spot(5, 6, 0.05)), fits: true };
    const next = await answerSpot(pz.id, a, { col: 3, row: 4, rot: 1 }, true, shown, 'piece');
    expect(next.answers).toHaveLength(1);
    expect(next.answers![0]).toMatchObject({
      pieceId: 'a',
      col: 3,
      row: 4,
      fits: true,
      verdict: 'strong',
      p: 0.9,
      rank: 0,
      grid: '28x36',
      from: 'piece',
      mode: 'whole',
    });
    const placed = (await db().pieces.get('a'))!;
    expect(placed.status).toBe('placed');
    expect(placed.placedAt).toMatchObject({ col: 3, row: 4, rot: 1, from: 'tray', tray: 'B' });
    expect(answerView(next).taken.get('3,4')?.id).toBe('a');

    const back = await undoFits(pz.id, 'a');
    expect(back.answers![0]!.undone).toBe(true);
    expect(answerView(back).taken.size).toBe(0);
    const row = (await db().pieces.get('a'))!;
    expect(row.status).toBe('tray');
    expect(row.tray).toBe('B');
    expect(row.placedAt).toBeNull();
    expect((await getProject(pz.id))!.answers).toHaveLength(1);
  });

  it('"doesn’t fit" rules the spot out for that piece; "Ask again" brings it back; another grid ignores answers', async () => {
    const pz = await puzzle();
    const a = piece(pz.id, 'a');
    await db().pieces.put(a);
    const shown = { placement: placement('likely', spot(3, 4, 0.6), spot(5, 6, 0.35), spot(7, 8, 0.03)), fits: true };
    let p = await answerSpot(pz.id, a, { col: 3, row: 4, rot: 0 }, false, shown, 'fill');
    expect((await db().pieces.get('a'))!.status).toBe('table');
    const view = answerView(p);
    expect([...view.notHere.get('a')!]).toEqual(['3,4']);
    // The next spot moves up, its chance divided by what's left: 0.35 / 0.4 = 0.875 → Strong.
    const after = placementWithAnswers(a, shown.placement, view, new Map());
    expect(after.top.map((t) => [t.col, t.row])).toEqual([
      [5, 6],
      [7, 8],
    ]);
    expect(after.top[0]!.p).toBeCloseTo(0.875, 6);
    expect(after.verdict).toBe('strong');
    p = await clearNotHere(pz.id, 'a');
    expect(answerView(p).notHere.size).toBe(0);
    expect(answerView({ ...p, grid: { cols: 36, rows: 28 } as never, answers: [{ ...p.answers![0]!, undone: false }] }).notHere.size).toBe(0);
  });

  it('Undo right after "doesn’t fit" (M9 part 1): only that answer is undone, earlier ones stay; the piece stays on the table', async () => {
    const pz = await puzzle();
    const a = piece(pz.id, 'a');
    await db().pieces.put(a);
    const shown = { placement: placement('likely', spot(3, 4, 0.6), spot(5, 6, 0.35), spot(7, 8, 0.03)), fits: true };
    await answerSpot(pz.id, a, { col: 3, row: 4, rot: 0 }, false, shown, 'live');
    let p = await answerSpot(pz.id, a, { col: 5, row: 6, rot: 0 }, false, shown, 'live');
    expect([...answerView(p).notHere.get('a')!].sort()).toEqual(['3,4', '5,6']);
    p = await undoAnswer(pz.id, 'a', false);
    expect([...answerView(p).notHere.get('a')!]).toEqual(['3,4']);
    expect(p.answers!.map((x) => Boolean(x.undone))).toEqual([false, true]);
    expect((await db().pieces.get('a'))!.status).toBe('table');
    // ✓ Fits then Undo, the same way as undoFits.
    await answerSpot(pz.id, a, { col: 5, row: 6, rot: 0 }, true, shown, 'live');
    expect((await db().pieces.get('a'))!.status).toBe('placed');
    p = await undoAnswer(pz.id, 'a', true);
    expect((await db().pieces.get('a'))!.status).toBe('table');
    expect(answerView(p).taken.size).toBe(0);
    expect([...answerView(p).notHere.get('a')!]).toEqual(['3,4']);
  });

  it('whole picture: a spot taken by another piece is left out, and a spot whose neighbour’s knob can’t meet this piece’s', () => {
    // Piece k sits at (3, 4) unturned with a knob out on its right ('t' at index 1).
    const k = { ...piece('p', 'k', 'ftbt', 'placed'), placedAt: { col: 3, row: 4, rot: 0 as const, at: 1, from: 'table' as const, tray: null } };
    const view = answerView({
      grid: { cols: 28, rows: 36 } as never,
      answers: [{ pieceId: 'k', col: 3, row: 4, rot: 0, fits: true, at: 1, grid: '28x36', verdict: 'strong', p: 0.9, rank: 0, from: 'piece', mode: 'whole' }],
    });
    const placed = placedPieces([k]);
    // Piece a: knob out on its left ('t' at index 3) — can't sit right of k at (4, 4); a knob in there ('b') can.
    const a = piece('p', 'a', 'bbbt');
    const b = piece('p', 'b', 'tttb');
    const pl = placement('likely', spot(4, 4, 0.6), spot(3, 4, 0.2), spot(9, 9, 0.1));
    const pa = placementWithAnswers(a, pl, view, placed);
    expect(pa.top.map((t) => [t.col, t.row])).toEqual([[9, 9]]);
    const pb = placementWithAnswers(b, pl, view, placed);
    expect(pb.top.map((t) => [t.col, t.row])).toEqual([
      [4, 4],
      [9, 9],
    ]);
    expect(pb.top[0]!.p).toBeCloseTo(0.6 / 0.8, 6);
  });

  it('empty spots: the filled spot leaves the pairing, and its neighbours need the opposite knob', () => {
    const k = { ...piece('p', 'k', 'ftbt', 'placed'), placedAt: { col: 3, row: 4, rot: 0 as const, at: 1, from: 'table' as const, tray: null } };
    const view = answerView({
      grid: { cols: 28, rows: 36 } as never,
      answers: [{ pieceId: 'k', col: 3, row: 4, rot: 0, fits: true, at: 1, grid: '28x36', verdict: 'strong', p: 0.9, rank: 0, from: 'piece', mode: 'open' }],
    });
    const sides = spotSidesWithNeighbours(
      [
        [4, 4],
        [3, 5],
      ],
      ['????', '????'],
      view,
      placedPieces([k]),
    )!;
    // Right of k (its knob out on the right): this spot's left needs a knob in. Below k (its bottom is 'b'): a knob out.
    expect(sides[0]![3]).toBe('b');
    expect(sides[1]![0]).toBe('t');

    const cache: PlacementCache = {
      boxKey: 'k',
      colour: null,
      open: {
        cells: [
          [3, 4],
          [4, 4],
        ],
        turn: 0,
        fit: 1,
        runnerUp: 0,
      } as never,
      byPiece: {
        a: { ts: 100, placement: placement('strong', { ...spot(3, 4, 0.8), score: 0.9 }, { ...spot(4, 4, 0.1), score: 0.5 }) },
      },
    };
    const a = piece('p', 'a');
    const without = shownPlacements(cache, [a]);
    expect(without.get('a')!.placement.top[0]).toMatchObject({ col: 3, row: 4 });
    const withAns = shownPlacements(cache, [a], { view, placed: placedPieces([k]) });
    // (3, 4) is filled now: a goes to (4, 4), the only empty spot left.
    expect(withAns.get('a')!.placement.top[0]).toMatchObject({ col: 4, row: 4 });
  });

  it('empty spots: a piece tried in every spot it was offered is offered the other empty spots', () => {
    const cache: PlacementCache = {
      boxKey: 'k',
      colour: null,
      open: {
        cells: [
          [1, 1],
          [2, 1],
          [3, 1],
        ],
        turn: 0,
        fit: 1,
        runnerUp: 0,
      } as never,
      byPiece: { a: { ts: 100, placement: placement('strong', { ...spot(1, 1, 0.9), score: 0.9 }) } },
    };
    const a = piece('p', 'a');
    const view = answerView({
      grid: { cols: 28, rows: 36 } as never,
      answers: [{ pieceId: 'a', col: 1, row: 1, rot: 0, fits: false, at: 1, grid: '28x36', verdict: 'strong', p: 0.9, rank: 0, from: 'piece', mode: 'open' }],
    });
    const shown = shownPlacements(cache, [a], { view, placed: new Map() }).get('a')!;
    expect(shown.fits).toBe(true);
    expect(shown.placement.verdict).toBe('several');
    expect(shown.placement.top.map((t) => [t.col, t.row])).toEqual([
      [2, 1],
      [3, 1],
    ]);
  });

  it('"not a puzzle piece": removed from the list, its answers left out of the Accuracy page', async () => {
    const pz = await puzzle();
    const a = piece(pz.id, 'label');
    await db().pieces.put(a);
    await answerSpot(pz.id, a, { col: 3, row: 4, rot: 0 }, false, { placement: placement('strong', spot(3, 4, 0.9)), fits: true }, 'piece');
    const next = await removeNotAPiece(pz.id, 'label');
    expect(await db().pieces.get('label')).toBeUndefined();
    expect(next.answers!.every((x) => x.undone)).toBe(true);
    expect(answerView(next).notHere.size).toBe(0);
  });

  it('accuracy: first-choice answers by verdict with a 95 % range; tries per piece; undone answers left out', () => {
    const base = { col: 0, row: 0, rot: 0 as const, at: 1, grid: '28x36', from: 'piece' as const, mode: 'whole' as const };
    const ans: SpotAnswer[] = [
      { ...base, pieceId: 'a', fits: true, verdict: 'strong', p: 0.9, rank: 0 },
      { ...base, pieceId: 'b', fits: true, verdict: 'strong', p: 0.95, rank: 0 },
      { ...base, pieceId: 'c', fits: false, verdict: 'strong', p: 0.8, rank: 0 },
      { ...base, pieceId: 'c', fits: true, verdict: 'likely', p: 0.6, rank: 0 },
      { ...base, pieceId: 'd', fits: false, verdict: 'several', p: 0.3, rank: 0 },
      { ...base, pieceId: 'd', fits: true, verdict: 'several', p: 0.2, rank: 1 },
      { ...base, pieceId: 'e', fits: true, verdict: 'strong', p: 0.9, rank: 0, undone: true },
    ];
    const a = accuracyOf(ans);
    expect(a.answers).toBe(6);
    expect(a.first.strong).toMatchObject({ right: 2, total: 3 });
    expect(a.first.likely).toMatchObject({ right: 1, total: 1 });
    expect(a.first.several).toMatchObject({ right: 0, total: 1 });
    expect(a.first.all).toMatchObject({ right: 3, total: 5 });
    expect(a.placed).toBe(4);
    expect(a.triesPerPiece).toBeCloseTo((1 + 1 + 2 + 2) / 4, 6);
    expect(a.calibration.map((b) => b.label)).toEqual(['below 55 %', '55–75 %', '75–90 %', '90 % and more']);
    const [lo, hi] = wilson(8, 10);
    expect(lo).toBeCloseTo(0.49, 2);
    expect(hi).toBeCloseTo(0.943, 2);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});
