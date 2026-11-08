/**
 * Puzzle projects in the database (src/db/db.ts, schema v2): create, read, list, change and delete,
 * plus the blobs (photos) that belong to a project and two per-project settings.
 *
 * Blob ids made here start with `p:<projectId>:` so a project's files can always be found again
 * (blobs rows have no project field). Deleting a project removes those blobs, every blob a
 * project, snap or piece record points to, its pieces and snaps, and its settings.
 */
import { db, type BlobRow } from '../db/db';
import type { PieceRow, Project, SnapRow } from './types';

/** Setting holding the id of the puzzle last opened (or null). */
export const CURRENT_PROJECT_KEY = 'currentProjectId';
/** Per-project setting key for the printer scale from the ruler check (step 4). */
export const printScaleKey = (projectId: string): string => `printScale:${projectId}`;

export const LAST_SETUP_STEP = 6;

/** Settings key of a puzzle's scan bin (deleted scan, restorable; src/project/scans.ts). */
export const scanBinKey = (projectId: string): string => `scanBin:${projectId}`;

export type ProjectPatch = Partial<Omit<Project, 'id' | 'createdAt'>>;

export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The blob id prefix for a project's own files. */
export function blobPrefix(projectId: string): string {
  return `p:${projectId}:`;
}

/** A blob id for a project's file, e.g. projectBlobId(id, 'box-photo'). */
export function projectBlobId(projectId: string, name: string): string {
  return `${blobPrefix(projectId)}${name}`;
}

/** Fills fields missing from older rows (schema v1 rows only had id, name and times). */
export function normalizeProject(row: Partial<Project> & { id: string }): Project {
  const now = Date.now();
  return {
    id: row.id,
    name: typeof row.name === 'string' && row.name.trim() ? row.name : 'Puzzle',
    createdAt: row.createdAt ?? now,
    updatedAt: row.updatedAt ?? row.createdAt ?? now,
    pieceCount: typeof row.pieceCount === 'number' && Number.isFinite(row.pieceCount) ? row.pieceCount : 0,
    grid: row.grid ?? null,
    box: row.box ?? null,
    markerMap: row.markerMap ?? null,
    tableModel: row.tableModel ?? null,
    piecePitch: row.piecePitch ?? null,
    setupStep: typeof row.setupStep === 'number' ? row.setupStep : 0,
    // Puzzles saved before marker-free mode existed and already using markers (a marker map, or past
    // the printing step) stay marker puzzles.
    tracking: row.tracking === 'markers' || row.tracking === 'pieces' ? row.tracking : row.markerMap || (row.setupStep ?? 0) >= 5 ? 'markers' : 'pieces',
    coin: typeof row.coin === 'string' ? row.coin : null,
    // A coin measurement wins; marker puzzles are measured by their markers; otherwise estimated.
    scaleSource: row.scaleSource === 'coin' ? 'coin' : row.tracking === 'markers' || row.markerMap ? 'markers' : 'estimate',
  };
}

/** "Puzzle 1", "Puzzle 2", … : the first number not used yet. */
export async function nextProjectName(): Promise<string> {
  const names = new Set((await db().projects.toArray()).map((p) => p.name));
  for (let i = 1; ; i++) if (!names.has(`Puzzle ${i}`)) return `Puzzle ${i}`;
}

export async function createProject(init: { name?: string; pieceCount?: number; setupStep?: number } = {}): Promise<Project> {
  const now = Date.now();
  const project = normalizeProject({
    id: newId(),
    name: init.name?.trim() || (await nextProjectName()),
    createdAt: now,
    updatedAt: now,
    pieceCount: init.pieceCount ?? 0,
    setupStep: init.setupStep ?? 1,
  });
  await db().projects.add(project);
  return project;
}

export async function getProject(id: string): Promise<Project | undefined> {
  const row = await db().projects.get(id);
  return row ? normalizeProject(row) : undefined;
}

/** All puzzles, the most recently changed first. */
export async function listProjects(): Promise<Project[]> {
  const rows = await db().projects.orderBy('updatedAt').reverse().toArray();
  return rows.map((r) => normalizeProject(r));
}

/** Changes some fields; `updatedAt` is set automatically. Throws if the puzzle doesn't exist. */
export async function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  const d = db();
  return d.transaction('rw', d.projects, async () => {
    const row = await d.projects.get(id);
    if (!row) throw new Error('This puzzle is no longer on this iPhone.');
    const next = normalizeProject({
      ...normalizeProject(row),
      ...patch,
      id,
      createdAt: row.createdAt,
      updatedAt: Math.max(Date.now(), (row.updatedAt ?? 0) + 1),
    });
    await d.projects.put(next);
    return next;
  });
}

