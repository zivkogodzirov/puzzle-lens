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
import { normalizeProject, referencedBlobIds, scanBinCheckKey, scanBinKey, scanBinSummaryKey } from './store';
import type { PieceRow, Project, SnapRow } from './types';

export { scanBinCheckKey, scanBinKey, scanBinSummaryKey };

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

const summaryOf = (bin: ScanBin): ScanBinSummary => ({ ts: bin.ts, pieces: bin.pieces.length, photos: bin.snaps.length });

function readSummary(value: unknown): ScanBinSummary | null {
  const s = value as Partial<ScanBinSummary> | null | undefined;
  return s && typeof s === 'object' && typeof s.ts === 'number' && typeof s.pieces === 'number' && typeof s.photos === 'number'
    ? { ts: s.ts, pieces: s.pieces, photos: s.photos }
    : null;
}

/**
 * A few ids of the bin, kept next to its size row, that show by key alone (without reading the bin)
 * that the bin is still the one the size was taken from. Only the app from before 2026-11-10 changes
 * the bin without its size row (a deploy rolled back and then forward again, or a tab left open
 * across an update; review 2026-11-10), and each of its changes shows in the tables: emptying the
 * bin (a restore) or deleting the puzzle removes the bin row, a swap puts the bin's pieces back, and
 * deleting a scan again frees the older bin's pictures. (Restoring and then deleting again in the
 * old app doesn't show; the size is then put right by the next restore or delete.)
 */
interface BinCheck {
  /** The bin's `ts` when the check was made (it belongs to the size row with the same `ts`). */
  ts: number;
  /** A piece of the bin, or with none a photo record: in neither table while the bin holds it. */
  piece: string | null;
  snap: string | null;
  /** A picture of the bin: stored while the bin holds it. */
  blob: string | null;
}

function readCheck(value: unknown): BinCheck | null {
  const c = value as Partial<BinCheck> | null | undefined;
  const id = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return c && typeof c === 'object' && typeof c.ts === 'number' ? { ts: c.ts, piece: id(c.piece), snap: id(c.snap), blob: id(c.blob) } : null;
}

/** Whether the tables still look as they do while the checked bin is in the bin (key-only reads). */
async function checkHolds(c: BinCheck): Promise<boolean> {
  const d = db();
  const [piece, snap, blob] = await Promise.all([
    c.piece ? d.pieces.where(':id').equals(c.piece).count() : 0,
    c.snap ? d.snaps.where(':id').equals(c.snap).count() : 0,
    c.blob ? d.blobs.where(':id').equals(c.blob).count() : 1,
  ]);
  return piece === 0 && snap === 0 && blob > 0;
}

/** The check for `bin`, from the tables as they are now (call it after the bin's records have moved). */
async function checkOf(bin: ScanBin): Promise<BinCheck> {
  const d = db();
  const piece = bin.pieces[0]?.id ?? null;
  const snap = piece ? null : (bin.snaps[0]?.id ?? null);
  const blob = bin.pieces.find((p) => p.thumbBlobId)?.thumbBlobId ?? bin.snaps.find((s) => s.blobId)?.blobId ?? null;
  // An id that doesn't already look right (a picture that was never stored) is left out, so the
  // bin isn't read again every time.
  const [inPieces, inSnaps, stored] = await Promise.all([
    piece ? d.pieces.where(':id').equals(piece).count() : 0,
    snap ? d.snaps.where(':id').equals(snap).count() : 0,
    blob ? d.blobs.where(':id').equals(blob).count() : 0,
  ]);
  return { ts: bin.ts, piece: inPieces ? null : piece, snap: inSnaps ? null : snap, blob: stored ? blob : null };
}

/** Keeps the bin's size row and its check (inside a transaction on settings, pieces, snaps and blobs). */
async function keepSize(projectId: string, bin: ScanBin): Promise<void> {
  const d = db();
  await d.settings.put({ key: scanBinSummaryKey(projectId), value: summaryOf(bin) });
  await d.settings.put({ key: scanBinCheckKey(projectId), value: await checkOf(bin) });
}

async function forgetSize(projectId: string): Promise<void> {
  const d = db();
  await d.settings.delete(scanBinSummaryKey(projectId));
  await d.settings.delete(scanBinCheckKey(projectId));
}

