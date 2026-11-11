/**
 * One puzzle (PLAN §5), as four tabs (M9 part 4, design plan §2 decisions 1–3, §4 items 3 and 6–8):
 * **Table · Picture · Pieces · More**, with the tab bar at the bottom and Scan in the navigation bar.
 *
 * ## Addresses
 * - `#/puzzle/<id>` opens the Table tab (the default, decision 3; the app reopens the last puzzle there);
 *   `#/puzzle/<id>/<tab>` (table, picture, pieces, more) opens that tab, also after a reload.
 * - Switching tabs **replaces** the address (no Back step per tab, as in iPhone apps): Back, the browser's
 *   or the navigation bar's, goes from any tab to Home. An unknown tab name opens the Table tab.
 * - The old `#/progress/<id>` opens the Picture tab (router.ts REDIRECTS); `#/accuracy/<id>` is unchanged.
 * - The last tab is not remembered per puzzle: the address keeps it, and a puzzle opened from Home or at
 *   launch starts on Table.
 *
 * ## The contract for the tabs (round 2 builds on this)
 * - This file (the shell) loads the puzzle, its piece counts and its pieces once, works out the spots
 *   on the box picture and the joins, and gives all of it to the tabs through `usePuzzle()` (context.ts:
 *   the `PuzzleCtx` type lists every field). It also owns what must work from every tab: the navigation
 *   bar (title, ‹ Home, Scan), the tab bar, the error callout, the piece card (`openCard`), the live views
 *   (`openLive`, `pointOut`), and the Undo toasts after an answer (`answer`, `takeOut`).
 * - One file per tab, each drawn only while it is open, inside `<section class="tab-panel">`:
 *   TableTab.tsx, PictureTab.tsx, PiecesTab.tsx, MoreTab.tsx. A tab's own state (filters, open panels,
 *   sheets) lives in the tab. A tab builder owns that file (and may add files next to it named after the
 *   tab, e.g. `PiecesGrid.tsx`), plus their CSS in their own block of styles.css, headed "M9 part 4: <tab> tab",
 *   right after the "M9 part 4: tabs" block.
 * - Shared, not to be changed by one tab's builder: this file, context.ts, shared.ts, the ui kit
 *   (src/app/ui), the components used by several tabs (PieceCard, LiveTable, Trays' TablePhoto), the router.
 *   A tab needing something new from the shell asks for a new `PuzzleCtx` field.
 * - A page of its own from a tab (e.g. "Which pieces join" as a full page): add a route in router.ts and a
 *   screen in App.tsx, link to it with `go('<route>', project.id)`, and give its NavBar
 *   `back={{ label: project.name, route: 'puzzle', arg: project.id, sub: '<tab>' }}` so Back returns to the tab.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { NavBar, type NavBack } from '../../ui/NavBar';
import { Icon } from '../../ui/icons';
import { Callout } from '../../ui/Callout';
import { TabBar, type TabItem } from '../../ui/TabBar';
import { toast } from '../../ui/toast';
import { go, replaceRoute, route, routeArg, routeSub } from '../../router';
import { setScreenTitle } from '../../shell';
import { countPiecesByStatus, getProject, setCurrentProjectId } from '../../../project/store';
import { scanBinSummary, type ScanBinSummary } from '../../../project/scans';
import type { PieceRow, Project } from '../../../project/types';
import { db } from '../../../db/db';
import {
  learnDue,
  placeKeyOf,
  readPlacements,
  shownPlacements,
  stalePieces,
  unplacedStatus,
  updatePlacements,
  type PlacementCache,
} from '../../../project/placements';
import { readerWorker } from '../../workers';
import { pieceSide, pieceState, spotLabel, SIDE_WORDS, type FrameSide } from '../../../project/progress';
import { LiveTable, type MatchLine } from '../../components/LiveTable';
import { matchList } from '../../components/Matches';
import { pairKey, pairModel } from '../../../project/pairs';
import { pairAnswerView } from '../../../project/pairAnswers';
import { answerSpot, answerView, clearNotHere, placedPieces, removeNotAPiece, restoreNotAPiece, undoAnswer, undoFits } from '../../../project/answers';
import { PieceCard } from '../../components/PieceCard';
import { OVERLAY_STATE } from '../../overlay';
import { OV } from '../../tokens';
import { markPlaced, piecesInFilledSpots } from '../../../project/placedFromPhoto';
import { backupReminder, type BackupReminder } from '../../../project/backupReminder';
import { logError, logInfo } from '../../../log/logger';
import { settings } from '../../settings';
import { CONFIDENCE_WORDS, errorWords, plural } from '../../words';
import { canScan, pct, pieceGroup, useBlobUrl, boxVersion } from './shared';
import { DEFAULT_TAB, PuzzleContext, tabOf, type CardFrom, type PieceCounts, type PuzzleCtx, type PuzzleTab, type Spot } from './context';
import type { PointOutOpts } from './context';
import { TableTab } from './TableTab';
import { PictureTab } from './PictureTab';
import { PiecesTab } from './PiecesTab';
import { MoreTab, backupToastOnce } from './MoreTab'; // M9 part 4 more: backupToastOnce
// M9 part 4 pieces: the pages pushed from the Pieces tab (#/joins/<id>, #/sort/<id>), drawn here with the tabs' data.
import { piecesPage } from './PiecesPages';

/** While the piece counts are being read, how often the backup reminder looks again whether the pieces list read the pieces (ms). */
const REMIND_WAIT_MS = 300;

