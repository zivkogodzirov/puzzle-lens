/**
 * Box placements kept per puzzle (src/project/placements.ts), on an in-memory IndexedDB with a
 * stand-in photo helper: only new or re-photographed pieces are placed again, the colour match is
 * kept once measured, and a new box picture starts over. Also: scans store each piece's patch.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, eraseAllData } from '../../src/db/db';
import { createProject, getProject, projectBlobId, putBlob, updateProject } from '../../src/project/store';
import { readPlacements, updatePlacements } from '../../src/project/placements';
import { planMerge } from '../../src/project/catalog';
import type { PieceRow } from '../../src/project/types';
import type { PieceToPlace, PlaceReply } from '../../src/shared/apis';

beforeEach(async () => {
  await eraseAllData();
});

const colour = {
  from: { mean: [50, 0, 0] as [number, number, number], std: [10, 5, 5] as [number, number, number] },
  to: { mean: [55, 2, 3] as [number, number, number], std: [12, 6, 6] as [number, number, number] },
};

function fakeReader() {
  const calls: Array<{ ids: string[]; colour: unknown }> = [];
  return {
    calls,
    async placePieces(_box: Blob, _key: string, _grid: { cols: number; rows: number }, pieces: PieceToPlace[], c: unknown): Promise<PlaceReply> {
      calls.push({ ids: pieces.map((p) => p.id), colour: c });
      return {
        results: pieces.map((p, i) => ({ id: p.id, placement: { top: [{ col: i, row: 0, rot: 0, score: 1, p: 0.9 }], verdict: 'strong' as const } })),
        colour: (c as typeof colour | null) ?? colour,
        ms: 1,
      };
    },
  };
}

async function setup(n: number) {
  const p = await createProject({ name: 'The Kiss', pieceCount: 1000, setupStep: 6 });
  const rect = await putBlob(projectBlobId(p.id, 'box-rect'), 'box', new Blob([new Uint8Array([1, 2, 3])]));
  await updateProject(p.id, {
    box: {
      photoBlobId: rect,
      rectifiedBlobId: rect,
      corners: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      photoWidth: 10,
      photoHeight: 10,
      width: 28,
      height: 36,
    },
    grid: { cols: 28, rows: 36, source: 'suggested' },
  });
  for (let i = 0; i < n; i++) {
    const blobId = await putBlob(projectBlobId(p.id, `patch-p${i}`), 'patch', new Blob([new Uint8Array(56 * 56 * 4)]));
    await db().pieces.put({
      id: `p${i}`,
      projectId: p.id,
      createdAt: 1,
      updatedAt: 1,
      status: 'table',
      table: { x: 0, y: 0, angleDeg: 0, lastSeen: 1, snapId: 's' },
      outlineMm: [],
      areaMm2: 300,
      sizeMm: [18, 19],
      colour: { meanLab: [50, 0, 0], hueHist: [] },
      thumbBlobId: null,
      seen: 1,
      bestPxPerMm: 5,
      flags: {},
      patch: { blobId, flats: [false, false, false, false], sure: true, ts: 100 },
    } as PieceRow);
  }
  return (await getProject(p.id))!;
}

describe('box placements', () => {
  it('places every piece once, keeps the colour match, then only re-places pieces photographed again', async () => {
    const project = await setup(3);
    const r = fakeReader();
    let pieces = await db().pieces.toArray();
    const c1 = await updatePlacements(project, pieces, r);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.ids.sort()).toEqual(['p0', 'p1', 'p2']);
    expect(r.calls[0]!.colour).toBeNull();
    expect(Object.keys(c1!.byPiece)).toHaveLength(3);
    expect((await readPlacements(project.id))!.colour).toEqual(colour);
    // Nothing new: no work.
    await updatePlacements(project, pieces, r);
    expect(r.calls).toHaveLength(1);
    // p1 photographed again (newer patch): only p1, with the stored colour match.
    await db().pieces.update('p1', { patch: { ...pieces[1]!.patch!, ts: 200 } });
    pieces = await db().pieces.toArray();
    await updatePlacements(project, pieces, r);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[1]!.ids).toEqual(['p1']);
    expect(r.calls[1]!.colour).toEqual(colour);
  });

  it('a new box picture starts over', async () => {
    const project = await setup(2);
    const r = fakeReader();
    const pieces = await db().pieces.toArray();
    await updatePlacements(project, pieces, r);
    const moved = {
      ...project,
      box: {
        ...project.box!,
        corners: [
          [1, 1],
          [10, 0],
          [10, 10],
          [0, 10],
        ] as Array<[number, number]>,
      },
    };
    await updatePlacements(moved, pieces, r);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[1]!.ids.sort()).toEqual(['p0', 'p1']);
    expect(r.calls[1]!.colour).toBeNull();
  });

  it("a scan stores each piece's patch with its flat sides (and keeps the id when photographed again sharper)", () => {
    const found = {
      outlineMm: [0, 0, 18, 0, 18, 19, 0, 19],
      centreMm: [9, 9.5] as [number, number],
      angleDeg: 0,
      areaMm2: 342,
      sizeMm: [18, 19] as [number, number],
      meanLab: [50, 0, 0] as [number, number, number],
      hueHist: [],
      flags: {},
      patch: { blob: new Blob([new Uint8Array(4)]), flats: [true, false, false, false], sure: true },
    };
    const ctx = {
      projectId: 'x',
      snapId: 's1',
      pxPerMm: 5,
      now: 10,
      newId: () => 'n1',
      thumbId: (id: string) => `t-${id}`,
      patchId: (id: string) => `pt-${id}`,
    };
    const plan = planMerge([], [found], ctx);
    expect(plan.added[0]!.patch).toEqual({ blobId: 'pt-n1', flats: [true, false, false, false], sure: true, ts: 10 });
    expect(plan.patches.map((p) => p.id)).toEqual(['pt-n1']);
    const again = planMerge(plan.added, [{ ...found, patch: { ...found.patch, flats: [false, true, false, false] } }], { ...ctx, pxPerMm: 9, now: 20 });
    expect(again.updates[0]!.patch).toEqual({ blobId: 'pt-n1', flats: [false, true, false, false], sure: true, ts: 20 });
  });
});
