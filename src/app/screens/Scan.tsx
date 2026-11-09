import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { go, routeArg } from '../router';
import { readerWorker, restartReader } from '../workers';
import { TableCamera, type CaptureMeta } from '../components/TableCamera';
import { deleteBlob, getProject, newId, projectBlobId, putBlob, updateProject } from '../../project/store';
import { measurePitch, planMerge } from '../../project/catalog';
import { Coverage, sortingArea, type Area } from '../../scan/coverage';
import { FREE_RULES, markerCentres, type CaptureKind } from '../../scan/autoCapture';
import { applyH, invertH } from '../../geo/homography';
import { db } from '../../db/db';
import type { PhotoQuality, PieceRow, Project, SnapRow, Vec2 } from '../../project/types';
import type { FoundPiece } from '../../cv/pieceFinder';
import { coinById, MK_COINS, type CoinType } from '../../cv/coin';
import { DEFAULT_PITCH_MM } from '../../cv/pieceFinder';
import { REAL_PIECE_AREA_SHARE } from '../../cv/scanMarkerless';
import { CoverageMap, PhotoResult, type OutlineFlag } from '../components/ScanMaps';
import type { FinishedCheck, FreeScanReply } from '../../shared/apis';
import { logError, logInfo } from '../../log/logger';
import { errorWords } from './Puzzle';

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
  const on = pieces.filter((p) => p.status === 'table');
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
      const [ps, ss] = await Promise.all([db().pieces.where('projectId').equals(id).toArray(), db().snaps.where('projectId').equals(id).toArray()]);
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
      if (!kindChosen.current) setKind(ps.some((q) => q.status === 'table') ? 'detail' : 'overview');
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
  const free = project.tracking !== 'markers';
  if (!free && !project.markerMap) {
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
      if (free) {
        const existing0 = await db().pieces.where('projectId').equals(project.id).toArray();
        const catalog = existing0
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
            findCoin: kind === 'overview' && Boolean(coinType) && project.scaleSource !== 'coin',
            pieceCount: project.pieceCount || undefined,
            grid: project.grid ? { cols: project.grid.cols, rows: project.grid.rows } : null,
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
          try {
            next = await saveOpenSpots(project, f.finished);
            setProject(next);
          } catch (err) {
            logError('scan', 'The empty spots could not be saved', err);
          }
          setNote({ ok: true, lines: finishedLines(f.finished, next) });
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
              coinLines.push(`Coin found ✓ Sizes are now measured (the estimate was ${Math.abs(Math.round((k - 1) * 100))} % ${k > 1 ? 'small' : 'big'}).`);
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
      const existing = await db().pieces.where('projectId').equals(project.id).toArray();
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
        pieceIds: [...plan.added, ...plan.updates.filter((p) => p.status === 'table')].map((p) => p.id),
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
        await db().snaps.put(snap);
      });
      await pruneFullPhotos(project.id);
      const all = await db().pieces.where('projectId').equals(project.id).toArray();
      const measured = measurePitch(all.filter((p) => p.status === 'table'));
      // Marker-free: a piece's found top face is ~79 % of its cell (REAL_PIECE_AREA_SHARE), so the
      // cell pitch is the face size ÷ √0.79. (Marker puzzles keep the face-size meaning they use.)
      const toCell = free ? 1 / Math.sqrt(REAL_PIECE_AREA_SHARE) : 1;
      const pitch2 = measured ? { ...measured, wMm: measured.wMm * toCell, hMm: measured.hMm * toCell } : null;
      const next = await updateProject(project.id, { ...(pitch2 ? { piecePitch: pitch2 } : {}), ...(scaleChanged ? { scaleSource: 'coin' as const } : {}) });
      setProject(next);
      setPieces(all);
      if (scaleChanged) setSnaps(await db().snaps.where('projectId').equals(project.id).toArray());
      else setSnaps((s) => [...s, snap]);
      const lines0: string[] = [];
      if (plan.moved || plan.missing) logInfo('scan', `Moved pieces recognised: ${plan.moved}; no longer at their spot: ${plan.missing}`);
      if (plan.moved) lines0.push(`${plan.moved === 1 ? '1 piece was' : `${plan.moved} pieces were`} moved: recognised, not counted again.`);
      if (plan.missing)
        lines0.push(
          `${plan.missing === 1 ? '1 piece is' : `${plan.missing} pieces are`} no longer where ${plan.missing === 1 ? 'it was' : 'they were'} (taken away, or moved out of view).`,
        );
      const clumps = r.pieces.filter((p) => p.flags.clump).length;
      const weak = r.pieces.filter((p) => p.flags.weak).length;
      const lines: string[] = [
        kind === 'overview'
          ? `Found ${r.pieces.filter((p) => !p.flags.cut).length} pieces (${plan.added.length} new).`
          : `Close-up read: ${plan.updates.length - plan.missing + plan.added.length} pieces (${plan.added.length} new).`,
        ...lines0,
      ];
      if (clumps)
        lines.push(
          `${clumps === 1 ? 'One spot where pieces touch' : `${clumps} spots where pieces touch`} (orange dashes): spread them apart and take the photo again.`,
        );
      if (weak) lines.push(`${weak} pale piece${weak > 1 ? 's' : ''} with a faint outline (yellow): check ${weak > 1 ? 'they are' : 'it is'} outlined right.`);
      for (const q of r.reasons) if (!/Blurred|Tilted/.test(q)) lines.push(q);
      lines.unshift(...coinLines);
      setNote({ ok: true, lines });
      setAutoPaused(false);
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
    <>
      <TableCamera
        mode={kind}
        map={map}
        target={target}
        busy={busy}
        autoCapture={!autoPaused && (kind === 'overview' || target !== null)}
        pieces={free ? undefined : onTable}
        free={free ? { pitchMm } : null}
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
          {free && kind === 'detail' && target && <p class="chip">Aim at the dashed box on the map</p>}
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
          {free && <CoverageMap pieces={onTable} coverage={coverage} target={kind === 'detail' ? target : null} view={viewMm} />}
          {free && (
            <label class="chip pick-photo" data-testid="pick-photo">
              🖼 Choose a photo
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
          {kind === 'detail' && !target && covered >= 98 && <p class="chip ok">All close-ups done ✓</p>}
        </div>
      </TableCamera>
      {note && (
        <div
          class={note.ok ? 'notice notice-good scan-note scan-note-top' : 'notice notice-bad scan-note scan-note-top'}
          data-testid="scan-note"
          role="status"
          onClick={() => setNote(null)}
        >
          {note.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      )}
      {showPhoto && lastPhoto && <PhotoResult url={lastPhoto.url} size={lastPhoto.size} outlines={lastPhoto.outlines} onClose={() => setShowPhoto(false)} />}
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
    });
  }
  if (!fin.gaps.length && project.openSpots) {
    const next = await updateProject(project.id, { openSpots: null });
    await deleteBlob(id);
    return next;
  }
  return project;
}