/** Lines between pieces that join, at most, in the live view. */
const LIVE_LINES = 6;

/** The puzzle page's parent (M9 part 2): the list of puzzles on Home. */
const HOME_BACK: NavBack = { label: 'Home', route: 'home', ariaLabel: 'Back to home' };

/** The tab bar's items (icons: design plan §3.6). */
const TAB_ITEMS: Array<TabItem<PuzzleTab>> = [
  { id: 'table', label: 'Table', icon: <Icon name="scan-eye" />, testId: 'tab-table' },
  { id: 'picture', label: 'Picture', icon: <Icon name="image" />, testId: 'tab-picture' },
  { id: 'pieces', label: 'Pieces', icon: <Icon name="puzzle" />, testId: 'tab-pieces' },
  { id: 'more', label: 'More', icon: <Icon name="more-horizontal" />, testId: 'tab-more' },
];

const NO_COUNTS: PieceCounts = { all: null, table: 0, tray: 0, missing: 0, pending: 0, placed: 0, aside: 0 };

export function PuzzleScreen() {
  const id = routeArg.value;
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [counts, setCounts] = useState<PieceCounts>(NO_COUNTS);
  const [bin, setBin] = useState<ScanBinSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The pieces' times, for the backup reminder. */
  const [reminderRows, setReminderRows] = useState<Pick<PieceRow, 'updatedAt'>[] | null>(null);
  const mounted = useRef(true);
  /** Piece counts being read (on opening, or after a change), so the reminder waits for them. */
  const counting = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const gotCounts = (c: Awaited<ReturnType<typeof countPiecesByStatus>>) =>
    setCounts({ all: c.all, table: c.table, tray: c.tray, missing: c.missing, pending: c.pending, placed: c.placed, aside: c.aside });

  useEffect(() => {
    setProject(undefined);
    setCounts(NO_COUNTS);
    setReminderRows(null);
    if (!id) {
      setProject(null);
      return;
    }
    counting.current++;
    getProject(id)
      .then(async (p) => {
        if (!mounted.current) return;
        setProject(p ?? null);
        if (p) {
          void setCurrentProjectId(p.id).catch(() => {});
          gotCounts(await countPiecesByStatus(p.id));
          setBin(await scanBinSummary(p.id));
        }
      })
      .catch((err) => {
        logError('puzzle', 'The puzzle could not be loaded', err);
        setError(errorWords(err));
        setProject(null);
      })
      .finally(() => counting.current--);
  }, [id]);

  // Backup reminder (M7 part 3): from the pieces' and answers' times against the last backup.
  // The pieces are read again after every change that may have changed them, as before, but when the
  // pieces list reads them after that change, its read is used (review 2026-11-10: on opening and
  // after every ✓ Fits, every piece was read up to 3 more times for this and for the counts).
  // How it fits together:
  // - remindKey changes with every such change; askedAt is when it last changed (set while drawing).
  // - A read started at or after askedAt is new enough; an older one is ignored when it arrives.
  // - listReadAt is when the pieces were last read for the tabs (PuzzleTabs, below). They are read when the
  //   counts change, and that effect runs before this one (children's effects come first), so after a
  //   change of counts listReadAt >= askedAt and this effect doesn't read.
  // - counting > 0 while counts are being read (reload starts in the same tap as the change):
  //   the pieces will most often be read once they arrive, so this waits, looking again every REMIND_WAIT_MS.
  // - Otherwise (e.g. ✗ Doesn't fit, which changes only the puzzle record) it reads at once.
  const remindKey = project ? `${project.id}|${project.updatedAt}|${counts.all}|${counts.table}|${counts.tray}|${counts.placed}` : '';
  const remind = useRef({ key: '', askedAt: 0, listReadAt: -1 });
  if (remind.current.key !== remindKey) remind.current = { ...remind.current, key: remindKey, askedAt: performance.now() };
  /** Pieces read starting at `at`: used if no change came after that. */
  const gotReminderRows = (rows: PieceRow[], at: number) => {
    if (mounted.current && at >= remind.current.askedAt) setReminderRows(rows.map((r) => ({ updatedAt: r.updatedAt })));
  };
  const listReading = (rows: Promise<PieceRow[]>, at: number) => {
    remind.current.listReadAt = at;
    void rows.then((r) => gotReminderRows(r, at)).catch(() => {});
  };
  useEffect(() => {
    if (!project) return;
    const pid = project.id;
    const key = remindKey;
    let t: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      // A newer change: its own turn of this effect reads.
      if (remind.current.key !== key) return;
      // The counts are on their way (and with them, most often, the pieces are read for the tabs).
      if (counting.current > 0) return void (t = setTimeout(read, REMIND_WAIT_MS));
      // The pieces are being read for the tabs since the change.
      if (remind.current.listReadAt >= remind.current.askedAt) return;
      const at = performance.now();
      void db()
        .pieces.where('projectId')
        .equals(pid)
        .toArray()
        .then((rows) => gotReminderRows(rows, at))
        .catch(() => {});
    };
    read();
    return () => clearTimeout(t);
  }, [remindKey]);
  // The title names the puzzle, also after renaming it (M9 part 1).
  // M9 part 4 pieces: on a page pushed from the Pieces tab, that page's title ("Which pieces join · Harbour · Puzzle Lens").
  useEffect(() => {
    if (project) setScreenTitle(piecesPage(route.value) ? route.value : 'puzzle', project.name);
  }, [project?.name, route.value]);
  const reminder = useMemo<BackupReminder | null>(
    () => (project && reminderRows ? backupReminder(project, reminderRows) : null),
    [reminderRows, project?.lastBackup?.at, project?.backupSnoozedUntil],
  );
  // M9 part 4 more: a backup that is due also shows as a toast on opening the puzzle, at most once a day (MoreTab.tsx).
  // Only when the puzzle is opened (the first 10 s), never because an answer just made a backup due: it would
  // replace that answer's "Placed at … · Undo" toast (review 2026-11-11). backupToastOnce also waits for no other toast.
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
  }, [project?.id]);
  useEffect(() => {
    if (reminder && project && Date.now() - openedAt.current < 10_000) backupToastOnce(project.id);
  }, [reminder !== null, project?.id]);

  /** After deleting, restoring or an answer: the puzzle (size), piece counts and bin as stored now. */
  const reload = async () => {
    if (!project) return;
    const pid = project.id;
    counting.current++;
    try {
      const [np, c, b] = await Promise.all([getProject(pid), countPiecesByStatus(pid), scanBinSummary(pid)]);
      if (!mounted.current) return;
      if (np) setProject(np);
      gotCounts(c);
      setBin(b);
    } finally {
      counting.current--;
    }
  };

  // One <main> and one navigation bar whatever the state, so the heading keeps the focus it got when the screen
  // opened (M9 part 1) once the puzzle has loaded.
  const tab = tabOf(routeSub.value);
  // M9 part 4 pieces: a page pushed from the Pieces tab: its title, "‹ Pieces" back to the tab (short, so the title fits on one line), no Scan.
  const page = piecesPage(route.value);
  return (
    <main
      class={`screen${project ? ' puzzle-tabs' : ''}`}
      data-testid={project === null ? 'puzzle-missing' : project ? 'puzzle-screen' : undefined}
      data-tab={project && !page ? tab : undefined}
      data-page={page ? route.value : undefined}
    >
      <NavBar
        title={page ? page.title : project ? project.name : 'Puzzle'}
        back={page && id ? { label: 'Pieces', route: 'puzzle', arg: id, sub: 'pieces' } : HOME_BACK}
      >
        {/* Scan, from every tab (it was the first button of the action bar, M9 part 1). */}
        {project && canScan(project) && !page && (
          <button class="btn-icon navbar-scan" aria-label="Scan pieces" data-testid="scan-pieces" onClick={() => go('scan', project.id)}>
            <Icon name="camera" />
          </button>
        )}
      </NavBar>
      {project === undefined ? (
        <p class="muted">Loading…</p>
      ) : project === null ? (
        <>
          <Callout kind="bad" icon={<Icon name="alert-triangle" />} role="alert">
            {error ?? 'This puzzle is not on this iPhone (it may have been deleted).'}
          </Callout>
          <button class="btn btn-filled btn-block" onClick={() => go('home')}>
            Back to my puzzles
          </button>
        </>
      ) : (
        <PuzzleTabs
          project={project}
          setProject={setProject}
          counts={counts}
          bin={bin}
          reload={reload}
          error={error}
          setError={setError}
          reminder={reminder}
          onReading={listReading}
        />
      )}
    </main>
  );
}

