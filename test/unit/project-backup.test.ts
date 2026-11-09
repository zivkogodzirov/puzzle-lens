/**
 * Project backup (src/project/backup.ts): export → import round trip, including photos, and the
 * checks that refuse damaged or foreign files.
 */
import 'fake-indexeddb/auto'; // must come first: Dexie picks up indexedDB when it loads
import { strToU8, unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, eraseAllData } from '../../src/db/db';
import { BACKUP_VERSION, BackupError, backupFileName, collectBackup, exportBackup, importBackup, readBackup } from '../../src/project/backup';
import { createProject, deleteProject, getPrintScale, getProject, listProjects, projectBlobId, putBlob, setPrintScale, updateProject } from '../../src/project/store';
import type { PieceRow, SnapRow } from '../../src/project/types';

beforeEach(async () => {
  await eraseAllData();
});

const bytes = (n: number, len = 50) => Uint8Array.from({ length: len }, (_, i) => (i * 31 + n) & 255);

function piece(id: string, projectId: string, thumbBlobId: string | null, snapId: string): PieceRow {
  return {
    id,
    projectId,
    createdAt: 1,
    updatedAt: 2,
    status: 'table',
    table: { x: 1, y: 2, angleDeg: 3, lastSeen: 4, snapId },
    outlineMm: [0, 0, 5, 0, 5, 5],
    areaMm2: 330,
    sizeMm: [18, 19],
    colour: { meanLab: [60, 1, 2], hueHist: [1, 0, 0, 0, 0, 0, 0, 0] },
    thumbBlobId,
    seen: 2,
    bestPxPerMm: 5,
    flags: { weak: true },
  };
}

async function makeFullProject() {
  const p = await createProject({ name: 'Lighthouse', pieceCount: 1000 });
  const photo = projectBlobId(p.id, 'box-photo');
  const rect = projectBlobId(p.id, 'box-rectified');
  await putBlob(photo, 'box-photo', new Blob([bytes(1, 5000)], { type: 'image/jpeg' }), { corners: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]] });
  await putBlob(rect, 'box-rectified', new Blob([bytes(2, 3000)], { type: 'image/jpeg' }));
  await putBlob('thumb-1', 'thumb', new Blob([bytes(3)], { type: 'image/jpeg' }));
  await putBlob('snap-1-photo', 'snap', new Blob([bytes(4)], { type: 'image/png' }));
  const snap: SnapRow = { id: 'snap-1', projectId: p.id, kind: 'overview', ts: 9, width: 4032, height: 3024, zoom: 1, imgToTable: [1, 0, 0, 0, 1, 0, 0, 0, 1], quality: null, blobId: 'snap-1-photo', pieceIds: ['piece-1'] };
  await db().snaps.put(snap);
  await db().pieces.put(piece('piece-1', p.id, 'thumb-1', 'snap-1'));
  await setPrintScale(p.id, 0.97);
  return updateProject(p.id, {
    grid: { cols: 28, rows: 36, source: 'suggested' },
    setupStep: 5,
    box: { photoBlobId: photo, rectifiedBlobId: rect, corners: [[10, 10], [90, 10], [90, 90], [10, 90]], photoWidth: 100, photoHeight: 100, width: 1460, height: 2048 },
  });
}

async function blobBytes(id: string): Promise<Uint8Array | null> {
  const row = await db().blobs.get(id);
  return row ? new Uint8Array(await row.blob.arrayBuffer()) : null;
}

describe('export', () => {
  it('makes one .pfbackup ZIP with backup.json and every photo, stored uncompressed', async () => {
    const p = await makeFullProject();
    const file = await exportBackup(p.id, { appVersion: 'test' });
    expect(file.name).toMatch(/^Lighthouse \d{4}-\d\d-\d\d\.pfbackup$/);
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(zip['backup.json']));
    expect(manifest).toMatchObject({ format: 'puzzle-lens-backup', version: BACKUP_VERSION, appVersion: 'test', settings: { printScale: 0.97 } });
    expect(manifest.project.id).toBe(p.id);
    expect(manifest.blobs).toHaveLength(4);
    for (const b of manifest.blobs) expect(zip[b.file]?.length).toBe(b.size);
    expect(manifest.blobs.find((b: { kind: string }) => b.kind === 'snap').file).toMatch(/\.png$/);
  });

  it('names files safely', () => {
    expect(backupFileName({ name: 'My/Puzzle: "Sea"' }, new Date(2026, 10, 6))).toBe('MyPuzzle Sea 2026-11-06.pfbackup');
    expect(backupFileName({ name: '///' }, new Date(2026, 0, 2))).toBe('Puzzle 2026-01-02.pfbackup');
  });

  it('refuses a puzzle that does not exist', async () => {
    await expect(collectBackup('nope')).rejects.toBeInstanceOf(BackupError);
  });
});

