/** Pieces marked as in the puzzle without tapping each (M7 part 4, src/project/placedFromPhoto.ts). */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SpotChoice } from '../../src/cv/openSpots';
import { db, eraseAllData } from '../../src/db/db';
import { createProject, placementKey, updateProject } from '../../src/project/store';
import { markFromFinishedPhoto, markPlaced, piecesInFilledSpots } from '../../src/project/placedFromPhoto';
import { undoFits } from '../../src/project/answers';
import type { PieceRow } from '../../src/project/types';

beforeEach(async () => {
  await eraseAllData();
});

const at = (col: number, row: number, verdict: 'strong' | 'likely' | 'several' = 'strong'): SpotChoice =>
  ({ placement: { top: [{ col, row, rot: 2, score: 1, p: 0.9 }], verdict }, fits: true }) as unknown as SpotChoice;
const piece = (projectId: string, id: string, status: PieceRow['status'] = 'table', extra: Partial<PieceRow> = {}) =>
  ({ id, projectId, status, updatedAt: 1, tray: null, placedAt: null, ...extra }) as unknown as PieceRow;

describe('a new photo of the puzzle', () => {
  it('spots filled since the last photo: their sure pieces still waiting are the ones that went in', () => {
    const oldOpen: Array<[number, number]> = [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ];
    const newOpen: Array<[number, number]> = [[4, 1]];
    const before = new Map([
      ['a', at(1, 1)],
      ['b', at(2, 1, 'likely')],
      ['c', at(3, 1, 'several')], // not sure: left alone
      ['d', at(4, 1)], // its spot is still empty
      ['e', at(1, 1)], // in a tray, but its spot already went to 'a'
    ]);
    const pieces = [piece('p', 'a'), piece('p', 'b', 'tray'), piece('p', 'c'), piece('p', 'd'), piece('p', 'e', 'tray')];
    expect(piecesInFilledSpots(before, oldOpen, newOpen, pieces)).toEqual([
      { id: 'a', col: 1, row: 1, rot: 2 },
      { id: 'b', col: 2, row: 1, rot: 2 },
    ]);
    // Pieces already in the puzzle or set aside aren't marked again.
    expect(piecesInFilledSpots(before, oldOpen, newOpen, [piece('p', 'a', 'placed'), piece('p', 'b', 'aside')])).toEqual([]);
  });

  it('marked pieces are in the puzzle (from the photo) and can be taken out again', async () => {
    const pz = await createProject({ name: 'The Kiss', pieceCount: 1000 });
    await db().pieces.bulkPut([piece(pz.id, 'a'), piece(pz.id, 'b', 'tray', { tray: 'C' }), piece(pz.id, 'z', 'placed')]);
    expect(
      await markPlaced(
        pz.id,
        [
          { id: 'a', col: 1, row: 1, rot: 2 },
          { id: 'b', col: 2, row: 1 },
          { id: 'z', col: 5, row: 5 },
        ],
        'photo',
      ),
    ).toEqual(['a', 'b']);
    const a = (await db().pieces.get('a'))!;
    expect(a.status).toBe('placed');
    expect(a.placedAt).toMatchObject({ col: 1, row: 1, rot: 2, from: 'table', by: 'photo' });
    expect((await db().pieces.get('b'))!.placedAt).toMatchObject({ from: 'tray', tray: 'C' });
    await undoFits(pz.id, 'b');
    expect(await db().pieces.get('b')).toMatchObject({ status: 'tray', tray: 'C', placedAt: null });
  });

  it('"It’s in the puzzle": in, with no spot', async () => {
    const pz = await createProject({ name: 'The Kiss', pieceCount: 1000 });
    await db().pieces.put(piece(pz.id, 'a'));
    await markPlaced(pz.id, [{ id: 'a' }], 'tap');
    expect((await db().pieces.get('a'))!.placedAt).toMatchObject({ col: -1, row: -1, by: 'tap' });
  });

  it('a finished photo (no empty spots left): the sure pieces for the old empty spots went in', async () => {
    const pz = await createProject({ name: 'The Kiss', pieceCount: 1000 });
    await db().pieces.bulkPut([piece(pz.id, 'a'), piece(pz.id, 'b'), piece(pz.id, 'c')]);
    await db().settings.put({
      key: placementKey(pz.id),
      value: {
        boxKey: 'k',
        colour: null,
        open: {
          cells: [
            [1, 1],
            [2, 1],
            [3, 1],
          ],
          sides: null,
          turn: 0,
          fit: 1,
          runnerUp: 0,
        },
        byPiece: {
          a: { ts: 1, placement: { top: [{ col: 1, row: 1, rot: 0, score: 0.9, p: 0.9 }], verdict: 'strong' } },
          b: { ts: 1, placement: { top: [{ col: 2, row: 1, rot: 0, score: 0.9, p: 0.9 }], verdict: 'strong' } },
          c: { ts: 1, placement: { top: [{ col: 3, row: 1, rot: 0, score: -0.5, p: 0.3 }], verdict: 'several' } },
        },
      },
    });
    await updateProject(pz.id, { grid: { cols: 5, rows: 3, source: 'suggested' } as never });
    const r = await markFromFinishedPhoto(pz.id);
    expect(r.filled).toBe(3);
    expect(r.ids.sort()).toEqual(['a', 'b']);
    expect((await db().pieces.get('c'))!.status).toBe('table');
  });
});
