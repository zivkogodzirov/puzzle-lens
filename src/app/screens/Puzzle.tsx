/**
 * One puzzle (PLAN §5): name, piece count, grid, box picture, setup progress with "Continue
 * setup", pieces catalogued so far, Export backup and Delete.
 * M9 part 2: the kit's NavBar, icons, callouts and lists; deleting the puzzle or the scanned pieces asks in an
 * action sheet, a new batch explains itself in a sheet, and ✓ Fits answers with an Undo toast.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { NavBar, type NavBack } from '../ui/NavBar';
import { Icon, type IconName } from '../ui/icons';
import { Callout } from '../ui/Callout';
import { ListRow, ListSection } from '../ui/List';
import { ActionSheet, confirmAction } from '../ui/ActionSheet';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/toast';
import { go, routeArg } from '../router';
import { setScreenTitle } from '../shell';
import { APP_VERSION } from '../env';
import { reportWorker } from '../workers';
import { countPiecesByStatus, deleteProject, getBlob, getProject, LAST_SETUP_STEP, setCurrentProjectId, updateProject } from '../../project/store';
import { exportBackup, zipHere } from '../../project/backup';
import { deleteScan, restoreScan, scanBinSummary, type ScanBinSummary } from '../../project/scans';
import type { PieceRow, Project } from '../../project/types';
import { db } from '../../db/db';
import { readShape, READ_OK, type PieceKind } from '../../cv/shapeRead';
import type { Placement } from '../../cv/placement';
import {
  learnDue,
  placeKeyOf,
  readPlacements,
  shownPlacements,
  stalePieces,
  unplacedStatus,
  updatePlacements,
  type PlacementCache,
} from '../../project/placements';
import type { SpotChoice } from '../../cv/openSpots';
import { readerWorker } from '../workers';
import { TablePhoto, TraysPanel, useColourGroups } from '../components/Trays';
import { pieceSide, pieceState, progressCounts, SIDE_ARROW, SIDE_WORDS, spotLabel, type FrameSide, type PieceState } from '../../project/progress';
import { FillSpot } from '../components/FillSpot';
import { LiveTable, type MatchLine } from '../components/LiveTable';
import { matchList, MatchesPanel } from '../components/Matches';
import { pairKey, pairModel } from '../../project/pairs';
import { answerPair, pairAnswerView, undoPairAnswer } from '../../project/pairAnswers';
import { answerSpot, answerView, clearNotHere, placedPieces, removeNotAPiece, restoreNotAPiece, undoAnswer, undoFits } from '../../project/answers';
import { PieceCard } from '../components/PieceCard';
import { OVERLAY_STATE } from '../overlay';
import { resolvePending } from '../../project/pending';
import { startNewBatch } from '../../project/batches';
import { markPlaced, piecesInFilledSpots } from '../../project/placedFromPhoto';
import { backupReminder, markBackedUp, snoozeBackupReminder, type BackupReminder } from '../../project/backupReminder';
import { TableContrast } from '../components/TableContrast';
import { BoxFitNotice } from '../components/BoxFitNotice';
import type { Groups } from '../../project/groups';
import { canShareFile, downloadUrl, revokeDownloadUrls, shareOrDownload } from '../../report/share';
import { formatBytes } from '../../report/collect';
import { logError, logInfo, logWarn } from '../../log/logger';
import { settings } from '../settings';
import { CONFIDENCE_WORDS, errorWords, plural, UNREADABLE_PHOTO } from '../words';

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

/** While the piece counts are being read, how often the backup reminder looks again whether the pieces list read the pieces (ms). */
const REMIND_WAIT_MS = 300;

/** The puzzle page's parent (M9 part 2): the list of puzzles on Home. */
const HOME_BACK: NavBack = { label: 'Home', route: 'home', ariaLabel: 'Back to home' };

type ExportPhase = { kind: 'idle' } | { kind: 'preparing' } | { kind: 'ready'; file: File; url: string } | { kind: 'error'; message: string };

