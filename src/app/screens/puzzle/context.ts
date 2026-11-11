/**
 * The contract between the puzzle screen's shell (PuzzleScreen.tsx) and its four tabs (M9 part 4).
 *
 * A tab reads everything through `usePuzzle()`: the puzzle and its pieces, what the app worked out about them
 * (spots on the box picture, joins), and the shared actions (open a piece's card, answer, open the live view,
 * scan). It keeps its own screen state (filters, open panels) in its own `useState`: that state starts afresh
 * when the tab is opened again (only the open tab is drawn).
 *
 * Nothing here is drawn by a tab: the piece card, the live views ("Live view" and "Point it out") and the
 * Undo toasts belong to the shell, so they work from every tab.
 */
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { PieceRow, Project } from '../../../project/types';
import type { SpotChoice } from '../../../cv/openSpots';
import type { PlacementCache } from '../../../project/placements';
import type { ScanBinSummary } from '../../../project/scans';
import type { BackupReminder } from '../../../project/backupReminder';
import type { answerView, placedPieces } from '../../../project/answers';
import type { pairAnswerView } from '../../../project/pairAnswers';
import type { pairModel } from '../../../project/pairs';
import type { matchList } from '../../components/Matches';
import type { MatchLine } from '../../components/LiveTable';
import type { FrameSide, PieceState } from '../../../project/progress';
import type { ShapeGroup } from './shared';

/** The puzzle's tabs, in the tab bar's order. The address is `#/puzzle/<id>/<tab>`; `#/puzzle/<id>` is the Table tab. */
export const TABS = ['table', 'picture', 'pieces', 'more'] as const;
export type PuzzleTab = (typeof TABS)[number];
export const DEFAULT_TAB: PuzzleTab = 'table';

/** The tab in an address's last part (`routeSub`); the default tab for none or an unknown one. */
export function tabOf(sub: string | null | undefined): PuzzleTab {
  return (TABS as readonly string[]).includes(sub ?? '') ? (sub as PuzzleTab) : DEFAULT_TAB;
}

/** Where a piece's card was opened from: the live view's card has no "Point it out"; Fill a spot opens it on the spot. */
export type CardFrom = 'grid' | 'live' | 'photo' | 'fill';
export type Spot = { col: number; row: number; rot: 0 | 1 | 2 | 3 };

/** How many pieces of the puzzle have each status (null: not read yet). */
/** Options of pointOut() for one spot's candidates (M9 part 4, review 2026-11-11). */
export interface PointOutOpts {
  title: string;
  legend: string;
  /** The best piece (green); the others are amber. */
  best?: string;
  /** Each piece's spot here, so It fits / Not there can be answered in the live view. */
  spotOf?: (id: string) => Spot | null;
  /** When the live view closes (e.g. reopen the spot's sheet). */
  onClose?: () => void;
}

export interface PieceCounts {
  all: number | null;
  table: number;
  tray: number;
  missing: number;
  pending: number;
  placed: number;
  aside: number;
}

export interface PuzzleCtx {
  // ---- The puzzle ----
  project: Project;
  /** Saves nothing: shows a puzzle record the caller already stored (e.g. from updateProject). */
  setProject: (p: Project) => void;
  /** The box picture as an object URL (null while loading, or without one). */
  boxUrl: string | null;
  /** Pieces can be scanned (set-up finished, or the markers measured). */
  canScan: boolean;
  /** A message in plain words above the tab (null to clear it). */
  setError: (message: string | null) => void;
  /** The backup reminder (null: none due, or not worked out yet). The More tab shows it; the tab bar shows a dot. */
  reminder: BackupReminder | null;

  // ---- Counts (from the database, after each change) ----
  counts: PieceCounts;
  /** The earlier scan in the bin, if any. */
  bin: ScanBinSummary | null;
  /** Reads the counts, the bin and the puzzle record again (after deleting, restoring, a new batch, an answer…). */
  reload: () => Promise<void>;

