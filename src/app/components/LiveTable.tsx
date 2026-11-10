/**
 * Live view of the table (M5 part 1): the camera picture with every scanned piece outlined in its
 * state colour (green = spot known, labelled column·row; blue = shape read; grey = found), staying
 * on the pieces while the phone moves. No markers: the table is found in each frame from the
 * pieces themselves, matched against the puzzle's overview photos (src/cv/anchor.ts).
 *
 * Tap a piece to see what the app knows about it. `find` pieces pulse, and an arrow at the
 * screen's edge points to them when they are out of view.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { TestButton } from './TestSteps';
import { settings } from '../settings';
import { errorWords } from '../words';
import { cameraError, cameraState, cameraStream, startCamera, stopCamera } from '../../camera/camera';
import { latestFrame, latestFrameAt, pumpError, startPump, stopPump } from '../../camera/framePump';
import { frameToElement } from '../../camera/coords';
import { applyH } from '../../geo/homography';
import { db } from '../../db/db';
import { getBlob, getProject } from '../../project/store';
import { snapsOfBatch } from '../../project/batches';
import type { PieceRow, Vec2 } from '../../project/types';
import type { AnchorPhoto } from '../../shared/apis';
import { trackerWorker } from '../workers';
import { OverlayPredictor } from '../livePredict';
import { logInfo, logWarn } from '../../log/logger';
import { OVERLAY_BAD, strokeHalo } from '../overlay';

/** A piece is shown as gone from its spot after this many of the last GONE_CHECKS presence checks. */
const GONE_OF = 3;
const GONE_CHECKS = 4;
const GONE_COLOUR = OVERLAY_BAD;

/** Overview photos used to find the table (newest first). */
const MAX_REF_PHOTOS = 3;
/** A fix older than this is not drawn (the tracker stopped or lost the table). */
const STALE_MS = 600;
/** How long a note shows; one with Undo longer (M9 part 1: at least 8 s to change your mind). */
const NOTE_MS = 4000;
const UNDO_MS = 10_000;

type RefState = { kind: 'loading' } | { kind: 'none' } | { kind: 'ready'; features: number; photos: number } | { kind: 'error'; message: string };

/** A line between two pieces that join (M6). */
export interface MatchLine {
  a: string;
  b: string;
  /** Shown at the middle ("95 %", "✓"). */
  label: string;
  confirmed: boolean;
}

const LINE_COLOUR = '#ffffff';
const LINE_OK_COLOUR = '#3ccf7a';

interface Drawn {
  id: string;
  poly: Vec2[];
  centre: Vec2;
}

