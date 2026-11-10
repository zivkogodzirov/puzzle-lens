/**
 * The Scan screen's piece reads (src/scan/pieceReads.ts, M8 part 4) on an in-memory IndexedDB: a
 * list read earlier is used again only while no piece row was written since, and the rows after a
 * merge taken from the plan are exactly what reading them back gives.
 */
import 'fake-indexeddb/auto'; // must come first: Dexie picks up indexedDB when it loads
import { beforeEach, describe, expect, it } from 'vitest';
import { db, eraseAllData } from '../../src/db/db';
import { planMerge, type FoundForCatalog, type MergePlan } from '../../src/project/catalog';
import { currentPieceList, piecesAfterMerge, readPieceList, rowsAfterMerge, stillCurrent } from '../../src/scan/pieceReads';
import type { PieceRow } from '../../src/project/types';

beforeEach(async () => {
  await eraseAllData();
});

function found(x: number, y: number, extra: Partial<FoundForCatalog> = {}): FoundForCatalog {
  const h = 12;
  return {
    outlineMm: [x - h, y - h, x + h, y - h, x + h, y + h, x - h, y + h],
    centreMm: [x, y],
    angleDeg: 0,
    areaMm2: 400,
    sizeMm: [24, 26],
    meanLab: [50, 0, 0],
    hueHist: [1, 0, 0, 0, 0, 0, 0, 0],
    flags: {},
    ...extra,
  };
}

let n = 0;
// Random-looking ids, so the database's order (by id) differs from the order the plan lists them in.
const newId = () => `${((++n * 2654435761) >>> 0).toString(16)}-${n}`;
const ctx = (now: number, view?: Array<[number, number]>) => ({
  projectId: 'p',
  snapId: `s${now}`,
  pxPerMm: 6,
  now,
  newId,
  thumbId: (id: string) => `p:p:thumb-${id}`,
  view: view ?? null,
});

/** Writes a plan the way the Scan screen does (one transaction: puts, then deletes). */
async function write(plan: MergePlan): Promise<void> {
  await db().transaction('rw', db().blobs, db().pieces, db().snaps, async () => {
    await db().blobs.put({ id: `snap-${plan.added.length}`, ts: 1, kind: 'snap', blob: new Blob(['x']) });
    await db().pieces.bulkPut([...plan.updates, ...plan.added]);
    if (plan.removed.length) await db().pieces.bulkDelete(plan.removed);
  });
}

const grid = (dx = 0) => Array.from({ length: 12 }, (_, i) => found(40 + (i % 4) * 60 + dx, 40 + Math.floor(i / 4) * 60));

describe('Scan screen piece reads', () => {
  it('a list read earlier stays in use until a piece row is written (anywhere), not for other tables', async () => {
    await write(planMerge([], grid(), ctx(1)));
    const list = await readPieceList('p');
    expect(list.rows).toHaveLength(12);
    expect(stillCurrent(list)).toBe(true);
    // Other tables don't count.
    await db().blobs.put({ id: 'b', ts: 1, kind: 'thumb', blob: new Blob(['y']) });
    await db().snaps.put({
      id: 's',
      projectId: 'p',
      kind: 'overview',
      ts: 1,
      width: 1,
      height: 1,
      zoom: 1,
      imgToTable: null,
      quality: null as never,
      blobId: null,
      pieceIds: [],
    });
    expect(stillCurrent(list)).toBe(true);
    expect(await currentPieceList(list, 'p')).toBe(list);
    // Any piece write does, whoever makes it (here: a plain update, as the puzzle page's answers do).
    await db().pieces.update(list.rows[0]!.id, { status: 'placed' });
    expect(stillCurrent(list)).toBe(false);
    const again = await currentPieceList(list, 'p');
    expect(again).not.toBe(list);
    expect(again.rows.find((p) => p.id === list.rows[0]!.id)!.status).toBe('placed');
    // A collection modify (the coin rescale) and a delete count too.
    await db()
      .pieces.where('projectId')
      .equals('p')
      .modify((p) => {
        p.areaMm2 *= 2;
      });
    expect(stillCurrent(again)).toBe(false);
    const third = await readPieceList('p');
    await db().pieces.delete(third.rows[1]!.id);
    expect(stillCurrent(third)).toBe(false);
    // Another puzzle's list is never taken for this one.
    expect(await currentPieceList(await readPieceList('q'), 'p')).not.toMatchObject({ projectId: 'q' });
  });

  it('"Erase all data" makes an earlier list old', async () => {
    await write(planMerge([], grid(), ctx(1)));
    const list = await readPieceList('p');
    await eraseAllData();
    expect(stillCurrent(list)).toBe(false);
    expect((await currentPieceList(list, 'p')).rows).toEqual([]);
  });

  it('the rows after a merge, taken from the plan, are exactly what reading them back gives', async () => {
    await write(planMerge([], grid(), ctx(1)));
    for (const [k, dx] of [
      [2, 0],
      [3, 3],
      [4, 200],
    ] as const) {
      const list = await readPieceList('p');
      // Some pieces seen again (one moved a little), some new, some gone from a spot in view.
      const f = grid(dx).filter((_, i) => i % 5 !== 0);
      f.push(found(500 + k * 30, 300));
      const view: Array<[number, number]> = [
        [0, 0],
        [600, 0],
        [600, 400],
        [0, 400],
      ];
      const plan = planMerge(list.rows, f, ctx(k, view));
      expect(plan.updates.length + plan.added.length).toBeGreaterThan(0);
      await write(plan);
      const derived = await piecesAfterMerge(list, plan);
      const readBack = (await readPieceList('p')).rows;
      expect(derived).toEqual(readBack);
      expect(derived.map((p) => p.id)).toEqual(readBack.map((p) => p.id));
      // It really came from the plan (no read): the plan's own row objects.
      const one = plan.added[0] ?? plan.updates[0]!;
      expect(derived.find((p) => p.id === one.id)).toBe(one);
    }
  });

  it('removed rows (pending sightings merged into a known piece) are left out', () => {
    const row = (id: string): PieceRow => ({ id, projectId: 'p', status: 'table' }) as unknown as PieceRow;
    const out = rowsAfterMerge([row('b'), row('d'), row('a')], {
      updates: [{ ...row('d'), status: 'missing' } as PieceRow],
      added: [row('c')],
      removed: ['a'],
    });
    expect(out.map((p) => [p.id, p.status])).toEqual([
      ['b', 'table'],
      ['c', 'table'],
      ['d', 'missing'],
    ]);
  });

  it('when something else wrote piece rows meanwhile, the rows are read back instead', async () => {
    await write(planMerge([], grid(), ctx(1)));
    const list = await readPieceList('p');
    const plan = planMerge(list.rows, grid(1), ctx(2));
    // e.g. a "✓ Fits" answer saved while the photo was being read.
    await db().pieces.update(list.rows[3]!.id, { status: 'placed' });
    await write(plan);
    const after = await piecesAfterMerge(list, plan);
    expect(after).toEqual((await readPieceList('p')).rows);
    expect(after.find((p) => p.id === plan.updates[0]!.id)).not.toBe(plan.updates[0]);
  });

  it('a plan that writes no row is read back (its transaction may not count as a piece write)', async () => {
    await write(planMerge([], grid(), ctx(1)));
    const list = await readPieceList('p');
    const plan = { updates: [], added: [], removed: [] };
    const after = await piecesAfterMerge(list, plan);
    expect(after).toEqual(list.rows);
    expect(after).not.toBe(list.rows);
  });
});
