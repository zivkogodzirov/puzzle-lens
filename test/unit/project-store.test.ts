/**
 * Puzzle projects in the database (src/project/store.ts) on an in-memory IndexedDB.
 */
import 'fake-indexeddb/auto'; // must come first: Dexie picks up indexedDB when it loads
import { beforeEach, describe, expect, it } from 'vitest';
import { db, eraseAllData } from '../../src/db/db';
import {
  countPieces,
  countPiecesByStatus,
  createProject,
  deleteProject,
  getBlob,
  getBlobRow,
  getCurrentProjectId,
  getPrintScale,
  getProject,
  listProjects,
  nextProjectName,
  normalizeProject,
  projectBlobId,
  projectBlobIds,
  putBlob,
  setBlobMeta,
  setCurrentProjectId,
  setPrintScale,
  updateProject,
} from '../../src/project/store';
import type { PieceRow, SnapRow } from '../../src/project/types';

beforeEach(async () => {
  await eraseAllData();
});

const jpeg = (n: number) => new Blob([new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9])], { type: 'image/jpeg' });

function makePiece(id: string, projectId: string, thumbBlobId: string | null): PieceRow {
  return {
    id,
    projectId,
    createdAt: 1,
    updatedAt: 1,
    status: 'table',
    table: { x: 10, y: 20, angleDeg: 0, lastSeen: 1, snapId: 's1' },
    outlineMm: [0, 0, 1, 0, 1, 1],
    areaMm2: 300,
    sizeMm: [18, 19],
    colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
    thumbBlobId,
    seen: 1,
    bestPxPerMm: 5,
    flags: {},
  };
}

function makeSnap(id: string, projectId: string, blobId: string | null, pieceIds: string[] = []): SnapRow {
  return { id, projectId, kind: 'overview', ts: 1, width: 4032, height: 3024, zoom: 1, imgToTable: null, quality: null, blobId, pieceIds };
}