/** The loaded puzzle: its pieces, what the app worked out about them, the tabs, and what works from every tab. */
function PuzzleTabs({
  project,
  setProject,
  counts,
  bin,
  reload,
  error,
  setError,
  reminder,
  onReading,
}: {
  project: Project;
  setProject: (p: Project) => void;
  counts: PieceCounts;
  bin: ScanBinSummary | null;
  reload: () => Promise<void>;
  error: string | null;
  setError: (m: string | null) => void;
  reminder: BackupReminder | null;
  /** Every piece being read (from the time given), so the backup reminder can use the same read. */
  onReading: (rows: Promise<PieceRow[]>, at: number) => void;
}) {
  const projectId = project.id;
  const tab = tabOf(routeSub.value);
  // M9 part 4 pieces: a page pushed from the Pieces tab, drawn instead of the tabs (null on the tabs).
  const page = piecesPage(route.value);
  const scannable = canScan(project);
  // The pieces are read once the counts are known, so they are read once on opening, not again when the counts arrive.
  const readPieces = scannable && counts.all !== null;
  const version = `${counts.all}|${counts.tray}|${counts.table}|${counts.pending}`;
  const [rows, setRows] = useState<PieceRow[]>([]);
  const [allRows, setAllRows] = useState<PieceRow[]>([]);
  const [piecesRead, setPiecesRead] = useState(false);
  const [places, setPlaces] = useState<PlacementCache | null>(null);
  const [placing, setPlacing] = useState<{ done: number; total: number } | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  /**
   * The piece card (M9 part 3): which piece, where it was opened from (the live view: no "Point it out"), the
   * spot to show first (from Fill a spot), and a count so each opening starts afresh. Kept while it slides away.
   */
  const [card, setCard] = useState<{ id: string; from: CardFrom; at: { col: number; row: number } | null; n: number } | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  /**
   * "Placed at 18·7" with Undo, after It fits (M9 part 2: a toast, was a note in the page; M9 part 3: these words).
   * An answer given in a live view waits here until the live view closes (it has its own Undo meanwhile).
   */
  const placedLater = useRef<{ id: string; col: number; row: number } | null>(null);
  const placedToast = useRef<{ id: string; close: () => void } | null>(null);
  /**
   * Pieces to point out in the live view, with lines between those that join (M6); `back`: a piece card's
   * "Point it out" (M9 part 3), whose card opens again when the live view closes.
   */
  const [findLive, setFindLive] = useState<{ ids: string[]; lines: MatchLine[]; back?: string; words?: PointOutOpts } | null>(null);
  /** What a new puzzle photo changed (M7 part 4): spots filled since the last one, and the pieces marked as in the puzzle. */
  const [photoPlaced, setPhotoPlaced] = useState<{ filled: number; ids: string[] } | null>(null);
  const boxUrl = useBlobUrl(project.box?.rectifiedBlobId, boxVersion(project.box));
  const placeKey = placeKeyOf(project);
  const onPiecesChanged = () => void reload().catch((err) => logError('puzzle', 'The piece counts could not be read', err));
  useEffect(() => {
    if (!readPieces) return;
    let live = true;
    void (async () => {
      const at = performance.now();
      const reading = db().pieces.where('projectId').equals(projectId).toArray();
      onReading(reading, at);
      const everything = await reading;
      // Pieces to check (M5 part 3) are on the table too.
      const ps = everything.filter((q) => q.status === 'table' || q.status === 'pending');
      if (!live) return;
      setRows(ps);
      setAllRows(everything);
      setPiecesRead(true);
      // Box placement (M4): show what is known, then place pieces that are new or photographed again.
      if (!placeKey) return;
      const cached = await readPlacements(projectId);
      if (live) setPlaces(cached?.boxKey === placeKey ? cached : null);
      // Pieces in trays are placed too: they still belong in the puzzle (and compete for empty spots).
      const unplaced = everything.filter(unplacedStatus);
      // Pieces new or photographed again, or all of them once the colours can be learned from the pieces in the puzzle (M8).
      const learnNow = learnDue(cached, placeKey, everything);
      const todo = stalePieces(cached, placeKey, unplaced).length || (learnNow ? unplaced.length : 0);
      if (!todo) return;
      try {
        const rw = readerWorker();
        const info = await rw.ready;
        if (!info?.ok || !live) return;
        setPlacing({ done: 0, total: todo });
        const next = await updatePlacements(project, unplaced, rw.api, (done, total) => live && setPlacing({ done, total }), everything);
        if (next?.learned && learnNow)
          logInfo(
            'place',
            next.colour?.affine
              ? `Colours learned from ${next.learned.n} pieces in the puzzle (held-out ΔE ${next.learned.before.toFixed(1)} → ${next.learned.after.toFixed(1)})`
              : `Colours not learned from ${next.learned.n} pieces in the puzzle (${next.learned.before ? `no better on held-out pieces: ΔE ${next.learned.before.toFixed(1)} vs ${next.learned.after.toFixed(1)}` : 'too few usable'})`,
          );
        if (live) setPlaces(next);
        // A new photo of the puzzle (M7 part 4): its spots filled since the last photo had their pieces put in.
        if (cached?.open?.cells.length && next?.open && cached.boxKey !== next.boxKey) {
          const before = shownPlacements(cached, unplaced, { view: answerView(project), placed: placedPieces(everything) });
          const went = piecesInFilledSpots(before, cached.open.cells, next.open.cells, everything);
          const filledN = cached.open.cells.length - cached.open.cells.filter(([c, r]) => next.open!.cells.some(([c2, r2]) => c2 === c && r2 === r)).length;
          if (filledN > 0) {
            const ids = went.length ? await markPlaced(projectId, went, 'photo') : [];
            logInfo('place', `New puzzle photo: ${filledN} spots filled since the last one; ${ids.length} pieces marked as in the puzzle`);
            if (live) setPhotoPlaced({ filled: filledN, ids });
            if (ids.length) onPiecesChanged();
          }
        }
        logInfo(
          'place',
          `Placed ${plural(todo, 'piece')} on the box picture` +
            (next?.open
              ? `, among ${next.open.cells.length} empty spots (turn ${next.open.turn}, fit ${next.open.fit.toFixed(2)} vs ${next.open.runnerUp.toFixed(2)})`
              : ''),
        );
      } catch (err) {
        logError('place', 'Box placement failed', err);
      } finally {
        if (live) setPlacing(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [projectId, version, placeKey, readPieces]);
  // Fits / Doesn't fit (M5 part 2): taken spots, ruled-out spots, and placed pieces' knobs.
  const answersCtx = useMemo(() => ({ view: answerView(project), placed: placedPieces(allRows) }), [project.answers, project.grid, allRows]);
  const shownPlaces = useMemo(() => shownPlacements(places, allRows.filter(unplacedStatus), answersCtx), [places, allRows, answersCtx]);
  const openCells = places?.open?.cells.length ? places.open.cells.filter(([c, r]) => !answersCtx.view.taken.has(`${c},${r}`)) : null;
  // Which pieces join (M6): from the placements, minus the owner's "don't fit" pairs.
  const pairView = useMemo(() => pairAnswerView(project), [project.pairAnswers]);
  const pairs = useMemo(() => {
    if (!project.grid) return null;
    const filled = new Set<string>(answersCtx.view.taken.keys());
    for (const r of allRows) if (r.status === 'placed' && r.placedAt && r.placedAt.col >= 0) filled.add(`${r.placedAt.col},${r.placedAt.row}`);
    const model = pairModel({
      shown: shownPlaces,
      rows: allRows.filter(unplacedStatus),
      grid: project.grid,
      open: places?.open?.cells.length ? new Set(places.open.cells.map(([c, r]) => `${c},${r}`)) : null,
      filled,
      not: pairView.not,
    });
    return { model, list: matchList(model, pairView, new Set(rows.map((r) => r.id))) };
  }, [shownPlaces, allRows, rows, project.grid, places, answersCtx, pairView]);
  // On the live view: the few most likely pairs (more get hard to follow across the table).
  const matchLines: MatchLine[] = (pairs?.list.pairs ?? [])
    .filter((s) => s.p >= 0.5)
    .slice(0, LIVE_LINES)
    .map((s) => {
      const ok = pairs!.list.confirmed.has(pairKey(s.a, s.b, s.dir));
      return { a: s.a, b: s.b, label: ok ? '✓' : `${pct(s.p)} %`, confirmed: ok };
    });
  const answer = (piece: PieceRow, spot: Spot, fits: boolean, from: 'piece' | 'fill' | 'live') => {
    void answerSpot(projectId, piece, spot, fits, shownPlaces.get(piece.id) ?? null, from)
      .then((next) => {
        logInfo('answer', `${fits ? 'Fits' : "Doesn't fit"}: piece at column ${spot.col + 1}, row ${spot.row + 1} (from ${from})`);
        setProject(next);
        if (fits) {
          const placed = { id: piece.id, col: spot.col, row: spot.row };
          if (document.querySelector('[data-testid="live-table"]')) placedLater.current = placed;
          else showPlaced(placed);
          onPiecesChanged();
        } else if (from !== 'live') {
          // "Not there" (M9 part 3, decision 22): Undo offers that spot again (the live view has its own Undo).
          toast({
            text: `Not at ${spot.col + 1}·${spot.row + 1}`,
            action: {
              label: 'Undo',
              run: () =>
                void undoAnswer(projectId, piece.id, false)
                  .then(setProject)
                  .catch((err) => logError('answer', 'Could not undo the answer', err)),
            },
          });
        }
      })
      .catch((err) => logError('answer', 'The answer could not be saved', err));
  };
  /** Takes a piece out of the puzzle again (Undo, Take out): back on the table or into its tray. */
  const takeOut = (id: string) =>
    undoFits(projectId, id).then((next) => {
      setProject(next);
      if (placedLater.current?.id === id) placedLater.current = null;
      if (placedToast.current?.id === id) placedToast.current.close();
      onPiecesChanged();
    });
  function showPlaced({ id, col, row }: { id: string; col: number; row: number }) {
    const close = toast({
      text: `Placed at ${col + 1}·${row + 1}`,
      action: { label: 'Undo', run: () => void takeOut(id).catch((err) => logError('answer', 'Could not take the piece out again', err)) },
    });
    placedToast.current = { id, close };
  }
  /** A live view closed: the last ✓ Fits given there gets its toast (with Undo) now. */
  const showPlacedLater = () => {
    const placed = placedLater.current;
    placedLater.current = null;
    if (placed) showPlaced(placed);
  };
  /** Undo right after an answer in the live view (M9 part 1): ✓ Fits as takeOut; ✗ Doesn't fit offers that spot again. */
  const undoLiveAnswer = (p: PieceRow, fits: boolean) =>
    (fits ? takeOut(p.id) : undoAnswer(projectId, p.id, false).then(setProject)).then(() =>
      logInfo('answer', `Undone in the live view: ${fits ? 'Fits' : "Doesn't fit"}`),
    );
  /**
   * Opens a piece's card (M9 part 3: a sheet over the page; it was a panel below the pieces that had to be
   * scrolled into view, and a quick tap after that scroll could land on the wrong button: see PieceCard).
   */
  const openCard = (id: string, from: CardFrom = 'grid', at: { col: number; row: number } | null = null) => {
    setCard((c) => ({ id, from, at, n: (c?.n ?? 0) + 1 }));
    setCardOpen(true);
  };
  const bestSpot = (p: PieceRow) => {
    const t = shownPlaces.get(p.id)?.placement.top[0];
    return t ? { col: t.col, row: t.row, rot: t.rot } : null;
  };
  const grid = project.grid;
  const pitch = project.piecePitch;
  const cell: [number, number] | null = pitch ? [pitch.wMm, pitch.hMm] : null;
  const groups = useMemo(() => new Map(rows.map((r) => [r.id, pieceGroup(r, cell)])), [rows, cell?.[0], cell?.[1]]);
  const unplaced = useMemo(() => allRows.filter(unplacedStatus), [allRows]);
  // Each piece's state (found / shape read / spot known) and frame side, for the table view and the progress line.
  const states = useMemo(() => new Map(rows.map((r) => [r.id, pieceState(groups.get(r.id) !== 'unsure', shownPlaces.get(r.id))])), [rows, groups, shownPlaces]);
  const sideOf = (id: string): FrameSide | null => (grid ? pieceSide(shownPlaces.get(id), grid) : null);
  const infoOf = (p: PieceRow): string => {
    const c = shownPlaces.get(p.id);
    const st = states.get(p.id);
    if (st === 'placed') {
      const t = c!.placement.top[0]!;
      const side = sideOf(p.id);
      return `Column ${t.col + 1}, row ${t.row + 1} (${CONFIDENCE_WORDS[c!.placement.verdict]}${settings.testerMode.value ? `, ${pct(t.p)} %` : ''})${side ? `, ${SIDE_WORDS[side]}` : ''}.`;
    }
    const g = groups.get(p.id);
    const shape = g === 'corner' ? 'a corner piece' : g === 'edge' ? 'an edge piece' : g === 'interior' ? 'an inside piece' : null;
    if (c && !c.fits) return `${shape ? `Shape read (${shape}). ` : ''}Fits none of the empty spots.`;
    if (shape) return `Shape read (${shape}). Its spot isn't sure yet${c ? ': several places look alike' : ''}.`;
    return 'Found, but its shape couldn’t be read yet (a close-up helps).';
  };
  const confidenceOf = (p: PieceRow) => {
    const c = shownPlaces.get(p.id);
    return c && c.fits && c.placement.top[0] ? { verdict: c.placement.verdict, p: c.placement.top[0].p } : null;
  };
  /** Another tab: the address changes without a Back step, and the new tab starts at the top. */
  const goTab = (to: PuzzleTab) => {
    if (to === tab) return;
    replaceRoute('puzzle', projectId, to === DEFAULT_TAB ? null : to);
    scrollTo(0, 0);
  };

  const ctx: PuzzleCtx = {
    project,
    setProject,
    boxUrl,
    canScan: scannable,
    setError,
    reminder,
    counts,
    bin,
    reload,
    piecesRead,
    allRows,
    rows,
    unplaced,
    places,
    placing,
    shownPlaces,
    answers: answersCtx,
    openCells,
    photoPlaced,
    setPhotoPlaced,
    groups,
    states,
    sideOf,
    infoOf,
    pairView,
    pairs,
    openCard,
    selectedPiece: cardOpen ? (card?.id ?? null) : null,
    answer,
    undoLiveAnswer,
    showPlacedLater,
    takeOut,
    openLive: () => setLiveOpen(true),
    pointOut: (ids, lines, opts) => setFindLive({ ids, lines, words: opts }),
    scan: () => go('scan', projectId),
    tab,
    goTab,
  };

  // The piece card (M9 part 3): a sheet over the page, for a piece on the table or in a tray.
  const cardRow = card ? (unplaced.find((r) => r.id === card.id) ?? null) : null;
  const cardBlock =
    card && project.grid ? (
      <PieceCard
        key={card.n}
        open={cardOpen && cardRow !== null}
        onClose={() => setCardOpen(false)}
        piece={cardRow}
        choice={shownPlaces.get(card.id) ?? null}
        project={project}
        boxUrl={boxUrl}
        spots={openCells}
        startAt={card.at}
        onAnswer={(spot, fits) => {
          if (!cardRow) return;
          // "It fits" closes the card (the page shows "Placed at …" with Undo); "Not there" keeps it open on the next spot.
          if (fits) setCardOpen(false);
          answer(cardRow, spot, fits, card.from === 'fill' ? 'fill' : 'piece');
        }}
        partners={pairs?.model.sides.get(card.id) ?? null}
        pieceById={(pid) => allRows.find((r) => r.id === pid)}
        ruledOut={answersCtx.view.notHere.get(card.id)?.size ?? 0}
        onClearRuledOut={() =>
          void clearNotHere(projectId, card.id)
            .then(setProject)
            .catch((err) => logError('answer', 'Could not clear the answers', err))
        }
        onInPuzzle={() =>
          void markPlaced(projectId, [{ id: card.id }], 'tap')
            .then(() => {
              logInfo('answer', 'Put in the puzzle (spot not known)');
              setCardOpen(false);
              onPiecesChanged();
            })
            .catch((err) => logError('answer', 'Could not mark it as in the puzzle', err))
        }
        onRemove={() => {
          // One tap, then Undo (decision 22; it asked "Remove it from the list?" first).
          const id = card.id;
          setCardOpen(false);
          void removeNotAPiece(projectId, id)
            .then((next) => {
              logInfo('answer', 'Removed something that is not a puzzle piece');
              setProject(next);
              onPiecesChanged();
              toast({
                text: 'Removed. Take it off the table too.',
                action: {
                  label: 'Undo',
                  run: () =>
                    void restoreNotAPiece(projectId, id)
                      .then((back) => {
                        logInfo('answer', 'Not a piece: undone, the piece is back');
                        setProject(back);
                        onPiecesChanged();
                      })
                      .catch((err) => logError('answer', 'Could not bring the piece back', err)),
                },
              });
            })
            .catch((err) => logError('answer', 'Could not remove it', err));
        }}
        onFind={
          card.from !== 'live' && cardRow && (cardRow.status === 'table' || cardRow.status === 'pending')
            ? () => {
                setCardOpen(false);
                setFindLive({ ids: [card.id], lines: [], back: card.id });
              }
            : undefined
        }
      />
    ) : null;

  return (
    <PuzzleContext.Provider value={ctx}>
      {error && (
        <Callout kind="bad" icon={<Icon name="alert-triangle" />} role="alert" testId="puzzle-error">
          {error}
        </Callout>
      )}
      {/* M9 part 4 pieces: a page pushed from the Pieces tab takes the tabs' place (no tab bar: Back returns to the tab). */}
      {page ? (
        <page.Body />
      ) : (
        <>
          <section class="tab-panel" data-testid={`tab-panel-${tab}`} aria-label={TAB_ITEMS.find((t) => t.id === tab)!.label}>
            {tab === 'table' && <TableTab />}
            {tab === 'picture' && <PictureTab />}
            {tab === 'pieces' && <PiecesTab />}
            {tab === 'more' && <MoreTab />}
          </section>
          <TabBar
            fixed
            label="Puzzle"
            testId="puzzle-tabs"
            selected={tab}
            onSelect={goTab}
            items={TAB_ITEMS.map((t) =>
              t.id === 'more' && reminder
                ? { ...t, badge: true, badgeLabel: 'backup due' }
                : t.id === 'pieces' && counts?.pending
                  ? // Pieces to check, waiting on the Pieces tab (review 2026-11-11: seen only there).
                    { ...t, badge: counts.pending, badgeLabel: `${counts.pending} to check` }
                  : t,
            )}
          />
        </>
      )}
      {/* The live views and the piece card: over every tab. */}
      {liveOpen && (
        <LiveTable
          projectId={projectId}
          pieces={rows}
          colourOf={(p) => OVERLAY_STATE[states.get(p.id) ?? 'found']}
          labelOf={(p) => spotLabel(shownPlaces.get(p.id))}
          confidenceOf={confidenceOf}
          infoOf={infoOf}
          answer={{
            labelOf: (p) => {
              const b = bestSpot(p);
              return project.grid && b ? `column ${b.col + 1}, row ${b.row + 1}` : null;
            },
            onAnswer: (p, fits) => {
              const b = bestSpot(p);
              if (b) answer(p, b, fits, 'live');
            },
            onUndo: undoLiveAnswer,
          }}
          onPick={(p) => {
            setLiveOpen(false);
            openCard(p.id, 'live');
          }}
          title="Live view"
          lines={matchLines}
          legend={
            <>
              <span class="state-dot" style={{ background: OVERLAY_STATE.placed }} />
              spot known <span class="state-dot" style={{ background: OVERLAY_STATE.shape }} />
              shape read <span class="state-dot" style={{ background: OVERLAY_STATE.found }} />
              found.{matchLines.length > 0 ? ' Lines join pieces that fit together; a green shape marks a square of 4.' : ''} Hold the phone about as high as
              for your scan. Tap a piece.
            </>
          }
          onClose={() => {
            setLiveOpen(false);
            // An answer given there gets its toast with Undo now, above the tab bar (check 2026-11-10: as a note
            // in the page it was below the screen, out of reach after closing the live view).
            showPlacedLater();
          }}
        />
      )}
      {findLive && (
        <LiveTable
          projectId={projectId}
          pieces={rows}
          colourOf={(p) =>
            findLive.words?.best && findLive.ids.includes(p.id) && p.id !== findLive.words.best
              ? OV.weak
              : findLive.ids.includes(p.id)
                ? OVERLAY_STATE.placed
                : OVERLAY_STATE[states.get(p.id) ?? 'found']
          }
          answer={
            findLive.words?.spotOf
              ? {
                  labelOf: (p) => {
                    const s = findLive.words!.spotOf!(p.id);
                    return s ? `column ${s.col + 1}, row ${s.row + 1}` : null;
                  },
                  onAnswer: (p, fits) => {
                    const s = findLive.words!.spotOf!(p.id);
                    if (s) answer(p, s, fits, 'live');
                  },
                  onUndo: undoLiveAnswer,
                }
              : undefined
          }
          infoOf={infoOf}
          labelOf={(p) => spotLabel(shownPlaces.get(p.id))}
          confidenceOf={confidenceOf}
          find={findLive.ids}
          lines={findLive.lines}
          title={findLive.words?.title ?? (findLive.ids.length === 1 ? 'Find this piece' : findLive.ids.length > 2 ? 'Find the 4 pieces' : 'Find the 2 pieces')}
          legend={
            findLive.words ? (
              <>{findLive.words.legend}</>
            ) : findLive.ids.length === 1 ? (
              <>The pulsing piece is the one from its card. An arrow at the edge shows the way when it is out of view.</>
            ) : (
              <>The pulsing pieces join: the line shows which goes with which. An arrow at the edge shows the way when one is out of view.</>
            )
          }
          onClose={() => {
            const back = findLive.back;
            const after = findLive.words?.onClose;
            setFindLive(null);
            // An answer given there gets its toast with Undo now (as after the main live view).
            if (findLive.words?.spotOf) showPlacedLater();
            after?.();
            // From a piece card's "Point it out": back to its card, to say whether it fits.
            if (back && rows.some((r) => r.id === back)) openCard(back, 'live');
          }}
        />
      )}
      {cardBlock}
    </PuzzleContext.Provider>
  );
}
