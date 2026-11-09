import { useEffect, useRef, useState } from 'preact/hooks';
import { APP_VERSION, isStandalone, previousEndedUnexpectedly } from '../env';
import { hasPendingMemoryResult } from '../../device/memoryRunner';
import { go } from '../router';
import { listProjects } from '../../project/store';
import { importBackup } from '../../project/backup';
import type { Project } from '../../project/types';
import { logError, logInfo } from '../../log/logger';
import { boxVersion, errorWords, setupStatus, useBlobUrl } from './Puzzle';

function PuzzleCard({ p }: { p: Project }) {
  const thumb = useBlobUrl(p.box?.rectifiedBlobId, boxVersion(p.box));
  return (
    <a class="puzzle-card" href={`#/puzzle/${encodeURIComponent(p.id)}`} data-testid="puzzle-card">
      <span class="puzzle-thumb">{thumb ? <img src={thumb} alt="" /> : <span aria-hidden="true">🧩</span>}</span>
      <span class="puzzle-info">
        <strong class="puzzle-title">{p.name}</strong>
        <span class="small muted">
          {p.pieceCount ? `${p.pieceCount} pieces` : 'Piece count not set'}
          {p.grid ? ` · ${p.grid.cols} × ${p.grid.rows}` : ''}
        </span>
        <span class="small muted">{setupStatus(p)}</span>
      </span>
      <span class="puzzle-chevron" aria-hidden="true">
        ›
      </span>
    </a>
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
      <h2>Your puzzles</h2>
      <button class="btn btn-primary btn-block" data-testid="new-puzzle" onClick={() => go('new')}>
        ＋ New puzzle
      </button>
      {projects === null && <p class="muted small">Loading…</p>}
      {projects?.length === 0 && <p class="muted small">No puzzles yet. Tap "New puzzle" to start your first one.</p>}
      <div class="puzzle-list">
        {projects?.map((p) => (
          <PuzzleCard key={p.id} p={p} />
        ))}
      </div>
      {note && (
        <div class="notice notice-good" data-testid="import-done">
          {note}
        </div>
      )}
      {error && (
        <div class="notice notice-bad" role="alert" data-testid="import-error">
          {error}
        </div>
      )}
      <label class={`btn btn-small file-btn${importing ? ' is-busy' : ''}`} data-testid="import-backup">
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
  return (
    <main class="screen">
      <div class="topbar">
        <h1>Puzzle Lens</h1>
      </div>

      {!isStandalone.value && (
        <div class="notice notice-warn" data-testid="install-banner">
          <strong>Install first, then start your puzzle there.</strong>
          <p class="small">
            You're in a Safari tab. Puzzle data saved here is <em>not</em> shared with the Home Screen app, and Safari may delete it after 7 days without a
            visit.
          </p>
          <ol class="steps small">
            <li>
              Tap the <strong>Share</strong> button (square with an arrow). If you don't see it, tap <strong>⋯</strong> first.
            </li>
            <li>
              Scroll down (tap <strong>View More</strong> if you see it) and tap <strong>Add to Home Screen</strong>. If there's an{' '}
              <strong>Open as Web App</strong> switch, leave it on. Then tap <strong>Add</strong>.
            </li>
            <li>
              Open <strong>Puzzle Lens</strong> from your Home Screen.
            </li>
          </ol>
          <a class="btn btn-small" href="#/help">
            Full setup guide
          </a>
        </div>
      )}

      {memoryResultWaiting ? (
        <div class="notice notice-good" data-testid="memory-result-waiting">
          <p style={{ marginTop: 0 }}>The memory test finished — open Device check to see the result.</p>
          <a class="btn btn-small" href="#/device">
            Open Device check
          </a>
        </div>
      ) : (
        previousEndedUnexpectedly.value && (
          <div class="notice notice-bad" data-testid="crash-notice">
            The last visit may have ended unexpectedly: iOS may have closed the app, for example if it used too much memory. This is noted in the log and goes
            into the next report automatically.
          </div>
        )
      )}

      <YourPuzzles />

      <h2>Tools</h2>
      <div class="tiles">
        <a class="tile tile-wide" href="#/live">
          <span class="tile-icon">📷</span>
          <span>
            Live camera
            <div class="tile-sub">Camera, Snap and the speed display</div>
          </span>
        </a>
        <a class="tile" href="#/device">
          <span class="tile-icon">🩺</span>
          <span>
            Device check
            <div class="tile-sub">What your iPhone can do</div>
          </span>
        </a>
        <a class="tile" href="#/report">
          <span class="tile-icon">📦</span>
          <span>
            Send report
            <div class="tile-sub">For when something goes wrong</div>
          </span>
        </a>
        <a class="tile" href="#/help">
          <span class="tile-icon">🧭</span>
          <span>
            Setup guide
            <div class="tile-sub">Step by step</div>
          </span>
        </a>
        <a class="tile" href="#/settings">
          <span class="tile-icon">⚙️</span>
          <span>
            Settings
            <div class="tile-sub">Units, camera, data</div>
          </span>
        </a>
      </div>

      <p class="muted small" style={{ marginTop: '24px' }}>
        Version {APP_VERSION} ·{' '}
        <a href="#/log" style={{ color: 'inherit' }}>
          Activity log
        </a>
      </p>
    </main>
  );
}