describe('create, read, list, update', () => {
  it('creates puzzles named Puzzle 1, Puzzle 2… with every field filled', async () => {
    const a = await createProject();
    const b = await createProject({ pieceCount: 1000 });
    expect(a.name).toBe('Puzzle 1');
    expect(b.name).toBe('Puzzle 2');
    expect(b).toMatchObject({ pieceCount: 1000, grid: null, box: null, markerMap: null, tableModel: null, piecePitch: null, setupStep: 1 });
    expect(await getProject(a.id)).toEqual(a);
    expect(await getProject('nope')).toBeUndefined();
  });

  it('reuses a free number and keeps a given name', async () => {
    await createProject({ name: 'Puzzle 2' });
    expect(await nextProjectName()).toBe('Puzzle 1');
    const c = await createProject({ name: '  Lighthouse  ' });
    expect(c.name).toBe('Lighthouse');
  });

  it('lists the most recently changed first', async () => {
    const a = await createProject();
    const b = await createProject();
    await updateProject(a.id, { pieceCount: 500 });
    const list = await listProjects();
    expect(list.map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it('updates fields, keeps id and createdAt, moves updatedAt forward', async () => {
    const a = await createProject();
    const u = await updateProject(a.id, { name: 'Sea', grid: { cols: 28, rows: 36, source: 'suggested' }, setupStep: 4, createdAt: 5 } as never);
    expect(u).toMatchObject({ id: a.id, name: 'Sea', createdAt: a.createdAt, grid: { cols: 28, rows: 36 }, setupStep: 4 });
    expect(u.updatedAt).toBeGreaterThan(a.updatedAt);
    await expect(updateProject('missing', { name: 'x' })).rejects.toThrow(/no longer/);
  });

  it('reads old (schema v1) rows that only have id, name and times', async () => {
    await db().projects.put({ id: 'old', name: 'Old', createdAt: 1, updatedAt: 2 } as never);
    const p = await getProject('old');
    expect(p).toEqual(normalizeProject({ id: 'old', name: 'Old', createdAt: 1, updatedAt: 2 }));
    expect(p).toMatchObject({ pieceCount: 0, grid: null, setupStep: 0 });
  });
});

describe('blobs and settings', () => {
  it('stores blobs with meta and changes the meta alone', async () => {
    const a = await createProject();
    const id = projectBlobId(a.id, 'box-photo');
    await putBlob(id, 'box-photo', jpeg(1), { corners: null });
    await setBlobMeta(id, { corners: [[0.1, 0.1]] });
    const row = await getBlobRow(id);
    expect(row?.meta).toEqual({ corners: [[0.1, 0.1]] });
    expect((await getBlob(id))?.size).toBe(5);
  });

  it('remembers the current puzzle and a print scale per puzzle', async () => {
    const a = await createProject();
    expect(await getCurrentProjectId()).toBeNull();
    await setCurrentProjectId(a.id);
    expect(await getCurrentProjectId()).toBe(a.id);
    await setPrintScale(a.id, 0.97);
    expect(await getPrintScale(a.id)).toBe(0.97);
    expect((await db().settings.get(`printScale:${a.id}`))?.value).toBe(0.97);
    await setPrintScale(a.id, null);
    expect(await getPrintScale(a.id)).toBeNull();
  });
});

describe('delete', () => {
  it('removes the puzzle with its pieces, snaps, blobs and settings, and nothing else', async () => {
    const a = await createProject();
    const b = await createProject();
    const d = db();
    const boxPhoto = projectBlobId(a.id, 'box-photo');
    const boxRect = projectBlobId(a.id, 'box-rectified');
    await putBlob(boxPhoto, 'box-photo', jpeg(1));
    await putBlob(boxRect, 'box-rectified', jpeg(2));
    await putBlob(projectBlobId(a.id, 'pending'), 'other', jpeg(3));
    await putBlob('snap-photo-a', 'snap', jpeg(4)); // referenced, without the prefix
    await putBlob('thumb-a', 'thumb', jpeg(5));
    await putBlob('unrelated', 'snap', jpeg(6));
    await putBlob(projectBlobId(b.id, 'box-photo'), 'box-photo', jpeg(7));
    await updateProject(a.id, {
      box: { photoBlobId: boxPhoto, rectifiedBlobId: boxRect, corners: [[0, 0], [1, 0], [1, 1], [0, 1]], photoWidth: 10, photoHeight: 10, width: 10, height: 10 },
    });
    await d.snaps.bulkPut([makeSnap('s1', a.id, 'snap-photo-a', ['pa']), makeSnap('s2', b.id, null)]);
    await d.pieces.bulkPut([makePiece('pa', a.id, 'thumb-a'), makePiece('pb', b.id, null)]);
    await setPrintScale(a.id, 1.01);
    await setPrintScale(b.id, 0.99);
    await setCurrentProjectId(a.id);

    expect((await projectBlobIds(a.id)).sort()).toEqual([boxPhoto, boxRect, projectBlobId(a.id, 'pending'), 'snap-photo-a', 'thumb-a'].sort());
    expect(await countPieces(a.id)).toBe(1);

    await deleteProject(a.id);

    expect(await getProject(a.id)).toBeUndefined();
    expect(await countPieces(a.id)).toBe(0);
    expect(await d.snaps.where('projectId').equals(a.id).count()).toBe(0);
    expect((await d.blobs.toCollection().primaryKeys()).sort()).toEqual([projectBlobId(b.id, 'box-photo'), 'unrelated'].sort());
    expect(await getPrintScale(a.id)).toBeNull();
    expect(await getCurrentProjectId()).toBeNull();
    // The other puzzle is untouched.
    expect(await getProject(b.id)).toBeDefined();
    expect(await countPieces(b.id)).toBe(1);
    expect(await getPrintScale(b.id)).toBe(0.99);
  });

  it('keeps the current-puzzle setting when another puzzle is deleted', async () => {
    const a = await createProject();
    const b = await createProject();
    await setCurrentProjectId(b.id);
    await deleteProject(a.id);
    expect(await getCurrentProjectId()).toBe(b.id);
  });
});

describe('tracking mode', () => {
  it('new puzzles default to no markers; puzzles that already use markers stay marker puzzles', async () => {
    const { normalizeProject } = await import('../../src/project/store');
    expect(normalizeProject({ id: 'a', setupStep: 1 }).tracking).toBe('pieces');
    expect(normalizeProject({ id: 'b', setupStep: 5 }).tracking).toBe('markers');
    expect(normalizeProject({ id: 'c', setupStep: 6, markerMap: { markers: [] } as never }).tracking).toBe('markers');
    expect(normalizeProject({ id: 'd', setupStep: 6, tracking: 'pieces' }).tracking).toBe('pieces');
  });
});

describe('scale source', () => {
  it('coin wins; marker puzzles are measured by markers; otherwise estimated', async () => {
    const { normalizeProject } = await import('../../src/project/store');
    expect(normalizeProject({ id: 'a', setupStep: 1 }).scaleSource).toBe('estimate');
    expect(normalizeProject({ id: 'b', setupStep: 4, tracking: 'markers' }).scaleSource).toBe('markers');
    expect(normalizeProject({ id: 'c', setupStep: 6, tracking: 'pieces', scaleSource: 'coin' }).scaleSource).toBe('coin');
    // A marker puzzle saved as "estimate" before its map existed is corrected.
    expect(normalizeProject({ id: 'd', setupStep: 6, tracking: 'markers', scaleSource: 'estimate' }).scaleSource).toBe('markers');
  });
});

describe('counting pieces', () => {
  it('counts by status from the indexes, as a count of every piece would (review 2026-11-10)', async () => {
    const a = await createProject();
    const b = await createProject();
    const statuses = ['table', 'table', 'pending', 'tray', 'tray', 'tray', 'placed', 'missing', 'aside', 'aside', undefined, 'odd'];
    await db().pieces.bulkPut([
      ...statuses.map((status, i) => ({ ...makePiece(`a${i}`, a.id, null), status }) as PieceRow),
      ...['table', 'placed'].map((status, i) => ({ ...makePiece(`b${i}`, b.id, null), status }) as PieceRow),
    ]);
    // What the page counted before, from every row: anything not missing, in a tray, in the puzzle or set aside is on the table.
    const rows = await db().pieces.where('projectId').equals(a.id).toArray();
    const n = (s: string) => rows.filter((p) => p.status === s).length;
    const old = {
      table: rows.length - n('missing') - n('tray') - n('placed') - n('aside'),
      missing: n('missing'),
      tray: n('tray'),
      placed: n('placed'),
      pending: n('pending'),
      aside: n('aside'),
      all: rows.length,
    };
    expect(await countPiecesByStatus(a.id)).toEqual(old);
    expect(old).toEqual({ table: 5, missing: 1, tray: 3, placed: 1, pending: 1, aside: 2, all: 12 });
    expect(await countPiecesByStatus(b.id)).toEqual({ table: 1, missing: 0, tray: 0, placed: 1, pending: 0, aside: 0, all: 2 });
    expect(await countPiecesByStatus('none')).toEqual({ table: 0, missing: 0, tray: 0, placed: 0, pending: 0, aside: 0, all: 0 });
  });
});
