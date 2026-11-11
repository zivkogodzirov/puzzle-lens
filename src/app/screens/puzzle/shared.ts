/**
 * Helpers of the puzzle screens (moved from screens/Puzzle.tsx in M9 part 4), used by its tabs and by other
 * screens (Home, the set-up wizard, Scan, the piece card…): set-up steps and words, a stored picture as an
 * object URL, a piece's shape group, and whether pieces can be scanned yet.
 *
 * Shared by every tab: a round-2 tab builder doesn't change these (add a helper to the tab's own file instead).
 */
import { useEffect, useState } from 'preact/hooks';
import { getBlob, LAST_SETUP_STEP } from '../../../project/store';
import type { PieceRow, Project } from '../../../project/types';
import { readShape, READ_OK, type PieceKind } from '../../../cv/shapeRead';
import { logWarn } from '../../../log/logger';
import { errorWords, UNREADABLE_PHOTO } from '../../words';

/** The wizard steps the owner sees with printed markers (index = Project.setupStep value that shows it). */
export const SETUP_STEPS: readonly string[] = [
  'Home Screen check',
  'Name and piece count',
  'Box picture',
  'Grid',
  'Print markers',
  'Lay out markers and photograph the table',
];
/** Without printing (the default, 2026-11-07), step 4 is the last one and there are no marker steps. */
const SETUP_STEPS_NO_PRINT: readonly string[] = ['Home Screen check', 'Name and piece count', 'Box picture', 'Grid', 'Ready to scan'];

/**
 * The set-up steps of the way the puzzle is set up (review 2026-11-10: without printing, the wizard
 * said "Step 4 of 5 · Print markers", and the puzzle page then ticked the two marker steps as done).
 * Until printed markers are chosen at step 4, a puzzle is set up without them.
 */
export function setupSteps(p: Pick<Project, 'tracking'>): readonly string[] {
  return p.tracking === 'markers' ? SETUP_STEPS : SETUP_STEPS_NO_PRINT;
}

// Errors in plain words (M9 part 1: shared by every screen, in src/app/words.ts).
export { errorWords, UNREADABLE_PHOTO };

/** An object URL for a stored blob (freed when the screen closes or the id changes). */
export function useBlobUrl(blobId: string | null | undefined, version: unknown = null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    setUrl(null);
    if (blobId) {
      getBlob(blobId)
        .then((b) => {
          if (!live || !b) return;
          made = URL.createObjectURL(b);
          setUrl(made);
        })
        .catch((err) => logWarn('puzzle', 'A saved picture could not be read', err));
    }
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [blobId, version]);
  return url;
}

/**
 * What changes when the box picture is straightened again (same blob id, new corners or size), so a
 * picture reloads then, and not on every other change of the puzzle (answers, trays).
 */
export function boxVersion(box: Project['box'] | null | undefined): string | null {
  return box ? `${box.rectifiedBlobId}|${box.width}x${box.height}|${box.corners.map((c) => c.join(',')).join(';')}|${box.fitted ?? 0}` : null;
}

/** "Set-up: step 3 of 4 (Grid)" (of 5 with printed markers) or "Set-up finished". */
export function setupStatus(p: Project): string {
  if (p.setupStep >= LAST_SETUP_STEP) return 'Set-up finished';
  const steps = setupSteps(p);
  const last = steps.length - 1;
  const step = Math.max(1, Math.min(last, p.setupStep));
  return `Set-up: step ${step} of ${last} (${steps[step]})`;
}

export type ShapeGroup = PieceKind | 'unsure';

/** A catalogued piece's group from its outline: corner, edge, interior, or not sure (touching, cut, or a read not trusted). */
export function pieceGroup(p: PieceRow, cell: [number, number] | null): ShapeGroup {
  if (p.flags.clump || p.flags.cut || p.flags.part) return 'unsure';
  const r = readShape(p.outlineMm, cell);
  return r && r.kind && r.quality >= READ_OK ? r.kind : 'unsure';
}

/** How many corner and edge pieces a cols × rows puzzle has. */
export function borderCounts(grid: { cols: number; rows: number }): { corners: number; edges: number } {
  return { corners: 4, edges: 2 * Math.max(0, grid.cols - 2) + 2 * Math.max(0, grid.rows - 2) };
}

/** Pieces can be scanned once set-up is finished (marker-free) or the markers are measured. */
export function canScan(p: Project): boolean {
  return p.tracking === 'markers' ? Boolean(p.markerMap) : p.setupStep >= LAST_SETUP_STEP;
}

/** A chance in whole percent, never shown as a certain 100 %. */
export const pct = (p: number): number => Math.min(99, Math.round(p * 100));
