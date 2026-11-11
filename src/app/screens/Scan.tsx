import { settings } from '../settings';
import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { go, routeArg, routeSub } from '../router';
import { readerWorker, restartReader, trackerWorker } from '../workers';
import { TableCamera, type CaptureMeta } from '../components/TableCamera';
import { TopBar } from '../components/TopBar';
import { TestStrip } from '../components/TestSteps';
import { plural } from '../words';
import { cameraState } from '../../camera/camera';
import { deleteBlob, getProject, newId, projectBlobId, putBlob, updateProject } from '../../project/store';
import { measurePitch, planMerge } from '../../project/catalog';
import { snapsOfBatch } from '../../project/batches';
import { markFromFinishedPhoto } from '../../project/placedFromPhoto';
import { Coverage, sortingArea, type Area } from '../../scan/coverage';
import { FREE_RULES, markerCentres, type CaptureKind } from '../../scan/autoCapture';
import { currentPieceList, piecesAfterMerge, readPieceList, type PieceList } from '../../scan/pieceReads';
import { applyH, invertH } from '../../geo/homography';
import { db } from '../../db/db';
import type { Grid, PhotoQuality, PieceRow, Project, SnapRow, Vec2 } from '../../project/types';
import type { FoundPiece } from '../../cv/pieceFinder';
import { coinById, MK_COINS, type CoinType } from '../../cv/coin';
import { DEFAULT_PITCH_MM } from '../../cv/pieceFinder';
import { REAL_PIECE_AREA_SHARE } from '../../cv/scanMarkerless';
import { CoverageMap, PhotoResult, type OutlineFlag } from '../components/ScanMaps';
import type { FinishedCheck, FreeScanReply } from '../../shared/apis';
import { logError, logInfo } from '../../log/logger';
import { errorWords } from './puzzle/shared';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/icons';

const SCAN_TIMEOUT_MS = 120_000;

/** One scan photo's result, whichever way it was placed (markers or pieces). */
interface Unified {
  pieces: FoundPiece[];
  thumbs: Array<Blob | null>;
  /** Placement patches (marker-free scans only). */
  patches?: FreeScanReply['patches'];
  imgToTable: number[] | null;
  pxPerMm: number | null;
  reasons: string[];
  width: number;
  height: number;
  quality: PhotoQuality;
}
/** Where a result note that doesn't fit gets room (styles.css needs-room): not on a phone held sideways. */
const ROOM_UPRIGHT = 'not all and (orientation: landscape) and (max-height: 500px)';

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

/** The area to cover with close-ups: inside the markers, or (marker-free) around the pieces found. */
function scanArea(project: Project, pieces: PieceRow[]): Area | null {
  if (project.tracking === 'markers') return project.markerMap ? sortingArea(project.markerMap) : null;
  const on = pieces.filter((p) => p.status === 'table' || p.status === 'pending');
  if (!on.length) return null;
  // 2nd–98th percentile, so one misplaced piece can't stretch the area; at most 1.5 m a side.
  const q = (v: number[], f: number) => v.slice().sort((a, b) => a - b)[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))]!;
  const xs = on.map((p) => p.table.x);
  const ys = on.map((p) => p.table.y);
  const m = 20;
  const cx = q(xs, 0.5);
  const cy = q(ys, 0.5);
  const clamp = (v: number, c: number) => Math.max(c - 750, Math.min(c + 750, v));
  return { x0: clamp(q(xs, 0.02) - m, cx), y0: clamp(q(ys, 0.02) - m, cy), x1: clamp(q(xs, 0.98) + m, cx), y1: clamp(q(ys, 0.98) + m, cy) };
}

/** Rebuilds the close-up coverage from the puzzle's earlier close-ups. */
function coverageFrom(project: Project, snaps: SnapRow[], pieces: PieceRow[]): Coverage | null {
  const area = scanArea(project, pieces);
  if (!area) return null;
  // Marker-free close-ups are judged by the live size estimate (≥ 7.5 px/mm), so count them from there.
  const cov = new Coverage(area, project.tracking === 'markers' ? 8.5 : 7.5);
  for (const s of snaps) {
    if (s.kind !== 'detail' || !s.imgToTable) continue;
    const H = invertH(s.imgToTable);
    if (H) cov.addPhoto(H, { width: s.width, height: s.height }, pxPerMmOf(s.imgToTable, s.width, s.height));
  }
  return cov;
}

/** Scales one photo's marker-free result by k (estimate mm → true mm). */
function scaleFoundPieces(f: { pieces: FoundPiece[]; imgToCatalog: number[] | null; pxPerMm: number | null }, k: number): void {
  for (const p of f.pieces) {
    p.outlineMm = p.outlineMm.map((v) => v * k);
    p.centreMm = [p.centreMm[0] * k, p.centreMm[1] * k];
    p.areaMm2 *= k * k;
    p.sizeMm = [p.sizeMm[0] * k, p.sizeMm[1] * k];
  }
  if (f.imgToCatalog) f.imgToCatalog = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => (row < 2 ? k : 1) * f.imgToCatalog![row * 3 + col]!));
  if (f.pxPerMm) f.pxPerMm /= k;
}

