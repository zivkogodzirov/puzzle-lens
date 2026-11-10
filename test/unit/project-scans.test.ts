/**
 * Deleting, restoring and re-scanning a puzzle's scan (src/project/scans.ts) on an in-memory
 * IndexedDB.
 */
import 'fake-indexeddb/auto'; // must come first: Dexie picks up indexedDB when it loads
import { beforeEach, describe, expect, it } from 'vitest';
import { db, eraseAllData } from '../../src/db/db';
import { exportBackup, importBackup } from '../../src/project/backup';
import {
  countPieces,
  createProject,
  deleteProject,
  getBlob,
  getProject,
  normalizeProject,
  projectBlobId,
  projectBlobIds,
  putBlob,
  referencedBlobIds,
  updateProject,
} from '../../src/project/store';
import { deleteScan, restoreScan, scanBinCheckKey, scanBinKey, scanBinSummary, scanBinSummaryKey, type ScanBin } from '../../src/project/scans';
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
    expect(await db().settings.get(scanBinSummaryKey(p.id))).toBeUndefined();
    expect(await db().settings.get(scanBinCheckKey(p.id))).toBeUndefined();
    expect(await db().blobs.count()).toBe(0);
  });

  it("the bin's size is kept in a small row of its own, so showing it doesn't read every piece in the bin (review 2026-11-10)", async () => {
    const p = await scanned(3);
    await deleteScan(p.id);
    const bin = (await db().settings.get(scanBinKey(p.id)))!.value as { ts: number };
    expect((await db().settings.get(scanBinSummaryKey(p.id)))!.value).toEqual({ ts: bin.ts, pieces: 3, photos: 1 });
    // Read from that row alone: a bin row that is never read gives the same answer.
    await db().settings.put({ key: scanBinKey(p.id), value: { ...bin, pieces: 'not read' } });
    expect(await scanBinSummary(p.id)).toEqual({ ts: bin.ts, pieces: 3, photos: 1 });
    await db().settings.put({ key: scanBinKey(p.id), value: bin });
    // Kept up to date when the scans are swapped, replaced, and when the bin is emptied.
    await addScan(p.id, 5, 'new');
    await restoreScan(p.id);
    expect((await db().settings.get(scanBinSummaryKey(p.id)))!.value).toMatchObject({ pieces: 5, photos: 1 });
    await deleteScan(p.id);
    expect((await db().settings.get(scanBinSummaryKey(p.id)))!.value).toMatchObject({ pieces: 3, photos: 1 });
    expect(await restoreScan(p.id)).toBe(3);
    expect(await db().settings.get(scanBinSummaryKey(p.id))).toBeUndefined();
    expect(await scanBinSummary(p.id)).toBeNull();
  });

  it('a bin without its size row (deleted before 2026-11-10, or from a backup) is read once, and its size kept', async () => {
    const p = await scanned(4);
    await deleteScan(p.id);
    await db().settings.delete(scanBinSummaryKey(p.id));
    const bin = (await db().settings.get(scanBinKey(p.id)))!.value as { ts: number };
    expect(await scanBinSummary(p.id)).toEqual({ ts: bin.ts, pieces: 4, photos: 1 });
    expect((await db().settings.get(scanBinSummaryKey(p.id)))!.value).toEqual({ ts: bin.ts, pieces: 4, photos: 1 });
    // No bin: nothing is kept.
    const q = await scanned(1, 'q');
    expect(await scanBinSummary(q.id)).toBeNull();
    expect(await db().settings.get(scanBinSummaryKey(q.id))).toBeUndefined();
  });

  it("an old bin's size is still given when it can't be kept (the iPhone's storage full)", async () => {
    const p = await scanned(2);
    await deleteScan(p.id);
    await db().settings.delete(scanBinSummaryKey(p.id));
    const bin = (await db().settings.get(scanBinKey(p.id)))!.value as { ts: number };
    const table = db().settings;
    const put = table.put.bind(table);
    (table as unknown as { put: unknown }).put = (row: { key: string }, ...rest: unknown[]) => {
      if (row.key === scanBinSummaryKey(p.id)) {
        const e = new Error('The quota has been exceeded.');
        e.name = 'QuotaExceededError';
        return Promise.reject(e);
      }
      return put(row as never, ...(rest as []));
    };
    try {
      // Before: this threw, and the puzzle page didn't open.
      expect(await scanBinSummary(p.id)).toEqual({ ts: bin.ts, pieces: 2, photos: 1 });
    } finally {
      (table as unknown as { put: unknown }).put = put;
    }
    expect(await db().settings.get(scanBinSummaryKey(p.id))).toBeUndefined();
    // Kept the next time it can be.
    expect(await scanBinSummary(p.id)).toEqual({ ts: bin.ts, pieces: 2, photos: 1 });
    expect((await db().settings.get(scanBinSummaryKey(p.id)))!.value).toEqual({ ts: bin.ts, pieces: 2, photos: 1 });
  });

  it('a marker puzzle goes back to marker sizes', async () => {
    const p = await scanned(1);
    await updateProject(p.id, { tracking: 'markers', scaleSource: 'markers' });
    await deleteScan(p.id);
    expect((await getProject(p.id))!.scaleSource).toBe('markers');
  });
});

