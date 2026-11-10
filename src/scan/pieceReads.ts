/**
 * The Scan screen's reads of a puzzle's piece rows (M8 part 4, 2026-11-10). Each marker-free photo
 * read every piece row of the puzzle three times (about 20 ms each at 1000 pieces in Safari on the
 * Mac, more on the iPhone). Now a list read earlier is used again only while no piece row has been
 * written since, anywhere in the app: Dexie reports every finished write to the database (this
 * tab's at once, other tabs' through a broadcast), and those are counted here.
 */
import Dexie from 'dexie';
import { db } from '../db/db';
import type { MergePlan } from '../project/catalog';
import type { PieceRow } from '../project/types';

/** Finished write transactions that changed piece rows, since the app started. */
let piecesWrites = 0;
Dexie.on('storagemutated', (parts) => {
  for (const part of Object.keys(parts)) {
    if (/^idb:\/\/[^/]+\/pieces\//.test(part)) {
      piecesWrites++;
      return;
    }
  }
});

/** A puzzle's piece rows as read, and how many piece writes there had been before the read. */
export interface PieceList {
  projectId: string;
  rows: PieceRow[];
  writes: number;
  /** The database object read from ("Erase all data" replaces it). */
  from: object;
}

/** All piece rows of a puzzle, in the database's order (by id). */
export async function readPieceList(projectId: string): Promise<PieceList> {
  const d = db();
  // Counted before the read: a write that lands while reading makes the list count as old (safe side).
  const writes = piecesWrites;
  const rows = await d.pieces.where('projectId').equals(projectId).toArray();
  return { projectId, rows, writes, from: d };
}

/** True when no piece row has been written since `list` was read. */
export function stillCurrent(list: PieceList): boolean {
  return list.writes === piecesWrites && list.from === db();
}

/** `list` again when nothing was written since it was read; otherwise the rows read afresh. */
export async function currentPieceList(list: PieceList | null, projectId: string): Promise<PieceList> {
  return list && list.projectId === projectId && stillCurrent(list) ? list : readPieceList(projectId);
}

/**
 * The rows `plan` leaves behind when it is written over `list` (puts, then deletes), in the
 * database's order: what reading them back would give.
 */
export function rowsAfterMerge(rows: PieceRow[], plan: Pick<MergePlan, 'updates' | 'added' | 'removed'>): PieceRow[] {
  const byId = new Map(rows.map((p) => [p.id, p]));
  for (const p of plan.updates) byId.set(p.id, p);
  for (const p of plan.added) byId.set(p.id, p);
  for (const id of plan.removed) byId.delete(id);
  // IndexedDB orders the rows of one puzzle by id, comparing UTF-16 code units, as `<` does.
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The piece rows after `plan` was written in one transaction. Taken from the plan when that
 * transaction was the only piece write since `list` was read (and it wrote at least one row, so it
 * was counted); otherwise read back from the database.
 */
export async function piecesAfterMerge(list: PieceList, plan: Pick<MergePlan, 'updates' | 'added' | 'removed'>): Promise<PieceRow[]> {
  const wrote = plan.updates.length + plan.added.length > 0;
  if (wrote && piecesWrites === list.writes + 1 && list.from === db()) return rowsAfterMerge(list.rows, plan);
  return (await readPieceList(list.projectId)).rows;
}