describe('import', () => {
  it('round trip: export, delete, import gives back the same puzzle, pieces, snaps, photos and print scale', async () => {
    const p = await makeFullProject();
    const before = { project: await getProject(p.id), pieces: await db().pieces.toArray(), snaps: await db().snaps.toArray() };
    const blobIds = (await db().blobs.toCollection().primaryKeys()).sort();
    const originals = await Promise.all(blobIds.map(blobBytes));
    const file = await exportBackup(p.id);
    await deleteProject(p.id);
    expect(await db().blobs.count()).toBe(0);

    const result = await importBackup(file);
    expect(result).toMatchObject({ copied: false, pieces: 1, snaps: 1, blobs: 4 });
    const after = await getProject(p.id);
    expect({ ...after, updatedAt: 0 }).toEqual({ ...before.project, updatedAt: 0 });
    expect(await db().pieces.toArray()).toEqual(before.pieces);
    expect(await db().snaps.toArray()).toEqual(before.snaps);
    expect((await db().blobs.toCollection().primaryKeys()).sort()).toEqual(blobIds);
    expect(await Promise.all(blobIds.map(blobBytes))).toEqual(originals);
    expect((await db().blobs.get(projectBlobId(p.id, 'box-photo')))?.meta).toEqual({ corners: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]] });
    expect((await db().blobs.get('snap-1-photo'))?.blob.type).toBe('image/png');
    expect(await getPrintScale(p.id)).toBe(0.97);
  });

  it('imports as a copy (new ids, links kept) when the puzzle is already here', async () => {
    const p0 = await makeFullProject();
    // A pair answer (M6) between the piece and one that's gone: it follows the piece's new id.
    const p = await updateProject(p0.id, { pairAnswers: [{ a: 'piece-1', b: 'gone', dir: 1, fits: true, at: 1, p: 0.9, confirmed: false, from: 'matches' }] });
    const file = await exportBackup(p.id);
    const result = await importBackup(file);
    expect(result.copied).toBe(true);
    const copy = result.project;
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toBe('Lighthouse (copy)');
    expect(await listProjects()).toHaveLength(2);
    expect(copy.box!.photoBlobId).toBe(projectBlobId(copy.id, 'box-photo'));
    expect(await blobBytes(copy.box!.photoBlobId)).toEqual(await blobBytes(p.box!.photoBlobId));
    const pieces = await db().pieces.where('projectId').equals(copy.id).toArray();
    const snaps = await db().snaps.where('projectId').equals(copy.id).toArray();
    expect(pieces).toHaveLength(1);
    expect(snaps).toHaveLength(1);
    expect(pieces[0]!.id).not.toBe('piece-1');
    expect(snaps[0]!.pieceIds).toEqual([pieces[0]!.id]);
    expect(pieces[0]!.table.snapId).toBe(snaps[0]!.id);
    expect(await blobBytes(pieces[0]!.thumbBlobId!)).toEqual(bytes(3));
    expect(await blobBytes(snaps[0]!.blobId!)).toEqual(bytes(4));
    expect(await getPrintScale(copy.id)).toBe(0.97);
    expect(copy.pairAnswers).toEqual([{ a: pieces[0]!.id, b: 'gone', dir: 1, fits: true, at: 1, p: 0.9, confirmed: false, from: 'matches' }]);
    // Deleting the copy leaves the original whole.
    await deleteProject(copy.id);
    expect(await blobBytes(p.box!.photoBlobId)).not.toBeNull();
    expect(await blobBytes('thumb-1')).toEqual(bytes(3));
  });

  it('refuses files that are not backups, damaged, or from a newer app, and writes nothing', async () => {
    const p = await makeFullProject();
    const good = unzipSync(new Uint8Array(await (await exportBackup(p.id)).arrayBuffer()));
    await deleteProject(p.id);
    const manifest = JSON.parse(new TextDecoder().decode(good['backup.json']));
    const withManifest = (m: unknown, extra: Record<string, Uint8Array> = {}) => {
      const files: Record<string, Uint8Array> = { ...good, ...extra, 'backup.json': strToU8(JSON.stringify(m)) };
      return zipSync(files);
    };
    const cases: Array<[string, Uint8Array, RegExp]> = [
      ['not a zip', strToU8('hello'), /isn't a Puzzle Lens backup/],
      ['zip without backup.json', zipSync({ 'a.txt': strToU8('x') }), /no backup\.json/],
      ['bad json', zipSync({ 'backup.json': strToU8('{') }), /damaged/],
      ['other format', withManifest({ ...manifest, format: 'other' }), /isn't a Puzzle Lens backup/],
      ['newer version', withManifest({ ...manifest, version: BACKUP_VERSION + 1 }), /newer version/],
      ['no version', withManifest({ ...manifest, version: undefined }), /version/],
      ['missing photo', zipSync(Object.fromEntries(Object.entries(good).filter(([k]) => k !== manifest.blobs[0].file))), /missing/],
      ['wrong size', withManifest({ ...manifest, blobs: [{ ...manifest.blobs[0], size: 1 }, ...manifest.blobs.slice(1)] }), /wrong size/],
      ['piece of another puzzle', withManifest({ ...manifest, pieces: [{ ...manifest.pieces[0], projectId: 'x' }] }), /piece/],
      ['no project', withManifest({ ...manifest, project: null }), /puzzle record/],
    ];
    for (const [name, data, message] of cases) {
      await expect(readBackup(data), name).rejects.toThrow(message);
      await expect(importBackup(data), name).rejects.toBeInstanceOf(BackupError);
    }
    expect(await db().projects.count()).toBe(0);
    expect(await db().blobs.count()).toBe(0);
  });
});