const isScanSnap = (s: SnapRow): boolean => s.kind === 'overview' || s.kind === 'detail';

/**
 * What the app from before 2026-11-10 (2334bf1) does to the bin, written out from its
 * src/project/scans.ts and store.ts: the same moves as now, but it knows nothing of the bin's size
 * row. It still runs on the owner's data if a deploy is rolled back, or in a tab left open across
 * an update (review 2026-11-10).
 */
const appBefore1110 = {
  async deleteScan(projectId: string): Promise<void> {
    const d = db();
    await d.transaction('rw', [d.projects, d.pieces, d.snaps, d.blobs, d.settings], async () => {
      const project = normalizeProject((await d.projects.get(projectId))!);
      const pieces = await d.pieces.where('projectId').equals(projectId).toArray();
      const snaps = (await d.snaps.where('projectId').equals(projectId).toArray()).filter(isScanSnap);
      if (!pieces.length && !snaps.length) return;
      const old = (await d.settings.get(scanBinKey(projectId)))?.value as ScanBin | undefined;
      if (old) {
        const keep = new Set(referencedBlobIds(project, snaps, pieces));
        await d.blobs.bulkDelete(referencedBlobIds({ ...project, box: null, openSpots: null }, old.snaps, old.pieces).filter((id) => !keep.has(id)));
      }
      const bin: ScanBin = { ts: Date.now(), pieces, snaps, project: { piecePitch: project.piecePitch, scaleSource: project.scaleSource } };
      await d.settings.put({ key: scanBinKey(projectId), value: bin });
      await d.pieces.bulkDelete(pieces.map((p) => p.id));
      await d.snaps.bulkDelete(snaps.map((s) => s.id));
      await d.projects.update(projectId, { piecePitch: null, scaleSource: 'estimate', updatedAt: Date.now() });
    });
  },
  async restoreScan(projectId: string): Promise<void> {
    const d = db();
    await d.transaction('rw', [d.projects, d.pieces, d.snaps, d.settings], async () => {
      const project = normalizeProject((await d.projects.get(projectId))!);
      const bin = (await d.settings.get(scanBinKey(projectId)))?.value as ScanBin | undefined;
      if (!bin) return;
      const pieces = await d.pieces.where('projectId').equals(projectId).toArray();
      const snaps = (await d.snaps.where('projectId').equals(projectId).toArray()).filter(isScanSnap);
      if (pieces.length || snaps.length) {
        const swapped: ScanBin = { ts: Date.now(), pieces, snaps, project: { piecePitch: project.piecePitch, scaleSource: project.scaleSource } };
        await d.settings.put({ key: scanBinKey(projectId), value: swapped });
        await d.pieces.bulkDelete(pieces.map((p) => p.id));
        await d.snaps.bulkDelete(snaps.map((s) => s.id));
      } else await d.settings.delete(scanBinKey(projectId));
      await d.pieces.bulkPut(bin.pieces);
      await d.snaps.bulkPut(bin.snaps);
      await d.projects.update(projectId, { piecePitch: bin.project.piecePitch, scaleSource: bin.project.scaleSource, updatedAt: Date.now() });
    });
  },
  async deleteProject(id: string): Promise<void> {
    const d = db();
    await d.transaction('rw', [d.projects, d.pieces, d.snaps, d.blobs, d.settings], async () => {
      const blobIds = await projectBlobIds(id);
      await d.pieces.where('projectId').equals(id).delete();
      await d.snaps.where('projectId').equals(id).delete();
      await d.blobs.bulkDelete(blobIds);
      await d.settings.delete(scanBinKey(id));
      await d.projects.delete(id);
    });
  },
};

