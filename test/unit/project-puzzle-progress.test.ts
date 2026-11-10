/** Progress (M7 part 2, src/project/progress.ts puzzleProgress): what's done, known and still to find. */
import { describe, expect, it } from 'vitest';
import type { SpotChoice } from '../../src/cv/openSpots';
import { puzzleProgress } from '../../src/project/progress';
import type { PieceRow } from '../../src/project/types';

const grid = { cols: 4, rows: 3 };
const piece = (id: string, status: PieceRow['status'], extra: Partial<PieceRow> = {}) => ({ id, status, placedAt: null, tray: null, ...extra }) as PieceRow;
const at = (col: number, row: number, verdict: 'strong' | 'likely' | 'several' = 'strong'): SpotChoice =>
  ({ placement: { top: [{ col, row, rot: 0, score: 1, p: 0.9 }], verdict }, fits: true }) as unknown as SpotChoice;

describe('puzzle progress', () => {
  it('from the puzzle photo: all but the empty spots are in; pieces known for some empty spots; the rest still to find', () => {
    const open: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [2, 2],
      [3, 2],
    ];
    const pieces = [
      piece('a', 'table'),
      piece('b', 'tray', { tray: 'B' }),
      piece('c', 'placed', { placedAt: { col: 3, row: 2, rot: 0, at: 1, from: 'table', tray: null } }),
      piece('d', 'table'),
      piece('label', 'table'),
    ];
    const shown = new Map([
      ['a', at(0, 0)],
      ['b', at(2, 2)],
      ['d', at(1, 0, 'several')],
    ]);
    const p = puzzleProgress({ grid, pieces, shown, open, taken: new Set(['3,2']) });
    expect(p.cells).toBe(12);
    // 12 − 4 empty + 1 fitted since.
    expect(p.done).toBe(9);
    expect(p.doneFrom).toBe('photo');
    expect(p.known).toBe(2);
    expect(p.toFind).toBe(1);
    expect(p.toFindExact).toBe(true);
    expect(p.status).toMatchObject({ table: 3, tray: 1, placed: 1 });
    expect(p.trays).toEqual([['B', 1]]);
    expect([...p.cellState]).toEqual([2, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1]);
  });

  it('on the whole picture: only pieces said to fit are in; never seen is an estimate', () => {
    const pieces = [
      piece('a', 'placed', { placedAt: { col: 0, row: 0, rot: 0, at: 1, from: 'table', tray: null } }),
      piece('b', 'table'),
      piece('c', 'table'),
      piece('d', 'aside'),
    ];
    const p = puzzleProgress({ grid, pieces, shown: new Map([['b', at(1, 1)]]), open: null, taken: new Set() });
    expect(p.done).toBe(1);
    expect(p.doneFrom).toBe('answers');
    expect(p.known).toBe(1);
    // 12 − 1 in − 2 on the table − 1 set aside.
    expect(p.toFind).toBe(8);
    expect(p.toFindExact).toBe(false);
    expect(p.cellState[0]).toBe(1);
    expect(p.cellState[1 * 4 + 1]).toBe(2);
  });

  it('a puzzle photo whose spots aren’t on the box picture yet: counted from the photo', () => {
    const p = puzzleProgress({ grid, pieces: [], shown: new Map(), open: null, gapCount: 3, taken: new Set(['1,1']) });
    expect(p.done).toBe(10);
    expect(p.doneFrom).toBe('photo');
  });

  it('a photo showing the puzzle complete: every spot in', () => {
    const p = puzzleProgress({ grid, pieces: [piece('a', 'table')], shown: new Map(), open: null, taken: new Set(), finished: true });
    expect(p).toMatchObject({ done: 12, toFind: 0, doneFrom: 'photo' });
  });
});
