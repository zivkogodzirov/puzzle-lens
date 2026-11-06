import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { go, routeArg } from '../router';
import { readerWorker, restartReader } from '../workers';
import { TableCamera, type CaptureMeta } from '../components/TableCamera';
import { deleteBlob, getProject, newId, projectBlobId, updateProject } from '../../project/store';
import { measurePitch, planMerge } from '../../project/catalog';
import { Coverage, sortingArea } from '../../scan/coverage';
import { markerCentres, type CaptureKind } from '../../scan/autoCapture';
import { applyH, invertH } from '../../geo/homography';
import { db } from '../../db/db';
import type { PieceRow, Project, SnapRow, Vec2 } from '../../project/types';
import { logError, logInfo } from '../../log/logger';
import { errorWords } from './Puzzle';

const SCAN_TIMEOUT_MS = 120_000;
/** How many scan photos keep their full-size picture. */
const KEEP_FULL_PHOTOS = 10;

/** Drops the full-size photo of all but the newest KEEP_FULL_PHOTOS scans (the snap records stay). */
async function pruneFullPhotos(projectId: string): Promise<void> {
  const scans = (await db().snaps.where('projectId').equals(projectId).toArray()).filter((s) => (s.kind === 'overview' || s.kind === 'detail') && s.blobId);
  scans.sort((a, b) => b.ts - a.ts);
  for (const s of scans.slice(KEEP_FULL_PHOTOS)) {
    await deleteBlob(s.blobId!);
    await db().snaps.update(s.id, { blobId: null });
  }
}

interface ScanNote {
  ok: boolean;
  lines: string[];
}

