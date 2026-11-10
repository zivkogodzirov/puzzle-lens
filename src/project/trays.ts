/**
 * Trays by colour (M4): pieces of one colour group go into one tray (a bowl, a box lid). A piece in a
 * tray has status 'tray' and the tray's letter; it is no longer expected on the table (scans don't
 * mark it missing) and is left out of the pieces shown and placed. The groups' colours are fixed
 * while any piece is in a tray, so letters never move under the owner's hands.
 */
import { db } from '../db/db';
import { GROUPS, type Lab } from '../cv/colourGroups';
import type { PieceRow, Project, TraySetup } from './types';

/** The number of groups a puzzle uses (stored, or the default), within 2–12. */
export function trayCountOf(p: Pick<Project, 'trays'>): number {
  const n = p.trays?.count;
  return Math.max(GROUPS.min, Math.min(GROUPS.max, Number.isFinite(n) ? Math.round(n!) : GROUPS.default));
}

/** The fixed group colours, when pieces are in trays (null: groups follow the pieces on the table). */
export function fixedColours(p: Pick<Project, 'trays'>, pieces: Pick<PieceRow, 'status'>[]): Lab[] | null {
  const c = p.trays?.colours;
  return c && c.length && pieces.some((q) => q.status === 'tray') ? (c as Lab[]) : null;
}

/**
 * Puts pieces into a tray: they leave the table. `colours`: the groups' colours now, kept fixed from
 * the first tray on (unless already fixed).
 */
export async function moveToTray(projectId: string, ids: string[], tray: string, colours: Lab[]): Promise<number> {
  const d = db();
  return d.transaction('rw', d.pieces, d.projects, async () => {
    const all = await d.pieces.where('projectId').equals(projectId).toArray();
    const project = await d.projects.get(projectId);
    if (!project) throw new Error('This puzzle is not on this iPhone.');
    const now = Date.now();
    const want = new Set(ids);
    const moving = all.filter((p) => want.has(p.id) && (p.status === 'table' || p.status === 'pending'));
    await d.pieces.bulkPut(moving.map((p) => ({ ...p, status: 'tray' as const, tray, updatedAt: now })));
    const fixed = fixedColours(project, all);
    if (!fixed && moving.length) {
      const trays: TraySetup = { count: trayCountOf(project), colours };
      await d.projects.put({ ...project, trays, updatedAt: Math.max(now, project.updatedAt + 1) });
    }
    return moving.length;
  });
}

/** Puts a tray's pieces back on the table. When no tray holds pieces any more, the groups follow the table again. */
export async function emptyTray(projectId: string, tray: string): Promise<number> {
  const d = db();
  return d.transaction('rw', d.pieces, d.projects, async () => {
    const all = await d.pieces.where('projectId').equals(projectId).toArray();
    const now = Date.now();
    const back = all.filter((p) => p.status === 'tray' && p.tray === tray);
    await d.pieces.bulkPut(back.map((p) => ({ ...p, status: 'table' as const, tray: null, updatedAt: now })));
    if (back.length === all.filter((p) => p.status === 'tray').length) {
      const project = await d.projects.get(projectId);
      if (project?.trays?.colours)
        await d.projects.put({ ...project, trays: { ...project.trays, colours: null }, updatedAt: Math.max(now, project.updatedAt + 1) });
    }
    return back.length;
  });
}

/** How many pieces each tray holds (by letter). */
export function trayCounts(pieces: Pick<PieceRow, 'status' | 'tray'>[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pieces) if (p.status === 'tray' && p.tray) m.set(p.tray, (m.get(p.tray) ?? 0) + 1);
  return new Map([...m].sort((a, b) => a[0].localeCompare(b[0])));
}
