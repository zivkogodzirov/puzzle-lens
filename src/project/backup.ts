/**
 * Project backup (PLAN §4, RESEARCH §14): one `.pfbackup` file = a ZIP holding
 *
 *   backup.json        format, version, the project, its pieces and snaps, the list of blobs, and
 *                      (version 2, M7 part 3) the per-puzzle settings: print scale, the pieces'
 *                      spots on the box picture (placement cache) and the scan bin
 *   blobs/0001.jpg …   the photos, thumbnails and straightened pieces, stored as they are
 *
 * Export collects everything from the database; the ZIP itself is made by a function passed in
 * (the app uses the report worker, so the screen stays responsive; tests zip in place).
 * Import checks the file thoroughly before writing anything, then writes it in one transaction.
 * If the same puzzle is already on this iPhone, it is imported as a copy with new ids, so nothing
 * is ever overwritten.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { buildZip } from '../report/zip';
import type { ReportFileInput } from '../shared/apis';
import { db, type BlobRow } from '../db/db';
import type { PieceRow, Project, SnapRow } from './types';
import { getPrintScale, newId, normalizeProject, placementKey, printScaleKey, projectBlobId, projectBlobIds, scanBinKey } from './store';
import type { PlacementCache } from './placements';
import type { ScanBin } from './scans';

export const BACKUP_FORMAT = 'puzzle-lens-backup';
/** 2 (M7 part 3): settings also carry the placement cache and the scan bin. Version 1 files still import. */
export const BACKUP_VERSION = 2;
export const BACKUP_EXTENSION = '.pfbackup';
export const MANIFEST_NAME = 'backup.json';

export interface BackupBlobEntry {
  id: string;
  kind: string;
  ts: number;
  type: string;
  size: number;
  meta?: unknown;
  /** Path of the file inside the ZIP. */
  file: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  appVersion: string;
  exportedAt: number;
  project: Project;
  pieces: PieceRow[];
  snaps: SnapRow[];
  blobs: BackupBlobEntry[];
  settings: {
    printScale: number | null;
    /** The pieces' spots on the box picture, so they needn't be worked out again (version 2). */
    placements?: PlacementCache | null;
    /** An earlier scan in the bin (version 2). */
    scanBin?: ScanBin | null;
  };
}

/** A problem with a backup file, in words for the screen. */
export class BackupError extends Error {
  override name = 'BackupError';
}

export type ZipFn = (files: ReportFileInput[]) => Promise<Blob>;

/** Zips on the calling thread (tests, or when the worker can't start). */
export const zipHere: ZipFn = async (files) => {
  const entries = [];
  for (const f of files) {
    if (f.text !== undefined) entries.push({ name: f.name, data: f.text, stored: f.stored });
    else if (f.blob) entries.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()), stored: f.stored ?? true });
  }
  return new Blob([buildZip(entries) as BlobPart], { type: 'application/zip' });
};

const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/json': '.json' };

/** A safe file name for the backup, e.g. "Puzzle 1 2026-11-06.pfbackup". */
export function backupFileName(project: Pick<Project, 'name'>, when = new Date()): string {
  const safe =
    project.name
      .replace(/[^\p{L}\p{N} _-]+/gu, '')
      .trim()
      .slice(0, 40) || 'Puzzle';
  const d = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
  return `${safe} ${d}${BACKUP_EXTENSION}`;
}

/** Reads a project and everything that belongs to it, ready to zip. */
export async function collectBackup(projectId: string, appVersion = 'dev'): Promise<{ manifest: BackupManifest; files: ReportFileInput[] }> {
  const d = db();
  const row = await d.projects.get(projectId);
  if (!row) throw new BackupError('This puzzle is no longer on this iPhone.');
  const project = normalizeProject(row);
  const pieces = await d.pieces.where('projectId').equals(projectId).toArray();
  const snaps = await d.snaps.where('projectId').equals(projectId).toArray();
  const blobIds = (await projectBlobIds(projectId)).sort();
  const blobRows = (await d.blobs.bulkGet(blobIds)).filter((b): b is BlobRow => !!b);
  const files: ReportFileInput[] = [];
  const blobs: BackupBlobEntry[] = blobRows.map((b, i) => {
    const type = b.blob.type || 'application/octet-stream';
    const file = `blobs/${String(i + 1).padStart(4, '0')}${EXT[type] ?? '.bin'}`;
    files.push({ name: file, blob: b.blob, stored: type.startsWith('image/') });
    const entry: BackupBlobEntry = { id: b.id, kind: b.kind, ts: b.ts, type, size: b.blob.size, file };
    if (b.meta !== undefined) entry.meta = b.meta;
    return entry;
  });
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion,
    exportedAt: Date.now(),
    project,
    pieces,
    snaps,
    blobs,
    settings: {
      printScale: await getPrintScale(projectId),
      placements: ((await d.settings.get(placementKey(projectId)))?.value as PlacementCache | undefined) ?? null,
      scanBin: ((await d.settings.get(scanBinKey(projectId)))?.value as ScanBin | undefined) ?? null,
    },
  };
  files.unshift({ name: MANIFEST_NAME, text: JSON.stringify(manifest), stored: false });
  return { manifest, files };
}