/** Even–odd rule. */
function inside(p: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

export function LiveTable({
  projectId,
  pieces,
  colourOf,
  labelOf,
  infoOf,
  onPick,
  find = [],
  answer,
  lines = [],
  title,
  legend,
  onClose,
}: {
  projectId: string;
  /** Pieces on the table to outline. */
  pieces: PieceRow[];
  colourOf: (p: PieceRow) => string;
  labelOf?: (p: PieceRow) => string | null;
  infoOf?: (p: PieceRow) => string;
  /** "Show where it goes" for a tapped piece. */
  onPick?: (p: PieceRow) => void;
  /** Pieces to point out (pulsing, with an arrow when out of view). */
  find?: string[];
  /**
   * Fits / Doesn't fit (M5 part 2): the spot to ask about for a piece (words), and what to do with the
   * answer; onUndo takes the answer back (the Undo next to the note, M9 part 1).
   */
  answer?: {
    labelOf: (p: PieceRow) => string | null;
    onAnswer: (p: PieceRow, fits: boolean) => void;
    onUndo?: (p: PieceRow, fits: boolean) => Promise<void>;
  };
  /** Lines between pieces that join (M6): ✓ for a pair confirmed by a square of 4. */
  lines?: MatchLine[];
  title: string;
  legend?: ComponentChildren;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [refs, setRefs] = useState<RefState>({ kind: 'loading' });
  const [tapped, setTapped] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; undo?: () => void } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Shows a note (replacing the one before) for a while; with `undo`, an Undo button. */
  const showNote = (text: string, undo?: () => void) => {
    clearTimeout(noteTimer.current);
    setNote({ text, undo });
    noteTimer.current = setTimeout(() => setNote(null), undo ? UNDO_MS : NOTE_MS);
  };
  useEffect(() => () => clearTimeout(noteTimer.current), []);
  /** The Undo for an answer just given (the piece back on the table, or its spot offered again). */
  const undoOf = (p: PieceRow, fits: boolean) => {
    const onUndo = answer?.onUndo;
    if (!onUndo) return undefined;
    return () => {
      clearTimeout(noteTimer.current);
      setNote(null);
      onUndo(p, fits)
        .then(() => showNote(fits ? 'Undone: the piece is back on the table.' : 'Undone: that spot is offered again.'))
        .catch((err) => logWarn('answer', 'The answer could not be undone', err));
    };
  };
  const [targets, setTargets] = useState<string[]>(find);
  /** Pieces that looked gone from their spot in at least GONE_OF of the last GONE_CHECKS checks (M5 part 4). */
  const gone = useRef(new Set<string>());
  const [status, setStatus] = useState<{ kind: 'looking' | 'good' | 'weak' | 'lost'; inView: number; perSec: number; gone: number }>({
    kind: 'looking',
    inView: 0,
    perSec: 0,
    gone: 0,
  });
  const drawn = useRef<Drawn[]>([]);
  const tappedRef = useRef<string | null>(null);
  tappedRef.current = tapped;
  const cur = useRef({ pieces, colourOf, labelOf, targets, lines });
  cur.current = { pieces, colourOf, labelOf, targets, lines };
  const stream = cameraStream.value;
  const state = cameraState.value;
  const live = state === 'live';
  const byId = new Map(pieces.map((p) => [p.id, p]));

  // Camera on while open; the tracker finds the table from the overview photos.
  useEffect(() => {
    if (cameraState.value === 'idle' || cameraState.value === 'error') void startCamera();
    let gone = false;
    const t0 = performance.now();
    void (async () => {
      try {
        // This batch's photos only (M7): earlier batches show another table layout.
        const project = await getProject(projectId);
        const snaps = snapsOfBatch(project ?? {}, await db().snaps.where('projectId').equals(projectId).toArray())
          .filter((s) => s.kind === 'overview' && s.blobId && s.imgToTable)
          .sort((a, b) => b.ts - a.ts)
          .slice(0, MAX_REF_PHOTOS);
        const photos: AnchorPhoto[] = [];
        for (const s of snaps) {
          const blob = await getBlob(s.blobId!);
          if (blob) photos.push({ blob, imgToTable: s.imgToTable!, width: s.width, height: s.height });
        }
        if (gone) return;
        if (!photos.length) return setRefs({ kind: 'none' });
        const tw = trackerWorker();
        void tw.api.setTableMap(null, 1);
        void tw.api.setPieceStats(false);
        // The known pieces' outlines (table mm), for the check that they are still at their spots.
        const outlines = cur.current.pieces.map((p) => ({ id: p.id, outline: p.outlineMm.map((v, i) => v + (i % 2 ? p.table.y : p.table.x)) }));
        const r = await tw.api.setAnchor(photos, outlines);
        if (gone) return;
        if (r.error || !r.features) {
          logWarn('live', 'Live view: the scan photos could not be prepared', r);
          return setRefs({ kind: 'error', message: r.error ?? 'No detail found in the scan photos' });
        }
        logInfo('live', `Live view ready: ${r.features} features from ${r.photos} scan photo(s) in ${Math.round(performance.now() - t0)} ms`);
        setRefs({ kind: 'ready', features: r.features, photos: r.photos });
      } catch (err) {
        logWarn('live', 'Live view could not start', err);
        if (!gone) setRefs({ kind: 'error', message: errorWords(err) });
      }
    })();
    return () => {
      gone = true;
      void trackerWorker().api.setAnchor(null);
      try {
        stopPump();
      } finally {
        stopCamera();
      }
    };
  }, [projectId]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let onPlaying: (() => void) | null = null;
    if (stream && v.srcObject !== stream) {
      v.srcObject = stream;
      onPlaying = () => void startPump(v);
      v.addEventListener('playing', onPlaying, { once: true });
      void v.play().catch(() => {});
    }
    if (!stream) {
      stopPump();
      v.srcObject = null;
    }
    return () => {
      if (onPlaying) v.removeEventListener('playing', onPlaying);
    };
  }, [stream]);

  // Tracking state for the status line (fixes per second over the last 2 s), and a summary in the log.
  useEffect(() => {
    const fixes: number[] = [];
    let seen = 0;
    let found = 0;
    let lastFixAt = 0;
    let lastFix: { quality: 'good' | 'weak' } | null = null;
    const checks = new Map<string, boolean[]>();
    const unsub = latestFrame.subscribe((f) => {
      if (!f || f.anchor === undefined) return;
      seen++;
      const t = performance.now();
      if (f.anchor) {
        found++;
        fixes.push(t);
        lastFixAt = t;
        lastFix = f.anchor;
        // Gone from its spot: several checks in a row, so one odd frame (a hand, glare) doesn't count.
        const pr = f.anchor.presence;
        if (pr) {
          for (const [ids, isGone] of [
            [pr.gone, true],
            [pr.there, false],
          ] as const)
            for (const id of ids) {
              const h = checks.get(id) ?? [];
              h.push(isGone);
              if (h.length > GONE_CHECKS) h.shift();
              checks.set(id, h);
              const n = h.filter(Boolean).length;
              if (n >= GONE_OF && h[h.length - 1]) gone.current.add(id);
              else if (!isGone) gone.current.delete(id);
            }
        }
      }
      while (fixes.length && t - fixes[0]! > 2000) fixes.shift();
    });
    const timer = setInterval(() => {
      const t = performance.now();
      const fresh = lastFix && t - lastFixAt < STALE_MS;
      const inView = drawn.current.length;
      setStatus({
        kind: fresh ? (lastFix!.quality === 'good' ? 'good' : 'weak') : seen ? 'lost' : 'looking',
        inView,
        perSec: fixes.length / 2,
        gone: gone.current.size,
      });
    }, 250);
    return () => {
      unsub();
      clearInterval(timer);
      if (seen) logInfo('live', `Live view closed: table found in ${found} of ${seen} frames`);
    };
  }, []);

  // Outlines on the live picture, every screen refresh, where the table is predicted to be now (M5 part 4).
  useEffect(() => {
    let raf = 0;
    const predictor = new OverlayPredictor();
    const dbg = window as unknown as { __liveDebug?: boolean; __livePredict?: boolean; __liveOverlay?: unknown };
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || !video.videoWidth) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const f = latestFrame.value;
      const now = performance.now();
      if (!f?.anchor || now - latestFrameAt > STALE_MS) {
        drawn.current = [];
        canvas.dataset.drawn = '0';
        predictor.reset();
        return;
      }
      predictor.enabled = dbg.__livePredict !== false;
      predictor.push({
        frame: f.frameIndex,
        t: f.timestampUs / 1000,
        arrive: latestFrameAt,
        proc: f.timings.total ?? 0,
        H: f.anchor.tableToImg,
        width: f.width,
        height: f.height,
      });
      const H = predictor.at(now) ?? f.anchor.tableToImg;
      const frame = { width: f.width, height: f.height };
      const vid = { width: video.videoWidth, height: video.videoHeight };
      const el = { width: w, height: h };
      const toEl = (x: number, y: number): Vec2 => {
        const q = applyH(H, [x, y]);
        return frameToElement(q[0], q[1], frame, vid, el, f.rotation);
      };
      const { pieces: list, colourOf: col, labelOf: lab, targets: tg, lines: joins } = cur.current;
      const centres = new Map<string, Vec2>();
      const want = new Set(tg);
      const out: Drawn[] = [];
      const labels: Array<{ at: Vec2; text: string; colour: string }> = [];
      const pulses: Array<{ at: Vec2; r: number; colour: string; id: string }> = [];
      for (const p of list) {
        const o = p.outlineMm;
        if (o.length < 6) continue;
        const step = o.length > 160 ? 8 : o.length > 80 ? 4 : 2;
        const poly: Vec2[] = [];
        for (let i = 0; i < o.length; i += step) poly.push(toEl(p.table.x + o[i]!, p.table.y + o[i + 1]!));
        const centre = toEl(p.table.x, p.table.y);
        centres.set(p.id, centre);
        const size = Math.max(...poly.map((q) => Math.hypot(q[0] - centre[0], q[1] - centre[1])));
        const onScreen = poly.some((q) => q[0] >= 0 && q[1] >= 0 && q[0] <= w && q[1] <= h);
        if (want.has(p.id)) pulses.push({ at: centre, r: size, colour: col(p), id: p.id });
        if (!onScreen) continue;
        out.push({ id: p.id, poly, centre });
        ctx.beginPath();
        poly.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.closePath();
        const isGone = gone.current.has(p.id);
        const c = isGone ? GONE_COLOUR : col(p);
        const dim = want.size > 0 && !want.has(p.id);
        const width = p.id === tappedRef.current ? 4 : 2.5;
        // On a dark halo (M9 part 1: pale lines vanish on a cream table).
        ctx.globalAlpha = dim ? 0.5 : 1;
        strokeHalo(ctx, width);
        // Gone from its spot, or tracking unsure: dashed and hollow (PLAN §5 "red/hollow uncertain").
        const dashed = isGone || f.anchor.quality === 'weak';
        ctx.setLineDash(dashed ? [7, 5] : []);
        if (!dashed) {
          ctx.fillStyle = c;
          ctx.globalAlpha = dim ? 0.08 : 0.18;
          ctx.fill();
        }
        ctx.globalAlpha = dim ? 0.5 : 1;
        ctx.strokeStyle = c;
        ctx.lineWidth = width;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        const text = isGone ? 'moved?' : lab?.(p);
        if (text && size > 14) labels.push({ at: centre, text, colour: c });
      }
      // Pieces that join (M6): a line between their centres, its label at the middle.
      let nLines = 0;
      for (const j of joins) {
        const p = centres.get(j.a);
        const q = centres.get(j.b);
        if (!p || !q) continue;
        nLines++;
        const c = j.confirmed ? LINE_OK_COLOUR : LINE_COLOUR;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.strokeStyle = c;
        ctx.lineWidth = 3;
        ctx.setLineDash(j.confirmed ? [] : [9, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (j.label) labels.push({ at: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], text: j.label, colour: c });
      }
      ctx.font = '700 13px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const l of labels) {
        const tw = ctx.measureText(l.text).width + 10;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.beginPath();
        ctx.roundRect(l.at[0] - tw / 2, l.at[1] - 10, tw, 20, 6);
        ctx.fill();
        ctx.fillStyle = l.colour;
        ctx.fillText(l.text, l.at[0], l.at[1]);
      }
      // Pieces to find: a pulsing ring (still and thick with Reduce Motion on), or an arrow at the edge pointing to them.
      const beat = pulses.length && matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0.5 + 0.5 * Math.sin(now / 180);
      for (const t of pulses) {
        const [x, y] = t.at;
        const margin = 28;
        if (x >= margin && y >= margin && x <= w - margin && y <= h - margin) {
          ctx.beginPath();
          ctx.arc(x, y, t.r + 6 + 8 * beat, 0, 2 * Math.PI);
          ctx.globalAlpha = 0.5 + 0.5 * beat;
          strokeHalo(ctx, 3 + 2 * beat);
          ctx.strokeStyle = t.colour;
          ctx.lineWidth = 3 + 2 * beat;
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else {
          const cx = w / 2;
          const cy = h / 2;
          const dx = x - cx;
          const dy = y - cy;
          const k = Math.min((w / 2 - margin) / Math.abs(dx || 1e-6), (h / 2 - margin - 70) / Math.abs(dy || 1e-6));
          const ax = cx + dx * k;
          const ay = cy + dy * k;
          const ang = Math.atan2(dy, dx);
          ctx.save();
          ctx.translate(ax, ay);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.moveTo(16, 0);
          ctx.lineTo(-10, -13);
          ctx.lineTo(-4, 0);
          ctx.lineTo(-10, 13);
          ctx.closePath();
          ctx.fillStyle = t.colour;
          ctx.globalAlpha = 0.6 + 0.4 * beat;
          ctx.fill();
          ctx.restore();
          ctx.globalAlpha = 1;
        }
      }
      drawn.current = out;
      if (dbg.__liveDebug) dbg.__liveOverlay = { t: now, predicted: predictor.enabled, centres: Object.fromEntries(out.map((d) => [d.id, d.centre])) };
      // For the automated tests: how many pieces are drawn, and where the first one is.
      canvas.dataset.drawn = String(out.length);
      canvas.dataset.lines = String(nLines);
      canvas.dataset.first = out.length ? `${Math.round(out[0]!.centre[0])},${Math.round(out[0]!.centre[1])}` : '';
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onTap = (ev: MouseEvent) => {
    const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const p: Vec2 = [ev.clientX - box.left, ev.clientY - box.top];
    const list = drawn.current;
    let hit = list.find((d) => inside(p, d.poly))?.id ?? null;
    if (!hit) {
      let best = 36;
      for (const d of list) {
        const dd = Math.hypot(d.centre[0] - p[0], d.centre[1] - p[1]);
        if (dd < best) {
          best = dd;
          hit = d.id;
        }
      }
    }
    setTapped(hit);
  };

  const tp = tapped ? byId.get(tapped) : undefined;
  const words =
    refs.kind === 'loading'
      ? 'Getting your scan photos ready…'
      : refs.kind !== 'ready'
        ? null
        : status.kind === 'good'
          ? `Tracking ✓ · ${status.inView} piece${status.inView === 1 ? '' : 's'} in view` +
            (status.gone ? ` · ${status.gone} not where ${status.gone === 1 ? 'it was' : 'they were'}: scan again to update` : '')
          : status.kind === 'weak'
            ? `Tracking (hold steady) · ${status.inView} in view`
            : status.kind === 'lost'
              ? 'Looking for your pieces: point the camera at them'
              : 'Starting…';

  return (
    <div class="live live-table" data-testid="live-table">
      <video ref={videoRef} playsInline muted autoPlay data-testid="live-video" />
      <canvas ref={canvasRef} class="overlay" data-testid="live-table-overlay" data-status={status.kind} />
      <div class="live-tap" data-testid="live-tap" onClick={onTap} />

      <div class="live-top">
        <button class="chip" onClick={onClose} data-testid="live-table-close">
          ‹ Back
        </button>
        <span class="title">{title}</span>
        <TestButton variant="camera" />
      </div>
      {words && (
        <p class={`chip live-status live-status-${status.kind}`} data-testid="live-status" data-kind={refs.kind === 'ready' ? status.kind : refs.kind}>
          {words}
          {refs.kind === 'ready' && status.perSec > 0 && settings.testerMode.value && <span class="live-rate"> · {Math.round(status.perSec)}/s</span>}
        </p>
      )}

      {refs.kind === 'none' && (
        <div class="notice notice-warn live-notice" data-testid="live-no-photo">
          <p>There's no scan photo of your table to compare with yet. Scan your pieces first (Scan → overview photo), then come back.</p>
        </div>
      )}
      {refs.kind === 'error' && (
        <div class="notice notice-bad live-notice" data-testid="live-error">
          <p>The live view couldn't start: {refs.message}</p>
        </div>
      )}
      {((live && pumpError.value) || cameraError.value) && (
        <div class="notice notice-bad live-notice" data-testid="camera-problem">
          <p>{pumpError.value ?? cameraError.value}</p>
          {state !== 'live' && (
            <button class="btn btn-small" onClick={() => void startCamera()}>
              Start camera
            </button>
          )}
        </div>
      )}
      {!live && !cameraError.value && (
        <div class="live-center">
          {state === 'starting' ? (
            <p>Starting the camera…</p>
          ) : (
            <button class="btn btn-primary" data-testid="start-camera" onClick={() => void startCamera()}>
              {state === 'paused' ? 'Resume camera' : 'Start camera'}
            </button>
          )}
        </div>
      )}

      <div class="live-table-bottom">
        {note && (
          <p class="chip live-note" role="status" data-testid="live-note">
            {note.text}
            {note.undo && (
              <button class="btn btn-small live-note-undo" data-testid="live-undo" onClick={note.undo}>
                Undo
              </button>
            )}
          </p>
        )}
        {tp ? (
          <div class="live-table-info" data-testid="live-info">
            <div class="grow">
              {labelOf?.(tp) && <strong>{labelOf(tp)} · </strong>}
              {infoOf ? infoOf(tp) : 'A scanned piece.'}
            </div>
            {answer?.labelOf(tp) && (
              <div class="row" style={{ gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span class="small">Tried it in {answer.labelOf(tp)}?</span>
                <button
                  class="btn btn-small btn-fits"
                  data-testid="live-fits"
                  onClick={() => {
                    const where = answer.labelOf(tp);
                    answer.onAnswer(tp, true);
                    setTapped(null);
                    showNote(`✓ In the puzzle at ${where}.`, undoOf(tp, true));
                  }}
                >
                  ✓ Fits
                </button>
                <button
                  class="btn btn-small"
                  data-testid="live-not"
                  onClick={() => {
                    answer.onAnswer(tp, false);
                    showNote('Noted: the next best spot is shown now.', undoOf(tp, false));
                  }}
                >
                  ✗ Doesn't fit
                </button>
              </div>
            )}
            <div class="row" style={{ gap: '8px', flexWrap: 'wrap' }}>
              {!targets.includes(tp.id) && (
                <button class="btn btn-small" data-testid="live-find" onClick={() => setTargets([tp.id])}>
                  Point it out
                </button>
              )}
              {onPick && (
                <button class="btn btn-small" data-testid="live-pick" onClick={() => onPick(tp)}>
                  Show where it goes
                </button>
              )}
              <button class="btn btn-small" aria-label="Close" onClick={() => setTapped(null)}>
                ✕
              </button>
            </div>
          </div>
        ) : (
          legend && <div class="live-table-legend small">{legend}</div>
        )}
        {!tp && targets.length > 0 && (
          <p class="small live-table-legend" data-testid="live-finding">
            {targets.length === 1
              ? 'The pulsing piece is the one to find; an arrow at the edge shows the way when it’s out of view.'
              : 'The pulsing pieces are the ones to find.'}{' '}
            <button class="btn btn-small" onClick={() => setTargets([])}>
              Stop pointing
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
