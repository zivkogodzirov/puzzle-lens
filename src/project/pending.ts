/**
 * Pieces to check (M5 part 3): a rescan that sees a piece which may be one moved since, but can't
 * tell which, keeps it as 'pending' with the pieces it may be (PieceRow.maybe). Later scans settle
 * most of them (src/project/catalog.ts); the owner settles the rest: "same piece" merges it into
 * the known piece (which takes this newest sighting), "a different piece" keeps it as a new one.
 */
import { db } from '../db/db';
import type { PieceRow } from './types';

export async function resolvePending(projectId: string, pendingId: string, intoId: string | null): Promise<void> {
  const d = db();
  await d.transaction('rw', d.pieces, d.projects, async () => {
    const p = await d.pieces.get(pendingId);
    if (!p || p.projectId !== projectId || p.status !== 'pending') return;
    const now = Date.now();
    const into = intoId ? await d.pieces.get(intoId) : undefined;
    if (!into || (into.status !== 'table' && into.status !== 'missing' && into.status !== 'pending')) {
      await d.pieces.put({ ...p, status: 'table', maybe: null, updatedAt: now });
      return;
    }
    const merged: PieceRow = {
      ...into,
      updatedAt: now,
      status: 'table',
      maybe: null,
      table: { ...p.table },
      outlineMm: p.outlineMm,
      areaMm2: p.areaMm2,
      sizeMm: p.sizeMm,
      colour: p.colour,
      flags: p.flags,
      bestPxPerMm: Math.max(p.bestPxPerMm, into.bestPxPerMm),
      thumbBlobId: p.thumbBlobId ?? into.thumbBlobId,
      patch: p.patch ?? into.patch,
      seen: into.seen + p.seen,
    };
    await d.pieces.put(merged);
    await d.pieces.delete(pendingId);
    // Answers given for the pending piece now belong to the known one.
    const project = await d.projects.get(projectId);
    if (project?.answers?.some((a) => a.pieceId === pendingId))
      await d.projects.put({ ...project, answers: project.answers.map((a) => (a.pieceId === pendingId ? { ...a, pieceId: into.id } : a)), updatedAt: now });
  });
}