/** Makes the backup file for a project. */
export async function exportBackup(projectId: string, opts: { zip?: ZipFn; appVersion?: string } = {}): Promise<File> {
  const { manifest, files } = await collectBackup(projectId, opts.appVersion);
  const zipped = await (opts.zip ?? zipHere)(files);
  return new File([zipped], backupFileName(manifest.project), { type: 'application/zip' });
}

// ---------- reading and checking ----------

export interface ParsedBackup {
  manifest: BackupManifest;
  /** File contents by ZIP path. */
  files: Record<string, Uint8Array>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function fail(detail: string): never {
  throw new BackupError(`This backup file is damaged or incomplete (${detail}).`);
}

/** Unzips and checks a backup file. Throws BackupError with a plain-English message. */
export async function readBackup(data: Blob | Uint8Array): Promise<ParsedBackup> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new BackupError("This file isn't a Puzzle Lens backup (it can't be opened as one). Please choose a file ending in .pfbackup.");
  }
  const raw = files[MANIFEST_NAME];
  if (!raw) throw new BackupError("This file isn't a Puzzle Lens backup (it has no backup.json inside).");
  let m: unknown;
  try {
    m = JSON.parse(strFromU8(raw));
  } catch {
    fail('backup.json cannot be read');
  }
  if (!isObj(m) || m.format !== BACKUP_FORMAT) throw new BackupError("This file isn't a Puzzle Lens backup.");
  if (typeof m.version !== 'number' || !Number.isInteger(m.version) || m.version < 1) fail('no version number');
  if (m.version > BACKUP_VERSION) {
    throw new BackupError('This backup was made by a newer version of Puzzle Lens. Please update the app (close it and open it again), then import it.');
  }
  const p = m.project;
  if (!isObj(p) || !isStr(p.id) || typeof p.name !== 'string') fail('the puzzle record is missing');
  if (!Array.isArray(m.pieces) || !Array.isArray(m.snaps) || !Array.isArray(m.blobs)) fail('lists are missing');
  for (const piece of m.pieces as unknown[]) {
    if (!isObj(piece) || !isStr(piece.id) || piece.projectId !== p.id) fail('a piece record is wrong');
  }
  for (const snap of m.snaps as unknown[]) {
    if (!isObj(snap) || !isStr(snap.id) || snap.projectId !== p.id) fail('a photo record is wrong');
  }
  const seen = new Set<string>();
  for (const b of m.blobs as unknown[]) {
    if (!isObj(b) || !isStr(b.id) || !isStr(b.file) || !isStr(b.kind)) fail('a file entry is wrong');
    if (seen.has(b.id as string)) fail('a file is listed twice');
    seen.add(b.id as string);
    const content = files[b.file as string];
    if (!content) fail(`${b.file as string} is missing`);
    if (typeof b.size === 'number' && b.size !== content.length) fail(`${b.file as string} has the wrong size`);
  }
  const manifest = m as unknown as BackupManifest;
  manifest.project = normalizeProject(manifest.project);
  manifest.settings = isObj(m.settings) ? (m.settings as BackupManifest['settings']) : { printScale: null };
  // Version 2 extras: left out (worked out again / no bin) when they don't look right.
  const st = manifest.settings;
  if (st.placements && !(isObj(st.placements) && isObj(st.placements.byPiece) && typeof st.placements.boxKey === 'string')) st.placements = null;
  if (st.scanBin && !(isObj(st.scanBin) && Array.isArray(st.scanBin.pieces) && Array.isArray(st.scanBin.snaps) && typeof st.scanBin.ts === 'number'))
    st.scanBin = null;
  return { manifest, files };
}

// ---------- importing ----------

export interface ImportResult {
  project: Project;
  /** True if it was imported as a copy because the puzzle was already on this iPhone. */
  copied: boolean;
  pieces: number;
  snaps: number;
  blobs: number;
}

