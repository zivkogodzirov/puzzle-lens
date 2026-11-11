/**
 * The puzzle's **More** tab (M9 part 4, design plan §4 item 8): one grouped list, as in iPhone Settings.
 *
 * - **Backup:** "Back up now" with when the last backup was; once made, "Share backup" and "Download". When a
 *   backup is due (src/project/backupReminder.ts) the row says why, "Remind me tomorrow" puts it off, the tab
 *   bar shows a dot on More, and opening the puzzle shows a toast "Back up now?" at most once a day
 *   (`backupToastOnce`, called by the shell; its "Back up" opens this tab and starts the backup).
 * - **Pieces:** Start a new lot of pieces (its explanation in a sheet), Removed scans (restore the earlier scan),
 *   Delete scanned pieces (an action sheet).
 * - **Puzzle details:** the box picture, name (tap to rename), piece count, grid, measured piece size, coin, and
 *   the set-up steps with "Continue set-up" until set-up is finished.
 * - How it works (Help), "How often is the app right?" (Tester mode, decision 20), Delete this puzzle (an action sheet).
 *
 * Gets everything from `usePuzzle()` (context.ts); owned by the More tab's builder (PuzzleScreen.tsx explains
 * the contract).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Icon } from '../../ui/icons';
import { Callout } from '../../ui/Callout';
import { ListRow, ListSection } from '../../ui/List';
import { ActionSheet, confirmAction } from '../../ui/ActionSheet';
import { Sheet } from '../../ui/Sheet';
import { toast, currentToast } from '../../ui/toast';
import { go, replaceRoute, routeSub } from '../../router';
import { APP_VERSION } from '../../env';
import { reportWorker } from '../../workers';
import { db } from '../../../db/db';
import { deleteProject, LAST_SETUP_STEP, updateProject } from '../../../project/store';
import { exportBackup, zipHere } from '../../../project/backup';
import { deleteScan, restoreScan } from '../../../project/scans';
import { startNewBatch } from '../../../project/batches';
import { markBackedUp, snoozeBackupReminder, type BackupReminder } from '../../../project/backupReminder';
import { coinById } from '../../../cv/coin';
import { canShareFile, downloadUrl, revokeDownloadUrls, shareOrDownload } from '../../../report/share';
import { formatBytes } from '../../../report/collect';
import { logError, logInfo, logWarn } from '../../../log/logger';
import { settings } from '../../settings';
import { errorWords, plural } from '../../words';
import { setupSteps } from './shared';
import { usePuzzle } from './context';

type ExportPhase = { kind: 'idle' } | { kind: 'preparing' } | { kind: 'ready'; file: File; url: string } | { kind: 'error'; message: string };

/** The puzzle whose backup was asked for from the toast: the More tab starts it as soon as it is open. */
const backupAsked = signal<string | null>(null);

/** The day (local) the "Back up now?" toast last showed for a puzzle: in the database's settings table. */
const toastDayKey = (projectId: string) => `backupToastDay:${projectId}`;

/**
 * The backup reminder as a toast on opening a puzzle, at most once a day per puzzle (design plan §4 item 8),
 * unless the More tab (which shows it) is open. Its "Back up" opens the More tab and starts preparing the backup.
 * Called by the shell (PuzzleScreen.tsx) when a reminder becomes due.
 */
export function backupToastOnce(projectId: string): void {
  // Not over another message (an answer's Undo) or over the live view (review 2026-11-11).
  if (routeSub.value === 'more' || currentToast.value || document.querySelector('.live')) return;
  const today = new Date().toDateString();
  const key = toastDayKey(projectId);
  void db()
    .settings.get(key)
    .then(async (row) => {
      if (row?.value === today || routeSub.value === 'more' || currentToast.value || document.querySelector('.live')) return;
      await db().settings.put({ key, value: today });
      toast({
        text: 'Back up now?',
        action: {
          label: 'Back up',
          run: () => {
            backupAsked.value = projectId;
            replaceRoute('puzzle', projectId, 'more');
            scrollTo(0, 0);
          },
        },
      });
    })
    .catch((err) => logWarn('backup', 'The backup reminder could not be shown', err));
}

/** "11 Nov, 14:02" */
const when = (ts: number) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Why a backup is due, in one line. */
function dueWords(r: BackupReminder, pieces: number): string {
  if (r.never) return `Due: the ${plural(pieces, 'piece')} read so far are only on this iPhone.`;
  const since = [r.pieces ? `${plural(r.pieces, 'piece')} read or changed` : '', r.answers ? plural(r.answers, 'answer') : ''].filter(Boolean).join(' and ');
  return `Due: ${since} since then.`;
}

