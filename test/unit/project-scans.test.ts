/**
 * Deleting, restoring and re-scanning a puzzle's scan (src/project/scans.ts) on an in-memory
 * IndexedDB.
 */
import 'fake-indexeddb/auto'; // must come first: Dexie picks up indexedDB when it loads
import { beforeEach, describe, expect, it } from 'vitest';
import { db, eraseAllData } from '../../src/db/db';
import { countPieces, createProject, deleteProject, getBlob, getProject, projectBlobId, putBlob, updateProject } from '../../src/project/store';
import { deleteScan, restoreScan, scanBinKey, scanBinSummary } from '../../src/project/scans';
import type { PieceRow, SnapRow } from '../../src/project/types';

beforeEach(async () => {
  await eraseAllData();
});

const jpeg = (n: number) => new Blob([new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9])], { type: 'image/jpeg' });

function piece(id: string, projectId: string, thumb: string | null): PieceRow {
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
    thumbBlobId: thumb,
    seen: 1,
    bestPxPerMm: 5,
    flags: {},
  };
}

function snap(id: string, projectId: string, kind: SnapRow['kind'], blobId: string | null): SnapRow {
  return { id, projectId, kind, ts: 1, width: 4032, height: 3024, zoom: 1, imgToTable: null, quality: null, blobId, pieceIds: [] };
}

/** A finished puzzle with a scan of `n` pieces (thumbnails, an overview photo, a coin-measured size) and a box picture. */
async function scanned(n: number, tag = 'a') {
  const p = await createProject({ name: 'The Kiss', pieceCount: 1000, setupStep: 6 });
  const boxId = await putBlob(projectBlobId(p.id, 'box-photo'), 'box', jpeg(1));
  const rectId = await putBlob(projectBlobId(p.id, 'box-rect'), 'box', jpeg(2));
  await updateProject(p.id, {
    box: { photoBlobId: boxId, rectifiedBlobId: rectId, corners: [], widthPx: 1, heightPx: 1 } as never,
    piecePitch: { wMm: 17.8, hMm: 19.4, n },
    scaleSource: 'coin',
    tracking: 'pieces',
  });
  await addScan(p.id, n, tag);
  return p;
}

async function addScan(projectId: string, n: number, tag: string) {
  for (let i = 0; i < n; i++) {
    const t = await putBlob(projectBlobId(projectId, `thumb-${tag}${i}`), 'thumb', jpeg(10 + i));
    await db().pieces.put(piece(`${tag}${i}`, projectId, t));
  }
  const full = await putBlob(projectBlobId(projectId, `scan-${tag}`), 'snap', jpeg(99));
  await db().snaps.put(snap(`snap-${tag}`, projectId, 'overview', full));
}

describe('scan bin', () => {
  it('delete moves pieces and scan photos to the bin, keeps the set-up, and resets the measured size', async () => {
    const p = await scanned(3);
    await db().snaps.put(snap('mm', p.id, 'marker-map', null));
    expect(await deleteScan(p.id)).toBe(3);
    expect(await countPieces(p.id)).toBe(0);
    const snaps = await db().snaps.where('projectId').equals(p.id).toArray();
    expect(snaps.map((s) => s.kind)).toEqual(['marker-map']);
    const after = (await getProject(p.id))!;
    expect(after.piecePitch).toBeNull();
    expect(after.scaleSource).toBe('estimate');
    expect(after.box).not.toBeNull();
    expect(await scanBinSummary(p.id)).toMatchObject({ pieces: 3, photos: 1 });
    // Thumbnails and photos stay stored for a restore.
    expect(await getBlob(projectBlobId(p.id, 'thumb-a0'))).toBeTruthy();
    expect(await getBlob(projectBlobId(p.id, 'scan-a'))).toBeTruthy();
  });

  it('restore brings back exactly what was deleted (pieces, photos, size and where it came from) and empties the bin', async () => {
    const p = await scanned(4);
    const before = await db().pieces.where('projectId').equals(p.id).sortBy('id');
    await deleteScan(p.id);
    expect(await restoreScan(p.id)).toBe(4);
    expect(await db().pieces.where('projectId').equals(p.id).sortBy('id')).toEqual(before);
    expect((await db().snaps.where('projectId').equals(p.id).toArray()).map((s) => s.id)).toEqual(['snap-a']);
    const after = (await getProject(p.id))!;
    expect(after.piecePitch).toEqual({ wMm: 17.8, hMm: 19.4, n: 4 });
    expect(after.scaleSource).toBe('coin');
    expect(await scanBinSummary(p.id)).toBeNull();
  });

  it('restoring after a new scan swaps the two, so nothing is lost', async () => {
    const p = await scanned(3, 'old');
    await deleteScan(p.id);
    await addScan(p.id, 5, 'new');
    await updateProject(p.id, { piecePitch: { wMm: 18, hMm: 19, n: 5 }, scaleSource: 'estimate' });
    expect(await restoreScan(p.id)).toBe(3);
    expect((await db().pieces.where('projectId').equals(p.id).primaryKeys()).sort()).toEqual(['old0', 'old1', 'old2']);
    expect((await getProject(p.id))!.scaleSource).toBe('coin');
    expect(await scanBinSummary(p.id)).toMatchObject({ pieces: 5, photos: 1 });
    // …and swapping back works too.
    expect(await restoreScan(p.id)).toBe(5);
    expect(await countPieces(p.id)).toBe(5);
    expect(await scanBinSummary(p.id)).toMatchObject({ pieces: 3 });
  });

  it("deleting again replaces the bin and frees only the older scan's pictures", async () => {
    const p = await scanned(2, 'one');
    await deleteScan(p.id);
    await addScan(p.id, 2, 'two');
    await deleteScan(p.id);
    expect(await scanBinSummary(p.id)).toMatchObject({ pieces: 2 });
    expect(await getBlob(projectBlobId(p.id, 'thumb-one0'))).toBeUndefined();
    expect(await getBlob(projectBlobId(p.id, 'scan-one'))).toBeUndefined();
    expect(await getBlob(projectBlobId(p.id, 'thumb-two0'))).toBeTruthy();
    expect(await getBlob(projectBlobId(p.id, 'box-photo'))).toBeTruthy();
    expect(await restoreScan(p.id)).toBe(2);
    expect((await db().pieces.where('projectId').equals(p.id).primaryKeys()).sort()).toEqual(['two0', 'two1']);
  });

  it('nothing to delete or restore: no change', async () => {
    const p = await scanned(0);
    await db().snaps.clear();
    expect(await deleteScan(p.id)).toBe(0);
    expect(await scanBinSummary(p.id)).toBeNull();
    expect(await restoreScan(p.id)).toBe(0);
    expect((await getProject(p.id))!.scaleSource).toBe('coin');
  });

  it('deleting the puzzle also deletes its bin and the pictures in it', async () => {
    const p = await scanned(2);
    await deleteScan(p.id);
    await deleteProject(p.id);
    expect(await db().settings.get(scanBinKey(p.id))).toBeUndefined();
    expect(await db().blobs.count()).toBe(0);
  });

  it('a marker puzzle goes back to marker sizes', async () => {
    const p = await scanned(1);
    await updateProject(p.id, { tracking: 'markers', scaleSource: 'markers' });
    await deleteScan(p.id);
    expect((await getProject(p.id))!.scaleSource).toBe('markers');
  });
});