/** The bin as stored now, read in full (what the puzzle page should show). */
async function binNow(projectId: string) {
  const bin = (await db().settings.get(scanBinKey(projectId)))?.value as ScanBin | undefined;
  return bin ? { ts: bin.ts, pieces: bin.pieces.length, photos: bin.snaps.length } : null;
}

/** Counts how often the whole bin row is read while `fn` runs. */
async function binReads(projectId: string, fn: () => Promise<unknown>): Promise<number> {
  const table = db().settings;
  const get = table.get.bind(table);
  let n = 0;
  (table as unknown as { get: unknown }).get = (key: unknown, ...rest: unknown[]) => {
    if (key === scanBinKey(projectId)) n++;
    return get(key as never, ...(rest as []));
  };
  try {
    await fn();
  } finally {
    (table as unknown as { get: unknown }).get = get;
  }
  return n;
}

describe("the bin's size row after the app from before 2026-11-10 changed the bin (a deploy rolled back, then forward again; review 2026-11-10)", () => {
  it('the old app restored the bin (emptying it): no bin card is shown any more, and its size row goes', async () => {
    const p = await scanned(4);
    await deleteScan(p.id);
    await appBefore1110.restoreScan(p.id);
    // Before: the size row was trusted, so the puzzle page showed a bin that wasn't there.
    expect(await scanBinSummary(p.id)).toBeNull();
    expect(await db().settings.get(scanBinSummaryKey(p.id))).toBeUndefined();
    expect(await countPieces(p.id)).toBe(4);
  });

  it('"Restore" on a bin the old app already emptied restores nothing, and the bin card goes for good', async () => {
    const p = await scanned(4);
    await deleteScan(p.id);
    await appBefore1110.restoreScan(p.id);
    expect(await restoreScan(p.id)).toBe(0);
    // Before: restoreScan stopped before the size row, so the card and its dead "Restore" button stayed.
    expect(await db().settings.get(scanBinSummaryKey(p.id))).toBeUndefined();
    expect(await scanBinSummary(p.id)).toBeNull();
    expect(await countPieces(p.id)).toBe(4);
  });

  it('the old app swapped the scans: the size shown is the scan now in the bin', async () => {
    const p = await scanned(4, 'one');
    await deleteScan(p.id);
    await addScan(p.id, 2, 'two');
    await appBefore1110.restoreScan(p.id);
    expect(await binNow(p.id)).toMatchObject({ pieces: 2, photos: 1 });
    expect(await scanBinSummary(p.id)).toEqual(await binNow(p.id));
    // Read once to put the row right; after that it's trusted again.
    expect(await binReads(p.id, () => scanBinSummary(p.id))).toBe(0);
    expect(await restoreScan(p.id)).toBe(2);
    expect((await db().pieces.where('projectId').equals(p.id).primaryKeys()).sort()).toEqual(['two0', 'two1']);
    expect(await scanBinSummary(p.id)).toMatchObject({ pieces: 4, photos: 1 });
  });

  it('the old app deleted a newer scan (replacing the bin): the size shown is the new bin', async () => {
    const p = await scanned(4, 'one');
    await deleteScan(p.id);
    await addScan(p.id, 2, 'two');
    await appBefore1110.deleteScan(p.id);
    expect(await binNow(p.id)).toMatchObject({ pieces: 2, photos: 1 });
    expect(await scanBinSummary(p.id)).toEqual(await binNow(p.id));
    expect(await binReads(p.id, () => scanBinSummary(p.id))).toBe(0);
    expect(await restoreScan(p.id)).toBe(2);
    expect(await scanBinSummary(p.id)).toBeNull();
  });

  it('the old app restored, then deleted the scan again: the bin is shown as it is now', async () => {
    // The reviewer's sequence (out/rev-data rollback.json), with this app in between.
    const p = await scanned(4);
    await deleteScan(p.id);
    await appBefore1110.restoreScan(p.id);
    expect(await scanBinSummary(p.id)).toBeNull();
    expect(await restoreScan(p.id)).toBe(0);
    expect(await countPieces(p.id)).toBe(4);
    await appBefore1110.deleteScan(p.id);
    expect(await scanBinSummary(p.id)).toEqual(await binNow(p.id));
    expect(await restoreScan(p.id)).toBe(4);
  });

  it('the old app deleted the puzzle and the same puzzle came back from a backup: no bin is shown', async () => {
    const p = await scanned(3);
    const file = await exportBackup(p.id, { appVersion: 'test' });
    await deleteScan(p.id);
    await appBefore1110.deleteProject(p.id);
    const imported = await importBackup(file);
    expect(imported.project.id).toBe(p.id);
    expect(await scanBinSummary(p.id)).toBeNull();
    expect(await db().settings.get(scanBinSummaryKey(p.id))).toBeUndefined();
  });

  it("in normal use the bin's size is shown without reading the bin (a new scan, pieces removed, photos thinned, puzzle changed)", async () => {
    const p = await scanned(4, 'one');
    await deleteScan(p.id);
    const shown = await scanBinSummary(p.id);
    expect(shown).toEqual(await binNow(p.id));
    expect(await binReads(p.id, () => scanBinSummary(p.id))).toBe(0);
    await addScan(p.id, 3, 'two');
    await db().pieces.delete('two1');
    await db().blobs.delete(projectBlobId(p.id, 'scan-two'));
    await db().snaps.update('snap-two', { blobId: null });
    await updateProject(p.id, { piecePitch: { wMm: 18, hMm: 19, n: 2 } });
    expect(await binReads(p.id, async () => expect(await scanBinSummary(p.id)).toEqual(shown))).toBe(0);
    // Swapping and replacing keep it in step too.
    await restoreScan(p.id);
    const swapped = await binNow(p.id);
    expect(swapped).toMatchObject({ pieces: 2, photos: 1 });
    expect(await binReads(p.id, async () => expect(await scanBinSummary(p.id)).toEqual(swapped))).toBe(0);
    await deleteScan(p.id);
    const replaced = await binNow(p.id);
    expect(replaced).toMatchObject({ pieces: 4, photos: 1 });
    expect(await binReads(p.id, async () => expect(await scanBinSummary(p.id)).toEqual(replaced))).toBe(0);
  });

  it('a size row kept before its check row existed (the first 2026-11-10 build) is checked against the bin once', async () => {
    const p = await scanned(2);
    await deleteScan(p.id);
    await db().settings.delete(scanBinCheckKey(p.id));
    expect(await binReads(p.id, () => scanBinSummary(p.id))).toBe(1);
    expect(await binReads(p.id, () => scanBinSummary(p.id))).toBe(0);
    expect(await scanBinSummary(p.id)).toEqual(await binNow(p.id));
  });
});
