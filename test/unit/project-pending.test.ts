/**
 * Pieces to check (src/project/pending.ts, M5 part 3) on an in-memory IndexedDB: "same piece" merges
 * the pending sighting into the known piece (which takes the newest sighting, and its answers);
 * "a different piece" keeps it as a new one.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, eraseAllData } from '../../src/db/db';
import { createProject, getProject, updateProject } from '../../src/project/store';
import { resolvePending } from '../../src/project/pending';
import type { PieceRow } from '../../src/project/types';

beforeEach(async () => {
  await eraseAllData();
});

function piece(projectId: string, id: string, x: number, extra: Partial<PieceRow> = {}): PieceRow {
  return {
    id,
    projectId,
    createdAt: 1,
    updatedAt: 1,
    status: 'table',
    table: { x, y: 0, angleDeg: 0, lastSeen: 1, snapId: 's1' },
    outlineMm: [-9, -9, 9, -9, 9, 9, -9, 9],
    areaMm2: 324,
    sizeMm: [18, 18],
    colour: { meanLab: [50, 0, 0], hueHist: [] },
    thumbBlobId: `thumb-${id}`,
    seen: 1,
    bestPxPerMm: 5,
    flags: {},
    ...extra,
  };
}

describe('pieces to check', () => {
  it('"same piece": the known piece takes the new sighting (and its answers); the pending row goes', async () => {
    const p = await createProject({ name: 'The Kiss' });
    await updateProject(p.id, {
      answers: [{ pieceId: 'new', col: 1, row: 1, rot: 0, fits: false, at: 1, grid: '28x36', verdict: 'strong', p: 0.9, rank: 0, from: 'piece', mode: 'whole' }],
    });
    await db().pieces.bulkPut([
      piece(p.id, 'old', 100, { status: 'missing', seen: 3 }),
      piece(p.id, 'new', 250, { status: 'pending', maybe: ['old'], table: { x: 250, y: 40, angleDeg: 30, lastSeen: 2, snapId: 's2' } }),
    ]);
    await resolvePending(p.id, 'new', 'old');
    const rows = await db().pieces.toArray();
    expect(rows.map((r) => r.id)).toEqual(['old']);
    expect(rows[0]).toMatchObject({ status: 'table', table: { x: 250, y: 40, angleDeg: 30 }, thumbBlobId: 'thumb-new', seen: 4, maybe: null });
    expect((await getProject(p.id))!.answers![0]!.pieceId).toBe('old');
  });

  it('"a different piece": kept as a new piece on the table', async () => {
    const p = await createProject({ name: 'The Kiss' });
    await db().pieces.bulkPut([piece(p.id, 'old', 100), piece(p.id, 'new', 250, { status: 'pending', maybe: ['old'] })]);
    await resolvePending(p.id, 'new', null);
    const rows = await db().pieces.orderBy('id').toArray();
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ['new', 'table'],
      ['old', 'table'],
    ]);
  });
});