/** Every blob id a project's records point to (box photo, rectified box, snap photos, thumbnails). */
export function referencedBlobIds(project: Project, snaps: SnapRow[], pieces: PieceRow[]): string[] {
  const ids = new Set<string>();
  if (project.box) {
    ids.add(project.box.photoBlobId);
    ids.add(project.box.rectifiedBlobId);
  }
  for (const s of snaps) if (s.blobId) ids.add(s.blobId);
  for (const p of pieces) if (p.thumbBlobId) ids.add(p.thumbBlobId);
  ids.delete('');
  return [...ids];
}

/** Ids of all blobs belonging to a project: the referenced ones plus those with its prefix. */
export async function projectBlobIds(projectId: string): Promise<string[]> {
  const d = db();
  const row = await d.projects.get(projectId);
  const ids = new Set<string>(await d.blobs.where('id').startsWith(blobPrefix(projectId)).primaryKeys());
  if (row) {
    const snaps = await d.snaps.where('projectId').equals(projectId).toArray();
    const pieces = await d.pieces.where('projectId').equals(projectId).toArray();
    for (const id of referencedBlobIds(normalizeProject(row), snaps, pieces)) ids.add(id);
  }
  return [...ids];
}

/** Deletes a puzzle with its pieces, snaps, blobs and settings (one transaction). */
export async function deleteProject(id: string): Promise<void> {
  const d = db();
  await d.transaction('rw', [d.projects, d.pieces, d.snaps, d.blobs, d.settings], async () => {
    const blobIds = await projectBlobIds(id);
    await d.pieces.where('projectId').equals(id).delete();
    await d.snaps.where('projectId').equals(id).delete();
    await d.blobs.bulkDelete(blobIds);
    await d.settings.delete(printScaleKey(id));
    await d.settings.delete(scanBinKey(id));
    const current = await d.settings.get(CURRENT_PROJECT_KEY);
    if (current?.value === id) await d.settings.delete(CURRENT_PROJECT_KEY);
    await d.projects.delete(id);
  });
}

// ---------- blobs ----------

export async function putBlob(id: string, kind: string, blob: Blob, meta?: unknown): Promise<string> {
  const row: BlobRow = { id, ts: Date.now(), kind, blob };
  if (meta !== undefined) row.meta = meta;
  await db().blobs.put(row);
  return id;
}

export async function getBlobRow(id: string): Promise<BlobRow | undefined> {
  return db().blobs.get(id);
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return (await db().blobs.get(id))?.blob;
}

/**
 * Changes only a blob's meta, keeping the file. CAUTION: don't use this on rows holding real photo
 * data in the app. In WebKit (Playwright, iOS engine), rewriting a stored row with its Blob made the
 * photo unreadable after a reload ("NotFoundError" / "WebKitBlobResource error 1"). Keep changing
 * values in their own row instead (as the wizard does for the box corners).
 */
export async function setBlobMeta(id: string, meta: unknown): Promise<void> {
  await db().blobs.update(id, { meta });
}

export async function deleteBlob(id: string): Promise<void> {
  await db().blobs.delete(id);
}

/** Pieces catalogued for a puzzle: on the table now, and no longer seen at their spot (missing). */
export async function countPiecesByStatus(projectId: string): Promise<{ table: number; missing: number; all: number }> {
  const rows = await db().pieces.where('projectId').equals(projectId).toArray();
  const missing = rows.filter((p) => p.status === 'missing').length;
  return { table: rows.length - missing, missing, all: rows.length };
}

/** Number of pieces catalogued for a puzzle. */
export async function countPieces(projectId: string): Promise<number> {
  return db().pieces.where('projectId').equals(projectId).count();
}

// ---------- settings ----------

export async function getCurrentProjectId(): Promise<string | null> {
  const row = await db().settings.get(CURRENT_PROJECT_KEY);
  return typeof row?.value === 'string' ? row.value : null;
}

export async function setCurrentProjectId(id: string | null): Promise<void> {
  if (id === null) await db().settings.delete(CURRENT_PROJECT_KEY);
  else await db().settings.put({ key: CURRENT_PROJECT_KEY, value: id });
}

/**
 * Printer scale from the ruler check: measured bar length / 100 mm (1 = printed at 100 %).
 * Kept as a setting until the marker map step stores it in project.markerMap.printScale.
 */
export async function getPrintScale(projectId: string): Promise<number | null> {
  const row = await db().settings.get(printScaleKey(projectId));
  return typeof row?.value === 'number' && Number.isFinite(row.value) ? row.value : null;
}

export async function setPrintScale(projectId: string, scale: number | null): Promise<void> {
  if (scale === null) await db().settings.delete(printScaleKey(projectId));
  else await db().settings.put({ key: printScaleKey(projectId), value: scale });
}