/** Rescales a puzzle's whole catalog and its photos' table mappings by k (one transaction). */
async function rescaleCatalog(projectId: string, k: number): Promise<void> {
  await db().transaction('rw', db().pieces, db().snaps, async () => {
    await db()
      .pieces.where('projectId')
      .equals(projectId)
      .modify((p) => {
        p.table = { ...p.table, x: p.table.x * k, y: p.table.y * k };
        p.outlineMm = p.outlineMm.map((v) => v * k);
        p.areaMm2 *= k * k;
        p.sizeMm = [p.sizeMm[0] * k, p.sizeMm[1] * k];
        p.bestPxPerMm /= k;
      });
    await db()
      .snaps.where('projectId')
      .equals(projectId)
      .modify((s) => {
        if (s.imgToTable) s.imgToTable = s.imgToTable.map((v, i) => (i < 6 ? v * k : v));
      });
  });
}

/**
 * Scanning pieces (PLAN §1 steps 1–3): one overview photo finds every piece and its colours; then
 * close-ups (2×) cover the table for shape reading. Each photo is checked, placed on the table and
 * merged into the catalog; grey outlines show what has been found.
 */
/**
 * One line of the result note. A "✓" in it ("Coin found ✓") is drawn as the check icon (M9 part 2); one in
 * quotes names a button ("✓ in the puzzle") and stays text.
 */