/** The finished-puzzle check in plain words. */
export function finishedLines(fin: FinishedCheck, project: Pick<Project, 'grid' | 'pieceCount' | 'box' | 'openSpots'>): string[] {
  const n = fin.cols * fin.rows;
  const lines = [`Finished puzzle: ${fin.cols} across × ${fin.rows} down = ${n.toLocaleString('en')} pieces, counted from the seams.`];
  const g = project.grid;
  if (g) {
    const same = (g.cols === fin.cols && g.rows === fin.rows) || (g.cols === fin.rows && g.rows === fin.cols);
    lines.push(
      same
        ? `That matches your puzzle (${g.cols} × ${g.rows}).`
        : `Your puzzle is set to ${g.cols} × ${g.rows}: check the grid, or take the photo again from straight above.`,
    );
  }
  if (!fin.gaps.length) lines.push('No gaps found: every spot has a piece.');
  else {
    const list = fin.gaps
      .slice(0, 6)
      .map(([c, r]) => `column ${c + 1}, row ${r + 1}`)
      .join('; ');
    lines.push(
      `${fin.gaps.length === 1 ? '1 possible gap' : `${fin.gaps.length} possible gaps`} (red squares on the last photo; counted from the top left): ${list}${fin.gaps.length > 6 ? '; …' : ''}.`,
    );
    if (project.openSpots && project.openSpots.gaps.length === fin.gaps.length)
      lines.push(
        project.box
          ? `Saved: your leftover pieces will now be matched only to these ${fin.gaps.length} empty spots, one piece per spot. Scan the leftover pieces (or open Pieces on the puzzle's page).`
          : `Saved these ${fin.gaps.length} empty spots: add the box picture and your leftover pieces will be matched only to them.`,
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
