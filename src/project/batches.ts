/**
 * Batches (M7, PLAN §6 "multi-batch sessions"). A 1000-piece puzzle is worked 200–300 pieces at a
 * time. Pieces added next to the ones already on the table need nothing special: a rescan finds
 * them (M5 part 3). But once the pieces are swept together or put back in the box and a new lot is
 * spread out, no photo can be matched to the old table any more (marker-free photos are placed by
 * the pieces themselves). "Start a new batch" handles that:
 *
 * - Pieces in the puzzle and in trays stay where they are.
 * - The pieces on the table (and those to check, or already missing) are **set aside**: kept with
 *   everything known about them, but no longer expected on the table.
 * - The next photo starts a fresh table. A piece set aside that turns up again is recognised by its
 *   picture (fingerprint, src/project/catalog.ts), or offered as a "piece to check" when unsure.
 * - Earlier batches' photos are left out of the live view and the scan's coverage map (they show
 *   another table layout); they stay stored and in backups.
 */
import { db } from '../db/db';
import type { Project, SnapRow } from './types';

/** The batch on the table now (1 until a new batch is started). */
export function batchNumber(p: Pick<Project, 'batch'>): number {
  return p.batch?.n ?? 1;
}

/** Photos taken since the current batch started (the current table layout). */
export function snapsOfBatch<T extends Pick<SnapRow, 'ts'>>(p: Pick<Project, 'batch'>, snaps: T[]): T[] {
  const since = p.batch?.startedAt ?? 0;
  return snaps.filter((s) => s.ts >= since);
}

/** Starts a new batch: the pieces on the table are set aside (see the file comment). */
export async function startNewBatch(projectId: string, now = Date.now()): Promise<{ project: Project; aside: number }> {
  const d = db();
  return d.transaction('rw', d.projects, d.pieces, async () => {
    const project = await d.projects.get(projectId);
    if (!project) throw new Error('This puzzle is no longer on this iPhone.');
    let aside = 0;
    await d.pieces
      .where('projectId')
      .equals(projectId)
      .modify((p) => {
        if (p.status === 'table' || p.status === 'pending' || p.status === 'missing') {
          p.status = 'aside';
          p.updatedAt = now;
          aside++;
        }
      });
    const next: Project = { ...project, batch: { n: batchNumber(project) + 1, startedAt: now }, updatedAt: Math.max(now, project.updatedAt + 1) };
    await d.projects.put(next);
    return { project: next, aside };
  });
}
