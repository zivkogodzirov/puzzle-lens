/**
 * Fits / Doesn't fit (M5 part 2, PLAN §6 M5): the owner tries a piece in a suggested spot and says
 * whether it fits. Every answer is kept on the puzzle (Project.answers) with what the app said at
 * the time (its verdict, the spot's chance, whether it was the app's first choice), so the Accuracy
 * page can show how often the app is right.
 *
 * What answers change:
 * - **Fits:** the piece is in the puzzle now (status 'placed', at that spot). Its spot is taken: no
 *   other piece is suggested there. Its sides tell the spots next to it what they need (knob out
 *   against knob in).
 * - **Doesn't fit:** that spot is ruled out for that piece; its other spots move up, their chances
 *   divided by what is left (P(spot | not there) = p / (1 − p_there)).
 * Answers are for one grid (a new box picture with another grid ignores them).
 */
import { db } from '../db/db';
import { PLACE, type Placement, type PlacementSpot } from '../cv/placement';
import type { SpotChoice } from '../cv/openSpots';
import type { PieceRow, Project, SpotAnswer, Verdict } from './types';

/** Side reads at least this sure count for neighbours (a wrong "knob" would hide the right spot). */
export const NEIGHBOUR_MIN_CONF = 0.6;

const cellKey = (c: number, r: number) => `${c},${r}`;
const gridKey = (g: { cols: number; rows: number }) => `${g.cols}x${g.rows}`;

/** What the answers mean for the current grid. */
export interface AnswerView {
  /** Spots taken by pieces that fit there: "c,r" → piece id (and how it sits). */
  taken: Map<string, { id: string; col: number; row: number; rot: 0 | 1 | 2 | 3 }>;
  /** Per piece: spots it doesn't fit ("c,r"). */
  notHere: Map<string, Set<string>>;
}

export function answerView(project: Pick<Project, 'answers' | 'grid'>): AnswerView {
  const view: AnswerView = { taken: new Map(), notHere: new Map() };
  if (!project.grid) return view;
  const g = gridKey(project.grid);
  for (const a of project.answers ?? []) {
    if (a.grid !== g || a.undone) continue;
    const k = cellKey(a.col, a.row);
    if (a.fits) view.taken.set(k, { id: a.pieceId, col: a.col, row: a.row, rot: a.rot });
    else {
      const s = view.notHere.get(a.pieceId) ?? new Set<string>();
      s.add(k);
      view.notHere.set(a.pieceId, s);
    }
  }
  return view;
}

