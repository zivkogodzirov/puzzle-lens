/** Batches (M7, src/project/batches.ts): a new batch sets the table's pieces aside; the rest stay. */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, eraseAllData } from '../../src/db/db';
import { createProject, countPiecesByStatus, getProject } from '../../src/project/store';
import { batchNumber, snapsOfBatch, startNewBatch } from '../../src/project/batches';
import type { PieceRow } from '../../src/project/types';

beforeEach(async () => {
  await eraseAllData();
});

const piece = (projectId: string, id: string, status: PieceRow['status']) => ({ id, projectId, status, updatedAt: 1 }) as unknown as PieceRow;

describe('batches', () => {
  it('a new batch sets the table, pieces to check and missing pieces aside; trays and the puzzle stay', async () => {
    const p = await createProject({ name: 'The Kiss', pieceCount: 1000 });
    expect(batchNumber(p)).toBe(1);
    await db().pieces.bulkPut([
      piece(p.id, 'a', 'table'),
      piece(p.id, 'b', 'pending'),
      piece(p.id, 'c', 'missing'),
      piece(p.id, 'd', 'tray'),
      piece(p.id, 'e', 'placed'),
      piece(p.id, 'f', 'aside'),
      piece('other', 'g', 'table'),
    ]);
    const r = await startNewBatch(p.id, 5000);
    expect(r.aside).toBe(3);
    expect(r.project.batch).toEqual({ n: 2, startedAt: 5000 });
    expect((await getProject(p.id))!.batch).toEqual({ n: 2, startedAt: 5000 });
    const by = new Map((await db().pieces.toArray()).map((q) => [q.id, q.status]));
    expect(Object.fromEntries(by)).toEqual({ a: 'aside', b: 'aside', c: 'aside', d: 'tray', e: 'placed', f: 'aside', g: 'table' });
    expect(await countPiecesByStatus(p.id)).toMatchObject({ table: 0, tray: 1, placed: 1, aside: 4, all: 6 });
    // And the next one counts on.
    expect((await startNewBatch(p.id, 6000)).project.batch!.n).toBe(3);
  });

  it('only this batch’s photos show the table as it is now', () => {
    const snaps = [{ ts: 100 }, { ts: 5000 }, { ts: 7000 }];
    expect(snapsOfBatch({}, snaps)).toHaveLength(3);
    expect(snapsOfBatch({ batch: { n: 2, startedAt: 5000 } }, snaps)).toEqual([{ ts: 5000 }, { ts: 7000 }]);
  });
});
