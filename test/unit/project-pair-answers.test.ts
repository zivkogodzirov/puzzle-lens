/**
 * "They fit" / "Don't fit" for pairs (M6): kept on the puzzle with what the app said, the view the
 * Matches panel uses, Undo, removing a non-piece, and the Accuracy page's pair rows.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, eraseAllData } from '../../src/db/db';
import { createProject, getProject } from '../../src/project/store';
import { removeNotAPiece } from '../../src/project/answers';
import { answerPair, pairAccuracyOf, pairAnswerView, undoPairAnswer } from '../../src/project/pairAnswers';
import { pairKey } from '../../src/project/pairs';
import type { PairAnswer, PieceRow } from '../../src/project/types';

beforeEach(async () => {
  await eraseAllData();
});

describe('pair answers', () => {
  it('kept on the puzzle; joined and "don’t fit" pairs in the view; Undo takes the latest back', async () => {
    const pz = await createProject({ name: 'The Kiss', pieceCount: 1000, setupStep: 6 });
    await answerPair(pz.id, { a: 'a', b: 'b', dir: 1, p: 0.95 }, true, true, 'matches');
    await answerPair(pz.id, { a: 'a', b: 'c', dir: 2, p: 0.6 }, false, false, 'matches');
    let p = (await getProject(pz.id))!;
    expect(p.pairAnswers).toHaveLength(2);
    expect(p.pairAnswers![0]).toMatchObject({ a: 'a', b: 'b', dir: 1, fits: true, p: 0.95, confirmed: true, from: 'matches' });
    let view = pairAnswerView(p);
    expect([...view.joined.keys()]).toEqual(['a|b|1']);
    expect([...view.not]).toEqual(['a|c|2']);
    // The same pair named from the other piece.
    expect(view.not.has(pairKey('c', 'a', 0))).toBe(true);
    p = await undoPairAnswer(pz.id, 'a|c|2');
    view = pairAnswerView(p);
    expect(view.not.size).toBe(0);
    expect(p.pairAnswers![1]!.undone).toBe(true);
    // A later answer about the same pair wins.
    p = await answerPair(pz.id, { a: 'a', b: 'b', dir: 1, p: 0.95 }, false, true, 'matches');
    view = pairAnswerView(p);
    expect(view.joined.size).toBe(0);
    expect(view.not.has('a|b|1')).toBe(true);
  });

  it('removing something that isn’t a piece takes its pair answers out too', async () => {
    const pz = await createProject({ name: 'The Kiss', pieceCount: 1000, setupStep: 6 });
    await db().pieces.put({ id: 'label', projectId: pz.id, status: 'table' } as unknown as PieceRow);
    await answerPair(pz.id, { a: 'label', b: 'b', dir: 1, p: 0.4 }, false, false, 'matches');
    await answerPair(pz.id, { a: 'x', b: 'y', dir: 2, p: 0.9 }, true, false, 'matches');
    const p = await removeNotAPiece(pz.id, 'label');
    expect(p.pairAnswers!.map((a) => Boolean(a.undone))).toEqual([true, false]);
  });

  it('accuracy: squares of 4 and other pairs, with a 95 % range; undone answers left out', () => {
    const ans = (fits: boolean, p: number, confirmed: boolean, undone = false): PairAnswer => ({
      a: 'a',
      b: 'b',
      dir: 1,
      fits,
      at: 1,
      p,
      confirmed,
      from: 'matches',
      undone,
    });
    const acc = pairAccuracyOf([ans(true, 0.97, true), ans(true, 0.95, true), ans(false, 0.6, false), ans(true, 0.8, false), ans(false, 0.9, true, true)]);
    expect(acc.answers).toBe(4);
    expect(acc.confirmed).toMatchObject({ right: 2, total: 2 });
    expect(acc.other).toMatchObject({ right: 1, total: 2 });
    expect(acc.all).toMatchObject({ right: 3, total: 4 });
    expect(acc.all.range[0]).toBeLessThan(0.75);
    expect(acc.calibration.map((b) => [b.label, b.right, b.total])).toEqual([
      ['50–75 %', 0, 1],
      ['75–90 %', 1, 1],
      ['90 % and more', 2, 2],
    ]);
  });
});