/** Side kind facing direction e (0 top, 1 right, 2 bottom, 3 left) for a piece turned q quarter turns clockwise. */
export const facingSide = (sides: string, q: number, e: number): string => sides[(e - q + 4) % 4] ?? 'u';
const DIRS: Array<[number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** A placed piece's sure side facing direction e, as 't' / 'b', or null. */
function sureSide(p: PieceRow | undefined, rot: number, e: number): 't' | 'b' | null {
  const s = p?.patch?.sides;
  if (!s) return null;
  const k = facingSide(s, rot, e);
  const conf = (p!.patch!.sideConf?.[(e - rot + 4) % 4] ?? 0) * (p!.patch!.sure ? 1 : 0.6);
  return (k === 't' || k === 'b') && conf >= NEIGHBOUR_MIN_CONF ? k : null;
}

/**
 * For the empty-spots pairing: the spots' sides with what placed neighbours need (a neighbour's
 * knob out → this spot's piece has a knob in there, and the other way round). Unchanged where
 * nothing is known.
 */
export function spotSidesWithNeighbours(
  cells: Array<[number, number]>,
  sides: string[] | null,
  view: AnswerView,
  placed: Map<string, PieceRow>,
): string[] | null {
  if (!view.taken.size) return sides;
  const out = cells.map((_, j) => sides?.[j] ?? '????');
  let changed = false;
  cells.forEach(([c, r], j) => {
    const s = out[j]!.split('');
    for (let e = 0; e < 4; e++) {
      const n = view.taken.get(cellKey(c + DIRS[e]![0], r + DIRS[e]![1]));
      if (!n) continue;
      const k = sureSide(placed.get(n.id), n.rot, (e + 2) % 4);
      if (!k) continue;
      s[e] = k === 't' ? 'b' : 't';
      changed = true;
    }
    out[j] = s.join('');
  });
  return changed || sides ? out : null;
}

/**
 * Whole-picture placements with the answers applied: spots taken by other pieces, spots this piece
 * doesn't fit, and spots next to a placed piece whose knob it can't take are ruled out; the rest
 * keep their order, with chances divided by what is left, and the verdict follows the new first spot.
 */
export function placementWithAnswers(piece: PieceRow, placement: Placement, view: AnswerView, placed: Map<string, PieceRow>): Placement {
  const not = view.notHere.get(piece.id);
  const keep: PlacementSpot[] = [];
  let removed = 0;
  for (const t of placement.top) {
    const k = cellKey(t.col, t.row);
    const takenBy = view.taken.get(k);
    let out = Boolean((takenBy && takenBy.id !== piece.id) || not?.has(k));
    if (!out && piece.patch?.sides && view.taken.size) {
      for (let e = 0; e < 4 && !out; e++) {
        const n = view.taken.get(cellKey(t.col + DIRS[e]![0], t.row + DIRS[e]![1]));
        if (!n || n.id === piece.id) continue;
        const theirs = sureSide(placed.get(n.id), n.rot, (e + 2) % 4);
        const mine = sureSide(piece, t.rot, e);
        // Two knobs out, or two knobs in, can't meet.
        if (theirs && mine && theirs === mine) out = true;
      }
    }
    if (out) removed += t.p;
    else keep.push(t);
  }
  if (!removed) return placement;
  const left = Math.max(1e-6, 1 - removed);
  const top = keep.map((t) => ({ ...t, p: Math.min(1, t.p / left) }));
  const p1 = top[0]?.p ?? 0;
  return { top, verdict: p1 >= PLACE.strongP ? 'strong' : p1 >= PLACE.likelyP ? 'likely' : 'several' };
}

/** Pieces in the puzzle with their spot, by id (for neighbours). */
export function placedPieces(pieces: PieceRow[]): Map<string, PieceRow> {
  return new Map(pieces.filter((p) => p.status === 'placed').map((p) => [p.id, p]));
}

/**
 * Saves an answer for `piece` at `spot`. `shown`: what the app showed for the piece then (for the
 * Accuracy page). Fits → the piece goes into the puzzle (status 'placed'). Returns the updated puzzle.
 */
export async function answerSpot(
  projectId: string,
  piece: PieceRow,
  spot: { col: number; row: number; rot: 0 | 1 | 2 | 3 },
  fits: boolean,
  shown: SpotChoice | null,
  from: SpotAnswer['from'],
): Promise<Project> {
  const d = db();
  return d.transaction('rw', d.projects, d.pieces, async () => {
    const project = await d.projects.get(projectId);
    if (!project?.grid) throw new Error('This puzzle is no longer on this iPhone.');
    const top = shown?.placement.top ?? [];
    const rank = top.findIndex((t) => t.col === spot.col && t.row === spot.row);
    const now = Date.now();
    const a: SpotAnswer = {
      pieceId: piece.id,
      col: spot.col,
      row: spot.row,
      rot: spot.rot,
      fits,
      at: now,
      grid: gridKey(project.grid),
      verdict: (shown?.placement.verdict ?? 'several') as Verdict,
      p: rank >= 0 ? top[rank]!.p : 0,
      rank,
      from,
      mode: project.openSpots ? 'open' : 'whole',
    };
    const next: Project = { ...project, answers: [...(project.answers ?? []), a], updatedAt: Math.max(now, project.updatedAt + 1) };
    await d.projects.put(next);
    if (fits) {
      const row = await d.pieces.get(piece.id);
      if (row && (row.status === 'table' || row.status === 'tray' || row.status === 'pending'))
        await d.pieces.put({
          ...row,
          status: 'placed',
          placedAt: { col: spot.col, row: spot.row, rot: spot.rot, at: now, from: row.status === 'tray' ? 'tray' : 'table', tray: row.tray ?? null },
          updatedAt: now,
        });
    }
    return next;
  });
}

/**
 * Takes a placed piece out again (a mistake): it goes back where it was (table or its tray) and the
 * "fits" answer is marked undone (left out of the Accuracy page).
 */
export async function undoFits(projectId: string, pieceId: string): Promise<Project> {
  const d = db();
  return d.transaction('rw', d.projects, d.pieces, async () => {
    const project = await d.projects.get(projectId);
    if (!project) throw new Error('This puzzle is no longer on this iPhone.');
    const answers = [...(project.answers ?? [])];
    for (let i = answers.length - 1; i >= 0; i--)
      if (answers[i]!.pieceId === pieceId && answers[i]!.fits && !answers[i]!.undone) {
        answers[i] = { ...answers[i]!, undone: true };
        break;
      }
    const now = Date.now();
    const next: Project = { ...project, answers, updatedAt: Math.max(now, project.updatedAt + 1) };
    await d.projects.put(next);
    const row = await d.pieces.get(pieceId);
    if (row?.status === 'placed') {
      const back = row.placedAt?.from === 'tray' && row.placedAt.tray ? 'tray' : 'table';
      await d.pieces.put({ ...row, status: back, tray: back === 'tray' ? row.placedAt!.tray : null, placedAt: null, updatedAt: now });
    }
    return next;
  });
}

/**
 * Removes something that isn't a puzzle piece (a label, a patch of table) from the catalog; its
 * answers are marked undone so they don't count on the Accuracy page.
 */
export async function removeNotAPiece(projectId: string, pieceId: string): Promise<Project> {
  const d = db();
  return d.transaction('rw', d.projects, d.pieces, async () => {
    const project = await d.projects.get(projectId);
    if (!project) throw new Error('This puzzle is no longer on this iPhone.');
    const answers = (project.answers ?? []).map((a) => (a.pieceId === pieceId && !a.undone ? { ...a, undone: true } : a));
    const next: Project = { ...project, answers, updatedAt: Math.max(Date.now(), project.updatedAt + 1) };
    await d.projects.put(next);
    await d.pieces.delete(pieceId);
    return next;
  });
}

/** Removes "doesn't fit" answers for a piece (e.g. it was answered by mistake). */
export async function clearNotHere(projectId: string, pieceId: string): Promise<Project> {
  const d = db();
  return d.transaction('rw', d.projects, async () => {
    const project = await d.projects.get(projectId);
    if (!project) throw new Error('This puzzle is no longer on this iPhone.');
    const answers = (project.answers ?? []).map((a) => (a.pieceId === pieceId && !a.fits && !a.undone ? { ...a, undone: true } : a));
    const next: Project = { ...project, answers, updatedAt: Math.max(Date.now(), project.updatedAt + 1) };
    await d.projects.put(next);
    return next;
  });
}

/** Wilson 95 % range for k right out of n (0–1). */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

export interface AccuracyRow {
  label: string;
  right: number;
  total: number;
  range: [number, number];
}

export interface Accuracy {
  /** Answers counted (undone ones left out). */
  answers: number;
  /** The app's first choice, by verdict, and all together. */
  first: { strong: AccuracyRow; likely: AccuracyRow; several: AccuracyRow; all: AccuracyRow };
  /** Shown chance vs how often it was right, for the first choice (bands of the chance). */
  calibration: Array<{ label: string; said: number; right: number; total: number }>;
  /** Pieces that went in, and how many tries they took on average. */
  placed: number;
  triesPerPiece: number | null;
}

const row = (label: string, xs: SpotAnswer[]): AccuracyRow => {
  const right = xs.filter((a) => a.fits).length;
  return { label, right, total: xs.length, range: wilson(right, xs.length) };
};

export function accuracyOf(answers: SpotAnswer[]): Accuracy {
  const real = answers.filter((a) => !a.undone);
  const first = real.filter((a) => a.rank === 0);
  const bands: Array<[string, number, number]> = [
    ['below 55 %', 0, 0.55],
    ['55–75 %', 0.55, 0.75],
    ['75–90 %', 0.75, 0.9],
    ['90 % and more', 0.9, 1.01],
  ];
  const fitsBy = new Map<string, number>();
  const triesBy = new Map<string, number>();
  for (const a of real) {
    triesBy.set(a.pieceId, (triesBy.get(a.pieceId) ?? 0) + 1);
    if (a.fits) fitsBy.set(a.pieceId, triesBy.get(a.pieceId)!);
  }
  const tries = [...fitsBy.values()];
  return {
    answers: real.length,
    first: {
      strong: row(
        'Strong',
        first.filter((a) => a.verdict === 'strong'),
      ),
      likely: row(
        'Likely',
        first.filter((a) => a.verdict === 'likely'),
      ),
      several: row(
        'Several spots look alike',
        first.filter((a) => a.verdict === 'several'),
      ),
      all: row('All', first),
    },
    calibration: bands
      .map(([label, lo, hi]) => {
        const xs = first.filter((a) => a.p >= lo && a.p < hi);
        return { label, said: xs.length ? xs.reduce((s, a) => s + a.p, 0) / xs.length : 0, right: xs.filter((a) => a.fits).length, total: xs.length };
      })
      .filter((b) => b.total > 0),
    placed: fitsBy.size,
    triesPerPiece: tries.length ? tries.reduce((s, t) => s + t, 0) / tries.length : null,
  };
}