/**
 * The bin's size, or null when it is empty. Read from the small row kept next to the bin (review
 * 2026-11-10: the puzzle page read the whole bin, every piece of the deleted scan, on opening and
 * after every ✓ Fits), after checking by key that the row still fits the bin (BinCheck). A bin
 * without one (deleted before then, brought back by a backup, or changed by the older app) is read
 * once and its size kept; a size row left without its bin is dropped.
 */
export async function scanBinSummary(projectId: string): Promise<ScanBinSummary | null> {
  const d = db();
  // undefined: the bin has to be read (or a row left without its bin tidied up).
  const quick = await d.transaction('r', [d.settings, d.pieces, d.snaps, d.blobs], async (): Promise<ScanBinSummary | null | undefined> => {
    const [[s, c], bins] = await Promise.all([
      d.settings.bulkGet([scanBinSummaryKey(projectId), scanBinCheckKey(projectId)]),
      d.settings.where(':id').equals(scanBinKey(projectId)).count(),
    ]);
    if (!bins) return s || c ? undefined : null;
    const kept = readSummary(s?.value);
    const check = readCheck(c?.value);
    return kept && check && check.ts === kept.ts && (await checkHolds(check)) ? kept : undefined;
  });
  if (quick !== undefined) return quick;
  try {
    return await d.transaction('rw', [d.settings, d.pieces, d.snaps, d.blobs], async () => {
      const bin = readBin((await d.settings.get(scanBinKey(projectId)))?.value);
      if (!bin) {
        await forgetSize(projectId);
        return null;
      }
      await keepSize(projectId, bin);
      return summaryOf(bin);
    });
  } catch {
    // Keeping the size is only a shortcut (check 2026-11-10): when it can't be saved (the iPhone's
    // storage is full) the size is still given, as before, so the puzzle page still opens.
    const bin = readBin((await d.settings.get(scanBinKey(projectId)))?.value);
    return bin ? summaryOf(bin) : null;
  }
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
      const free = referencedBlobIds({ ...project, box: null, openSpots: null }, old.snaps, old.pieces).filter((id) => !keep.has(id));
      await d.blobs.bulkDelete(free);
    }
    const bin: ScanBin = { ts: Date.now(), pieces, snaps, project: { piecePitch: project.piecePitch, scaleSource: project.scaleSource } };
    await d.settings.put({ key: scanBinKey(projectId), value: bin });
    await d.pieces.bulkDelete(pieces.map((p) => p.id));
    await d.snaps.bulkDelete(snaps.map((s) => s.id));
    await d.projects.update(projectId, { piecePitch: null, scaleSource: freshScale(project), updatedAt: Date.now() });
    await keepSize(projectId, bin);
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
  await d.transaction('rw', [d.projects, d.pieces, d.snaps, d.blobs, d.settings], async () => {
    const row = await d.projects.get(projectId);
    if (!row) throw new Error('This puzzle is not on this iPhone.');
    const project = normalizeProject(row);
    const bin = readBin((await d.settings.get(scanBinKey(projectId)))?.value);
    if (!bin) {
      // Nothing to restore. A size row left without its bin (the older app emptied it; review
      // 2026-11-10) goes too, so the bin card and its "Restore" don't stay for good.
      await forgetSize(projectId);
      return;
    }
    const pieces = await d.pieces.where('projectId').equals(projectId).toArray();
    const snaps = (await d.snaps.where('projectId').equals(projectId).toArray()).filter(isScanSnap);
    let swapped: ScanBin | null = null;
    if (pieces.length || snaps.length) {
      swapped = { ts: Date.now(), pieces, snaps, project: { piecePitch: project.piecePitch, scaleSource: project.scaleSource } };
      await d.settings.put({ key: scanBinKey(projectId), value: swapped });
      await d.pieces.bulkDelete(pieces.map((p) => p.id));
      await d.snaps.bulkDelete(snaps.map((s) => s.id));
    } else {
      await d.settings.delete(scanBinKey(projectId));
      await forgetSize(projectId);
    }
    await d.pieces.bulkPut(bin.pieces);
    await d.snaps.bulkPut(bin.snaps);
    await d.projects.update(projectId, { piecePitch: bin.project.piecePitch, scaleSource: bin.project.scaleSource, updatedAt: Date.now() });
    if (swapped) await keepSize(projectId, swapped);
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
  return referencedBlobIds({ ...normalizeProject(row), box: null, openSpots: null }, bin.snaps, bin.pieces);
}
