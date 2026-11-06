/**
 * One puzzle (PLAN §5): name, piece count, grid, box picture, setup progress with "Continue
 * setup", pieces catalogued so far, Export backup and Delete.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { TopBar } from '../components/TopBar';
import { go, routeArg } from '../router';
import { APP_VERSION } from '../env';
import { reportWorker } from '../workers';
import { countPieces, deleteProject, getBlob, getProject, LAST_SETUP_STEP, setCurrentProjectId, updateProject } from '../../project/store';
import { exportBackup, zipHere } from '../../project/backup';
import type { PieceRow, Project } from '../../project/types';
import { db } from '../../db/db';
import { canShareFile, downloadUrl, revokeDownloadUrls, shareOrDownload } from '../../report/share';
import { formatBytes } from '../../report/collect';
import { logError, logInfo, logWarn } from '../../log/logger';

/** The wizard steps the owner sees (index = Project.setupStep value that shows it). */
export const SETUP_STEPS: readonly string[] = [
  'Home Screen check',
  'Name and piece count',
  'Box picture',
  'Grid',
  'Print markers',
  'Lay out markers and photograph the table',
];

/** Words for an error, for the screen. */
export function errorWords(err: unknown): string {
  const e = err as { message?: string; name?: string } | null;
  const m = e?.message || String(err);
  if (e?.name === 'QuotaExceededError' || /quota/i.test(m)) return 'Your iPhone is out of storage space for Puzzle Lens. Free some space and try again.';
  return m;
}

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

/** "Set-up: step 3 of 5 (Grid)" or "Set-up finished". */
export function setupStatus(p: Project): string {
  if (p.setupStep >= LAST_SETUP_STEP) return 'Set-up finished';
  const step = Math.max(1, Math.min(5, p.setupStep));
  return `Set-up: step ${step} of 5 (${SETUP_STEPS[step]})`;
}

type ExportPhase = { kind: 'idle' } | { kind: 'preparing' } | { kind: 'ready'; file: File; url: string } | { kind: 'error'; message: string };

