/**
 * One puzzle (PLAN §5): name, piece count, grid, box picture, setup progress with "Continue
 * setup", pieces catalogued so far, Export backup and Delete.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TopBar } from '../components/TopBar';
import { go, routeArg } from '../router';
import { APP_VERSION } from '../env';
import { reportWorker } from '../workers';
import { countPiecesByStatus, deleteProject, getBlob, getProject, LAST_SETUP_STEP, setCurrentProjectId, updateProject } from '../../project/store';
import { exportBackup, zipHere } from '../../project/backup';
import { deleteScan, restoreScan, scanBinSummary, type ScanBinSummary } from '../../project/scans';
import type { PieceRow, Project } from '../../project/types';
import { db } from '../../db/db';
import { readShape, READ_OK, type PieceKind } from '../../cv/shapeRead';
import type { Placement } from '../../cv/placement';
import { placeKeyOf, readPlacements, shownPlacements, stalePieces, unplacedStatus, updatePlacements, type PlacementCache } from '../../project/placements';
import type { SpotChoice } from '../../cv/openSpots';
import { readerWorker } from '../workers';
import { TraysPanel, useColourGroups } from '../components/Trays';
import type { Groups } from '../../project/groups';
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
  const [bin, setBin] = useState<ScanBinSummary | null>(null);
  const [missingN, setMissingN] = useState(0);
  const [trayN, setTrayN] = useState(0);
  const [scanAction, setScanAction] = useState<'none' | 'confirm-delete' | 'confirm-restore' | 'busy'>('none');
  const [scanNote, setScanNote] = useState<string | null>(null);
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
          const c = await countPiecesByStatus(p.id);
          setPieces(c.all);
          setMissingN(c.missing);
          setTrayN(c.tray);
          setBin(await scanBinSummary(p.id));
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

  /** After deleting or restoring: the puzzle (size), piece count and bin as stored now. */
  const reloadScan = async () => {
    const [np, c, b] = await Promise.all([getProject(p.id), countPiecesByStatus(p.id), scanBinSummary(p.id)]);
    if (!mounted.current) return;
    if (np) setProject(np);
    setPieces(c.all);
    setMissingN(c.missing);
    setTrayN(c.tray);
    setBin(b);
  };

  const onDeleteScan = async (thenScan: boolean) => {
    setScanAction('busy');
    try {
      const n = await deleteScan(p.id);
      logInfo('puzzle', `Scan deleted (moved to the bin): ${n} pieces`);
      if (thenScan) {
        go('scan', p.id);
        return;
      }
      await reloadScan();
      setScanNote(`${n} pieces moved to the bin. Tap "Restore" to bring them back.`);
    } catch (err) {
      logError('puzzle', 'The scan could not be deleted', err);
      setError(errorWords(err));
    }
    if (mounted.current) setScanAction('none');
  };

  const onRestoreScan = async () => {
    setScanAction('busy');
    try {
      const swapped = (pieces ?? 0) > 0;
      const n = await restoreScan(p.id);
      logInfo('puzzle', `Scan restored from the bin: ${n} pieces${swapped ? ' (the newer scan went to the bin)' : ''}`);
      await reloadScan();
      setScanNote(swapped ? `${n} pieces restored. The newer scan is now in the bin.` : `${n} pieces restored.`);
    } catch (err) {
      logError('puzzle', 'The scan could not be restored', err);
      setError(errorWords(err));
    }
    if (mounted.current) setScanAction('none');
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
            {pieces === null ? '—' : pieces - missingN - trayN}
            {trayN > 0 && (
              <span class="muted small" data-testid="puzzle-tray-count">
                {' '}
                on the table, {trayN} in trays
              </span>
            )}
            {missingN > 0 && (
              <span class="muted small" data-testid="puzzle-missing-count">
                {' '}
                on the table (+{missingN} no longer seen at {missingN === 1 ? 'its' : 'their'} spot)
              </span>
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

      {canScan(p) && (
        <>
          <h2>Pieces</h2>
          <button class="btn btn-primary btn-block" data-testid="scan-pieces" onClick={() => go('scan', p.id)}>
            📷 Scan pieces
          </button>
          <Catalog
            projectId={p.id}
            version={`${pieces}|${trayN}`}
            markers={p.tracking === 'markers'}
            grid={p.grid}
            pitch={p.piecePitch}
            project={p}
            onProject={setProject}
            onPiecesChanged={() => void reloadScan().catch((err) => logError('puzzle', 'The piece counts could not be read', err))}
          />
          {scanNote && (
            <div class="notice notice-good" role="status" data-testid="scan-bin-note">
              {scanNote}
            </div>
          )}
          {(pieces ?? 0) > 0 && scanAction !== 'confirm-delete' && scanAction !== 'confirm-restore' && (
            <button
              class="btn btn-block"
              data-testid="delete-scan"
              disabled={scanAction === 'busy'}
              onClick={() => (setScanNote(null), setScanAction('confirm-delete'))}
            >
              Delete scanned pieces…
            </button>
          )}
          {scanAction === 'confirm-delete' && (
            <div class="notice notice-warn" data-testid="delete-scan-confirm">
              <p>
                This moves the <strong>{pieces} pieces</strong> read so far, with their photos, to the bin. You can restore them later. The box picture and grid
                stay.
              </p>
              {bin && <p class="small">The bin already holds an older scan ({bin.pieces} pieces); it will be replaced.</p>}
              <div class="row" style={{ flexWrap: 'wrap', gap: '8px' }}>
                <button class="btn btn-primary" data-testid="delete-scan-rescan" onClick={() => void onDeleteScan(true)}>
                  Delete and scan again
                </button>
                <button class="btn btn-danger" data-testid="delete-scan-yes" onClick={() => void onDeleteScan(false)}>
                  Delete pieces
                </button>
                <button class="btn" onClick={() => setScanAction('none')}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {bin && scanAction !== 'confirm-delete' && (
            <div class="card" data-testid="scan-bin">
              <p class="small">
                <strong>Bin:</strong> an earlier scan with {bin.pieces} {bin.pieces === 1 ? 'piece' : 'pieces'} and {bin.photos}{' '}
                {bin.photos === 1 ? 'photo' : 'photos'} (deleted {new Date(bin.ts).toLocaleString()}).
              </p>
              {scanAction !== 'confirm-restore' ? (
                <button
                  class="btn btn-small"
                  data-testid="restore-scan"
                  disabled={scanAction === 'busy'}
                  onClick={() => (setScanNote(null), (pieces ?? 0) > 0 ? setScanAction('confirm-restore') : void onRestoreScan())}
                >
                  Restore
                </button>
              ) : (
                <div class="notice notice-warn" data-testid="restore-scan-confirm">
                  <p class="small">
                    Restoring swaps the scans: the <strong>{pieces} pieces</strong> you have now go to the bin (two scans can't be mixed, because each one
                    measures the table its own way).
                  </p>
                  <div class="row" style={{ gap: '8px' }}>
                    <button class="btn btn-primary" data-testid="restore-scan-yes" onClick={() => void onRestoreScan()}>
                      Swap and restore
                    </button>
                    <button class="btn" onClick={() => setScanAction('none')}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
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
            <a
              class={share === 'fallback' ? 'btn btn-primary btn-block' : 'btn btn-small'}
              data-testid="download-backup"
              href={exp.url}
              download={exp.file.name}
            >
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

export type ShapeGroup = PieceKind | 'unsure';

/** A catalogued piece's group from its outline: corner, edge, interior, or not sure (touching, cut, or a read not trusted). */
export function pieceGroup(p: PieceRow, cell: [number, number] | null): ShapeGroup {
  if (p.flags.clump || p.flags.cut) return 'unsure';
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
  projectId,
  version,
  markers,
  grid,
  pitch,
  project,
  onProject,
  onPiecesChanged,
}: {
  projectId: string;
  version: unknown;
  markers: boolean;
  grid: Project['grid'];
  pitch: Project['piecePitch'];
  project: Project;
  onProject: (p: Project) => void;
  onPiecesChanged: () => void;
}) {
  const [rows, setRows] = useState<PieceRow[]>([]);
  const [allRows, setAllRows] = useState<PieceRow[]>([]);
  const [traysOpen, setTraysOpen] = useState(false);
  const [trayGroup, setTrayGroup] = useState<number | null>(null);
  const [show, setShow] = useState<'all' | 'border' | 'interior' | 'unsure'>('all');
  const [places, setPlaces] = useState<PlacementCache | null>(null);
  const [placing, setPlacing] = useState<{ done: number; total: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const boxUrl = useBlobUrl(project.box?.rectifiedBlobId, project.box);
  const placeKey = placeKeyOf(project);
  useEffect(() => {
    let live = true;
    void (async () => {
      const everything = await db().pieces.where('projectId').equals(projectId).toArray();
      const ps = everything.filter((q) => q.status === 'table');
      if (!live) return;
      setRows(ps);
      setAllRows(everything);
      // Box placement (M4): show what is known, then place pieces that are new or photographed again.
      if (!placeKey) return;
      const cached = await readPlacements(projectId);
      if (live) setPlaces(cached?.boxKey === placeKey ? cached : null);
      // Pieces in trays are placed too: they still belong in the puzzle (and compete for empty spots).
      const unplaced = everything.filter(unplacedStatus);
      const todo = stalePieces(cached, placeKey, unplaced).length;
      if (!todo) return;
      try {
        const rw = readerWorker();
        const info = await rw.ready;
        if (!info?.ok || !live) return;
        setPlacing({ done: 0, total: todo });
        const next = await updatePlacements(project, unplaced, rw.api, (done, total) => live && setPlacing({ done, total }));
        if (live) setPlaces(next);
        logInfo(
          'place',
          `Placed ${todo} pieces on the box picture` +
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
  const shownPlaces = useMemo(() => shownPlacements(places, allRows.filter(unplacedStatus)), [places, allRows]);
  // Trays by colour (M4): read only when the owner opens it.
  const { groups: colourGroups } = useColourGroups(traysOpen, project, allRows);
  const cell: [number, number] | null = pitch ? [pitch.wMm, pitch.hMm] : null;
  const groups = useMemo(() => new Map(rows.map((r) => [r.id, pieceGroup(r, cell)])), [rows, cell?.[0], cell?.[1]]);
  const traysBlock = (
    <>
      <button
        class={`btn btn-block ${traysOpen ? 'btn-on' : ''}`}
        aria-expanded={traysOpen}
        data-testid="trays-toggle"
        onClick={() => (setTraysOpen(!traysOpen), setTrayGroup(null))}
      >
        🎨 Sort into trays by colour
      </button>
      {traysOpen && (
        <TraysPanel
          project={project}
          all={allRows}
          table={rows}
          groups={colourGroups}
          selected={trayGroup}
          onSelect={setTrayGroup}
          onChanged={(np) => (np ? onProject(np) : onPiecesChanged())}
        />
      )}
    </>
  );
  if (!rows.length)
    return allRows.some((q) => q.status === 'tray') ? (
      <div>
        <p class="muted small">All your scanned pieces are in trays.</p>
        {traysBlock}
      </div>
    ) : (
      <p class="muted small">No pieces yet. Spread pieces face up {markers ? 'inside the markers' : 'on the table, with small gaps'} and tap Scan pieces.</p>
    );
  const n = { corner: 0, edge: 0, interior: 0, unsure: 0 };
  for (const g of groups.values()) n[g]++;
  const count = { all: rows.length, border: n.corner + n.edge, interior: n.interior, unsure: n.unsure };
  const want = borderCounts(grid ?? { cols: 0, rows: 0 });
  const tooMany = grid && (n.corner > want.corners || n.edge > want.edges);
  if (show === 'unsure' && !count.unsure) setShow('all');
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
      <div class="chips catalog-groups" role="group" aria-label="Show pieces" data-testid="catalog-groups">
        {/* "Not sure" only when there is something not sure. */}
        {(['all', 'border', 'interior', 'unsure'] as const)
          .filter((k) => k !== 'unsure' || count.unsure > 0)
          .map((k) => (
            <button key={k} class={`chip ${show === k ? 'chip-on' : ''}`} aria-pressed={show === k} data-testid={`group-${k}`} onClick={() => setShow(k)}>
              {GROUP_LABEL[k]} {count[k]}
            </button>
          ))}
      </div>
      {show === 'border' && (
        <p class="small" data-testid="border-counts">
          <span class="legend-corner">Corners {grid ? `${n.corner} of ${want.corners}` : n.corner}</span> ·{' '}
          <span class="legend-edge">Edges {grid ? `${n.edge} of ${want.edges}` : n.edge}</span>
          {n.unsure ? <span class="muted"> · {n.unsure} not sure yet (a close-up helps)</span> : null}
        </p>
      )}
      {tooMany && (
        <div class="notice notice-warn" data-testid="border-warning">
          More {n.corner > want.corners ? 'corner' : 'edge'} pieces than a {grid!.cols} × {grid!.rows} puzzle has: some shapes were misread, or the grid may be
          wrong. Check?
        </div>
      )}
      {project.box && (
        <PlaceSummary
          shown={shownPlaces}
          open={places?.open ?? null}
          hasSpots={Boolean(project.openSpots)}
          rows={rows}
          placing={placing}
          onWholePicture={() => {
            void updateProject(projectId, { openSpots: null })
              .then(onProject)
              .catch((err) => logError('place', 'Could not switch to the whole picture', err));
          }}
        />
      )}
      {traysBlock}
      <div class="catalog-grid" data-testid="catalog">
        {shown.slice(0, SHOW_MAX).map((r) => (
          <PieceThumb
            key={r.id}
            piece={r}
            group={groups.get(r.id)!}
            place={shownPlaces.get(r.id)?.placement ?? null}
            selected={selected === r.id}
            onSelect={() => setSelected(selected === r.id ? null : r.id)}
            tray={trayTag(colourGroups, trayOf(r.id))}
          />
        ))}
      </div>
      {selected && project.grid && rows.some((r) => r.id === selected) && (
        <PieceSpots
          piece={rows.find((r) => r.id === selected)!}
          choice={shownPlaces.get(selected) ?? null}
          spots={places?.open?.cells.length ? places.open.cells : null}
          boxUrl={boxUrl}
          grid={project.grid}
          aspect={project.box ? project.box.width / project.box.height : project.grid.cols / project.grid.rows}
          onClose={() => setSelected(null)}
        />
      )}
      {shown.length > SHOW_MAX && <p class="muted small">…and {shown.length - SHOW_MAX} more.</p>}
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
}: {
  piece: PieceRow;
  group: ShapeGroup;
  place: Placement | null;
  onSelect: () => void;
  selected: boolean;
  tray?: { letter: string; hex: string; ink: string; also: string | null } | null;
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
      {tray && (
        <span class="tray-tag" style={{ background: tray.hex, color: tray.ink }} data-testid="tray-tag">
          {tray.letter}
          {tray.also ? `+${tray.also}` : ''}
        </span>
      )}
    </button>
  );
}

const VERDICT_WORDS: Record<Placement['verdict'], string> = { strong: 'Strong', likely: 'Likely', several: 'Several spots look alike' };
/** A chance in whole percent, never shown as a certain 100 %. */
const pct = (p: number): number => Math.min(99, Math.round(p * 100));

/** How many pieces have a spot on the box picture, and progress while placing. */
function PlaceSummary({
  shown,
  open,
  hasSpots,
  rows,
  placing,
  onWholePicture,
}: {
  shown: Map<string, SpotChoice>;
  open: PlacementCache['open'];
  hasSpots: boolean;
  rows: PieceRow[];
  placing: { done: number; total: number } | null;
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
          <strong>Most of the puzzle done?</strong> Tap <strong>📷 Scan pieces → 🖼 Choose a photo</strong> and pick one photo of the whole puzzle with its
          holes. Your leftover pieces are then matched only to those empty spots, which is far more reliable than searching the whole picture.
        </p>
      )}
      {hasSpots && (
        <div class="notice notice-good small" data-testid="open-spots">
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
          <button class="btn btn-small" data-testid="whole-picture" onClick={onWholePicture}>
            Use the whole picture instead
          </button>
        </div>
      )}
      <p class="small" data-testid="place-summary">
        {placing ? (
          <span data-testid="placing">
            Finding spots on the box picture… {placing.done} of {placing.total}
          </span>
        ) : (
          <>
            On the box picture: <span class="legend-strong">{n.strong} strong</span> · <span class="legend-likely">{n.likely} likely</span> · {n.several}{' '}
            several spots look alike
            {n.nofit > 0 ? <span> · {n.nofit} fit none of the empty spots</span> : null}
            {none > 0 ? <span class="muted"> · {none} not placed yet (scanned before this version: scan again)</span> : null}. Tap a piece to see where it goes.
          </>
        )}
      </p>
    </>
  );
}

/** One piece's best spots on the box picture (column, row from the top-left, 1-based). */
function PieceSpots({
  piece,
  choice,
  spots,
  boxUrl,
  grid,
  aspect,
  onClose,
}: {
  piece: PieceRow;
  choice: SpotChoice | null;
  /** The empty spots pieces are matched to (drawn faintly), or null for the whole picture. */
  spots: Array<[number, number]> | null;
  boxUrl: string | null;
  grid: { cols: number; rows: number };
  aspect: number;
  onClose: () => void;
}) {
  const url = useBlobUrl(piece.thumbBlobId, piece.updatedAt);
  const place = choice?.placement ?? null;
  const best = place?.top[0];
  const fits = choice?.fits ?? true;
  return (
    <div class="card piece-spots" data-testid="piece-spots">
      <div class="row">
        {url && <img src={url} class="spot-thumb" alt="This piece" />}
        <div class="grow">
          {best ? (
            <>
              {fits ? (
                <p data-testid="spot-verdict">
                  <strong>
                    Column {best.col + 1}, row {best.row + 1}
                  </strong>{' '}
                  <span class={`legend-${place!.verdict}`}>
                    ({VERDICT_WORDS[place!.verdict]}, {pct(best.p)} %)
                  </span>
                </p>
              ) : (
                <p data-testid="spot-verdict">
                  <strong>Fits none of the empty spots well.</strong> It may not be a piece (a label, a shadow), or it may come from somewhere else. Closest:
                  column {best.col + 1}, row {best.row + 1}.
                </p>
              )}
              <p class="muted small">Counted from the top-left corner of the box picture.{spots ? ` Grey squares: the ${spots.length} empty spots.` : ''}</p>
              {place!.top.slice(1).some((t) => t.p >= 0.01) && (
                <p class="small" data-testid="spot-others">
                  Also possible:{' '}
                  {place!.top
                    .slice(1)
                    .filter((t) => t.p >= 0.01)
                    .map((t) => `column ${t.col + 1}, row ${t.row + 1} (${pct(t.p)} %)`)
                    .join('; ')}
                </p>
              )}
            </>
          ) : (
            <p data-testid="spot-verdict">
              {choice && spots
                ? 'Fits none of the empty spots (by its shape or its picture). It may not be a piece, or it may come from somewhere else.'
                : 'No spot yet: scan this piece again (overview or close-up).'}
            </p>
          )}
        </div>
        <button class="btn btn-small" onClick={onClose}>
          Close
        </button>
      </div>
      {boxUrl && place && (
        <svg
          class="spot-box"
          style={{ aspectRatio: String(aspect) }}
          viewBox={`0 0 ${grid.cols} ${grid.rows}`}
          preserveAspectRatio="none"
          data-testid="spot-box"
        >
          <image href={boxUrl} x={0} y={0} width={grid.cols} height={grid.rows} preserveAspectRatio="none" />
          {spots?.map(([c, r]) => (
            <rect key={`open-${c},${r}`} x={c} y={r} width={1} height={1} class="spot-open" vector-effect="non-scaling-stroke" />
          ))}
          {place.top
            .filter((t, i) => i === 0 || t.p >= 0.01)
            .reverse()
            .map((t, i, arr) => (
              <rect
                key={`${t.col},${t.row}`}
                x={t.col}
                y={t.row}
                width={1}
                height={1}
                class={i === arr.length - 1 ? 'spot-best' : 'spot-other'}
                vector-effect="non-scaling-stroke"
              />
            ))}
        </svg>
      )}
    </div>
  );
}

/** Pieces can be scanned once set-up is finished (marker-free) or the markers are measured. */
function canScan(p: Project): boolean {
  return p.tracking === 'markers' ? Boolean(p.markerMap) : p.setupStep >= LAST_SETUP_STEP;
}
