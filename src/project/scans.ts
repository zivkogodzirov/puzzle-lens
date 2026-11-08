/**
 * Deleting and restoring a puzzle's scan (owner's request 2026-11-08: "delete the scanned pieces,
 * restore them, and scan again").
 *
 * The scan = every catalogued piece plus the overview and close-up photo records. "Delete" moves
 * them, with the measured piece size and where sizes came from, into a per-puzzle bin (one
 * settings row); their thumbnails and photos stay stored, so "Restore" brings everything back
 * exactly. Only one scan fits in the bin: deleting again replaces it (the older bin's pictures are
 * then freed). Restoring while a newer scan exists swaps the two (the newer one goes to the bin):
 * two scans can't be merged, because without markers each first photo defines its own table
 * frame. The set-up (box picture, grid, marker map, empty-table photo) is never touched.
 */
import { db } from '../db/db';
import { normalizeProject, referencedBlobIds, scanBinKey } from './store';
import type { PieceRow, Project, SnapRow } from './types';

export { scanBinKey };

/** What the bin holds for one puzzle. */
export interface ScanBin {
  /** When the scan was deleted (ms). */
  ts: number;
  pieces: PieceRow[];
  snaps: SnapRow[];
  project: Pick<Project, 'piecePitch' | 'scaleSource'>;
}

export interface ScanBinSummary {
  ts: number;
  pieces: number;
  photos: number;
}

const isScanSnap = (s: SnapRow): boolean => s.kind === 'overview' || s.kind === 'detail';

function readBin(value: unknown): ScanBin | null {
  const b = value as Partial<ScanBin> | null | undefined;
  if (!b || typeof b !== 'object' || !Array.isArray(b.pieces) || !Array.isArray(b.snaps) || typeof b.ts !== 'number') return null;
  return {
    ts: b.ts,
    pieces: b.pieces,
    snaps: b.snaps,
    project: { piecePitch: b.project?.piecePitch ?? null, scaleSource: b.project?.scaleSource ?? 'estimate' },
  };
}

/** The bin's size, or null when it is empty. */
export async function scanBinSummary(projectId: string): Promise<ScanBinSummary | null> {
  const bin = readBin((await db().settings.get(scanBinKey(projectId)))?.value);
  return bin ? { ts: bin.ts, pieces: bin.pieces.length, photos: bin.snaps.length } : null;
}

/** Where sizes come from when no scan has measured them. */
function freshScale(p: Project): Project['scaleSource'] {
  return p.tracking === 'markers' || p.markerMap ? 'markers' : 'estimate';
}

/**
 * Moves the current scan into the bin (replacing what was there) and returns how many pieces moved.
 * Nothing happens (0) when there is no scan.
 */
export async function deleteScan(projectId: string): Promise<number> {
  const d = db();
  let moved = 0;
  await d.transaction('rw', [d.projects, d.pieces, d.snaps, d.blobs, d.settings], async () => {
    const row = await d.projects.get(projectId);
    if (!row) throw new Error('This puzzle is not on this iPhone.');
    const project = normalizeProject(row);
    const pieces = await d.pieces.where('projectId').equals(projectId).toArray();
    const snaps = (await d.snaps.where('projectId').equals(projectId).toArray()).filter(isScanSnap);
    if (!pieces.length && !snaps.length) return;
    // The older bin's pictures are no longer needed by anything.
    const old = readBin((await d.settings.get(scanBinKey(projectId)))?.value);
    if (old) {
      const keep = new Set(referencedBlobIds(project, snaps, pieces));
      const free = referencedBlobIds({ ...project, box: null }, old.snaps, old.pieces).filter((id) => !keep.has(id));
      await d.blobs.bulkDelete(free);
    }
    const bin: ScanBin = { ts: Date.now(), pieces, snaps, project: { piecePitch: project.piecePitch, scaleSource: project.scaleSource } };
    await d.settings.put({ key: scanBinKey(projectId), value: bin });
    await d.pieces.bulkDelete(pieces.map((p) => p.id));
    await d.snaps.bulkDelete(snaps.map((s) => s.id));
    await d.projects.update(projectId, { piecePitch: null, scaleSource: freshScale(project), updatedAt: Date.now() });
    moved = pieces.length;
  });
  return moved;
}

/**
 * Brings the bin's scan back. A scan made since then goes into the bin in its place (a swap), so
 * nothing is lost. Returns the number of pieces restored, or 0 when the bin was empty.
 */
export async function restoreScan(projectId: string): Promise<number> {
  const d = db();
  let restored = 0;
  await d.transaction('rw', [d.projects, d.pieces, d.snaps, d.settings], async () => {
    const row = await d.projects.get(projectId);
    if (!row) throw new Error('This puzzle is not on this iPhone.');
    const project = normalizeProject(row);
    const bin = readBin((await d.settings.get(scanBinKey(projectId)))?.value);
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
    restored = bin.pieces.length;
  });
  return restored;
}

/** Blob ids the bin keeps alive (so deleting or pruning elsewhere can leave them alone). */
export async function scanBinBlobIds(projectId: string): Promise<string[]> {
  const bin = readBin((await db().settings.get(scanBinKey(projectId)))?.value);
  if (!bin) return [];
  const row = await db().projects.get(projectId);
  if (!row) return [];
  return referencedBlobIds({ ...normalizeProject(row), box: null }, bin.snaps, bin.pieces);
}