export function MoreTab() {
  const ctx = usePuzzle();
  const { project: p, counts, bin, reminder, boxUrl, canScan, setProject, setError } = ctx;
  const pieces = counts.all;
  const tableN = counts.table;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [exp, setExp] = useState<ExportPhase>({ kind: 'idle' });
  const [share, setShare] = useState<'none' | 'sharing' | 'shared' | 'fallback'>('none');
  /** Deleting, restoring or a new lot is under way. */
  const [scanBusy, setScanBusy] = useState(false);
  /** The sheet that asks before one of them (M9 part 2: action sheets and a sheet instead of boxes in the page). */
  const [scanAsk, setScanAsk] = useState<'none' | 'delete' | 'restore' | 'batch'>('none');
  const [scanNote, setScanNote] = useState<string | null>(null);
  const mounted = useRef(true);
  const renameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revokeDownloadUrls();
    };
  }, []);
  useEffect(() => {
    if (renaming !== null) renameInput.current?.focus();
  }, [renaming !== null]);

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

  // "Back up" in the toast: start at once (also when this tab was already open).
  const asked = backupAsked.value;
  useEffect(() => {
    if (asked !== p.id) return;
    backupAsked.value = null;
    if (exp.kind !== 'ready' && exp.kind !== 'preparing') void prepareBackup();
  }, [asked]);

  // The backup has left the app: the reminder starts counting again from now.
  const backedUp = async () => {
    try {
      const next = await markBackedUp(p.id);
      setProject(next);
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

  const snooze = () =>
    void snoozeBackupReminder(p.id)
      .then(setProject)
      .catch((err) => logError('backup', 'The reminder could not be put off', err));

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
      void db()
        .settings.delete(toastDayKey(p.id))
        .catch(() => {});
      logInfo('puzzle', `Puzzle deleted: ${p.name}`);
      go('home');
    } catch (err) {
      logError('puzzle', 'The puzzle could not be deleted', err);
      setError(errorWords(err));
    }
  };

  // A new lot of pieces (M7 "batch"): the pieces on the table are set aside; the next photo starts a fresh table.
  const onNewBatch = async (thenScan: boolean) => {
    setScanBusy(true);
    try {
      const r = await startNewBatch(p.id);
      logInfo('puzzle', `Batch ${r.project.batch!.n} started: ${r.aside} pieces set aside`);
      if (thenScan) {
        go('scan', p.id);
        return;
      }
      await ctx.reload();
      if (mounted.current)
        setScanNote(`New lot started (lot ${r.project.batch!.n}): ${plural(r.aside, 'piece')} set aside. Spread the new pieces and tap Scan (at the top).`);
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
      await ctx.reload();
      if (mounted.current) setScanNote(`${plural(n, 'piece')} moved to the bin. Tap "Removed scans" to bring ${n === 1 ? 'it' : 'them'} back.`);
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
      await ctx.reload();
      if (mounted.current) setScanNote(swapped ? `${plural(n, 'piece')} restored. The newer scan is now in the bin.` : `${plural(n, 'piece')} restored.`);
    } catch (err) {
      logError('puzzle', 'The scan could not be restored', err);
      setError(errorWords(err));
    }
    if (mounted.current) setScanBusy(false);
  };

  const setupDone = p.setupStep >= LAST_SETUP_STEP;
  const steps = setupSteps(p);
  const lastStep = steps.length - 1;
  const coin = coinById(p.coin);
  const lastBackup = (
    <span class="more-line" data-testid="last-backup">
      {p.lastBackup ? `Last backup: ${when(p.lastBackup.at)} (${plural(p.lastBackup.pieces, 'piece')} then)` : 'Never backed up'}
    </span>
  );
  const due = reminder && (
    <span class="more-line more-due" data-testid="backup-reminder">
      <span class="more-due-dot" aria-hidden="true" />
      {dueWords(reminder, pieces ?? 0)}
    </span>
  );
  const askRestore = () => (setScanNote(null), (pieces ?? 0) > 0 ? setScanAsk('restore') : void onRestoreScan());
  return (
    <div class="more-tab">
      <ListSection
        header="Backup"
        footer="One file with this puzzle, its pieces, photos and answers. Keep it in Files or on your Mac, so the puzzle is safe if something happens to this iPhone."
      >
        {exp.kind === 'ready' ? (
          <>
            <ListRow
              icon={<Icon name="check" />}
              tone="good"
              title="Backup ready"
              subtitle={
                <>
                  <span class="more-line">
                    {exp.file.name} · {formatBytes(exp.file.size)}
                  </span>
                  {lastBackup}
                </>
              }
              testId="export-ready"
            />
            <ListRow
              icon={<Icon name="share" />}
              tone="accent"
              title="Share backup"
              subtitle="Save to Files, or send it to your Mac"
              disabled={share === 'sharing'}
              onClick={onShare}
              testId="share-backup"
            />
            <li>
              <a
                class="list-row has-icon is-action"
                data-testid="download-backup"
                href={exp.url}
                download={exp.file.name}
                onClick={() => {
                  logInfo('backup', 'Backup downloaded');
                  void backedUp();
                }}
              >
                <span class="list-icon list-icon-grey" aria-hidden="true">
                  <Icon name="download" />
                </span>
                <span class="list-title">
                  {share === 'fallback' ? 'Download backup' : 'Download instead'}
                  <span class="list-subtitle">Goes to the Files app, in Downloads</span>
                </span>
              </a>
            </li>
          </>
        ) : (
          <ListRow
            icon={<Icon name="save" />}
            tone={reminder ? 'warn' : 'accent'}
            title={exp.kind === 'preparing' ? 'Preparing backup…' : 'Back up now'}
            subtitle={
              <>
                {lastBackup}
                {due}
              </>
            }
            disabled={exp.kind === 'preparing'}
            onClick={() => void prepareBackup()}
            testId="export-backup"
          />
        )}
        {reminder && exp.kind !== 'ready' && (
          <ListRow icon={<Icon name="hourglass" />} title="Remind me tomorrow" onClick={snooze} disabled={exp.kind === 'preparing'} testId="backup-later" />
        )}
      </ListSection>
      {exp.kind === 'error' && (
        <Callout kind="bad" icon={<Icon name="alert-triangle" />} role="alert" testId="export-error">
          The backup couldn't be prepared: {exp.message}
        </Callout>
      )}
      {exp.kind === 'ready' && !canShareFile(exp.file) && share === 'none' && (
        <p class="muted small more-note">This browser can't open the Share menu for files. Use "Download instead".</p>
      )}
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

      {canScan && (
        <>
          {scanNote && (
            <Callout kind="good" icon={<Icon name="check" />} role="status" testId="scan-bin-note">
              {scanNote}
            </Callout>
          )}
          {(tableN > 0 || (pieces ?? 0) > 0 || bin) && (
            <ListSection header="Pieces">
              {tableN > 0 && (
                <ListRow
                  icon={<Icon name="refresh" />}
                  tone="accent"
                  title="Start a new lot of pieces…"
                  subtitle="When you spread out a new lot"
                  disabled={scanBusy}
                  onClick={() => (setScanNote(null), setScanAsk('batch'))}
                  chevron
                  testId="new-batch"
                />
              )}
              {bin && (
                <ListRow
                  icon={<Icon name="undo" />}
                  tone="accent"
                  title="Removed scans"
                  subtitle={
                    <span data-testid="scan-bin">
                      {plural(bin.pieces, 'piece')} and {plural(bin.photos, 'photo')} (removed {when(bin.ts)}). Tap to restore.
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
          <Sheet open={scanAsk === 'batch'} onClose={() => setScanAsk('none')} title="Start a new lot of pieces?" detent="large" testId="new-batch-confirm">
            <p>
              <strong>A new lot</strong> is for when you've put the pieces back in the box (or swept them together) and spread out new ones. Easier, if there's
              room: leave the leftovers where they are, spread the new pieces around them and scan as usual. Then every piece is recognised by where it lies,
              and you don't need a new lot.
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

      <ListSection header="Puzzle details" testId="puzzle-details">
        <li class="more-box">
          {boxUrl ? (
            <img src={boxUrl} alt="Your box picture" data-testid="puzzle-box" />
          ) : (
            <div class="more-box-empty">
              <Icon name="image" />
              <span>{p.box ? 'Loading picture…' : 'No box picture yet'}</span>
            </div>
          )}
        </li>
        {renaming === null ? (
          <ListRow
            title="Name"
            value={<span data-testid="puzzle-name">{p.name}</span>}
            chevron
            onClick={() => setRenaming(p.name)}
            ariaLabel={`Name: ${p.name}. Rename`}
            testId="rename"
          />
        ) : (
          <li>
            <form
              class="list-row more-rename"
              onSubmit={(e) => {
                e.preventDefault();
                void saveName();
              }}
            >
              <label class="list-title">
                <span class="more-sr">New name</span>
                <input
                  ref={renameInput}
                  class="text-input"
                  type="text"
                  value={renaming}
                  maxLength={60}
                  data-testid="rename-input"
                  onInput={(e) => setRenaming((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                />
              </label>
              <button type="submit" class="btn btn-small btn-filled" data-testid="rename-save">
                Save
              </button>
            </form>
          </li>
        )}
        <ListRow title="Pieces on the box" value={<span data-testid="puzzle-count">{p.pieceCount || '—'}</span>} />
        <ListRow
          title="Grid"
          subtitle={
            <span data-testid="puzzle-grid">
              {p.grid ? `${p.grid.cols} across × ${p.grid.rows} down (${plural(p.grid.cols * p.grid.rows, 'piece')})` : 'Not chosen yet'}
            </span>
          }
        />
        {p.piecePitch && (
          <ListRow
            title="Piece size"
            subtitle={
              <span data-testid="puzzle-size">
                Measured piece size {p.scaleSource === 'estimate' ? '≈ ' : ''}
                {p.piecePitch.wMm.toFixed(1)} × {p.piecePitch.hMm.toFixed(1)} mm
                {p.grid
                  ? ` → finished puzzle ≈ ${Math.round((p.grid.cols * p.piecePitch.wMm) / 10)} × ${Math.round((p.grid.rows * p.piecePitch.hMm) / 10)} cm`
                  : ''}
                {p.scaleSource === 'estimate'
                  ? ' (estimated from a typical piece; put a coin next to the pieces in the next Whole table photo for true sizes)'
                  : p.scaleSource === 'coin'
                    ? ' (measured with your coin)'
                    : ''}
              </span>
            }
          />
        )}
        {coin && <ListRow title="Coin for true size" value={coin.label} testId="puzzle-coin" />}
        {setupDone ? (
          <li>
            <div class="list-row has-icon" data-testid="setup-finished">
              <span class="list-icon list-icon-good" aria-hidden="true">
                <Icon name="check" />
              </span>
              <span class="list-title">Set-up finished</span>
            </div>
          </li>
        ) : (
          <>
            <li class="more-steps">
              <ol class="setup-progress" data-testid="setup-progress" aria-label="Set-up steps">
                {steps.slice(1).map((label, i) => {
                  const step = i + 1;
                  const state = p.setupStep > step ? 'done' : p.setupStep === step ? 'current' : 'todo';
                  return (
                    <li key={step} class={`setup-${state}`}>
                      <span class="setup-mark" aria-hidden="true">
                        {state === 'done' ? <Icon name="check" size={18} /> : step}
                      </span>
                      <span>
                        {label}
                        {state === 'done' ? <span class="more-sr"> (done)</span> : state === 'current' ? <span class="more-sr"> (next)</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </li>
            <ListRow
              icon={<Icon name="compass" />}
              tone="accent"
              title="Continue set-up"
              subtitle={`Step ${Math.max(1, Math.min(lastStep, p.setupStep))} of ${lastStep}: ${steps[Math.max(1, Math.min(lastStep, p.setupStep))]}`}
              onClick={() => go('new', p.id)}
              chevron
              testId="continue-setup"
            />
          </>
        )}
      </ListSection>

      <ListSection>
        <ListRow icon={<Icon name="help-circle" />} tone="accent" title="How it works" href="#/help" testId="more-help" />
        {/* Calibration statistics are for testing (decision 20): in Tester mode only. */}
        {settings.testerMode.value && (p.answers?.length ?? 0) + (p.pairAnswers?.length ?? 0) > 0 && (
          <ListRow
            icon={<Icon name="bar-chart" />}
            title="How often is the app right?"
            subtitle="Tester mode"
            href={`#/accuracy/${encodeURIComponent(p.id)}`}
            testId="accuracy-link"
          />
        )}
      </ListSection>

      <ListSection>
        <ListRow icon={<Icon name="trash" />} tone="bad" title="Delete this puzzle…" destructive onClick={() => void onDelete()} testId="delete-puzzle" />
      </ListSection>
    </div>
  );
}