  // ---- The pieces (read once the counts are known, and again when they change) ----
  /** The pieces have been read (false before, and when pieces can't be scanned yet). */
  piecesRead: boolean;
  /** Every piece of the puzzle, whatever its status. */
  allRows: PieceRow[];
  /** The pieces on the table: status 'table' or 'pending' (to check). */
  rows: PieceRow[];
  /** Pieces still to go in the puzzle (table, pending, tray): those with spots on the box picture. */
  unplaced: PieceRow[];

  // ---- Spots on the box picture (src/project/placements.ts) ----
  /** The stored placements (null until known, or without a box picture). */
  places: PlacementCache | null;
  /** Placing pieces on the box picture now: how far. */
  placing: { done: number; total: number } | null;
  /** Each unplaced piece's spot as shown (answers applied). */
  shownPlaces: Map<string, SpotChoice>;
  /** The owner's answers: spots taken, spots ruled out per piece. */
  answers: { view: ReturnType<typeof answerView>; placed: ReturnType<typeof placedPieces> };
  /** The empty spots from a photo of the puzzle (minus those answered), or null on the whole picture. */
  openCells: Array<[number, number]> | null;
  /** What a new photo of the puzzle changed (spots filled since the last one, pieces marked as in it); the Picture tab shows it. */
  photoPlaced: { filled: number; ids: string[] } | null;
  setPhotoPlaced: (v: { filled: number; ids: string[] } | null) => void;

  // ---- Per piece ----
  /** A table piece's shape group (corner / edge / interior / unsure). */
  groups: Map<string, ShapeGroup>;
  /** A table piece's state for the outline colours: found, shape read, spot known. */
  states: Map<string, PieceState>;
  /** The frame side of a border piece with a known spot. */
  sideOf: (id: string) => FrameSide | null;
  /** One sentence about a piece (its spot, shape…), as on the photo and in the live view. */
  infoOf: (p: PieceRow) => string;

  // ---- Joins (M6) ----
  pairView: ReturnType<typeof pairAnswerView>;
  /** Which pieces join (null without a grid). */
  pairs: { model: ReturnType<typeof pairModel>; list: ReturnType<typeof matchList> } | null;

  // ---- Shared actions ----
  /** Opens a piece's card (a sheet over any tab); `at`: the spot to show first. */
  openCard: (id: string, from?: CardFrom, at?: { col: number; row: number } | null) => void;
  /** The piece whose card is open (to mark its thumbnail), or null. */
  selectedPiece: string | null;
  /** Saves "It fits" / "Not there" for a piece at a spot, with its toast and Undo. */
  answer: (piece: PieceRow, spot: Spot, fits: boolean, from: 'piece' | 'fill' | 'live') => void;
  /** Undo right after an answer given in a live view (its own Undo). */
  undoLiveAnswer: (p: PieceRow, fits: boolean) => Promise<void>;
  /** A live view (of the tab's own, e.g. Fill a spot's) closed: the last "It fits" given there gets its toast now. */
  showPlacedLater: () => void;
  /** Takes a piece out of the puzzle again (back on the table or into its tray). */
  takeOut: (id: string) => Promise<void>;
  /** Opens the live view of the table (camera). */
  openLive: () => void;
  /**
   * Opens the live view pointing out these pieces, with lines between those that join. `opts` for the candidates
   * of one spot (Picture tab): its own title and explanation, the best piece green and the others amber, an
   * answer for that spot in the live view (spotOf), and what to do when it closes (back to the spot's sheet).
   */
  pointOut: (ids: string[], lines: MatchLine[], opts?: PointOutOpts) => void;
  /** Opens the scan camera. */
  scan: () => void;
  /** The current tab, and a way to switch (replaces the address: no Back step per tab). */
  tab: PuzzleTab;
  goTab: (tab: PuzzleTab) => void;
}

export const PuzzleContext = createContext<PuzzleCtx | null>(null);

/** Everything a tab needs, from the shell. Only inside PuzzleScreen. */
export function usePuzzle(): PuzzleCtx {
  const ctx = useContext(PuzzleContext);
  if (!ctx) throw new Error('usePuzzle() outside the puzzle screen');
  return ctx;
}
