/**
 * Box placements kept per puzzle (src/project/placements.ts), on an in-memory IndexedDB with a
 * stand-in photo helper: only new or re-photographed pieces are placed again, the colour match is
 * kept once measured, and a new box picture starts over. Also: scans store each piece's patch.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, eraseAllData } from '../../src/db/db';
import { createProject, getProject, projectBlobId, putBlob, updateProject } from '../../src/project/store';
import { readPlacements, shownPlacements, updatePlacements } from '../../src/project/placements';
import { planMerge } from '../../src/project/catalog';
import type { PieceRow } from '../../src/project/types';
import type { OpenSpotsInput, PieceToPlace, PlaceReply } from '../../src/shared/apis';

beforeEach(async () => {
  await eraseAllData();
});

const colour = {
  from: { mean: [50, 0, 0] as [number, number, number], std: [10, 5, 5] as [number, number, number] },
  to: { mean: [55, 2, 3] as [number, number, number], std: [12, 6, 6] as [number, number, number] },
};

function fakeReader() {
  const calls: Array<{ ids: string[]; colour: unknown; open: OpenSpotsInput | null }> = [];
  return {
    calls,
    async placePieces(
      _box: Blob,
      _key: string,
      _grid: { cols: number; rows: number },
      pieces: PieceToPlace[],
      c: unknown,
      open: OpenSpotsInput | null = null,
    ): Promise<PlaceReply> {
      calls.push({ ids: pieces.map((p) => p.id), colour: c, open });
      if (open) {
        // Among empty spots: every piece scored at every spot; piece i likes spot i best, but p0 and p1 both like spot 0 most.
        const cells = open.gaps;
        return {
          results: pieces.map((p, i) => ({
            id: p.id,
            placement: {
              top: cells.map(([col, row], j) => ({ col, row, rot: 0 as const, score: j === Math.max(0, i - 1) ? 0.8 : j === i ? 0.6 : 0, p: 0 })),
              verdict: 'several' as const,
            },
          })),
          colour: (c as typeof colour | null) ?? colour,
          open: { cells, turn: 0, fit: 0.9, runnerUp: 0.1 },
          ms: 1,
        };
      }
      return {
        results: pieces.map((p, i) => ({ id: p.id, placement: { top: [{ col: i, row: 0, rot: 0, score: 1, p: 0.9 }], verdict: 'strong' as const } })),
        colour: (c as typeof colour | null) ?? colour,
        open: null,
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

  it('with empty spots: they go to the photo helper, all pieces are placed again, and each spot takes one piece', async () => {
    let project = await setup(3);
    const r = fakeReader();
    const pieces = await db().pieces.toArray();
    await updatePlacements(project, pieces, r);
    expect(r.calls[0]!.open).toBeNull();
    const thumb = await putBlob(projectBlobId(project.id, 'open-spots'), 'open-spots', new Blob([new Uint8Array([9])]));
    const gaps: Array<[number, number]> = [
      [5, 0],
      [6, 0],
      [5, 1],
      [9, 9],
    ];
    project = await updateProject(project.id, { openSpots: { cols: 28, rows: 36, gaps, thumbBlobId: thumb, ts: 1 } });
    const c = await updatePlacements(project, pieces, r);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[1]!.ids.sort()).toEqual(['p0', 'p1', 'p2']);
    expect(r.calls[1]!.colour).toBeNull();
    expect(r.calls[1]!.open?.gaps).toEqual(gaps);
    expect(c!.open?.cells).toEqual(gaps);
    // p0 and p1 both like spot 0 best: one gets it, the other its own next best.
    const shown = shownPlacements(c, pieces);
    const spot = (id: string) => shown.get(id)!.placement.top[0]!;
    expect([spot('p0'), spot('p1'), spot('p2')].map((t) => `${t.col},${t.row}`)).toEqual(['5,0', '6,0', '5,1']);
    // Colour match now known: nothing to do. New empty spots (a newer photo): start over.
    await updatePlacements(project, pieces, r);
    expect(r.calls).toHaveLength(2);
    project = await updateProject(project.id, { openSpots: { ...project.openSpots!, ts: 2 } });
    await updatePlacements(project, pieces, r);
    expect(r.calls).toHaveLength(3);
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
