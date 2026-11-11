/**
 * Live view of the table (M5 part 1): the camera picture with every scanned piece outlined in its
 * state colour (green = spot known, labelled column·row; blue = shape read; grey = found), staying
 * on the pieces while the phone moves. No markers: the table is found in each frame from the
 * pieces themselves, matched against the puzzle's overview photos (src/cv/anchor.ts).
 *
 * Tap a piece to see what the app knows about it. `find` pieces pulse, and an arrow at the
 * screen's edge points to them when they are out of view.
 *
 * M9 part 3: the outline language (src/app/overlay.ts): solid = fine, dashed with a badge = have a look
 * ("?" faint outline, arrows apart = touching, "moved?"); one column·row pill per sure spot, placed so
 * labels never overlap (tapped piece first, then the pieces to find, then sure spots), a dot for an unsure
 * spot; a square of 4 as one quad with one label. "?" opens the legend; "Pieces in view" lists the outlined
 * pieces as buttons (the same as tapping one on the picture).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { TestButton } from './TestSteps';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/icons';
import { Sheet } from '../ui/Sheet';
import { settings } from '../settings';
import { ANSWER, CONFIDENCE_WORDS, errorWords } from '../words';
import { LabelTip, OverlayLegendButton, OverlayLegendSheet } from './OverlayLegend';
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
import {
  badgeAt,
  badgeBox,
  DASH,
  drawBadge,
  drawDots,
  drawLabels,
  labelTextWidth,
  markOf,
  OVERLAY_BAD,
  pieceName,
  placeLabels,
  PRIO,
  squareLabel,
  squaresOf,
  strokeHalo,
  type BadgeMark,
  type LabelRequest,
  type Rect,
} from '../overlay';
import { OV } from '../tokens';
// M9 part 6 help: news read from the screen's one status region.
import { announce } from '../ui/announce';

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

const LINE_COLOUR = OV.join;
const LINE_OK_COLOUR = OV.joinOk;

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
  confidenceOf,
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
  /**
   * How sure a labelled piece's spot is (M9 part 3, optional): 'strong' gets its column·row label, 'likely' and
   * 'several' a small dot (tap for the guess); the piece box says it in words (CONFIDENCE_WORDS, the % in Tester
   * mode). Without it every label shows, as before.
   */
  confidenceOf?: (p: PieceRow) => { verdict: keyof typeof CONFIDENCE_WORDS; p?: number } | null;
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
    announce(undo ? `${text} Undo is below.` : text); // M9 part 6 help
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
  const cur = useRef({ pieces, colourOf, labelOf, targets, lines, confidenceOf });
  cur.current = { pieces, colourOf, labelOf, targets, lines, confidenceOf };
  /** A column·row label is on the picture (for the one-time tip). */
  const labelsShown = useRef(false);
  /** The buttons and notes over the picture (canvas px), measured 4 times a second: labels keep clear of them. */
  const chrome = useRef<Rect[]>([]);
  const [labelsSeen, setLabelsSeen] = useState(false);
  /** "Pieces in view" (design plan §3.8 rule 10): the pieces outlined when it was opened. */
  const [inViewList, setInViewList] = useState<string[] | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
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
      if (labelsShown.current) setLabelsSeen(true);
      const c = canvasRef.current;
      if (c) {
        const o = c.getBoundingClientRect();
        chrome.current = [...(c.parentElement?.querySelectorAll('.live-top > *, .live-status, .ov-tip, .live-table-bottom > *') ?? [])]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({ x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }));
      }
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

  // Outlines on the live picture, every screen refresh, where the table is predicted to be now (M5 part 4),
  // in the outline language (M9 part 3, src/app/overlay.ts): solid = fine, dashed + badge = have a look,
  // one column·row pill per sure spot (placed so none overlap), a dot for an unsure one, a square of 4 as one quad.
  useEffect(() => {
    let raf = 0;
    const predictor = new OverlayPredictor();
    const dbg = window as unknown as { __liveDebug?: boolean; __livePredict?: boolean; __liveOverlay?: unknown };
    // The squares of 4 among the lines, worked out again only when the lines change.
    let sqFor: MatchLine[] | null = null;
    let squares: ReturnType<typeof squaresOf> = [];
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
        labelsShown.current = false;
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
      const { pieces: list, colourOf: col, labelOf: lab, targets: tg, lines: joins, confidenceOf: conf } = cur.current;
      if (joins !== sqFor) {
        sqFor = joins;
        squares = squaresOf(joins);
      }
      const inSquare = new Set<string>();
      const squareLines = new Set<number>();
      for (const s of squares) {
        for (const id of s.ids) inSquare.add(id);
        for (const i of s.lines) squareLines.add(i);
      }
      const tappedId = tappedRef.current;
      // Tracking unsure: every outline fainter (the status line says "hold steady"); dashes are for the pieces.
      const weakFix = f.anchor.quality === 'weak';
      const centres = new Map<string, Vec2>();
      const labelOfId = new Map<string, string | null>();
      const want = new Set(tg);
      const out: Drawn[] = [];
      const reqs: LabelRequest[] = [];
      const dots: Array<{ at: Vec2; colour: string }> = [];
      const badges: Array<{ id: string; mark: BadgeMark; at: [number, number] }> = [];
      const pulses: Array<{ at: Vec2; r: number; colour: string; id: string }> = [];
      for (const p of list) {
        const o = p.outlineMm;
        if (o.length < 6) continue;
        const step = o.length > 160 ? 8 : o.length > 80 ? 4 : 2;
        const poly: Vec2[] = [];
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let i = 0; i < o.length; i += step) {
          const q = toEl(p.table.x + o[i]!, p.table.y + o[i + 1]!);
          poly.push(q);
          if (q[0] < x0) x0 = q[0];
          if (q[0] > x1) x1 = q[0];
          if (q[1] < y0) y0 = q[1];
          if (q[1] > y1) y1 = q[1];
        }
        const centre = toEl(p.table.x, p.table.y);
        centres.set(p.id, centre);
        const size = Math.max(x1 - x0, y1 - y0) / 2;
        const onScreen = x1 >= 0 && y1 >= 0 && x0 <= w && y0 <= h;
        if (want.has(p.id)) pulses.push({ at: centre, r: size, colour: col(p), id: p.id });
        if (!onScreen) continue;
        out.push({ id: p.id, poly, centre });
        ctx.beginPath();
        poly.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.closePath();
        const isGone = gone.current.has(p.id);
        const mark = markOf(p.flags, isGone);
        const c = isGone ? GONE_COLOUR : col(p);
        const dim = want.size > 0 && !want.has(p.id);
        const alpha = dim ? 0.5 : weakFix ? 0.7 : 1;
        const width = p.id === tappedId ? 4 : 2.5;
        // On a dark halo (M9 part 1: pale lines vanish on a cream table).
        ctx.globalAlpha = alpha;
        strokeHalo(ctx, width);
        // Have a look (gone from its spot, a faint outline, touching pieces): dashed and hollow, with a badge.
        const dashed = mark !== 'ok';
        if (!dashed && !weakFix) {
          ctx.fillStyle = c;
          ctx.globalAlpha = dim ? 0.08 : 0.18;
          ctx.fill();
        }
        ctx.globalAlpha = alpha;
        ctx.setLineDash(dashed ? DASH : []);
        ctx.strokeStyle = c;
        ctx.lineWidth = width;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        if (mark !== 'ok') badges.push({ id: p.id, mark, at: badgeAt(mark, { x0, y0, x1 }, w, h) });
        if (mark === 'moved') continue;
        const text = lab?.(p) ?? null;
        labelOfId.set(p.id, text);
        if (!text) continue;
        const isTapped = p.id === tappedId;
        const isTarget = want.has(p.id);
        const cf = conf?.(p);
        const sure = cf ? cf.verdict === 'strong' : true;
        if (isTapped || isTarget) reqs.push({ key: p.id, text, x: centre[0], y: centre[1], r: size, prio: isTapped ? PRIO.tapped : PRIO.target });
        else if (inSquare.has(p.id)) continue;
        // An unsure spot: a dot, no label. A sure one: a label where it fits (not on pieces too small to read it on,
        // as before; the green outline still says its spot is known).
        else if (!sure) dots.push({ at: centre, colour: c });
        else if (size > 10) reqs.push({ key: p.id, text, x: centre[0], y: centre[1], r: size, prio: PRIO.sure });
      }
      // Pieces that join (M6): a line between their centres, its mark at the middle (a % only in Tester mode).
      const tester = settings.testerMode.value;
      let nLines = 0;
      joins.forEach((j, i) => {
        if (squareLines.has(i)) return;
        const p = centres.get(j.a);
        const q = centres.get(j.b);
        if (!p || !q) return;
        nLines++;
        const c = j.confirmed ? LINE_OK_COLOUR : LINE_COLOUR;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.strokeStyle = OV.joinHalo;
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.strokeStyle = c;
        ctx.lineWidth = 3;
        ctx.setLineDash(j.confirmed ? [] : [9, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (j.label && (tester || !/%\s*$/.test(j.label)))
          reqs.push({ key: `line:${i}`, text: j.label, x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, r: 0, prio: PRIO.line });
      });
      // A square of 4: one translucent quad through the 4 pieces, with one label ("17–18 · 7–8").
      const quads: Array<{ ids: string[]; label: string }> = [];
      for (const s of squares) {
        const pts = s.ids.map((id) => centres.get(id));
        if (pts.some((q) => !q)) continue;
        nLines += 4;
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q![0], q![1]) : ctx.moveTo(q![0], q![1])));
        ctx.closePath();
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = LINE_OK_COLOUR;
        ctx.fill();
        ctx.globalAlpha = 1;
        strokeHalo(ctx, 3);
        ctx.strokeStyle = LINE_OK_COLOUR;
        ctx.lineWidth = 3;
        ctx.stroke();
        const label =
          squareLabel(
            s.ids.map((id) => {
              if (labelOfId.has(id)) return labelOfId.get(id);
              const p = list.find((q) => q.id === id);
              return p ? (lab?.(p) ?? null) : null;
            }),
          ) ?? '✓';
        const cx = pts.reduce((a, q) => a + q![0], 0) / 4;
        const cy = pts.reduce((a, q) => a + q![1], 0) / 4;
        reqs.push({ key: `square:${s.ids.join('+')}`, text: label, x: cx, y: cy, r: 0, prio: PRIO.square });
        quads.push({ ids: s.ids, label });
      }
      // The square's one label speaks for its 4 pieces: none of their own (one label per thing on the table).
      if (quads.length) {
        const inQuad = new Set(quads.flatMap((q) => q.ids));
        for (let i = reqs.length - 1; i >= 0; i--) if (inQuad.has(reqs[i]!.key)) reqs.splice(i, 1);
      }
      // Badges: one per dashed outline, but not on top of another badge (in a crowd the dashes still say "have a look").
      const shown: typeof badges = [];
      const badgeBoxes: Rect[] = [];
      for (const b of badges) {
        const r = badgeBox(b.mark, b.at[0], b.at[1]);
        if (badgeBoxes.some((o) => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h)) continue;
        badgeBoxes.push(r);
        shown.push(b);
      }
      // Labels: greedily, never over each other nor over a badge or the buttons (overlay.ts placeLabels).
      const { placed } = placeLabels(reqs, (t) => labelTextWidth(t, ctx), { w, h }, [...chrome.current, ...badgeBoxes]);
      drawDots(ctx, dots);
      for (const b of shown) drawBadge(ctx, b.mark, b.at[0], b.at[1]);
      drawLabels(ctx, placed);
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
      labelsShown.current = placed.some((l) => !l.key.startsWith('line:'));
      if (dbg.__liveDebug)
        dbg.__liveOverlay = {
          t: now,
          predicted: predictor.enabled,
          centres: Object.fromEntries(out.map((d) => [d.id, d.centre])),
          labels: placed,
          badges: shown.map((b) => ({ id: b.id, mark: b.mark, x: b.at[0], y: b.at[1] })),
          dashed: badges.length,
          quads,
          joins: joins.map((j) => [j.a, j.b, j.confirmed]),
          dots: dots.length,
          size: [w, h],
        };
      // For the automated tests: how many pieces are drawn (and labels, badges, squares), and where the first piece is.
      canvas.dataset.drawn = String(out.length);
      canvas.dataset.lines = String(nLines);
      canvas.dataset.labels = String(placed.length);
      canvas.dataset.badges = String(shown.length);
      canvas.dataset.quads = String(quads.length);
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
  const sureOf = (p: PieceRow) => {
    const c = confidenceOf?.(p);
    return c ? c.verdict === 'strong' : true;
  };
  /** VoiceOver's and the list's name for a piece ("Edge piece, maybe column 17 row 8, check outline"). */
  const nameOf = (p: PieceRow) => pieceName(p, labelOf?.(p) ?? null, sureOf(p), gone.current.has(p.id));
  const tpConf = tp ? confidenceOf?.(tp) : null;
  const listed = (inViewList ?? []).map((id) => byId.get(id)).filter((p): p is PieceRow => Boolean(p));
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
    // M9 part 6 help: the live view opens over the puzzle's tabs: a dialog named by its title.
    <div class="live live-table" data-testid="live-table" role="dialog" aria-modal="true" aria-label={title}>
      <video ref={videoRef} playsInline muted autoPlay data-testid="live-video" />
      <canvas ref={canvasRef} class="overlay" data-testid="live-table-overlay" data-status={status.kind} aria-hidden="true" />
      {/* Taps on the picture; VoiceOver uses "Pieces in view" (below) instead. */}
      <div class="live-tap" data-testid="live-tap" onClick={onTap} aria-hidden="true" />

      <div class="live-top">
        <IconButton label="Back" class="btn-cam" testId="live-table-close" onClick={onClose}>
          <Icon name="chevron-left" />
        </IconButton>
        <span class="title">{title}</span>
        <OverlayLegendButton onOpen={() => setLegendOpen(true)} />
        <TestButton variant="camera" />
      </div>
      {words && (
        <p class={`chip live-status live-status-${status.kind}`} data-testid="live-status" data-kind={refs.kind === 'ready' ? status.kind : refs.kind}>
          {words}
          {refs.kind === 'ready' && status.perSec > 0 && settings.testerMode.value && <span class="live-rate"> · {Math.round(status.perSec)}/s</span>}
        </p>
      )}
      <LabelTip active={labelsSeen} />

      {refs.kind === 'none' && (
        <div class="notice notice-warn live-notice" data-testid="live-no-photo">
          <p>There's no scan photo of your table to compare with yet. Scan your pieces first (a Whole table photo), then come back.</p>
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
            <button class="btn btn-filled" data-testid="start-camera" onClick={() => void startCamera()}>
              {state === 'paused' ? 'Resume camera' : 'Start camera'}
            </button>
          )}
        </div>
      )}

      <div class="live-table-bottom">
        {note && (
          <p class="live-note" data-testid="live-note">
            <span class="live-note-text">{note.text}</span>
            {note.undo && (
              <button type="button" class="live-note-undo" data-testid="live-undo" onClick={note.undo}>
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
              {tpConf && !infoOf && (
                <span class="live-confidence" data-testid="live-confidence">
                  {' '}
                  {CONFIDENCE_WORDS[tpConf.verdict]}
                  {settings.testerMode.value && tpConf.p !== undefined ? ` · ${Math.round(tpConf.p * 100)} %` : ''}
                </span>
              )}
            </div>
            {answer?.labelOf(tp) && (
              <div class="row" style={{ gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span class="small">Tried it in {answer.labelOf(tp)}?</span>
                <button
                  class="btn btn-small btn-good btn-fits"
                  aria-label={`${ANSWER.fits} in ${answer.labelOf(tp)}`}
                  data-testid="live-fits"
                  onClick={() => {
                    const where = answer.labelOf(tp);
                    answer.onAnswer(tp, true);
                    setTapped(null);
                    showNote(`✓ In the puzzle at ${where}.`, undoOf(tp, true));
                  }}
                >
                  <Icon name="check" size={20} />
                  {ANSWER.fits}
                </button>
                <button
                  class="btn btn-small"
                  aria-label={`${ANSWER.not}: ${answer.labelOf(tp)}`}
                  data-testid="live-not"
                  onClick={() => {
                    answer.onAnswer(tp, false);
                    showNote('Noted: the next best spot is shown now.', undoOf(tp, false));
                  }}
                >
                  <Icon name="x" size={20} />
                  {ANSWER.not}
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
              <IconButton label="Close the piece's details" class="btn-cam live-info-close" testId="live-info-close" onClick={() => setTapped(null)}>
                <Icon name="x" />
              </IconButton>
            </div>
          </div>
        ) : (
          <>
            {refs.kind === 'ready' && (
              <button type="button" class="live-pieces-open" data-testid="live-pieces-open" onClick={() => setInViewList(drawn.current.map((d) => d.id))}>
                Pieces in view ({status.inView})
              </button>
            )}
            {legend && <div class="live-table-legend small">{legend}</div>}
          </>
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
      <OverlayLegendSheet open={legendOpen} onClose={() => setLegendOpen(false)} />
      <Sheet open={inViewList !== null} onClose={() => setInViewList(null)} title="Pieces in view" testId="live-pieces">
        {listed.length ? (
          <ul class="ov-piece-list" data-testid="live-pieces-list">
            {listed.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  class="ov-piece-item"
                  data-testid="live-piece-item"
                  data-id={p.id}
                  onClick={() => {
                    setTapped(p.id);
                    setInViewList(null);
                  }}
                >
                  {nameOf(p)}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted" data-testid="live-pieces-none">
            No pieces are outlined right now. Point the camera at your pieces.
          </p>
        )}
      </Sheet>
    </div>
  );
}
