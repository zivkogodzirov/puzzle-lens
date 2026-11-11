import { useEffect, useRef, useState } from 'preact/hooks';
import { APP_VERSION, isStandalone, previousEndedUnexpectedly } from '../env';
import { hasPendingMemoryResult } from '../../device/memoryRunner';
import { go } from '../router';
import { listProjects } from '../../project/store';
import { importBackup } from '../../project/backup';
import type { Project } from '../../project/types';
import { logError, logInfo } from '../../log/logger';
import { boxVersion, errorWords, setupStatus, useBlobUrl } from './Puzzle';
import { settings } from '../settings';
import { plural } from '../words';
import { NavBar } from '../ui/NavBar';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { ListRow, ListSection } from '../ui/List';
import { Icon } from '../ui/icons';

/** One puzzle as a list row: its box picture (or a puzzle icon), name, pieces and grid, set-up status; opens the puzzle. */
function PuzzleRow({ p }: { p: Project }) {
  const thumb = useBlobUrl(p.box?.rectifiedBlobId, boxVersion(p.box));
  return (
    <ListRow
      icon={thumb ? <img src={thumb} alt="" /> : <Icon name="puzzle" />}
      title={<strong class="puzzle-title">{p.name}</strong>}
      subtitle={
        <>
          {p.pieceCount ? plural(p.pieceCount, 'piece') : 'Piece count not set'}
          {p.grid ? ` · ${p.grid.cols} × ${p.grid.rows}` : ''}
          <span class="puzzle-row-status">{setupStatus(p)}</span>
        </>
      }
      href={`#/puzzle/${encodeURIComponent(p.id)}`}
      testId="puzzle-card"
    />
  );
}

function YourPuzzles() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const refresh = () =>
    listProjects()
      .then(setProjects)
      .catch((err) => {
        logError('home', 'Your puzzles could not be listed', err);
        setError(`Your puzzles couldn't be listed: ${errorWords(err)}`);
        setProjects([]);
      });
  useEffect(() => {
    void refresh();
  }, []);

  const onImport = async () => {
    const file = input.current?.files?.[0];
    if (input.current) input.current.value = '';
    if (!file) return;
    setError(null);
    setNote(null);
    setImporting(true);
    try {
      const r = await importBackup(file);
      logInfo('backup', `Backup imported: ${r.project.name} (${r.pieces} pieces, ${r.blobs} files${r.copied ? ', as a copy' : ''})`);
      setNote(
        r.copied
          ? `"${r.project.name}" was added. That puzzle was already on this iPhone, so the backup was added as a copy; nothing was replaced.`
          : `"${r.project.name}" was restored from the backup.`,
      );
      await refresh();
    } catch (err) {
      logError('backup', 'The backup could not be imported', err);
      setError(`The backup couldn't be imported: ${errorWords(err)}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <section data-testid="your-puzzles">
      <Button variant="filled" block testId="new-puzzle" onClick={() => go('new')}>
        <Icon name="plus" size={20} /> New puzzle
      </Button>
      {projects === null && <p class="muted small">Loading…</p>}
      {projects?.length === 0 && <p class="muted small">No puzzles yet. Tap "New puzzle" to start your first one.</p>}
      {projects && projects.length > 0 && (
        <div class="home-puzzles">
          <ListSection header="Your puzzles">
            {projects.map((p) => (
              <PuzzleRow key={p.id} p={p} />
            ))}
          </ListSection>
        </div>
      )}
      {note && (
        <Callout kind="good" testId="import-done">
          {note}
        </Callout>
      )}
      {error && (
        <Callout kind="bad" role="alert" testId="import-error">
          {error}
        </Callout>
      )}
      {/* A label, so a tap anywhere on it opens the file picker (the input inside is hidden). */}
      <label class={`btn btn-plain btn-small file-btn home-import${importing ? ' is-busy' : ''}`} data-testid="import-backup">
        <Icon name="download" size={20} />
        {importing ? 'Importing…' : 'Import a backup'}
        <input ref={input} class="hidden-input" type="file" data-testid="import-file" disabled={importing} onChange={() => void onImport()} />
      </label>
    </section>
  );
}

export function HomeScreen() {
  // A memory test that never finished means iOS closed the app on purpose (that's how the test
  // measures): point to the result instead of showing the "ended unexpectedly" warning.
  const memoryResultWaiting = hasPendingMemoryResult();
  const tester = settings.testerMode.value;
  return (
    <main class="screen">
      <NavBar title="Puzzle Lens" large back={false} />

      {!isStandalone.value && (
        <Callout kind="warn" icon={<Icon name="share" />} title="Install first, then start your puzzle there." testId="install-banner">
          <p>
            You're in a Safari tab. Puzzle data saved here is <em>not</em> shared with the Home Screen app, and Safari may delete it after 7 days without a
            visit.
          </p>
          <ol class="steps small">
            <li>
              Tap the <strong>Share</strong> button (square with an arrow). If you don't see it, tap{' '}
              <Icon name="more-horizontal" size={18} class="icon-inline" label="⋯ (More)" /> first.
            </li>
            <li>
              Scroll down (tap <strong>View More</strong> if you see it) and tap <strong>Add to Home Screen</strong>. If there's an{' '}
              <strong>Open as Web App</strong> switch, leave it on. Then tap <strong>Add</strong>.
            </li>
            <li>
              Open <strong>Puzzle Lens</strong> from your Home Screen.
            </li>
          </ol>
          <a class="btn btn-small callout-action callout-link" href="#/help">
            Full setup guide
          </a>
        </Callout>
      )}

      {memoryResultWaiting ? (
        <Callout kind="good" testId="memory-result-waiting">
          <p>The memory test finished — open Device check to see the result.</p>
          <a class="btn btn-small callout-action callout-link" href="#/device">
            Open Device check
          </a>
        </Callout>
      ) : (
        previousEndedUnexpectedly.value && (
          <Callout kind="bad" testId="crash-notice">
            The last visit may have ended unexpectedly: iOS may have closed the app, for example if it used too much memory. This is noted in the log and goes
            into the next report automatically.
          </Callout>
        )
      )}

      <YourPuzzles />

      {/* The testing tools: only in Tester mode (Settings). */}
      {tester && (
        <ListSection header="Diagnostics" footer="Shown while Tester mode is on (Settings)." testId="home-diagnostics">
          <ListRow
            icon={<Icon name="camera" />}
            tone="accent"
            title="Live camera"
            subtitle="Camera, Snap and the speed display"
            href="#/live"
            testId="tool-live"
          />
          <ListRow
            icon={<Icon name="stethoscope" />}
            tone="good"
            title="Device check"
            subtitle="What your iPhone can do"
            href="#/device"
            testId="tool-device"
          />
          <ListRow
            icon={<Icon name="send" />}
            tone="accent"
            title="Send report"
            subtitle="For when something goes wrong"
            href="#/report"
            testId="tool-report"
          />
          <ListRow icon={<Icon name="info" />} title="Activity log" subtitle="What the app did, and its errors" href="#/log" testId="tool-log" />
        </ListSection>
      )}

      <ListSection>
        <ListRow icon={<Icon name="compass" />} tone="accent" title="Setup guide" subtitle="Step by step" href="#/help" testId="tool-help" />
        <ListRow icon={<Icon name="settings" />} title="Settings" subtitle="Units, camera, data" href="#/settings" testId="tool-settings" />
      </ListSection>

      <p class="muted small home-version">Version {APP_VERSION}</p>
    </main>
  );
}