export function PuzzleScreen() {
  const id = routeArg.value;
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [pieces, setPieces] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [exp, setExp] = useState<ExportPhase>({ kind: 'idle' });
  const [share, setShare] = useState<'none' | 'sharing' | 'shared' | 'fallback'>('none');
  const [error, setError] = useState<string | null>(null);
  const [bin, setBin] = useState<ScanBinSummary | null>(null);
  const [missingN, setMissingN] = useState(0);
  const [trayN, setTrayN] = useState(0);
  const [tableN, setTableN] = useState(0);
  const [pendingN, setPendingN] = useState(0);
  const [placedN, setPlacedN] = useState(0);
  const [asideN, setAsideN] = useState(0);
  /** Deleting, restoring or a new batch is under way. */
  const [scanBusy, setScanBusy] = useState(false);
  /** The sheet that asks before one of them (M9 part 2: action sheets and a sheet instead of boxes in the page). */
  const [scanAsk, setScanAsk] = useState<'none' | 'delete' | 'restore' | 'batch'>('none');
  const [scanNote, setScanNote] = useState<string | null>(null);
  /** The pieces' times, for the backup reminder. */
  const [reminderRows, setReminderRows] = useState<Pick<PieceRow, 'updatedAt'>[] | null>(null);
  const mounted = useRef(true);
  /** Piece counts being read (on opening, or after a change), so the reminder waits for them. */
  const counting = useRef(0);
  const thumb = useBlobUrl(project?.box?.rectifiedBlobId, boxVersion(project?.box));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revokeDownloadUrls();
    };
  }, []);

  useEffect(() => {
    setProject(undefined);
    setPieces(null);
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
          const c = await countPiecesByStatus(p.id);
          setPieces(c.all);
          setMissingN(c.missing);
          setTrayN(c.tray);
          setTableN(c.table);
          setPendingN(c.pending);
          setPlacedN(c.placed);
          setAsideN(c.aside);
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
  // - listReadAt is when the pieces list last started reading. It reads when the counts change, and
  //   its effect runs before this one (children's effects come first), so after a change of counts
  //   listReadAt >= askedAt and this effect doesn't read.
  // - counting > 0 while counts are being read (reloadScan starts in the same tap as the change):
  //   the list will most often read once they arrive, so this waits, looking again every REMIND_WAIT_MS.
  // - Otherwise (e.g. ✗ Doesn't fit, which changes only the puzzle record) it reads at once.
  const remindKey = project ? `${project.id}|${project.updatedAt}|${pieces}|${tableN}|${trayN}|${placedN}` : '';
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
      // The counts are on their way (and with them, most often, the pieces list reads the pieces).
      if (counting.current > 0) return void (t = setTimeout(read, REMIND_WAIT_MS));
      // The pieces list is reading them since the change.
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
  useEffect(() => {
    if (project) setScreenTitle('puzzle', project.name);
  }, [project?.name]);
  const reminder = useMemo<BackupReminder | null>(
    () => (project && reminderRows ? backupReminder(project, reminderRows) : null),
    [reminderRows, project?.lastBackup?.at, project?.backupSnoozedUntil],
  );

  if (project === undefined) {
    return (
      <main class="screen">
        <NavBar title="Puzzle" back={HOME_BACK} />
        <p class="muted">Loading…</p>
      </main>
    );
  }
  if (project === null) {
    return (
      <main class="screen" data-testid="puzzle-missing">
        <NavBar title="Puzzle" back={HOME_BACK} />
        <Callout kind="bad" icon={<Icon name="alert-triangle" />} role="alert">
          {error ?? 'This puzzle is not on this iPhone (it may have been deleted).'}
        </Callout>
        <button class="btn btn-filled btn-block" onClick={() => go('home')}>
          Back to my puzzles
        </button>
      </main>
    );
  }

  const p = project;
  const saveName = async () => {
    const name = (renaming ?? '').trim();
    setRenaming(null);
    if (!name || name === p.name) return;
    try {
      setProject(await updateProject(p.id, { name }));
    } catch (err) {
      logError('puzzle', 'The new name could not be saved', err);
      setError(errorWords(err));
    }
  };

  const prepareBackup = async () => {
    revokeDownloadUrls();
    setShare('none');
    setExp({ kind: 'preparing' });
    try {
      let file: File;
      try {
        file = await exportBackup(p.id, { zip: (files) => reportWorker().build(files), appVersion: APP_VERSION });
      } catch (err) {
        // The packing helper couldn't run: pack here instead (slower, same file).
        logWarn('backup', 'Backup helper failed; packing on the main thread', err);
        file = await exportBackup(p.id, { zip: zipHere, appVersion: APP_VERSION });
      }
      logInfo('backup', `Backup prepared: ${file.name} (${file.size} bytes)`);
      if (mounted.current) setExp({ kind: 'ready', file, url: downloadUrl(file) });
    } catch (err) {
      logError('backup', 'The backup could not be prepared', err);
      if (mounted.current) setExp({ kind: 'error', message: errorWords(err) });
    }
  };

  // The backup has left the app: the reminder starts counting again from now.
  const backedUp = async () => {
    try {
      const next = await markBackedUp(p.id);
      if (mounted.current) setProject(next);
    } catch (err) {
      logError('backup', 'The backup time could not be saved', err);
    }
  };

  const onShare = () => {
    if (exp.kind !== 'ready' || share === 'sharing') return;
    // FIRST thing in the tap, file already made (iOS ~5 s rule).
    const pending = shareOrDownload(exp.file, 'Puzzle Lens backup');
    setShare('sharing');
    void pending.then((outcome) => {
      if (!mounted.current) return;
      if (outcome.kind === 'shared') {
        setShare('shared');
        logInfo('backup', 'Backup shared');
        void backedUp();
      } else if (outcome.kind === 'cancelled') setShare('none');
      else {
        setShare('fallback');
        logWarn('backup', `Share menu not available, download offered instead (${outcome.reason})`);
      }
    });
  };

  // Asked in an action sheet (M9 part 2); Cancel keeps everything.
  const onDelete = async () => {
    const sure = await confirmAction({
      title: `Delete “${p.name}”?`,
      message: 'Its box picture and every piece read so far go too, on this iPhone. This can’t be undone (unless you have a backup).',
      confirmLabel: 'Delete puzzle',
    });
    if (!sure) return;
    try {
      await deleteProject(p.id);
      logInfo('puzzle', `Puzzle deleted: ${p.name}`);
      go('home');
    } catch (err) {
      logError('puzzle', 'The puzzle could not be deleted', err);
      setError(errorWords(err));
    }
  };

  /** After deleting or restoring: the puzzle (size), piece count and bin as stored now. */
  const reloadScan = async () => {
    counting.current++;
    try {
      const [np, c, b] = await Promise.all([getProject(p.id), countPiecesByStatus(p.id), scanBinSummary(p.id)]);
      if (!mounted.current) return;
      if (np) setProject(np);
      setPieces(c.all);
      setMissingN(c.missing);
      setTrayN(c.tray);
      setTableN(c.table);
      setPendingN(c.pending);
      setPlacedN(c.placed);
      setAsideN(c.aside);
      setBin(b);
    } finally {
      counting.current--;
    }
  };

  // A new batch (M7): the pieces on the table are set aside; the next photo starts a fresh table.
  const onNewBatch = async (thenScan: boolean) => {
    setScanBusy(true);
    try {
      const r = await startNewBatch(p.id);
      logInfo('puzzle', `Batch ${r.project.batch!.n} started: ${r.aside} pieces set aside`);
      if (thenScan) {
        go('scan', p.id);
        return;
      }
      await reloadScan();
      setScanNote(`Batch ${r.project.batch!.n} started: ${plural(r.aside, 'piece')} set aside. Spread the new pieces and tap Scan (at the bottom).`);
    } catch (err) {
      logError('puzzle', 'The new batch could not be started', err);
      setError(errorWords(err));
    }
    if (mounted.current) setScanBusy(false);
  };

  const onDeleteScan = async (thenScan: boolean) => {
    setScanBusy(true);
    try {
      const n = await deleteScan(p.id);
      logInfo('puzzle', `Scan deleted (moved to the bin): ${n} pieces`);
      if (thenScan) {
        go('scan', p.id);
        return;
      }
      await reloadScan();
      setScanNote(`${plural(n, 'piece')} moved to the bin. Tap "Restore" to bring ${n === 1 ? 'it' : 'them'} back.`);
    } catch (err) {
      logError('puzzle', 'The scan could not be deleted', err);
      setError(errorWords(err));
    }
    if (mounted.current) setScanBusy(false);
  };

  const onRestoreScan = async () => {
    setScanBusy(true);
    try {
      const swapped = (pieces ?? 0) > 0;
      const n = await restoreScan(p.id);
      logInfo('puzzle', `Scan restored from the bin: ${n} pieces${swapped ? ' (the newer scan went to the bin)' : ''}`);
      await reloadScan();
      setScanNote(swapped ? `${plural(n, 'piece')} restored. The newer scan is now in the bin.` : `${plural(n, 'piece')} restored.`);
    } catch (err) {
      logError('puzzle', 'The scan could not be restored', err);
      setError(errorWords(err));
    }
    if (mounted.current) setScanBusy(false);
  };

  const setupDone = p.setupStep >= LAST_SETUP_STEP;
  const lastBackupWords = p.lastBackup
    ? `Last backup: ${new Date(p.lastBackup.at).toLocaleString()} (${plural(p.lastBackup.pieces, 'piece')} then).`
    : 'No backup of this puzzle has left this iPhone yet.';
  const askRestore = () => (setScanNote(null), (pieces ?? 0) > 0 ? setScanAsk('restore') : void onRestoreScan());
  return (
    <main class="screen" data-testid="puzzle-screen">
      <NavBar title={p.name} back={HOME_BACK} />

      {error && (
        <Callout kind="bad" icon={<Icon name="alert-triangle" />} role="alert" testId="puzzle-error">
          {error}
        </Callout>
      )}

      <div class="box-thumb-large">
        {thumb ? (
          <img src={thumb} alt="Your box picture" data-testid="puzzle-box" />
        ) : (
          <div class="box-thumb-empty muted">{p.box ? 'Loading picture…' : 'No box picture yet'}</div>
        )}
      </div>

      <div class="card">
        <dl class="kv">
          <dt>Name</dt>
          <dd>
            {renaming === null ? (
              <span class="row" style={{ gap: '8px' }}>
                <span data-testid="puzzle-name">{p.name}</span>
                <button class="btn btn-small" data-testid="rename" onClick={() => setRenaming(p.name)}>
                  Rename
                </button>
              </span>
            ) : (
              <span class="row" style={{ gap: '8px' }}>
                <input
                  class="text-input"
                  type="text"
                  value={renaming}
                  maxLength={60}
                  data-testid="rename-input"
                  onInput={(e) => setRenaming((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => e.key === 'Enter' && void saveName()}
                />
                <button class="btn btn-small btn-filled" data-testid="rename-save" onClick={() => void saveName()}>
                  Save
                </button>
              </span>
            )}
          </dd>
          <dt>Pieces on the box</dt>
          <dd data-testid="puzzle-count">{p.pieceCount || '—'}</dd>
          <dt>Grid</dt>
          <dd data-testid="puzzle-grid">
            {p.grid ? `${p.grid.cols} across × ${p.grid.rows} down (${plural(p.grid.cols * p.grid.rows, 'piece')})` : 'Not chosen yet'}
          </dd>
          <dt>Pieces read</dt>
          <dd data-testid="puzzle-pieces">
            {pieces === null ? '—' : pieces}
            {pieces !== null && (trayN > 0 || missingN > 0 || placedN > 0 || asideN > 0) && (
              <span class="muted small" data-testid="puzzle-status-counts">
                {': '}
                {[
                  `${tableN} on the table`,
                  missingN > 0 ? `${missingN} no longer seen at ${missingN === 1 ? 'its' : 'their'} spot` : '',
                  trayN > 0 ? `${trayN} in trays` : '',
                  placedN > 0 ? `${placedN} in the puzzle` : '',
                  asideN > 0 ? `${asideN} set aside` : '',
                ]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            )}
            {(p.batch?.n ?? 1) > 1 && (
              <div class="muted small" data-testid="puzzle-batch">
                Batch {p.batch!.n}
              </div>
            )}
            {p.piecePitch && (
              <div class="muted small" data-testid="puzzle-size">
                Measured piece size {p.scaleSource === 'estimate' ? '≈ ' : ''}
                {p.piecePitch.wMm.toFixed(1)} × {p.piecePitch.hMm.toFixed(1)} mm
                {p.grid
                  ? ` → finished puzzle ≈ ${Math.round((p.grid.cols * p.piecePitch.wMm) / 10)} × ${Math.round((p.grid.rows * p.piecePitch.hMm) / 10)} cm`
                  : ''}
                {p.scaleSource === 'estimate'
                  ? ' (estimated from a typical piece; put a coin next to the pieces in the next overview for true sizes)'
                  : p.scaleSource === 'coin'
                    ? ' (measured with your coin)'
                    : ''}
              </div>
            )}
            {!canScan(p) && <div class="muted small">Reading pieces starts after the set-up.</div>}
          </dd>
        </dl>
      </div>

      {reminder && (
        <Callout
          kind="warn"
          icon={<Icon name="save" />}
          role="status"
          testId="backup-reminder"
          title={
            reminder.never
              ? 'No backup yet.'
              : `Last backup ${reminder.days === 0 ? 'today' : reminder.days === 1 ? 'yesterday' : `${reminder.days} days ago`}.`
          }
        >
          <p>
            {reminder.never ? (
              <>Everything about this puzzle is only on this iPhone ({plural(pieces ?? 0, 'piece')} read).</>
            ) : (
              <>
                Since then{' '}
                {[
                  reminder.pieces ? `${reminder.pieces} ${reminder.pieces === 1 ? 'piece' : 'pieces'} read or changed` : '',
                  reminder.answers ? `${reminder.answers} ${reminder.answers === 1 ? 'answer' : 'answers'}` : '',
                ]
                  .filter(Boolean)
                  .join(' and ')}
                .
              </>
            )}
          </p>
          <div class="callout-buttons">
            <button
              class="btn btn-filled btn-small"
              data-testid="backup-now"
              onClick={() => {
                document
                  .getElementById('backup')
                  ?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
                if (exp.kind !== 'ready' && exp.kind !== 'preparing') void prepareBackup();
              }}
            >
              Back up now
            </button>
            <button
              class="btn btn-small"
              data-testid="backup-later"
              onClick={() =>
                void snoozeBackupReminder(p.id)
                  .then(setProject)
                  .catch((err) => logError('backup', 'The reminder could not be put off', err))
              }
            >
              Not now
            </button>
          </div>
        </Callout>
      )}

      {setupDone ? (
        <p class="small muted setup-finished" data-testid="setup-finished">
          <Icon name="check" size={20} class="inline-icon" /> Set-up finished
        </p>
      ) : (
        <>
          <h2>Set-up</h2>
          <ol class="setup-progress" data-testid="setup-progress">
            {setupSteps(p)
              .slice(1)
              .map((label, i) => {
                const step = i + 1;
                const state = p.setupStep > step ? 'done' : p.setupStep === step ? 'current' : 'todo';
                return (
                  <li key={step} class={`setup-${state}`}>
                    <span class="setup-mark" aria-hidden="true">
                      {state === 'done' ? <Icon name="check" size={18} /> : step}
                    </span>
                    <span>{label}</span>
                  </li>
                );
              })}
          </ol>
          <button class="btn btn-filled btn-block" data-testid="continue-setup" onClick={() => go('new', p.id)}>
            Continue set-up
          </button>
        </>
      )}

      {canScan(p) && (
        <>
          <h2>Pieces</h2>
          {/* Scan pieces is in the action bar at the bottom (M9 part 1); until the counts arrive, alone. */}
          {pieces === null && (
            <ActionBar>
              <ScanAction onScan={() => go('scan', p.id)} />
            </ActionBar>
          )}
          {/* Once the counts are known, so it reads the pieces once on opening, not again when they arrive. */}
          {pieces !== null && (
            <Catalog
              onScan={() => go('scan', p.id)}
              projectId={p.id}
              version={`${pieces}|${trayN}|${tableN}|${pendingN}`}
              markers={p.tracking === 'markers'}
              grid={p.grid}
              pitch={p.piecePitch}
              project={p}
              onProject={setProject}
              onPiecesChanged={() => void reloadScan().catch((err) => logError('puzzle', 'The piece counts could not be read', err))}
              onReading={listReading}
            />
          )}
          {scanNote && (
            <Callout kind="good" icon={<Icon name="check" />} role="status" testId="scan-bin-note">
              {scanNote}
            </Callout>
          )}
          {(tableN > 0 || (pieces ?? 0) > 0 || bin) && (
            <ListSection header="Scanned pieces">
              {tableN > 0 && (
                <ListRow
                  icon={<Icon name="refresh" />}
                  tone="accent"
                  title="Start a new batch…"
                  subtitle="For a new lot of pieces on the table"
                  disabled={scanBusy}
                  onClick={() => (setScanNote(null), setScanAsk('batch'))}
                  testId="new-batch"
                />
              )}
              {bin && (
                <ListRow
                  icon={<Icon name="undo" />}
                  tone="accent"
                  title="Restore the earlier scan"
                  subtitle={
                    <span data-testid="scan-bin">
                      In the bin: {bin.pieces} {bin.pieces === 1 ? 'piece' : 'pieces'} and {bin.photos} {bin.photos === 1 ? 'photo' : 'photos'} (deleted{' '}
                      {new Date(bin.ts).toLocaleString()})
                    </span>
                  }
                  disabled={scanBusy}
                  onClick={askRestore}
                  testId="restore-scan"
                />
              )}
              {(pieces ?? 0) > 0 && (
                <ListRow
                  icon={<Icon name="trash" />}
                  tone="bad"
                  title="Delete scanned pieces…"
                  destructive
                  disabled={scanBusy}
                  onClick={() => (setScanNote(null), setScanAsk('delete'))}
                  testId="delete-scan"
                />
              )}
            </ListSection>
          )}
          <Sheet open={scanAsk === 'batch'} onClose={() => setScanAsk('none')} title="Start a new batch?" detent="large" testId="new-batch-confirm">
            <p>
              <strong>A new batch</strong> is for when you've put the pieces back in the box (or swept them together) and spread out a new lot. Easier, if
              there's room: leave the leftovers where they are, spread the new pieces around them and scan as usual. Then every piece is recognised by where it
              lies, and you don't need a new batch.
            </p>
            <ul class="small">
              <li>
                The <strong>{tableN}</strong> {tableN === 1 ? 'piece' : 'pieces'} on the table {tableN === 1 ? 'is' : 'are'} set aside (kept in the list as "set
                aside").
              </li>
              <li>Pieces in the puzzle and in trays stay where they are.</li>
              <li>The next photo starts a fresh table.</li>
              <li>
                If you spread some of the set-aside pieces out again, they're read as new pieces: the app can't reliably tell hundreds of pieces apart by their
                picture alone.
              </li>
            </ul>
            <div class="sheet-buttons">
              <button class="btn btn-filled btn-block" data-testid="new-batch-scan" onClick={() => (setScanAsk('none'), void onNewBatch(true))}>
                <Icon name="camera" size={20} /> Start and scan
              </button>
              <button class="btn btn-block" data-testid="new-batch-yes" onClick={() => (setScanAsk('none'), void onNewBatch(false))}>
                Start
              </button>
              <button class="btn btn-plain btn-block" onClick={() => setScanAsk('none')}>
                Cancel
              </button>
            </div>
          </Sheet>
          <ActionSheet
            open={scanAsk === 'delete'}
            onClose={() => setScanAsk('none')}
            testId="delete-scan-confirm"
            title={`Delete the ${plural(pieces ?? 0, 'piece')} read so far?`}
            message={
              <>
                They go to the bin with their photos, so you can restore them later. The box picture and grid stay.
                {bin ? ` The older scan in the bin (${plural(bin.pieces, 'piece')}) is replaced.` : ''}
              </>
            }
            actions={[
              { label: 'Delete and scan again', destructive: true, run: () => void onDeleteScan(true), testId: 'delete-scan-rescan' },
              { label: 'Delete pieces', destructive: true, run: () => void onDeleteScan(false), testId: 'delete-scan-yes' },
            ]}
          />
          <ActionSheet
            open={scanAsk === 'restore'}
            onClose={() => setScanAsk('none')}
            testId="restore-scan-confirm"
            title="Swap the scans?"
            message={`Restoring swaps the scans: the ${plural(pieces ?? 0, 'piece')} you have now go to the bin (two scans can't be mixed, because each one measures the table its own way).`}
            actions={[{ label: 'Swap and restore', run: () => void onRestoreScan(), testId: 'restore-scan-yes' }]}
          />
        </>
      )}

      <h2 id="backup" class="section-title">
        <Icon name="save" class="section-icon" /> Backup
      </h2>
      <p class="muted small">
        One file with this puzzle, its pieces, photos and answers. Keep it in Files or send it to your Mac, so the puzzle is never lost if something happens to
        this iPhone.
      </p>
      <p class="small" data-testid="last-backup">
        {lastBackupWords}
      </p>
      {exp.kind !== 'ready' && (
        <button class="btn btn-block" data-testid="export-backup" disabled={exp.kind === 'preparing'} onClick={() => void prepareBackup()}>
          {exp.kind === 'preparing' ? 'Preparing backup…' : 'Export backup'}
        </button>
      )}
      {exp.kind === 'error' && (
        <Callout kind="bad" icon={<Icon name="alert-triangle" />} role="alert" testId="export-error">
          The backup couldn't be prepared: {exp.message}
        </Callout>
      )}
      {exp.kind === 'ready' && (
        <>
          <Callout kind="good" icon={<Icon name="check" />} title="Backup ready" testId="export-ready">
            {exp.file.name} · {formatBytes(exp.file.size)}
          </Callout>
          <button class="btn btn-filled btn-block" data-testid="share-backup" disabled={share === 'sharing'} onClick={onShare}>
            <Icon name="share" size={20} /> Share backup
          </button>
          {!canShareFile(exp.file) && share === 'none' && <p class="muted small">This browser can't open the Share menu for files. Use "Download instead".</p>}
          {share === 'shared' && (
            <Callout kind="good" icon={<Icon name="check" />} role="status">
              Sent
            </Callout>
          )}
          {share === 'fallback' && (
            <Callout kind="warn" icon={<Icon name="alert-triangle" />} role="alert">
              The Share menu didn't open. Tap <strong>Download backup</strong>: the file goes to the Files app, in Downloads.
            </Callout>
          )}
          <div class="row" style={{ marginTop: '10px' }}>
            <a
              class={share === 'fallback' ? 'btn btn-filled btn-block' : 'btn btn-small'}
              data-testid="download-backup"
              href={exp.url}
              download={exp.file.name}
              onClick={() => {
                logInfo('backup', 'Backup downloaded');
                void backedUp();
              }}
            >
              <Icon name="download" size={20} /> {share === 'fallback' ? 'Download backup' : 'Download instead'}
            </a>
          </div>
        </>
      )}

      <ListSection>
        <ListRow icon={<Icon name="trash" />} tone="bad" title="Delete this puzzle…" destructive onClick={() => void onDelete()} testId="delete-puzzle" />
      </ListSection>
    </main>
  );
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

const SHOW_MAX = 200;
const GROUP_LABEL: Record<'all' | 'border' | 'interior' | 'unsure', string> = { all: 'All', border: 'Border', interior: 'Inside', unsure: 'Not sure' };

/** The pieces on the table, with Border mode: corners (orange) and edges (teal) read from each piece's outline. */
function Catalog({
  onScan,
  projectId,
  version,
  markers,
  grid,
  pitch,
  project,
  onProject,
  onPiecesChanged,
  onReading,
}: {
  /** Opens the scan camera (from the action bar). */
  onScan: () => void;
  projectId: string;
  version: unknown;
  markers: boolean;
  grid: Project['grid'];
  pitch: Project['piecePitch'];
  project: Project;
  onProject: (p: Project) => void;
  onPiecesChanged: () => void;
  /** Every piece being read (from the time given), so the page can use the same read. */
  onReading?: (rows: Promise<PieceRow[]>, at: number) => void;
}) {
  const [rows, setRows] = useState<PieceRow[]>([]);
  const [allRows, setAllRows] = useState<PieceRow[]>([]);
  const [traysOpen, setTraysOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [trayGroup, setTrayGroup] = useState<number | null>(null);
  const [show, setShow] = useState<'all' | 'border' | 'interior' | 'unsure'>('all');
  const [places, setPlaces] = useState<PlacementCache | null>(null);
  const [placing, setPlacing] = useState<{ done: number; total: number } | null>(null);
  /**
   * The piece card (M9 part 3): which piece, where it was opened from (the live view: no "Point it out"), the
   * spot to show first (from Fill a spot), and a count so each opening starts afresh. Kept while it slides away.
   */
  const [card, setCard] = useState<{ id: string; from: 'grid' | 'live' | 'photo' | 'fill'; at: { col: number; row: number } | null; n: number } | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const selected = cardOpen ? (card?.id ?? null) : null;
  /**
   * "Placed at 18·7" with Undo, after It fits (M9 part 2: a toast, was a note in the page; M9 part 3: these words).
   * An answer given in a live view waits here until the live view closes (it has its own Undo meanwhile).
   */
  const placedLater = useRef<{ id: string; col: number; row: number } | null>(null);
  const placedToast = useRef<{ id: string; close: () => void } | null>(null);
  const [inPuzzleOpen, setInPuzzleOpen] = useState(false);
  const [matchesOpen, setMatchesOpen] = useState(false);
  /**
   * Pieces to point out in the live view, with lines between those that join (M6); `back`: a piece card's
   * "Point it out" (M9 part 3), whose card opens again when the live view closes.
   */
  const [findLive, setFindLive] = useState<{ ids: string[]; lines: MatchLine[]; back?: string } | null>(null);
  /** What a new puzzle photo changed (M7 part 4): spots filled since the last one, and the pieces marked as in the puzzle. */
  const [photoPlaced, setPhotoPlaced] = useState<{ filled: number; ids: string[] } | null>(null);
  const boxUrl = useBlobUrl(project.box?.rectifiedBlobId, boxVersion(project.box));
  const placeKey = placeKeyOf(project);
  useEffect(() => {
    let live = true;
    void (async () => {
      const at = performance.now();
      const reading = db().pieces.where('projectId').equals(projectId).toArray();
      onReading?.(reading, at);
      const everything = await reading;
      // Pieces to check (M5 part 3) are on the table too.
      const ps = everything.filter((q) => q.status === 'table' || q.status === 'pending');
      if (!live) return;
      setRows(ps);
      setAllRows(everything);
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
  }, [projectId, version, placeKey]);
  // Fits / Doesn't fit (M5 part 2): taken spots, ruled-out spots, and placed pieces' knobs.
  const answersCtx = useMemo(() => ({ view: answerView(project), placed: placedPieces(allRows) }), [project.answers, project.grid, allRows]);
  const shownPlaces = useMemo(() => shownPlacements(places, allRows.filter(unplacedStatus), answersCtx), [places, allRows, answersCtx]);
  const openCells = places?.open?.cells.length ? places.open.cells.filter(([c, r]) => !answersCtx.view.taken.has(`${c},${r}`)) : null;
  const inPuzzle = allRows.filter((r) => r.status === 'placed').length;
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
  const answer = (piece: PieceRow, spot: { col: number; row: number; rot: 0 | 1 | 2 | 3 }, fits: boolean, from: 'piece' | 'fill' | 'live') => {
    void answerSpot(projectId, piece, spot, fits, shownPlaces.get(piece.id) ?? null, from)
      .then((next) => {
        logInfo('answer', `${fits ? 'Fits' : "Doesn't fit"}: piece at column ${spot.col + 1}, row ${spot.row + 1} (from ${from})`);
        onProject(next);
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
                  .then(onProject)
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
      onProject(next);
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
    (fits ? takeOut(p.id) : undoAnswer(projectId, p.id, false).then(onProject)).then(() =>
      logInfo('answer', `Undone in the live view: ${fits ? 'Fits' : "Doesn't fit"}`),
    );
  /**
   * Opens a piece's card (M9 part 3: a sheet over the page; it was a panel below the pieces that had to be
   * scrolled into view, and a quick tap after that scroll could land on the wrong button: see PieceCard).
   */
  const pick = (id: string, from: 'grid' | 'live' | 'photo' | 'fill' = 'grid', at: { col: number; row: number } | null = null) => {
    setCard((c) => ({ id, from, at, n: (c?.n ?? 0) + 1 }));
    setCardOpen(true);
  };
  /** A panel opened from the action bar, brought into view once drawn (counted, so each tap asks once). */
  const [panelView, setPanelView] = useState<{ id: string; n: number } | null>(null);
  useLayoutEffect(() => {
    if (panelView) document.getElementById(panelView.id)?.scrollIntoView({ block: 'start' });
  }, [panelView]);
  const openPanel = (id: string, open: boolean, set: (on: boolean) => void) => {
    set(!open);
    if (!open) setPanelView((v) => ({ id, n: (v?.n ?? 0) + 1 }));
  };
  const bestSpot = (p: PieceRow) => {
    const t = shownPlaces.get(p.id)?.placement.top[0];
    return t ? { col: t.col, row: t.row, rot: t.rot } : null;
  };
  // Trays by colour (M4): read only when the owner opens it.
  const { groups: colourGroups, uneven } = useColourGroups(traysOpen, project, allRows);
  const cell: [number, number] | null = pitch ? [pitch.wMm, pitch.hMm] : null;
  const groups = useMemo(() => new Map(rows.map((r) => [r.id, pieceGroup(r, cell)])), [rows, cell?.[0], cell?.[1]]);
  const unplaced = useMemo(() => allRows.filter(unplacedStatus), [allRows]);
  // Each piece's state (found / shape read / spot known) and frame side, for the table view and the progress line.
  const states = useMemo(() => new Map(rows.map((r) => [r.id, pieceState(groups.get(r.id) !== 'unsure', shownPlaces.get(r.id))])), [rows, groups, shownPlaces]);
  const sideOf = (id: string): FrameSide | null => (grid ? pieceSide(shownPlaces.get(id), grid) : null);
  const progress = progressCounts([...states.values()]);
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
  // The live view and "Show my table" (opened from the action bar and the list of tools).
  const tableBlock = (
    <>
      {liveOpen && (
        <LiveTable
          projectId={projectId}
          pieces={rows}
          colourOf={(p) => OVERLAY_STATE[states.get(p.id) ?? 'found']}
          labelOf={(p) => spotLabel(shownPlaces.get(p.id))}
          confidenceOf={(p) => {
            const c = shownPlaces.get(p.id);
            return c && c.fits && c.placement.top[0] ? { verdict: c.placement.verdict, p: c.placement.top[0].p } : null;
          }}
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
            pick(p.id, 'live');
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
            // An answer given there gets its toast with Undo now, above the action bar (check 2026-11-10: as a note
            // in the page it was below the screen, out of reach after closing the live view).
            showPlacedLater();
          }}
        />
      )}
      {findLive && (
        <LiveTable
          projectId={projectId}
          pieces={rows}
          colourOf={(p) => (findLive.ids.includes(p.id) ? OVERLAY_STATE.placed : OVERLAY_STATE[states.get(p.id) ?? 'found'])}
          infoOf={infoOf}
          labelOf={(p) => spotLabel(shownPlaces.get(p.id))}
          confidenceOf={(p) => {
            const c = shownPlaces.get(p.id);
            return c && c.fits && c.placement.top[0] ? { verdict: c.placement.verdict, p: c.placement.top[0].p } : null;
          }}
          find={findLive.ids}
          lines={findLive.lines}
          title={findLive.ids.length === 1 ? 'Find this piece' : findLive.ids.length > 2 ? 'Find the 4 pieces' : 'Find the 2 pieces'}
          legend={
            findLive.ids.length === 1 ? (
              <>The pulsing piece is the one from its card. An arrow at the edge shows the way when it is out of view.</>
            ) : (
              <>The pulsing pieces join: the line shows which goes with which. An arrow at the edge shows the way when one is out of view.</>
            )
          }
          onClose={() => {
            const back = findLive.back;
            setFindLive(null);
            // From a piece card's "Point it out": back to its card, to say whether it fits.
            if (back && rows.some((r) => r.id === back)) pick(back, 'live');
          }}
        />
      )}
      {tableOpen && (
        <TablePhoto
          projectId={projectId}
          pieces={rows}
          mode="all"
          colour={OVERLAY_STATE.found}
          colourOf={(p) => OVERLAY_STATE[states.get(p.id) ?? 'found']}
          labelOf={(p) => spotLabel(shownPlaces.get(p.id))}
          confidenceOf={(p) => {
            const c = shownPlaces.get(p.id);
            return c && c.fits && c.placement.top[0] ? { verdict: c.placement.verdict, p: c.placement.top[0].p } : null;
          }}
          infoOf={infoOf}
          onPick={(p) => {
            setTableOpen(false);
            pick(p.id, 'photo');
          }}
          maxPhotos={6}
          title="Your table"
          legend={
            <>
              <span class="state-dot" style={{ background: OVERLAY_STATE.placed }} />
              spot known (column·row) <span class="state-dot" style={{ background: OVERLAY_STATE.shape }} />
              shape read <span class="state-dot" style={{ background: OVERLAY_STATE.found }} />
              found. Tap a piece to zoom in and see where it goes.
            </>
          }
          onClose={() => setTableOpen(false)}
        />
      )}
    </>
  );
  // Fill this spot (M4): from a spot on the box picture to the pieces that may go there.
  const fillBlock =
    project.box && project.grid && boxUrl && places ? (
      <>
        {fillOpen && <PanelHead id="fill-panel" title="Fill this spot" icon="target" testId="fill-close" onClose={() => setFillOpen(false)} />}
        {fillOpen && (
          <FillSpot
            project={project}
            boxUrl={boxUrl}
            shown={shownPlaces}
            spots={openCells}
            pieces={unplaced}
            onAnswer={(p, spot, fits) => answer(p, spot, fits, 'fill')}
            onUndo={undoLiveAnswer}
            onLiveClosed={showPlacedLater}
            filled={new Set(answersCtx.view.taken.keys())}
            onPickPiece={(p, spot) => pick(p.id, 'fill', spot)}
          />
        )}
      </>
    ) : null;
  // Which pieces join (M6).
  const matchesBlock =
    pairs && project.grid ? (
      <>
        {matchesOpen && (
          <PanelHead
            id="matches-panel"
            title={`Which pieces join${pairs.list.pairs.length ? ` (${pairs.list.pairs.length})` : ''}`}
            icon="link"
            testId="matches-close"
            onClose={() => setMatchesOpen(false)}
          />
        )}
        {matchesOpen && (
          <MatchesPanel
            project={project}
            boxUrl={boxUrl}
            list={pairs.list}
            pieces={allRows}
            joined={[...pairView.joined].map(([key, a]) => ({ key, a: a.a, b: a.b }))}
            onFind={(ids, ps) =>
              setFindLive({
                ids,
                lines: ps.map(([a, b]) => ({ a, b, label: '', confirmed: ids.length > 2 })),
              })
            }
            onAnswer={async (ss, fits, confirmed) => {
              let next = project;
              for (const sp of ss) next = await answerPair(projectId, sp, fits, confirmed, 'matches');
              logInfo(
                'pairs',
                `${fits ? 'They fit' : "Don't fit"}: ${ss.length} pair${ss.length === 1 ? '' : 's'} (${ss.map((sp) => pct(sp.p)).join(', ')} %${confirmed ? ', square ✓' : ''})`,
              );
              onProject(next);
            }}
            onUndo={async (keys) => {
              let next = project;
              for (const k of keys) next = await undoPairAnswer(projectId, k);
              onProject(next);
            }}
          />
        )}
      </>
    ) : null;
  // Sort into trays: a row that opens its panel under the list (it filters the pieces below).
  const traysRow = (
    <li>
      <button
        type="button"
        class={`list-row has-icon is-action${traysOpen ? ' is-open' : ''}`}
        aria-expanded={traysOpen}
        data-testid="trays-toggle"
        onClick={() => (setTraysOpen(!traysOpen), setTrayGroup(null))}
      >
        <span class="list-icon list-icon-accent" aria-hidden="true">
          <Icon name="inbox" />
        </span>
        <span class="list-title">Sort into trays by colour</span>
        <Icon name="chevron-down" size={20} class="list-disclosure" />
      </button>
    </li>
  );
  const traysPanel = (
    <>
      {traysOpen && (
        <TraysPanel
          project={project}
          all={allRows}
          table={rows}
          groups={colourGroups}
          uneven={uneven}
          selected={trayGroup}
          onSelect={setTrayGroup}
          onChanged={(np) => (np ? onProject(np) : onPiecesChanged())}
        />
      )}
    </>
  );
  // The main actions, always at hand at the bottom of the screen (M9 part 1, until the puzzle tabs).
  const bar = (
    <ActionBar>
      <ScanAction onScan={onScan} />
      {rows.length > 0 && (
        <button class="action-bar-btn" data-testid="live-toggle" onClick={() => setLiveOpen(true)}>
          <span class="action-bar-icon" aria-hidden="true">
            <Icon name="scan-eye" />
          </span>
          <span class="action-bar-label">Live view</span>
        </button>
      )}
      {fillBlock && (
        <button
          class="action-bar-btn"
          aria-expanded={fillOpen}
          aria-controls="fill-panel"
          data-testid="fill-toggle"
          onClick={() => openPanel('fill-panel', fillOpen, setFillOpen)}
        >
          <span class="action-bar-icon" aria-hidden="true">
            <Icon name="target" />
          </span>
          <span class="action-bar-label">Fill a spot</span>
        </button>
      )}
      {rows.length > 0 && matchesBlock && (
        <button
          class="action-bar-btn"
          aria-expanded={matchesOpen}
          aria-controls="matches-panel"
          data-testid="matches-toggle"
          onClick={() => openPanel('matches-panel', matchesOpen, setMatchesOpen)}
        >
          <span class="action-bar-icon" aria-hidden="true">
            <Icon name="link" />
          </span>
          <span class="action-bar-label">Joins</span>
          {pairs!.list.pairs.length > 0 && (
            // The count as a badge, so it isn't cut off on a narrow phone (check 2026-11-10: "Joins (3…").
            <span class="action-bar-badge" data-testid="matches-count">
              {pairs!.list.pairs.length}
            </span>
          )}
        </button>
      )}
    </ActionBar>
  );
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
            .then(onProject)
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
              onProject(next);
              onPiecesChanged();
              toast({
                text: 'Removed. Take it off the table too.',
                action: {
                  label: 'Undo',
                  run: () =>
                    void restoreNotAPiece(projectId, id)
                      .then((back) => {
                        logInfo('answer', 'Not a piece: undone, the piece is back');
                        onProject(back);
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
  if (!rows.length)
    return allRows.some((q) => q.status === 'tray') ? (
      <div>
        <p class="muted small">All your scanned pieces are in trays.</p>
        {fillBlock}
        {cardBlock}
        <ListSection>{traysRow}</ListSection>
        {traysPanel}
        {bar}
      </div>
    ) : (
      <>
        <p class="muted small" data-testid="catalog-empty">
          {allRows.length ? 'No pieces on the table now.' : 'No pieces yet.'} Spread pieces face up{' '}
          {markers ? 'inside the markers' : 'on the table, with small gaps'} and tap Scan.
        </p>
        {bar}
      </>
    );
  const n = { corner: 0, edge: 0, interior: 0, unsure: 0 };
  for (const g of groups.values()) n[g]++;
  const count = { all: rows.length, border: n.corner + n.edge, interior: n.interior, unsure: n.unsure };
  const want = borderCounts(grid ?? { cols: 0, rows: 0 });
  const tooMany = grid && (n.corner > want.corners || n.edge > want.edges);
  if (show === 'unsure' && !count.unsure) setShow('all');
  const sideCounts = new Map<FrameSide, number>();
  for (const r of rows) {
    const s = sideOf(r.id);
    if (s) sideCounts.set(s, (sideCounts.get(s) ?? 0) + 1);
  }
  const trayOf = (id: string) => (traysOpen && colourGroups ? colourGroups.of.get(id) : undefined);
  const shown = rows
    .filter((r) => {
      const g = groups.get(r.id)!;
      if (traysOpen && trayGroup !== null && trayOf(r.id)?.group !== trayGroup) return false;
      return show === 'all' || (show === 'border' ? g === 'corner' || g === 'edge' : g === show);
    })
    // Border view: corners first.
    .sort((a, b) => (show === 'border' ? Number(groups.get(b.id) === 'corner') - Number(groups.get(a.id) === 'corner') : 0));
  return (
    <div>
      {bar}
      <div class="page-filter catalog-groups" role="group" aria-label="Show pieces" data-testid="catalog-groups">
        {/* "Not sure" only when there is something not sure. */}
        {(['all', 'border', 'interior', 'unsure'] as const)
          .filter((k) => k !== 'unsure' || count.unsure > 0)
          .map((k) => (
            <button key={k} class="page-filter-btn" aria-pressed={show === k} data-testid={`group-${k}`} onClick={() => setShow(k)}>
              {GROUP_LABEL[k]} <span class="page-filter-count">{count[k]}</span>
            </button>
          ))}
      </div>
      <p class="small" data-testid="progress">
        <span class="state-dot state-found" />
        {progress.found} found · <span class="state-dot state-shape" />
        {progress.shape} shapes read · <span class="state-dot state-placed" />
        {progress.placed} placed on box
        {inPuzzle > 0 && (
          <>
            {' · '}
            <button class="link-btn" data-testid="in-puzzle" aria-expanded={inPuzzleOpen} onClick={() => setInPuzzleOpen(!inPuzzleOpen)}>
              <Icon name="check" size={18} class="inline-icon" /> {inPuzzle} in the puzzle
            </button>
          </>
        )}
      </p>
      {inPuzzleOpen && inPuzzle > 0 && (
        <div class="card in-puzzle-list" data-testid="in-puzzle-list">
          <p class="small muted">Pieces you said fit. Tapped “It fits” by mistake? Take it out: it goes back on the table (or into its tray).</p>
          {allRows
            .filter((r) => r.status === 'placed')
            .sort((a, b) => (b.placedAt?.at ?? 0) - (a.placedAt?.at ?? 0))
            .map((r) => (
              <InPuzzleRow
                key={r.id}
                piece={r}
                onTakeOut={() => void takeOut(r.id).catch((err) => logError('answer', 'Could not take the piece out again', err))}
              />
            ))}
        </div>
      )}
      {allRows.some((r) => r.status === 'pending') && (
        <PendingPanel
          projectId={projectId}
          rows={allRows}
          onDone={() => {
            onPiecesChanged();
          }}
        />
      )}
      {photoPlaced && (
        <Callout kind="good" icon={<Icon name="camera" />} role="status" testId="photo-placed">
          <p>
            Your new photo of the puzzle: <strong>{photoPlaced.filled}</strong> {photoPlaced.filled === 1 ? 'spot' : 'spots'} filled since the last one.{' '}
            {photoPlaced.ids.length
              ? `${photoPlaced.ids.length === 1 ? 'The piece the app had for it is' : `The ${photoPlaced.ids.length} pieces the app had for them are`} now counted as in the puzzle.`
              : 'The app wasn’t sure which pieces went there, so none were marked.'}
          </p>
          <div class="callout-buttons">
            {photoPlaced.ids.length > 0 && (
              <button
                class="btn btn-small"
                data-testid="photo-placed-undo"
                onClick={() =>
                  void (async () => {
                    let next = project;
                    for (const pid of photoPlaced.ids) next = await undoFits(projectId, pid);
                    onProject(next);
                    setPhotoPlaced(null);
                    onPiecesChanged();
                  })().catch((err) => logError('place', 'Could not take the pieces out again', err))
                }
              >
                Undo
              </button>
            )}
            <button class="btn btn-small" onClick={() => setPhotoPlaced(null)}>
              OK
            </button>
          </div>
        </Callout>
      )}
      {boxUrl && project.grid && <TableContrast project={project} pieces={allRows} boxUrl={boxUrl} />}
      {show === 'border' && (
        <p class="small" data-testid="border-counts">
          <span class="legend-corner">Corners {grid ? `${n.corner} of ${want.corners}` : n.corner}</span> ·{' '}
          <span class="legend-edge">Edges {grid ? `${n.edge} of ${want.edges}` : n.edge}</span>
          {n.unsure ? <span class="muted"> · {n.unsure} not sure yet (a close-up helps)</span> : null}
          {sideCounts.size > 0 && (
            <span data-testid="side-counts">
              <br />
              Side of the frame known: {[...sideCounts].map(([s, k]) => `${SIDE_ARROW[s]} ${k}`).join(' · ')}
            </span>
          )}
        </p>
      )}
      {tooMany && (
        <Callout kind="warn" icon={<Icon name="alert-triangle" />} testId="border-warning">
          More {n.corner > want.corners ? 'corner' : 'edge'} pieces than a {grid!.cols} × {grid!.rows} puzzle has: some shapes were misread, or the grid may be
          wrong. Check?
        </Callout>
      )}
      {project.box && (
        <PlaceSummary
          shown={shownPlaces}
          open={places?.open ?? null}
          hasSpots={Boolean(project.openSpots)}
          rows={rows}
          placing={placing}
          learned={places?.colour?.affine && places.learned?.n ? places.learned.n : 0}
          onWholePicture={() => {
            void updateProject(projectId, { openSpots: null })
              .then(onProject)
              .catch((err) => logError('place', 'Could not switch to the whole picture', err));
          }}
        />
      )}
      {project.box && !placing && <BoxFitNotice project={project} shown={shownPlaces} onProject={onProject} />}
      {tableBlock}
      {fillBlock}
      {matchesBlock}
      {/* The page's other tools (M9 part 2: one list instead of a stack of buttons and links). */}
      <ListSection testId="puzzle-tools">
        <ListRow
          icon={<Icon name="map" />}
          tone="accent"
          title="Show my table"
          subtitle="Your last scan photo, labelled"
          onClick={() => setTableOpen(true)}
          chevron
          testId="table-toggle"
        />
        {traysRow}
        {project.grid && (
          <ListRow
            icon={<Icon name="trending-up" />}
            tone="good"
            title="Progress"
            href={`#/progress/${encodeURIComponent(projectId)}`}
            testId="progress-link"
          />
        )}
        {(project.answers?.length ?? 0) + (project.pairAnswers?.length ?? 0) > 0 && (
          <ListRow
            icon={<Icon name="bar-chart" />}
            title="How often is the app right?"
            href={`#/accuracy/${encodeURIComponent(projectId)}`}
            testId="accuracy-link"
          />
        )}
      </ListSection>
      {traysPanel}
      <div class="catalog-grid" data-testid="catalog">
        {shown.slice(0, SHOW_MAX).map((r) => (
          <PieceThumb
            key={r.id}
            piece={r}
            group={groups.get(r.id)!}
            place={shownPlaces.get(r.id)?.placement ?? null}
            selected={selected === r.id}
            onSelect={() => pick(r.id)}
            tray={trayTag(colourGroups, trayOf(r.id))}
            side={sideOf(r.id)}
          />
        ))}
      </div>
      {cardBlock}
      {shown.length > SHOW_MAX && <p class="muted small">…and {shown.length - SHOW_MAX} more.</p>}
    </div>
  );
}

/**
 * Pieces to check (M5 part 3): a rescan saw these where no known piece was, and each may be a piece
 * moved since. The owner says which ("same piece") or that it's a new one.
 */
function PendingPanel({ projectId, rows, onDone }: { projectId: string; rows: PieceRow[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const pending = rows.filter((r) => r.status === 'pending');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const settle = (id: string, into: string | null) =>
    void resolvePending(projectId, id, into)
      .then(() => {
        logInfo('pending', into ? 'A piece to check was the same as a known piece' : 'A piece to check is a new piece');
        onDone();
      })
      .catch((err) => logError('pending', 'Could not settle the piece', err));
  return (
    <div class="callout callout-warn pending-panel" data-testid="pending-panel">
      <span class="callout-icon" aria-hidden="true">
        <Icon name="alert-triangle" />
      </span>
      <div class="callout-body">
        <strong>{pending.length === 1 ? '1 piece to check' : `${pending.length} pieces to check`}</strong>: a rescan saw {pending.length === 1 ? 'it' : 'them'}{' '}
        where no known piece was. Each may be a piece you moved, or a new one.
      </div>
      <button class="btn btn-small callout-action" data-testid="pending-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Check them'}
      </button>
      {open &&
        pending.map((p) => (
          <div class="pending-row" key={p.id} data-testid="pending-row">
            <PendingThumb piece={p} label="Seen now" />
            <span class="small">Same piece as:</span>
            {(p.maybe ?? [])
              .map((id) => byId.get(id))
              .filter((c): c is PieceRow => Boolean(c))
              .map((c) => (
                <button key={c.id} class="btn btn-small pending-choice" data-testid="pending-same" onClick={() => settle(p.id, c.id)}>
                  <PendingThumb piece={c} label={c.status === 'missing' ? 'Missing' : c.status === 'aside' ? 'Set aside' : 'Known'} />
                  This one
                </button>
              ))}
            <button class="btn btn-small" data-testid="pending-new" onClick={() => settle(p.id, null)}>
              A different piece
            </button>
          </div>
        ))}
    </div>
  );
}

function PendingThumb({ piece, label }: { piece: PieceRow; label: string }) {
  const url = useBlobUrl(piece.thumbBlobId, piece.updatedAt);
  return (
    <span class="pending-thumb">
      {url ? <img src={url} alt={label} /> : <span class="catalog-empty" />}
      <span class="tiny muted">{label}</span>
    </span>
  );
}

/** A piece in the puzzle (M5 part 2), with a way to take it out again. */
function InPuzzleRow({ piece, onTakeOut }: { piece: PieceRow; onTakeOut: () => void }) {
  const url = useBlobUrl(piece.thumbBlobId, piece.updatedAt);
  const at = piece.placedAt;
  return (
    <div class="row in-puzzle-row" data-testid="in-puzzle-row">
      {url ? <img src={url} class="spot-thumb" alt="A piece" /> : <span class="spot-thumb" />}
      <span class="grow small">
        {at && at.col >= 0 ? `Column ${at.col + 1}, row ${at.row + 1}` : 'In the puzzle (spot not known)'}
        {at?.by === 'photo' ? ' · from your puzzle photo' : ''}
      </span>
      <button class="btn btn-small" data-testid="take-out" onClick={onTakeOut}>
        Take it out
      </button>
    </div>
  );
}

/** A thumbnail's colour-group badge: the group's letter on its colour, "+B" when it also has a lot of B. */
function trayTag(
  groups: Groups | null,
  of: { group: number; also: number | null } | undefined,
): { letter: string; hex: string; ink: string; also: string | null } | null {
  if (!groups || !of) return null;
  const g = groups.groups[of.group];
  if (!g) return null;
  return { letter: g.letter, hex: g.hex, ink: g.ink, also: of.also !== null ? (groups.groups[of.also]?.letter ?? null) : null };
}

function PieceThumb({
  piece,
  group,
  place,
  onSelect,
  selected,
  tray,
  side,
}: {
  piece: PieceRow;
  group: ShapeGroup;
  place: Placement | null;
  onSelect: () => void;
  selected: boolean;
  tray?: { letter: string; hex: string; ink: string; also: string | null } | null;
  side?: FrameSide | null;
}) {
  const url = useBlobUrl(piece.thumbBlobId, piece.updatedAt);
  const cls = [
    piece.flags.clump ? 'flag-clump' : piece.flags.weak ? 'flag-weak' : '',
    group === 'corner' ? 'kind-corner' : group === 'edge' ? 'kind-edge' : '',
    selected ? 'thumb-selected' : '',
  ]
    .join(' ')
    .trim();
  const title = group === 'corner' ? 'Corner piece' : group === 'edge' ? 'Edge piece' : group === 'interior' ? 'Inside piece' : 'Shape not sure yet';
  return (
    <button class="thumb-btn" onClick={onSelect} data-group={group} data-place={place?.verdict ?? 'none'} aria-label={`${title}: show where it goes`}>
      {url ? <img src={url} class={cls} alt={title} title={title} loading="lazy" /> : <div class={`catalog-empty ${cls}`} title={title} />}
      {place && place.verdict !== 'several' && <span class={`place-dot place-${place.verdict}`} />}
      {piece.status === 'pending' && (
        <span class="pending-tag" title="To check: may be a piece you moved" data-testid="pending-tag">
          ?
        </span>
      )}
      {side && (
        <span class="side-tag" title={SIDE_WORDS[side]} data-testid="side-tag">
          {SIDE_ARROW[side]}
        </span>
      )}
      {tray && (
        <span class="tray-tag" style={{ background: tray.hex, color: tray.ink }} data-testid="tray-tag">
          {tray.letter}
          {tray.also ? `+${tray.also}` : ''}
        </span>
      )}
    </button>
  );
}

/**
 * The bar of main actions fixed at the bottom of the puzzle page, above the Home bar (M9 part 1;
 * it becomes the puzzle's tab bar later). The page leaves room for it below its last line.
 */
function ActionBar({ children }: { children: ComponentChildren }) {
  return (
    <nav class="action-bar" aria-label="Puzzle actions" data-testid="action-bar">
      <div class="action-bar-inner">{children}</div>
    </nav>
  );
}

function ScanAction({ onScan }: { onScan: () => void }) {
  return (
    <button class="action-bar-btn action-bar-primary" data-testid="scan-pieces" onClick={onScan}>
      <span class="action-bar-icon" aria-hidden="true">
        <Icon name="camera" />
      </span>
      <span class="action-bar-label">Scan</span>
    </button>
  );
}

/** The heading of a panel opened from the action bar, with a way to close it where it is. */
function PanelHead({ id, title, icon, testId, onClose }: { id: string; title: string; icon: IconName; testId: string; onClose: () => void }) {
  return (
    <div class="panel-head" id={id}>
      <h3>
        <Icon name={icon} class="section-icon" /> {title}
      </h3>
      <button class="btn btn-small" data-testid={testId} onClick={onClose}>
        Close
      </button>
    </div>
  );
}
/** A chance in whole percent, never shown as a certain 100 %. */
const pct = (p: number): number => Math.min(99, Math.round(p * 100));

/** How many pieces have a spot on the box picture, and progress while placing. */
function PlaceSummary({
  shown,
  open,
  hasSpots,
  rows,
  placing,
  learned = 0,
  onWholePicture,
}: {
  shown: Map<string, SpotChoice>;
  open: PlacementCache['open'];
  hasSpots: boolean;
  rows: PieceRow[];
  placing: { done: number; total: number } | null;
  /** Pieces in the puzzle the colours were learned from (M8), 0 if not. */
  learned?: number;
  onWholePicture: () => void;
}) {
  const n = { strong: 0, likely: 0, several: 0, nofit: 0 };
  for (const r of rows) {
    const c = shown.get(r.id);
    if (!c) continue;
    if (!c.fits) n.nofit++;
    else n[c.placement.verdict]++;
  }
  const none = rows.length - n.strong - n.likely - n.several - n.nofit;
  const spots = open?.cells.length ?? 0;
  const noKnobs = rows.filter((r) => r.patch && !r.patch.sides).length;
  return (
    <>
      {!hasSpots && rows.length > 0 && (
        <p class="small muted" data-testid="open-spots-tip">
          <strong>Most of the puzzle done?</strong> Tap{' '}
          <strong class="nw">
            <Icon name="camera" size={18} class="inline-icon" /> Scan
          </strong>{' '}
          →{' '}
          <strong class="nw">
            <Icon name="image" size={18} class="inline-icon" /> Choose a photo
          </strong>{' '}
          and pick one photo of the whole puzzle with its holes. Your leftover pieces are then matched only to those empty spots, which is far more reliable
          than searching the whole picture.
        </p>
      )}
      {hasSpots && (
        <Callout
          kind="info"
          icon={<Icon name="image" />}
          testId="open-spots"
          action={{ label: 'Use the whole picture instead', onClick: onWholePicture, testId: 'whole-picture' }}
        >
          {open && !spots ? (
            <p>Your finished-puzzle photo doesn’t line up with the box picture (its grid is a different size), so the whole picture is used.</p>
          ) : (
            <p>
              Leftover pieces are matched only to the <strong>{spots || '…'} empty spots</strong> from your finished-puzzle photo, one piece per spot. Put some
              in? Photograph the puzzle again to update the spots.
            </p>
          )}
          {spots > 0 && (!open?.sides || noKnobs > 0) && (
            <p data-testid="knobs-off">
              <strong>Knob shapes not used yet</strong> (read before this version): {!open?.sides ? 'choose your photo of the puzzle with its holes again' : ''}
              {!open?.sides && noKnobs > 0 ? ', then ' : ''}
              {noKnobs > 0
                ? `scan your leftover pieces again (${noKnobs === rows.length ? 'all of them' : `${noKnobs} of them`}: Delete scanned pieces → Delete and scan again)`
                : ''}
              .
            </p>
          )}
        </Callout>
      )}
      <p class="small" data-testid="place-summary">
        {placing ? (
          <span data-testid="placing">
            Finding spots on the box picture… {placing.done} of {placing.total}
          </span>
        ) : (
          <>
            On the box picture: <span class="legend-strong">{n.strong} very likely</span> · <span class="legend-likely">{n.likely} maybe</span> · {n.several}{' '}
            where several places look alike
            {n.nofit > 0 ? <span> · {n.nofit} fit none of the empty spots</span> : null}
            {none > 0 ? <span class="muted"> · {none} not placed yet (scanned before this version: scan again)</span> : null}. Tap a piece to see where it goes.
            {learned > 0 && (
              <span class="muted" data-testid="colours-learned">
                {' '}
                Colours learned from your {plural(learned, 'piece')} in the puzzle.
              </span>
            )}
          </>
        )}
      </p>
    </>
  );
}

/** Lines between pieces that join, at most, in the live view. */
const LIVE_LINES = 6;

/** Pieces can be scanned once set-up is finished (marker-free) or the markers are measured. */
function canScan(p: Project): boolean {
  return p.tracking === 'markers' ? Boolean(p.markerMap) : p.setupStep >= LAST_SETUP_STEP;
}