/** Pixels per mm at the image centre of a photo → table mapping. */
function pxPerMmOf(imgToTable: number[], width: number, height: number): number {
  const c: Vec2 = [(width - 1) / 2, (height - 1) / 2];
  const a = applyH(imgToTable, c);
  const b = applyH(imgToTable, [c[0] + 100, c[1]]);
  return 100 / Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Rebuilds the close-up coverage from the puzzle's earlier close-ups. */
function coverageFrom(project: Project, snaps: SnapRow[]): Coverage | null {
  if (!project.markerMap) return null;
  const cov = new Coverage(sortingArea(project.markerMap));
  for (const s of snaps) {
    if (s.kind !== 'detail' || !s.imgToTable) continue;
    const H = invertH(s.imgToTable);
    if (H) cov.addPhoto(H, { width: s.width, height: s.height }, pxPerMmOf(s.imgToTable, s.width, s.height));
  }
  return cov;
}

/**
 * Scanning pieces (PLAN §1 steps 1–3): one overview photo finds every piece and its colours; then
 * close-ups (2×) cover the table for shape reading. Each photo is checked, placed on the table and
 * merged into the catalog; grey outlines show what has been found.
 */
export function ScanScreen() {
  const id = routeArg.value;
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [pieces, setPieces] = useState<PieceRow[]>([]);
  const [snaps, setSnaps] = useState<SnapRow[]>([]);
  const [kind, setKind] = useState<CaptureKind>('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<ScanNote | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number; pxPerMm: number } | null>(null);
  const kindChosen = useRef(false);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const p = await getProject(id);
      setProject(p ?? null);
      if (!p) return;
      const [ps, ss] = await Promise.all([db().pieces.where('projectId').equals(id).toArray(), db().snaps.where('projectId').equals(id).toArray()]);
      setPieces(ps);
      setSnaps(ss);
      // The close-up view size comes from the newest close-up, if any.
      const lastDetail = ss.filter((s) => s.kind === 'detail' && s.imgToTable).sort((a, b) => b.ts - a.ts)[0];
      if (lastDetail) setFrameSize({ width: lastDetail.width, height: lastDetail.height, pxPerMm: pxPerMmOf(lastDetail.imgToTable!, lastDetail.width, lastDetail.height) });
      if (!kindChosen.current) setKind(ps.some((q) => q.status === 'table') ? 'detail' : 'overview');
    })();
  }, [id]);

  const coverage = useMemo(() => (project ? coverageFrom(project, snaps) : null), [project, snaps]);
  const target = useMemo(() => {
    if (kind !== 'detail' || !coverage || !project?.markerMap) return null;
    // The close-up's view on the table: from the last close-up, or the 2× nominal at ~62 cm with the
    // phone upright (portrait photo: ~335 mm across, ~447 mm away from you).
    const view: Vec2 = frameSize ? [frameSize.width / frameSize.pxPerMm, frameSize.height / frameSize.pxPerMm] : [335, 447];
    return coverage.nextTarget(view, markerCentres(project.markerMap));
  }, [kind, coverage, frameSize, project]);

  if (!id || project === null) {
    return (
      <main class="screen">
        <p>This puzzle is not on this iPhone.</p>
        <button class="btn btn-primary" onClick={() => go('home')}>
          Back to my puzzles
        </button>
      </main>
    );
  }
  if (project === undefined) return <main class="screen">Loading…</main>;
  if (!project.markerMap) {
    return (
      <main class="screen" data-testid="scan-needs-setup">
        <h1>Scan pieces</h1>
        <p>First lay out the markers and photograph the empty table (set-up step 5).</p>
        <button class="btn btn-primary btn-block" onClick={() => go('new', project.id)}>
          Continue set-up
        </button>
      </main>
    );
  }
  const map = project.markerMap;

  const onPhoto = async (blob: Blob, meta: CaptureMeta) => {
    setBusy(kind === 'overview' ? 'Finding pieces…' : 'Reading the close-up…');
    setNote(null);
    const snapId = newId();
    const zoom = meta.zoom >= 1.5 ? 2 : 1;
    try {
      const reader = readerWorker();
      const info = await reader.ready;
      if (!info?.ok) throw new Error(info?.error ?? 'The photo helper could not start');
      const pitch = project.piecePitch;
      const r = await Promise.race([
        reader.api.scanPhoto(blob, { map, table: project.tableModel, zoom, kind, pieceAreaMm2: pitch ? pitch.wMm * pitch.hMm * 1.05 : undefined }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Reading the photo took too long; please try again')), SCAN_TIMEOUT_MS)),
      ]);
      logInfo('scan', `${kind} photo: ${r.pieces.length} pieces in ${Math.round(r.ms)} ms`, { quality: r.quality, timings: r.timings, decodeMs: r.decodeMs });
      if (!r.imgToTable || !r.pxPerMm) {
        setNote({ ok: false, lines: ['No marker in this photo, so it can’t be placed on the table yet.', 'Aim so at least one marker card is in the picture.'] });
        return;
      }
      // Blurred or tilted close-ups would give wrong shapes: don't use them.
      const blocking = r.quality.reasons.filter((q) => /Blurred|Tilted/.test(q));
      if (blocking.length) {
        setNote({ ok: false, lines: [...blocking, 'Nothing was added from this photo.'] });
        return;
      }
      if (kind === 'detail') setFrameSize({ width: r.width, height: r.height, pxPerMm: r.pxPerMm });
      const now = Date.now();
      const existing = await db().pieces.where('projectId').equals(project.id).toArray();
      const plan = planMerge(
        existing,
        r.pieces.map((p, i) => ({ ...p, thumb: r.thumbs[i] ?? null })),
        { projectId: project.id, snapId, pxPerMm: r.pxPerMm, now, newId, thumbId: (pid) => projectBlobId(project.id, `thumb-${pid}`) },
      );
      const snap: SnapRow = {
        id: snapId,
        projectId: project.id,
        kind,
        ts: now,
        width: r.width,
        height: r.height,
        zoom,
        imgToTable: r.imgToTable,
        quality: r.quality,
        blobId: null,
        pieceIds: [...plan.added, ...plan.updates].map((p) => p.id),
      };
      // The full photo is kept for the latest KEEP_FULL_PHOTOS scans (they travel in backups, so the
      // owner can send real scans for checking); older ones are dropped to save space.
      const fullId = projectBlobId(project.id, `scan-${snapId}`);
      snap.blobId = fullId;
      // One transaction: if iOS closes the app half-way, nothing of this photo is half-saved.
      await db().transaction('rw', db().blobs, db().pieces, db().snaps, async () => {
        await db().blobs.bulkPut(plan.thumbs.map((t) => ({ id: t.id, ts: now, kind: 'thumb', blob: t.blob })));
        await db().blobs.put({ id: fullId, ts: now, kind: 'snap', blob, meta: { kind } });
        await db().pieces.bulkPut([...plan.updates, ...plan.added]);
        await db().snaps.put(snap);
      });
      await pruneFullPhotos(project.id);
      const all = await db().pieces.where('projectId').equals(project.id).toArray();
      const pitch2 = measurePitch(all.filter((p) => p.status === 'table'));
      const next = await updateProject(project.id, pitch2 ? { piecePitch: pitch2 } : {});
      setProject(next);
      setPieces(all);
      setSnaps((s) => [...s, snap]);
      const clumps = r.pieces.filter((p) => p.flags.clump).length;
      const weak = r.pieces.filter((p) => p.flags.weak).length;
      const lines = [
        kind === 'overview'
          ? `Found ${r.pieces.filter((p) => !p.flags.cut).length} pieces (${plan.added.length} new).`
          : `Close-up read: ${plan.updates.length + plan.added.length} pieces (${plan.added.length} new).`,
      ];
      if (clumps) lines.push(`${clumps === 1 ? 'One spot where pieces touch' : `${clumps} spots where pieces touch`} (orange dashes): spread them apart and take the photo again.`);
      if (weak) lines.push(`${weak} pale piece${weak > 1 ? 's' : ''} with a faint outline (yellow): check ${weak > 1 ? 'they are' : 'it is'} outlined right.`);
      for (const q of r.quality.reasons) if (!/Blurred|Tilted/.test(q)) lines.push(q);
      setNote({ ok: true, lines });
      if (kind === 'overview') {
        kindChosen.current = true;
        setKind('detail');
      }
    } catch (err) {
      logError('scan', 'Scan photo failed', err);
      setNote({ ok: false, lines: [errorWords(err)] });
      if (/too long/.test(String((err as Error)?.message))) restartReader();
    } finally {
      setBusy(null);
    }
  };

  const onTable = pieces.filter((p) => p.status === 'table');
  const covered = coverage ? Math.round(coverage.share() * 100) : 0;

  return (
    <TableCamera
      mode={kind}
      map={map}
      target={target}
      busy={busy}
      autoCapture={kind === 'overview' || target !== null}
      pieces={onTable}
      onPhoto={(b, m) => void onPhoto(b, m)}
      onClose={() => go('puzzle', project.id)}
    >
      <div class="scan-panel" data-testid="scan-panel">
        <div class="scan-counts">
          <span data-testid="scan-count">{onTable.length} pieces found</span>
          <span data-testid="scan-coverage">close-ups {covered}%</span>
        </div>
        <div class="row scan-modes">
          <button
            class="chip"
            aria-pressed={kind === 'overview'}
            data-testid="mode-overview"
            onClick={() => {
              kindChosen.current = true;
              setKind('overview');
            }}
          >
            Overview 1×
          </button>
          <button
            class="chip"
            aria-pressed={kind === 'detail'}
            data-testid="mode-detail"
            onClick={() => {
              kindChosen.current = true;
              setKind('detail');
            }}
          >
            Close-ups 2×
          </button>
        </div>
        {note && (
          <div class={note.ok ? 'notice notice-good scan-note' : 'notice notice-bad scan-note'} data-testid="scan-note" role="status">
            {note.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        )}
        {kind === 'detail' && !target && covered >= 98 && <p class="chip ok">All close-ups done ✓</p>}
      </div>
    </TableCamera>
  );
}