export function PuzzleScreen() {
  const id = routeArg.value;
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [pieces, setPieces] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [exp, setExp] = useState<ExportPhase>({ kind: 'idle' });
  const [share, setShare] = useState<'none' | 'sharing' | 'shared' | 'fallback'>('none');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const thumb = useBlobUrl(project?.box?.rectifiedBlobId, project?.box);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revokeDownloadUrls();
    };
  }, []);

  useEffect(() => {
    setProject(undefined);
    if (!id) {
      setProject(null);
      return;
    }
    getProject(id)
      .then(async (p) => {
        if (!mounted.current) return;
        setProject(p ?? null);
        if (p) {
          void setCurrentProjectId(p.id).catch(() => {});
          setPieces(await countPieces(p.id));
        }
      })
      .catch((err) => {
        logError('puzzle', 'The puzzle could not be loaded', err);
        setError(errorWords(err));
        setProject(null);
      });
  }, [id]);

  if (project === undefined) {
    return (
      <main class="screen">
        <TopBar title="Puzzle" />
        <p class="muted">Loading…</p>
      </main>
    );
  }
  if (project === null) {
    return (
      <main class="screen" data-testid="puzzle-missing">
        <TopBar title="Puzzle" />
        <div class="notice notice-bad">{error ?? 'This puzzle is not on this iPhone (it may have been deleted).'}</div>
        <button class="btn btn-primary btn-block" onClick={() => go('home')}>
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
      } else if (outcome.kind === 'cancelled') setShare('none');
      else {
        setShare('fallback');
        logWarn('backup', `Share menu not available, download offered instead (${outcome.reason})`);
      }
    });
  };

  const onDelete = async () => {
    try {
      await deleteProject(p.id);
      logInfo('puzzle', `Puzzle deleted: ${p.name}`);
      go('home');
    } catch (err) {
      logError('puzzle', 'The puzzle could not be deleted', err);
      setError(errorWords(err));
    }
  };

  const setupDone = p.setupStep >= LAST_SETUP_STEP;
  return (
    <main class="screen" data-testid="puzzle-screen">
      <TopBar title={p.name} />

      {error && (
        <div class="notice notice-bad" role="alert" data-testid="puzzle-error">
          {error}
        </div>
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
                <button class="btn btn-small btn-primary" data-testid="rename-save" onClick={() => void saveName()}>
                  Save
                </button>
              </span>
            )}
          </dd>
          <dt>Pieces on the box</dt>
          <dd data-testid="puzzle-count">{p.pieceCount || '—'}</dd>
          <dt>Grid</dt>
          <dd data-testid="puzzle-grid">{p.grid ? `${p.grid.cols} across × ${p.grid.rows} down (${p.grid.cols * p.grid.rows} pieces)` : 'Not chosen yet'}</dd>
          <dt>Pieces read</dt>
          <dd data-testid="puzzle-pieces">
            {pieces ?? '—'}
            {p.piecePitch && (
              <div class="muted small" data-testid="puzzle-size">
                Measured piece size ≈ {p.piecePitch.wMm.toFixed(1)} × {p.piecePitch.hMm.toFixed(1)} mm
                {p.grid ? ` → finished puzzle ≈ ${Math.round((p.grid.cols * p.piecePitch.wMm) / 10)} × ${Math.round((p.grid.rows * p.piecePitch.hMm) / 10)} cm (rough)` : ''}
              </div>
            )}
            {!p.markerMap && <div class="muted small">Reading pieces starts after the set-up.</div>}
          </dd>
        </dl>
      </div>

      <h2>Set-up</h2>
      <ol class="setup-progress" data-testid="setup-progress">
        {SETUP_STEPS.slice(1).map((label, i) => {
          const step = i + 1;
          const state = p.setupStep > step ? 'done' : p.setupStep === step ? 'current' : 'todo';
          return (
            <li key={step} class={`setup-${state}`}>
              <span class="setup-mark" aria-hidden="true">
                {state === 'done' ? '✓' : step}
              </span>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>
      {!setupDone && (
        <button class="btn btn-primary btn-block" data-testid="continue-setup" onClick={() => go('new', p.id)}>
          Continue set-up
        </button>
      )}

      {p.markerMap && (
        <>
          <h2>Pieces</h2>
          <button class="btn btn-primary btn-block" data-testid="scan-pieces" onClick={() => go('scan', p.id)}>
            📷 Scan pieces
          </button>
          <Catalog projectId={p.id} version={pieces} />
        </>
      )}

      <h2>Backup</h2>
      <p class="muted small">One file with this puzzle and its photos. Keep it in Files or send it to your Mac, so the puzzle is never lost.</p>
      {exp.kind !== 'ready' && (
        <button class="btn btn-block" data-testid="export-backup" disabled={exp.kind === 'preparing'} onClick={() => void prepareBackup()}>
          {exp.kind === 'preparing' ? 'Preparing backup…' : 'Export backup'}
        </button>
      )}
      {exp.kind === 'error' && (
        <div class="notice notice-bad" role="alert" data-testid="export-error">
          The backup couldn't be prepared: {exp.message}
        </div>
      )}
      {exp.kind === 'ready' && (
        <>
          <div class="notice notice-good" data-testid="export-ready">
            <strong>Backup ready ✓</strong>
            <p class="small">
              {exp.file.name} · {formatBytes(exp.file.size)}
            </p>
          </div>
          <button class="btn btn-primary btn-block" data-testid="share-backup" disabled={share === 'sharing'} onClick={onShare}>
            Share backup
          </button>
          {!canShareFile(exp.file) && share === 'none' && <p class="muted small">This browser can't open the Share menu for files. Use "Download instead".</p>}
          {share === 'shared' && <div class="notice notice-good">Sent ✓</div>}
          {share === 'fallback' && (
            <div class="notice notice-warn" role="alert">
              The Share menu didn't open. Tap <strong>Download backup</strong>: the file goes to the Files app, in Downloads.
            </div>
          )}
          <div class="row" style={{ marginTop: '10px' }}>
            <a class={share === 'fallback' ? 'btn btn-primary btn-block' : 'btn btn-small'} data-testid="download-backup" href={exp.url} download={exp.file.name}>
              {share === 'fallback' ? 'Download backup' : 'Download instead'}
            </a>
          </div>
        </>
      )}

      <h2>Delete</h2>
      {!confirmDelete ? (
        <button class="btn btn-danger btn-small" data-testid="delete-puzzle" onClick={() => setConfirmDelete(true)}>
          Delete this puzzle…
        </button>
      ) : (
        <div class="notice notice-bad">
          <p>
            This deletes <strong>{p.name}</strong> with its box picture and every piece read so far, on this iPhone. It can't be undone (unless you have a
            backup).
          </p>
          <div class="row">
            <button class="btn btn-danger" data-testid="delete-confirm" onClick={() => void onDelete()}>
              Yes, delete it
            </button>
            <button class="btn" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/** Thumbnails of the pieces on the table (first 120; the full catalog screen comes in M3). */
function Catalog({ projectId, version }: { projectId: string; version: unknown }) {
  const [rows, setRows] = useState<PieceRow[]>([]);
  useEffect(() => {
    void db()
      .pieces.where('projectId')
      .equals(projectId)
      .toArray()
      .then((ps) => setRows(ps.filter((q) => q.status === 'table').slice(0, 120)));
  }, [projectId, version]);
  if (!rows.length) return <p class="muted small">No pieces yet. Spread 200–300 pieces face up inside the markers and tap Scan pieces.</p>;
  return (
    <div class="catalog-grid" data-testid="catalog">
      {rows.map((r) => (
        <PieceThumb key={r.id} piece={r} />
      ))}
    </div>
  );
}

function PieceThumb({ piece }: { piece: PieceRow }) {
  const url = useBlobUrl(piece.thumbBlobId, piece.updatedAt);
  const cls = piece.flags.clump ? 'flag-clump' : piece.flags.weak ? 'flag-weak' : '';
  return url ? <img src={url} class={cls} alt="" loading="lazy" /> : <div class="catalog-empty" />;
}
