/**
 * Trays by colour (src/project/trays.ts, src/project/groups.ts) on an in-memory IndexedDB: pieces go
 * into a tray and back, the groups' colours are fixed while any tray holds pieces, and pieces in
 * trays still count among the empty spots.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, eraseAllData } from '../../src/db/db';
import { countPiecesByStatus, createProject, getProject, normalizeProject, updateProject } from '../../src/project/store';
import { emptyTray, fixedColours, moveToTray, trayCountOf, trayCounts } from '../../src/project/trays';
import { makeGroups } from '../../src/project/groups';
import { stalePieces } from '../../src/project/placements';
import { planMerge } from '../../src/project/catalog';
import type { Lab, PieceColours } from '../../src/cv/colourGroups';
import type { PieceRow } from '../../src/project/types';

beforeEach(async () => {
  await eraseAllData();
});

const DARK: Lab = [20, 5, 5];
const SKY: Lab = [70, -5, -35];

function piece(projectId: string, id: string, x: number): PieceRow {
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
    thumbBlobId: null,
    seen: 1,
    bestPxPerMm: 5,
    flags: {},
    patch: { blobId: `patch-${id}`, flats: [false, false, false, false], sure: true, ts: 100 },
  };
}

async function setup() {
  const p = await createProject({ name: 'The Kiss', pieceCount: 1000, setupStep: 6 });
  const ids = ['d1', 'd2', 'd3', 's1', 's2'];
  await db().pieces.bulkPut(ids.map((id, i) => piece(p.id, id, i * 30)));
  const colours = new Map<string, PieceColours>(ids.map((id) => [id, { main: id[0] === 'd' ? DARK : SKY, mainShare: 1, second: null, secondShare: 0 }]));
  return { project: (await getProject(p.id))!, colours };
}

describe('trays', () => {
  it('pieces go into a tray: off the table, counted in trays, and the groups are fixed', async () => {
    const { project, colours } = await setup();
    const g0 = makeGroups(project, await db().pieces.toArray(), colours);
    expect(g0.fixed).toBe(false);
    expect(g0.groups.map((g) => g.letter)).toEqual(['A', 'B']);
    const darkIds = [...g0.of].filter(([, v]) => v.group === 0).map(([id]) => id);
    expect(darkIds.sort()).toEqual(['d1', 'd2', 'd3']);

    expect(
      await moveToTray(
        project.id,
        darkIds,
        'A',
        g0.groups.map((g) => g.lab),
      ),
    ).toBe(3);
    const all = await db().pieces.toArray();
    expect(all.filter((p) => p.status === 'tray').map((p) => p.tray)).toEqual(['A', 'A', 'A']);
    expect(trayCounts(all)).toEqual(new Map([['A', 3]]));
    expect(await countPiecesByStatus(project.id)).toEqual({ table: 2, missing: 0, tray: 3, placed: 0, pending: 0, aside: 0, all: 5 });
    const p1 = (await getProject(project.id))!;
    expect(fixedColours(p1, all)).toEqual(g0.groups.map((g) => g.lab));

    // A new piece arriving later is grouped with the fixed colours; tray pieces keep their tray.
    const g1 = makeGroups(p1, all, colours);
    expect(g1.fixed).toBe(true);
    expect(g1.of.get('d1')).toEqual({ group: 0, also: null });
    expect(g1.of.get('s1')!.group).toBe(1);
  });

  it('putting the last tray back frees the groups again', async () => {
    const { project, colours } = await setup();
    const g0 = makeGroups(project, await db().pieces.toArray(), colours);
    const labs = g0.groups.map((g) => g.lab);
    await moveToTray(project.id, ['d1', 'd2', 'd3'], 'A', labs);
    await moveToTray(project.id, ['s1'], 'B', labs);
    expect(await emptyTray(project.id, 'A')).toBe(3);
    let p = (await getProject(project.id))!;
    expect(p.trays?.colours).toEqual(labs);
    expect(await emptyTray(project.id, 'B')).toBe(1);
    p = (await getProject(project.id))!;
    expect(p.trays?.colours).toBeNull();
    const all = await db().pieces.toArray();
    expect(all.every((q) => q.status === 'table' && !q.tray)).toBe(true);
    expect(fixedColours(p, all)).toBeNull();
  });

  it('the number of trays is kept within 2–12, default 6, and survives saving', async () => {
    const { project } = await setup();
    expect(trayCountOf(project)).toBe(6);
    expect(trayCountOf({ trays: { count: 40, colours: null } })).toBe(12);
    expect(trayCountOf({ trays: { count: 1, colours: null } })).toBe(2);
    await updateProject(project.id, { trays: { count: 8, colours: null } });
    expect(trayCountOf((await getProject(project.id))!)).toBe(8);
    expect(normalizeProject({ id: 'x', trays: { count: 3, colours: [] } }).trays).toEqual({ count: 3, colours: null });
    expect(normalizeProject({ id: 'x' }).trays).toBeNull();
  });

  it('pieces in trays are still placed (they belong in the puzzle), and a new scan of the table never marks them missing', async () => {
    const { project } = await setup();
    await moveToTray(project.id, ['d1'], 'A', [DARK, SKY]);
    const all = await db().pieces.toArray();
    expect(
      stalePieces(null, 'key', all)
        .map((p) => p.id)
        .sort(),
    ).toEqual(['d1', 'd2', 'd3', 's1', 's2']);
    // A photo of the whole table area finds only the pieces still there: d1 (in a tray) isn't expected.
    const found = all
      .filter((p) => p.status === 'table')
      .map((p) => ({
        outlineMm: [p.table.x - 9, -9, p.table.x + 9, -9, p.table.x + 9, 9, p.table.x - 9, 9],
        centreMm: [p.table.x, p.table.y] as [number, number],
        angleDeg: 0,
        areaMm2: p.areaMm2,
        sizeMm: p.sizeMm,
        meanLab: [50, 0, 0] as [number, number, number],
        hueHist: [1, 0, 0, 0, 0, 0, 0, 0],
        flags: {},
      }));
    const plan = planMerge(all, found, {
      projectId: project.id,
      snapId: 's2',
      pxPerMm: 5,
      now: 2,
      newId: () => 'new',
      thumbId: (id) => `t-${id}`,
      view: [
        [-50, -50],
        [200, -50],
        [200, 50],
        [-50, 50],
      ],
    });
    expect(plan.added).toEqual([]);
    expect(plan.updates.find((p) => p.id === 'd1')).toBeUndefined();
    expect(plan.updates.filter((p) => p.status === 'missing')).toEqual([]);
  });
});