function NoteLine({ text }: { text: string }) {
  const parts = text.split(/(?<!")✓/);
  if (parts.length === 1) return <p>{text}</p>;
  return (
    <p>
      {parts.map((t, i) => (
        <Fragment key={i}>
          {i > 0 && <Icon name="check" size={16} class="inline-icon" />}
          {t}
        </Fragment>
      ))}
    </p>
  );
}

export function ScanScreen() {
  const id = routeArg.value;
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [pieces, setPieces] = useState<PieceRow[]>([]);
  const [snaps, setSnaps] = useState<SnapRow[]>([]);
  const [kind, setKind] = useState<CaptureKind>('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<ScanNote | null>(null);
  const [frameSize, setFrameSize] = useState<{
    width: number;
    height: number;
    pxPerMm: number;
  } | null>(null);
  const kindChosen = useRef(false);
  const [lastPhoto, setLastPhoto] = useState<{
    url: string;
    size: { width: number; height: number };
    outlines: Array<{ points: number[]; flag: OutlineFlag }>;
  } | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  // After a photo that couldn't be used, wait for a tap instead of firing again and again.
  const [autoPaused, setAutoPaused] = useState(false);
  // The result note shows what fits in its place. When part of it is out of view, "More ▾" says so and
  // opens all of it over the camera (review 2026-11-10: only its first lines showed, with no sign of the
  // rest). No photo is taken by itself while it is open.
  const noteRef = useRef<HTMLDivElement>(null);
  const [noteMore, setNoteMore] = useState(false);
  // Squeezed to its least (about two lines, on a small screen): "More ▾" goes on its top edge, so it
  // doesn't cover the last line that shows (check 2026-11-10).
  const [noteTight, setNoteTight] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  // The note that didn't all fit with everything else in place: until the next note, the coin choice
  // and (while no photo takes itself) the gauge's height line make room for it (styles.css needs-room).
  // Only that note: a short one keeps the full gauge and the coin choice (check 2026-11-10).
  const [roomFor, setRoomFor] = useState<ScanNote | null>(null);
  const roomRef = useRef<ScanNote | null>(null);
  roomRef.current = roomFor;
  const recheck = useRef<(() => void) | null>(null);
  useEffect(() => setNoteOpen(false), [note]);
  useLayoutEffect(() => {
    const el = noteRef.current;
    if (!el) {
      recheck.current = null;
      setNoteMore(false);
      setNoteTight(false);
      return;
    }
    const check = () => {
      // Words still below its window: the bottom of its last line of text (not of its last paragraph's
      // box, whose line spacing alone may be cut: check 2026-11-10, a two-line note that showed whole
      // lost the gauge's height line). None once scrolled to the end.
      const last = el.lastElementChild;
      let bottom = -Infinity;
      if (last) {
        const range = document.createRange();
        range.selectNodeContents(last);
        for (const r of range.getClientRects()) if (r.height > 0) bottom = Math.max(bottom, r.bottom);
        if (bottom === -Infinity) bottom = last.getBoundingClientRect().bottom;
      }
      const hidden = bottom - (el.getBoundingClientRect().top + el.clientTop + el.clientHeight) > 2;
      // Even its least (about two lines) doesn't fit below what is drawn at the top: it lies over the
      // gauge's words, or over the button or box there (check 2026-11-10, a two-line note on a small
      // screen). Only reaching into the room's own 8 px margin doesn't count (a later check: on an SE
      // the gauge then shrank with its words still well clear of the note).
      const gauge = el.closest('.table-camera')?.querySelector('[data-testid="level-gauge"]');
      const room = el.closest('.table-camera-extra');
      const above = gauge ? gauge.getBoundingClientRect().bottom : room ? room.getBoundingClientRect().top - 8 : -Infinity;
      const squeezed = el.getBoundingClientRect().top < above - 1;
      setNoteTight(el.clientHeight < 60);
      // It doesn't fit: first it gets the room (upright only, where styles.css gives it); "More ▾" is
      // decided again once the room is there (the effect on roomFor below), so it doesn't flash. Sideways
      // the note has its own column and gets no room, so the flag isn't set there (check 2026-11-10: set
      // sideways, it stayed on back upright where the note fitted).
      if ((hidden || squeezed) && roomRef.current !== note && matchMedia(ROOM_UPRIGHT).matches) {
        setRoomFor(note);
        return;
      }
      setNoteMore(hidden);
    };
    recheck.current = check;
    check();
    // On a resize, checked in the next frame: the room it may give changes the note's size again, which
    // within the same frame is a "ResizeObserver loop" error.
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    });
    ro.observe(el);
    el.addEventListener('scroll', check, { passive: true });
    // Turned upright or sideways: checked before that frame is drawn (from the next frame, the first
    // upright frame showed the note without its room: check 2026-11-10).
    const upright = matchMedia(ROOM_UPRIGHT);
    upright.addEventListener('change', check);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      el.removeEventListener('scroll', check);
      upright.removeEventListener('change', check);
    };
  }, [note]);
  // The room is there now (or gone), or photos stopped or started taking themselves (the gauge's size):
  // measured again before the screen shows it.
  useLayoutEffect(() => recheck.current?.(), [roomFor, autoPaused]);
  /** Sharpness of the good photos so far, per kind: a photo far below them is blurred. */
  const sharpSeen = useRef<Record<string, number[]>>({});
  const lastUrl = useRef<string | null>(null);
  lastUrl.current = lastPhoto?.url ?? null;
  useEffect(
    () => () => {
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    },
    [],
  );

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const p = await getProject(id);
      setProject(p ?? null);
      if (!p) return;
      const [ps, ss0] = await Promise.all([db().pieces.where('projectId').equals(id).toArray(), db().snaps.where('projectId').equals(id).toArray()]);
      // Only this batch's photos (M7): earlier batches show another table layout.
      const ss = snapsOfBatch(p, ss0);
      setPieces(ps);
      setSnaps(ss);
      // The close-up view size comes from the newest close-up, if any.
      const lastDetail = ss.filter((s) => s.kind === 'detail' && s.imgToTable).sort((a, b) => b.ts - a.ts)[0];
      if (lastDetail)
        setFrameSize({
          width: lastDetail.width,
          height: lastDetail.height,
          pxPerMm: pxPerMmOf(lastDetail.imgToTable!, lastDetail.width, lastDetail.height),
        });
      if (!kindChosen.current) setKind(settings.scanMode.value === 'full' && ps.some((q) => q.status === 'table') ? 'detail' : 'overview');
    })();
  }, [id]);

  const coverage = useMemo(() => (project ? coverageFrom(project, snaps, pieces) : null), [project, snaps, pieces]);
  const target = useMemo(() => {
    if (kind !== 'detail' || !coverage || !project) return null;
    // The close-up's view on the table: from the last close-up, or the 2× nominal at ~62 cm with the
    // phone upright (portrait photo: ~335 mm across, ~447 mm away from you).
    const view: Vec2 = frameSize ? [frameSize.width / frameSize.pxPerMm, frameSize.height / frameSize.pxPerMm] : [335, 447];
    return coverage.nextTarget(view, project.markerMap ? markerCentres(project.markerMap) : undefined);
  }, [kind, coverage, frameSize, project]);
  const viewMm: Vec2 | null = frameSize ? [frameSize.width / frameSize.pxPerMm, frameSize.height / frameSize.pxPerMm] : [335, 447];

  // The photo helper starts when the screen opens, so its start-up (loading OpenCV) is over before
  // the first photo instead of adding to its wait (M8 part 4, 2026-11-10). A warm-up read of a
  // made-up picture was tried as well: in Safari it made the first real photo slower, so it isn't done.
  // It waits for the live tracker (which the camera starts) to be ready, so the live view isn't
  // slowed down; after 3 s it starts anyway. A photo taken before that starts the helper itself.
  const canScan = Boolean(project && (project.tracking !== 'markers' || project.markerMap));
  useEffect(() => {
    if (!canScan) return;
    let left = false;
    const start = () => {
      if (!left) readerWorker();
    };
    const timer = setTimeout(start, 3000);
    void trackerWorker().ready.then(() => {
      clearTimeout(timer);
      start();
    });
    return () => {
      left = true;
      clearTimeout(timer);
    };
  }, [canScan]);

  if (!id || project === null) {
    return (
      <main class="screen" data-testid="scan-missing">
        <TopBar title="Scan pieces" />
        <Callout kind="bad" role="alert" icon={<Icon name="alert-triangle" size={20} />}>
          This puzzle is not on this iPhone (it may have been deleted).
        </Callout>
        <button type="button" class="btn btn-filled btn-block" onClick={() => go('home')}>
          Back to my puzzles
        </button>
      </main>
    );
  }
  if (project === undefined) return <main class="screen">Loading…</main>;
  const free = project.tracking !== 'markers';
  if (!free && !project.markerMap) {
    return (
      <main class="screen" data-testid="scan-needs-setup">
        <TopBar title="Scan pieces" back={{ label: project.name, route: 'puzzle', arg: project.id }} />
        <p>First lay out the markers and photograph the empty table (set-up step 5).</p>
        <button type="button" class="btn btn-filled btn-block" onClick={() => go('new', project.id)}>
          Continue set-up
        </button>
      </main>
    );
  }
  const map = project.markerMap;
  const coinType = coinById(project.coin);
  const pitchMm = project.piecePitch ? Math.sqrt(project.piecePitch.wMm * project.piecePitch.hMm) : DEFAULT_PITCH_MM;

  const onPhoto = async (blob: Blob, meta: CaptureMeta) => {
    setBusy(kind === 'overview' ? 'Finding pieces…' : 'Reading the close-up…');
    setNote(null);
    const snapId = newId();
    const coinLines: string[] = [];
    let scaleChanged: { k: number; coin: CoinType } | null = null;
    const zoom = meta.zoom >= 1.5 ? 2 : 1;
    try {
      const reader = readerWorker();
      const info = await reader.ready;
      if (!info?.ok) throw new Error(info?.error ?? 'The photo helper could not start');
      const pitch = project.piecePitch;
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Reading the photo took too long; please try again')), SCAN_TIMEOUT_MS));
      let r: Unified;
      // Read once here and used again for the merge below while no piece row was written meanwhile.
      let first: PieceList | null = null;
      if (free) {
        first = await readPieceList(project.id);
        const catalog = first.rows
          .filter((p) => p.status === 'table' || p.status === 'pending')
          .map((p) => ({
            id: p.id,
            table: p.table,
            areaMm2: p.areaMm2,
            sizeMm: p.sizeMm,
            colour: p.colour,
            status: p.status,
          }));
        const f = await Promise.race([
          reader.api.scanFree(blob, {
            catalog,
            pitchMm,
            zoom,
            kind,
            table: null,
            // Looked for in every photo once a coin is chosen, so it is never taken for a piece (it was
            // only looked for until it had measured the scale: later scans added it as a piece, M5 part 3).
            findCoin: Boolean(coinType),
            pieceCount: project.pieceCount || undefined,
            grid: project.grid ? { cols: project.grid.cols, rows: project.grid.rows } : null,
            // The newest photo of this batch of the same kind at the same zoom: start detection at its
            // scale (M8 part 3). Not a close-up's for an overview or the other way round: they are taken
            // from different heights, and a wrong start can spoil the photo (review 2026-11-10).
            scaleHint: (() => {
              const last = snaps.filter((s) => s.kind === kind && s.imgToTable && Math.abs(s.zoom - zoom) < 0.5).sort((a, b) => b.ts - a.ts)[0];
              return last ? { pxPerMm: pxPerMmOf(last.imgToTable!, last.width, last.height), maxSide: Math.max(last.width, last.height) } : null;
            })(),
          }),
          timeout,
        ]);
        logInfo(
          'scan',
          `${kind} photo (no markers): ${f.pieces.length} pieces, ${f.registered ? `placed by ${f.inliers} pieces (±${f.rmsMm.toFixed(1)} mm)` : f.isNewFrame ? 'first photo' : 'not placed'} in ${Math.round(f.ms)} ms`,
          { timings: f.timings, confidence: f.confidence },
        );
        setLastPhoto((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return {
            url: URL.createObjectURL(f.preview),
            size: f.previewSize,
            outlines: f.finished
              ? finishedOutlines(f.finished)
              : [
                  ...f.regionsPreview.map((g) => ({ points: g.points, flag: g.kind })),
                  ...f.outlinesPreview.map((pts, i) => ({
                    points: pts,
                    flag: (f.pieces[i]!.flags.clump ? 'clump' : f.pieces[i]!.flags.weak ? 'weak' : 'ok') as OutlineFlag,
                  })),
                ],
          };
        });
        if (f.finished) {
          // A finished puzzle: report the count and any gaps; nothing goes into the catalog.
          logInfo(
            'scan',
            `Finished puzzle: ${f.finished.cols} × ${f.finished.rows} (${f.finished.colsExact.toFixed(2)} × ${f.finished.rowsExact.toFixed(2)}), ${f.finished.gaps.length} gaps, seams ${f.finished.seamStrength.toFixed(2)}`,
          );
          setAutoPaused(true);
          let next = project;
          const extra: string[] = [];
          try {
            // A count that doesn't match the puzzle's grid is not trusted: nothing is saved or marked
            // from it (review 2026-11-10: a puzzle part done, read as finished 18 × 55, would have
            // replaced the saved empty spots). The note says to check the grid.
            if (!gridMatches(project.grid, f.finished)) {
              logInfo('scan', `Finished-puzzle count ${f.finished.cols} × ${f.finished.rows} doesn't match the grid: nothing saved`);
            } else {
              // The puzzle finished since the last photo of it (M7 part 4): the pieces the app had for
              // its empty spots went in.
              if (!f.finished.gaps.length && project.openSpots) {
                const r = await markFromFinishedPhoto(project.id);
                if (r.filled) {
                  logInfo('scan', `Finished puzzle photo: ${r.filled} spots filled since the last one; ${r.ids.length} pieces marked as in the puzzle`);
                  extra.push(
                    `All ${r.filled} empty ${r.filled === 1 ? 'spot is' : 'spots are'} filled now. ${r.ids.length} of the pieces the app had for them ${r.ids.length === 1 ? 'is' : 'are'} counted as in the puzzle (Undo: "✓ in the puzzle" on the puzzle page).`,
                  );
                }
              }
              next = await saveOpenSpots(project, f.finished);
              setProject(next);
            }
          } catch (err) {
            logError('scan', 'The empty spots could not be saved', err);
          }
          setNote({ ok: true, lines: [...finishedLines(f.finished, next), ...extra] });
          return;
        }
        if (f.isNewFrame && f.pieces.filter((p) => !p.flags.cut).length < 5) {
          setAutoPaused(true);
          setNote({
            ok: false,
            lines: ['Hardly any pieces in this photo, so it wasn’t used.', 'Hold the phone over the spread-out pieces and tap the button.'],
          });
          return;
        }
        // Without markers, blur is judged against the earlier good photos of the same kind, and
        // tilt from the phone's sensor at the moment of the photo.
        const seen = sharpSeen.current[kind] ?? [];
        const med = seen.length ? seen.slice().sort((a, b) => a - b)[Math.floor(seen.length / 2)]! : null;
        const extra: string[] = [];
        if (med !== null && f.sharpness < 0.35 * med) extra.push('Blurred: hold the phone still');
        const maxTilt = kind === 'detail' ? FREE_RULES.detail.maxTiltDeg : FREE_RULES.overview.maxTiltDeg;
        if (meta.sensorTiltDeg !== null && meta.sensorTiltDeg > maxTilt + 2) extra.push('Tilted: hold the phone flat');
        if (extra.length) f.reasons = [...extra, ...f.reasons];
        else sharpSeen.current[kind] = [...seen, f.sharpness].slice(-10);
        if (!f.registered && !f.isNewFrame) {
          setAutoPaused(true);
          // Keep the last photo that couldn't be placed (one, overwritten), for reports and checking.
          void db()
            .blobs.put({
              id: projectBlobId(project.id, 'last-unplaced'),
              ts: Date.now(),
              kind: 'snap-unplaced',
              blob,
              meta: { kind, zoom, pitchMm, pieces: f.pieces.length },
            })
            .catch(() => {});
          setNote({
            ok: false,
            lines: [
              'This photo could not be matched to the pieces found so far.',
              'Include more of the same pieces (keep about half the picture on pieces already scanned) and try again.',
            ],
          });
          return;
        }
        // The coin: the true size. The catalog so far (and this photo) are rescaled from the
        // typical-piece estimate to real millimetres.
        if (coinType && kind === 'overview' && project.scaleSource !== 'coin') {
          if (f.coin) {
            const k = coinType.diameterMm / f.coin.diameterCatalogMm;
            if (k < 0.6 || k > 1.6) {
              coinLines.push(
                `The coin measured ${Math.round(f.coin.diameterCatalogMm)} mm against ${coinType.diameterMm} mm for a ${coinType.label}: is it the right coin? Sizes stay estimates (≈).`,
              );
            } else {
              // Applied only once the photo is accepted (below), so a rejected photo changes nothing.
              scaleChanged = { k, coin: coinType };
              coinLines.push(
                settings.testerMode.value
                  ? `Coin found ✓ Sizes are now measured (the estimate was ${Math.abs(Math.round((k - 1) * 100))} % ${k > 1 ? 'small' : 'big'}).`
                  : 'Coin found ✓ Sizes are now measured.',
              );
            }
          } else {
            coinLines.push(`No ${coinType.label} coin found in this photo: sizes stay estimates (≈). Put it flat on the table, away from the pieces.`);
          }
        }
        r = {
          pieces: f.pieces,
          thumbs: f.thumbs,
          patches: f.patches,
          imgToTable: f.imgToCatalog,
          pxPerMm: f.pxPerMm,
          reasons: f.reasons,
          width: f.width,
          height: f.height,
          quality: {
            ok: f.reasons.length === 0,
            reasons: f.reasons,
            sharpness: f.sharpness,
            clippedShare: f.clippedShare,
            glareShare: 0,
            tiltDeg: null,
            heightMm: null,
            markersSeen: 0,
          },
        };
      } else {
        const m = await Promise.race([
          reader.api.scanPhoto(blob, {
            map: map!,
            table: project.tableModel,
            zoom,
            kind,
            pieceAreaMm2: pitch ? pitch.wMm * pitch.hMm * 1.05 : undefined,
          }),
          timeout,
        ]);
        logInfo('scan', `${kind} photo: ${m.pieces.length} pieces in ${Math.round(m.ms)} ms`, { quality: m.quality, timings: m.timings, decodeMs: m.decodeMs });
        if (!m.imgToTable || !m.pxPerMm) {
          setNote({
            ok: false,
            lines: ['No marker in this photo, so it can’t be placed on the table yet.', 'Aim so at least one marker card is in the picture.'],
          });
          return;
        }
        r = {
          pieces: m.pieces,
          thumbs: m.thumbs,
          imgToTable: m.imgToTable,
          pxPerMm: m.pxPerMm,
          reasons: m.quality.reasons,
          width: m.width,
          height: m.height,
          quality: m.quality,
        };
      }
      if (!r.imgToTable || !r.pxPerMm) {
        setNote({
          ok: false,
          lines: ['No pieces could be measured in this photo. Point at the pieces and try again.'],
        });
        return;
      }
      // Blurred or tilted close-ups would give wrong shapes: don't use them.
      const blocking = r.reasons.filter((q) => /Blurred|Tilted/.test(q));
      if (blocking.length) {
        setAutoPaused(true);
        setNote({
          ok: false,
          lines: [...blocking, 'Nothing was added from this photo.'],
        });
        return;
      }
      if (scaleChanged) {
        const k = scaleChanged.k;
        const scaled = { pieces: r.pieces, imgToCatalog: r.imgToTable, pxPerMm: r.pxPerMm };
        scaleFoundPieces(scaled, k);
        r = { ...r, imgToTable: scaled.imgToCatalog, pxPerMm: scaled.pxPerMm };
        await rescaleCatalog(project.id, k);
        setFrameSize((fs) => fs && { ...fs, pxPerMm: fs.pxPerMm / k });
      }
      if (!r.pxPerMm) return;
      if (kind === 'detail') setFrameSize({ width: r.width, height: r.height, pxPerMm: r.pxPerMm });
      const now = Date.now();
      // The same rows as above unless something wrote piece rows since (e.g. the coin rescale).
      const list = await currentPieceList(first, project.id);
      const existing = list.rows;
      const plan = planMerge(
        existing,
        r.pieces.map((p, i) => {
          const pt = r.patches?.[i];
          return {
            ...p,
            thumb: r.thumbs[i] ?? null,
            patch: pt
              ? {
                  blob: new Blob([pt.rgba as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }),
                  flats: pt.flats,
                  sure: pt.sure,
                  sides: pt.sides,
                  sideConf: pt.sideConf,
                  light: pt.light ?? null,
                  fp: pt.fp ?? null,
                }
              : null,
          };
        }),
        {
          projectId: project.id,
          snapId,
          pxPerMm: r.pxPerMm,
          now,
          newId,
          thumbId: (pid) => projectBlobId(project.id, `thumb-${pid}`),
          patchId: (pid) => projectBlobId(project.id, `patch-${pid}`),
          // The photo's view on the table, to notice pieces that were moved or taken away.
          view: (
            [
              [0, 0],
              [r.width - 1, 0],
              [r.width - 1, r.height - 1],
              [0, r.height - 1],
            ] as Vec2[]
          ).map((c) => applyH(r.imgToTable!, c)),
        },
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
        pieceIds: [...plan.added, ...plan.updates.filter((p) => p.status === 'table' || p.status === 'pending')].map((p) => p.id),
      };
      // The full photo is kept for the latest KEEP_FULL_PHOTOS scans (they travel in backups, so the
      // owner can send real scans for checking); older ones are dropped to save space.
      const fullId = projectBlobId(project.id, `scan-${snapId}`);
      snap.blobId = fullId;
      // One transaction: if iOS closes the app half-way, nothing of this photo is half-saved.
      await db().transaction('rw', db().blobs, db().pieces, db().snaps, async () => {
        await db().blobs.bulkPut(
          plan.thumbs.map((t) => ({
            id: t.id,
            ts: now,
            kind: 'thumb',
            blob: t.blob,
          })),
        );
        await db().blobs.bulkPut(plan.patches.map((t) => ({ id: t.id, ts: now, kind: 'patch', blob: t.blob })));
        await db().blobs.put({
          id: fullId,
          ts: now,
          kind: 'snap',
          blob,
          meta: { kind },
        });
        await db().pieces.bulkPut([...plan.updates, ...plan.added]);
        // Pieces to check that this photo settled: merged into the known piece (M5 part 3).
        if (plan.removed.length) await db().pieces.bulkDelete(plan.removed);
        await db().snaps.put(snap);
      });
      await pruneFullPhotos(project.id);
      // What the transaction above left, taken from the plan when it was the only piece write since
      // the rows were read (otherwise read back).
      const all = await piecesAfterMerge(list, plan);
      const measured = measurePitch(all.filter((p) => p.status === 'table'));
      // Marker-free: a piece's found top face is ~79 % of its cell (REAL_PIECE_AREA_SHARE), so the
      // cell pitch is the face size ÷ √0.79. (Marker puzzles keep the face-size meaning they use.)
      const toCell = free ? 1 / Math.sqrt(REAL_PIECE_AREA_SHARE) : 1;
      const pitch2 = measured ? { ...measured, wMm: measured.wMm * toCell, hMm: measured.hMm * toCell } : null;
      const next = await updateProject(project.id, { ...(pitch2 ? { piecePitch: pitch2 } : {}), ...(scaleChanged ? { scaleSource: 'coin' as const } : {}) });
      setProject(next);
      setPieces(all);
      if (scaleChanged) setSnaps(snapsOfBatch(next, await db().snaps.where('projectId').equals(project.id).toArray()));
      else setSnaps((s) => [...s, snap]);
      const lines0: string[] = [];
      if (plan.moved || plan.missing) logInfo('scan', `Moved pieces recognised: ${plan.moved}; no longer at their spot: ${plan.missing}`);
      if (plan.back)
        lines0.push(
          `${plan.back === 1 ? '1 piece' : `${plan.back} pieces`} set aside in an earlier batch ${plan.back === 1 ? 'is' : 'are'} back: recognised, not counted again.`,
        );
      const movedHere = plan.moved - plan.back;
      if (movedHere) lines0.push(`${movedHere === 1 ? '1 piece was' : `${movedHere} pieces were`} moved: recognised, not counted again.`);
      if (plan.pending)
        lines0.push(
          `${plan.pending === 1 ? '1 piece' : `${plan.pending} pieces`} may be ${plan.pending === 1 ? 'one' : 'ones'} you moved: check ${plan.pending === 1 ? 'it' : 'them'} on the puzzle page ("Pieces to check"), or take a close-up.`,
        );
      if (plan.missing)
        lines0.push(
          `${plan.missing === 1 ? '1 piece is' : `${plan.missing} pieces are`} no longer where ${plan.missing === 1 ? 'it was' : 'they were'} (taken away, or moved out of view).`,
        );
      const clumps = r.pieces.filter((p) => p.flags.clump).length;
      const weak = r.pieces.filter((p) => p.flags.weak).length;
      const lines: string[] = [
        kind === 'overview'
          ? `Found ${plural(r.pieces.filter((p) => !p.flags.cut).length, 'piece')} (${plan.added.length} new).`
          : `Close-up read: ${plural(plan.updates.length - plan.missing + plan.added.length, 'piece')} (${plan.added.length} new).`,
        ...lines0,
      ];
      if (clumps)
        lines.push(
          `${clumps === 1 ? 'One spot where pieces touch' : `${clumps} spots where pieces touch`} (orange dashes): spread them apart and take the photo again.`,
        );
      const part = r.pieces.filter((p) => p.flags.part).length;
      const faint = weak - part;
      if (faint)
        lines.push(`${faint} pale piece${faint > 1 ? 's' : ''} with a faint outline (yellow): check ${faint > 1 ? 'they are' : 'it is'} outlined right.`);
      if (part)
        lines.push(
          `${part === 1 ? '1 piece' : `${part} pieces`} only partly outlined (yellow, smaller than the others): ${part === 1 ? 'its' : 'their'} shape is not used. A close-up helps.`,
        );
      for (const q of r.reasons) if (!/Blurred|Tilted/.test(q)) lines.push(q);
      lines.unshift(...coinLines);
      if (kind === 'overview' && settings.scanMode.value === 'quick') lines.push('Quick scan done. Close-ups (2×) read the shapes better, if you want them.');
      setNote({ ok: true, lines });
      setAutoPaused(false);
      // Full scan mode: close-ups next. Quick: stay on overviews (M5 part 4).
      if (kind === 'overview' && settings.scanMode.value === 'full') {
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

  const onTable = pieces.filter((p) => p.status === 'table' || p.status === 'pending');
  const covered = coverage ? Math.round(coverage.share() * 100) : 0;
  // Camera refused or paused: no map or "Aim at…" (nothing to aim with), so the panel stays short.
  const cameraOff = cameraState.value === 'error' || cameraState.value === 'paused';
  // Paused: TableCamera shows "Resume camera" in the middle of the screen; with a note it moves up under
  // the top bar and the panel keeps below it (styles.css .scan-panel.camera-paused, 2026-11-10: the note
  // covered it). Refused: "Start camera" is in the problem box at the top.
  const paused = cameraState.value === 'paused';

  return (
    <>
      <TableCamera
        mode={kind}
        map={map}
        target={target}
        busy={busy}
        autoCapture={!autoPaused && !noteOpen && (kind === 'overview' || target !== null)}
        pieces={free ? undefined : onTable}
        free={free ? { pitchMm } : null}
        onPhoto={(b, m) => void onPhoto(b, m)}
        // M9 part 4 picture: opened from the Picture tab's "Photograph the puzzle so far" (#/scan/<id>/picture), it returns there.
        onClose={() => go('puzzle', project.id, routeSub.value === 'picture' ? 'picture' : null)}
      >
        {/* auto-off: no photo takes itself (after a finished puzzle or a photo that couldn't be used);
            needs-room: the note didn't all fit. With both, the gauge is smaller and the note gets the room
            (styles.css, 2026-11-10). */}
        <div
          class={`scan-panel${note ? ' has-note' : ''}${note && roomFor === note ? ' needs-room' : ''}${paused ? ' camera-paused' : ''}${autoPaused ? ' auto-off' : ''}`}
          data-testid="scan-panel"
        >
          {/* The result of the last photo, at the top of the panel until it is tapped away or the next
              photo starts (M8 part 4, 2026-11-10): fixed near the top of the screen, it covered the
              gauge's instruction and the buttons. While it shows, the panel reaches up to what is drawn
              at the top and the note gets that room first (styles.css); what doesn't fit scrolls, with
              "More ▾" to open all of it. On a phone held sideways it sits in the free column on the left. */}
          {note && (
            <div class={noteTight ? 'scan-note-box tight' : 'scan-note-box'}>
              <div
                ref={noteRef}
                class={note.ok ? 'notice notice-good scan-note scan-note-panel' : 'notice notice-bad scan-note scan-note-panel'}
                data-testid="scan-note"
                role="status"
                onClick={() => setNote(null)}
              >
                {note.lines.map((l) => (
                  <NoteLine key={l} text={l} />
                ))}
              </div>
              {noteMore && (
                <button type="button" class="scan-note-more" data-testid="scan-note-more" onClick={() => setNoteOpen(true)}>
                  More
                  <Icon name="chevron-down" size={14} />
                </button>
              )}
            </div>
          )}
          <div class="scan-counts">
            <span data-testid="scan-count">{plural(onTable.length, 'piece')} found</span>
            <span data-testid="scan-coverage">close-ups {covered}%</span>
          </div>
          <div class="row scan-modes">
            <button
              class="chip"
              aria-pressed={kind === 'overview'}
              data-testid="mode-overview"
              onClick={() => {
                kindChosen.current = true;
                setAutoPaused(false);
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
                setAutoPaused(false);
                setKind('detail');
              }}
            >
              Close-ups 2×
            </button>
          </div>
          {free && kind === 'detail' && target && !cameraOff && <p class="chip scan-aim">Aim at the dashed box on the map</p>}
          {free && kind === 'overview' && project.scaleSource !== 'coin' && (
            <label class="chip coin-pick">
              Coin for true size:{' '}
              <select
                data-testid="coin-select"
                value={project.coin ?? ''}
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value || null;
                  void updateProject(project.id, { coin: v }).then(setProject);
                }}
              >
                <option value="">none</option>
                {MK_COINS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({c.diameterMm} mm)
                  </option>
                ))}
              </select>
            </label>
          )}
          {/* No camera, nothing to aim with: the map (and "Aim at…") are left out. */}
          {free && !cameraOff && <CoverageMap pieces={onTable} coverage={coverage} target={kind === 'detail' ? target : null} view={viewMm} />}
          {/* Side by side (they wrap on a narrow screen): one row less, so the note and the map fit. */}
          {(free || lastPhoto) && (
            <div class="row scan-photo-row">
              {free && (
                <label class="chip pick-photo" data-testid="pick-photo">
                  <Icon name="image" size={20} />
                  Choose a photo
                  <input
                    type="file"
                    accept="image/*"
                    data-testid="pick-photo-input"
                    hidden
                    onClick={() => setAutoPaused(true)}
                    onChange={(e) => {
                      const input = e.currentTarget as HTMLInputElement;
                      const file = input.files?.[0];
                      input.value = '';
                      // A photo from the library goes through exactly the same reading as a camera photo
                      // (as an overview or a 2× close-up, whichever is selected above).
                      if (file) void onPhoto(file, { zoom: kind === 'detail' ? 2 : 1, fix: null, auto: false, sensorTiltDeg: null });
                    }}
                  />
                </label>
              )}
              {lastPhoto && (
                <button class="chip" data-testid="show-photo" onClick={() => setShowPhoto(true)}>
                  See the last photo
                </button>
              )}
            </div>
          )}
          {kind === 'detail' && !target && covered >= 98 && (
            <p class="chip ok">
              All close-ups done <Icon name="check" size={18} />
            </p>
          )}
        </div>
      </TableCamera>
      {showPhoto && lastPhoto && <PhotoResult url={lastPhoto.url} size={lastPhoto.size} outlines={lastPhoto.outlines} onClose={() => setShowPhoto(false)} />}
      {/* All of the note, over the camera; a tap anywhere closes it (the note stays). */}
      {noteOpen && note && (
        <div class="scan-note-sheet" data-testid="scan-note-sheet" onClick={() => setNoteOpen(false)}>
          <TestStrip />
          <div class={note.ok ? 'notice notice-good' : 'notice notice-bad'}>
            {note.lines.map((l) => (
              <NoteLine key={l} text={l} />
            ))}
          </div>
          <button type="button" class="btn btn-filled" data-testid="scan-note-close">
            Close
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Keeps the empty spots of a nearly finished puzzle (with its picture straightened small): the
 * leftover pieces are then placed only there. A photo with no gaps clears them.
 */
export async function saveOpenSpots(project: Project, fin: FinishedCheck): Promise<Project> {
  const id = projectBlobId(project.id, 'open-spots');
  if (fin.gaps.length && fin.thumb) {
    await putBlob(id, 'open-spots', fin.thumb);
    return updateProject(project.id, {
      openSpots: { cols: fin.cols, rows: fin.rows, gaps: fin.gaps, gapSides: fin.gapSides, thumbBlobId: id, ts: Date.now() },
      finishedAt: null,
    });
  }
  if (!fin.gaps.length) {
    // Complete: no empty spots left (M7 part 4: the progress page counts every piece as in).
    const next = await updateProject(project.id, { openSpots: null, finishedAt: Date.now() });
    if (project.openSpots) await deleteBlob(id);
    return next;
  }
  return project;
}

/** The finished-puzzle count is the puzzle's grid, either way round (true when no grid is set). */
export function gridMatches(g: Pick<Grid, 'cols' | 'rows'> | null | undefined, fin: Pick<FinishedCheck, 'cols' | 'rows'>): boolean {
  return !g || (g.cols === fin.cols && g.rows === fin.rows) || (g.cols === fin.rows && g.rows === fin.cols);
}

/**
 * The finished-puzzle check in plain words. What to do next (the saved empty spots, the loose pieces
 * beside the puzzle) comes right after the count, before the long list of gaps: on a small screen the
 * note shows only its first lines (review 2026-11-10).
 */
export function finishedLines(fin: FinishedCheck, project: Pick<Project, 'grid' | 'pieceCount' | 'box' | 'openSpots'>): string[] {
  const n = fin.cols * fin.rows;
  const gaps = fin.gaps.length;
  const lines = [`Finished puzzle: ${fin.cols} across × ${fin.rows} down = ${n.toLocaleString('en')} pieces, counted from the seams.`];
  const g = project.grid;
  const same = gridMatches(g, fin);
  if (g) {
    lines.push(
      same
        ? `That matches your puzzle (${g.cols} × ${g.rows}).`
        : `Your puzzle is set to ${g.cols} × ${g.rows}, so nothing was saved from this photo: check the grid, or take the photo again from straight above.`,
    );
  }
  if (same && gaps && project.openSpots && project.openSpots.gaps.length === gaps)
    lines.push(
      project.box
        ? `Saved: your leftover pieces will now be matched only to these ${gaps} empty spots, one piece per spot. Scan the leftover pieces (or open Pieces on the puzzle's page).`
        : `Saved these ${gaps} empty spots: add the box picture and your leftover pieces will be matched only to them.`,
    );
  // Loose pieces lying beside the puzzle are not added from this photo: say so (2026-11-10: they used
  // to be skipped without a word).
  const loose = fin.loose ?? 0;
  if (loose === 1) lines.push('1 loose piece lies next to the puzzle. It was not added: to add it, take a photo of it away from the puzzle.');
  else if (loose > 1)
    lines.push(`About ${loose} loose pieces lie next to the puzzle. They were not added: to add them, take a photo of them away from the puzzle.`);
  if (!gaps) lines.push('No gaps found: every spot has a piece.');
  else {
    const list = fin.gaps
      .slice(0, 6)
      .map(([c, r]) => `column ${c + 1}, row ${r + 1}`)
      .join('; ');
    lines.push(
      `${gaps === 1 ? '1 possible gap' : `${gaps} possible gaps`} (red squares on the last photo; counted from the top left): ${list}${gaps > 6 ? '; …' : ''}.`,
    );
  }
  lines.push('This photo is not added to your pieces.');
  return lines;
}

/** The puzzle's frame and a red square on each gap, for the photo result. */
function finishedOutlines(fin: FinishedCheck): Array<{ points: number[]; flag: OutlineFlag }> {
  const c = fin.cornersPreview;
  const side = Math.min(Math.hypot(c[1]![0] - c[0]![0], c[1]![1] - c[0]![1]) / fin.cols, Math.hypot(c[3]![0] - c[0]![0], c[3]![1] - c[0]![1]) / fin.rows);
  const h = side * 0.45;
  return [
    { points: c.flat(), flag: 'finished' },
    ...fin.gapsPreview.map(([x, y]) => ({ points: [x - h, y - h, x + h, y - h, x + h, y + h, x - h, y + h], flag: 'gap' as const })),
  ];
}