/** Gives every record a new id (for "import as a copy"), keeping all links between them. */
function remapIds(m: BackupManifest): BackupManifest {
  const newPid = newId();
  const bin = m.settings?.scanBin ?? null;
  const snapIds = new Map([...m.snaps, ...(bin?.snaps ?? [])].map((s) => [s.id, newId()]));
  const pieceIds = new Map([...m.pieces, ...(bin?.pieces ?? [])].map((p) => [p.id, newId()]));
  const oldPrefix = `p:${m.project.id}:`;
  const blobIds = new Map(
    m.blobs.map((b) => [b.id, b.id.startsWith(oldPrefix) ? projectBlobId(newPid, b.id.slice(oldPrefix.length)) : projectBlobId(newPid, `imported-${newId()}`)]),
  );
  const blob = (id: string | null | undefined) => (id ? (blobIds.get(id) ?? id) : (id ?? null));
  const snapId = (id: string) => snapIds.get(id) ?? id;
  const project: Project = {
    ...m.project,
    id: newPid,
    name: `${m.project.name} (copy)`,
    box: m.project.box ? { ...m.project.box, photoBlobId: blob(m.project.box.photoBlobId)!, rectifiedBlobId: blob(m.project.box.rectifiedBlobId)! } : null,
    markerMap: m.project.markerMap ? { ...m.project.markerMap, snapId: snapId(m.project.markerMap.snapId) } : null,
    tableModel: m.project.tableModel ? { ...m.project.tableModel, snapId: snapId(m.project.tableModel.snapId) } : null,
    openSpots: m.project.openSpots ? { ...m.project.openSpots, thumbBlobId: blob(m.project.openSpots.thumbBlobId)! } : null,
    // Fits / Doesn't fit answers follow their pieces' new ids.
    answers: (m.project.answers ?? []).map((a) => ({ ...a, pieceId: pieceIds.get(a.pieceId) ?? a.pieceId })),
    pairAnswers: (m.project.pairAnswers ?? []).map((a) => ({ ...a, a: pieceIds.get(a.a) ?? a.a, b: pieceIds.get(a.b) ?? a.b })),
  };
  const snap = (s: SnapRow): SnapRow => ({
    ...s,
    id: snapId(s.id),
    projectId: newPid,
    blobId: blob(s.blobId),
    pieceIds: s.pieceIds.map((id) => pieceIds.get(id) ?? id),
  });
  const piece = (p: PieceRow): PieceRow => ({
    ...p,
    id: pieceIds.get(p.id)!,
    projectId: newPid,
    thumbBlobId: blob(p.thumbBlobId),
    patch: p.patch ? { ...p.patch, blobId: blob(p.patch.blobId)! } : p.patch,
    table: p.table ? { ...p.table, snapId: snapId(p.table.snapId) } : p.table,
    maybe: p.maybe ? p.maybe.map((id) => pieceIds.get(id) ?? id) : p.maybe,
  });
  const placements = m.settings?.placements;
  return {
    ...m,
    project,
    snaps: m.snaps.map(snap),
    pieces: m.pieces.map(piece),
    blobs: m.blobs.map((b) => ({ ...b, id: blobIds.get(b.id)! })),
    settings: {
      ...m.settings,
      // The placements are keyed by the box picture (its blob id): the copy's key, its pieces' ids.
      placements: placements
        ? {
            ...placements,
            boxKey: placements.boxKey.split(m.project.box?.rectifiedBlobId ?? '\u0000').join(project.box?.rectifiedBlobId ?? ''),
            byPiece: Object.fromEntries(Object.entries(placements.byPiece).map(([id, v]) => [pieceIds.get(id) ?? id, v])),
          }
        : null,
      scanBin: bin ? { ...bin, pieces: bin.pieces.map(piece), snaps: bin.snaps.map(snap) } : null,
    },
  };
}

/** Checks and restores a backup. Throws BackupError (in words) if the file is not usable. */
export async function importBackup(data: Blob | Uint8Array): Promise<ImportResult> {
  const parsed = await readBackup(data);
  const d = db();
  const exists = !!(await d.projects.get(parsed.manifest.project.id));
  const m = exists ? remapIds(parsed.manifest) : parsed.manifest;
  const blobRows: BlobRow[] = m.blobs.map((b) => {
    const content = parsed.files[b.file]!;
    const row: BlobRow = { id: b.id, ts: b.ts ?? Date.now(), kind: b.kind, blob: new Blob([content as BlobPart], { type: b.type || '' }) };
    if (b.meta !== undefined) row.meta = b.meta;
    return row;
  });
  const project = { ...m.project, updatedAt: Date.now() };
  await d.transaction('rw', [d.projects, d.pieces, d.snaps, d.blobs, d.settings], async () => {
    await d.blobs.bulkPut(blobRows);
    await d.pieces.bulkPut(m.pieces);
    await d.snaps.bulkPut(m.snaps);
    if (typeof m.settings?.printScale === 'number') await d.settings.put({ key: printScaleKey(project.id), value: m.settings.printScale });
    if (m.settings?.placements?.byPiece) await d.settings.put({ key: placementKey(project.id), value: m.settings.placements });
    if (m.settings?.scanBin?.pieces) await d.settings.put({ key: scanBinKey(project.id), value: m.settings.scanBin });
    await d.projects.put(project);
  });
  return { project, copied: exists, pieces: m.pieces.length, snaps: m.snaps.length, blobs: blobRows.length };
}
