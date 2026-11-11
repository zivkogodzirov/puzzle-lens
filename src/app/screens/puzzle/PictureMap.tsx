/**
 * The Picture tab's map (M9 part 4, design plan §4 item 6): the box picture with how far the puzzle is, as a
 * map you can zoom into. Spots in the puzzle are in full colour, empty spots dimmed, and an empty spot whose
 * piece is waiting (on your table or in a tray, its spot known) has a ring. A tap on a spot picks it (the tab
 * then opens the spot sheet).
 *
 * Zoom (inside the map only, never the page):
 * - pinch with two fingers, or double-tap a place (again at the closest zoom: back to the whole picture);
 * - the − / + buttons under the map (one hand, VoiceOver), and "Whole picture" (the picture icon) once zoomed in;
 * - zoomed in, one finger drags the picture; at the whole picture, the page scrolls as usual (touch-action pan-y).
 * A single tap waits a moment (DOUBLE_MS) to tell it from a double-tap, as in the iPhone's Maps.
 *
 * Speed: the picture is drawn once per change of the spots (memoised; one path for the dimmed spots, one for the
 * rings' halos); zooming and dragging only change a CSS transform on the drawn picture, written straight to
 * the element during a gesture (no redraw per frame).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../../ui/icons';

/** Two taps within this time (ms) and DOUBLE_PX of each other are a double-tap. */
const DOUBLE_MS = 300;
const DOUBLE_PX = 30;
/** A finger that moves more than this (px) drags instead of tapping. */
const SLOP = 8;
/** Each − / + step, and a double-tap. */
const STEP = 1.8;
/** At the closest zoom a spot is about this wide (px), and the zoom goes at least this far (×). */
const MAX_CELL_PX = 72;
const MIN_MAX_SCALE = 3;

export type Cell = [number, number];

export interface PictureMapProps {
  boxUrl: string;
  grid: { cols: number; rows: number };
  /** The box picture's width / height. */
  aspect: number;
  /** Per spot (row by row): 0 still to find, 1 in the puzzle, 2 empty with its piece waiting (puzzleProgress). */
  cellState: Uint8Array;
  /** The empty spots from a photo of the puzzle (outlined), or null on the whole picture. */
  open: Cell[] | null;
  /** The spot shown in the spot sheet (outlined), or null. */
  selected: Cell | null;
  /** A tap on the picture, in spots (fractional: column, row from the top-left). */
  onPick: (x: number, y: number) => void;
  /** What the picture shows, for VoiceOver. */
  label: string;
  /** Beside the zoom buttons (the tab's "Fill a spot"). */
  children?: ComponentChildren;
}

interface View {
  /** Scale, and the picture's top-left as a share of the map's width / height (≤ 0). */
  s: number;
  fx: number;
  fy: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The minus sign of the icon set (Lucide "minus"), until it is in ui/icons.tsx. */
function Minus() {
  return (
    <svg class="icon" width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={2} stroke-linecap="round" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}

export function PictureMap({ boxUrl, grid, aspect, cellState, open, selected, onPick, label, children }: PictureMapProps) {
  const vp = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const view = useRef<View>({ s: 1, fx: 0, fy: 0 });
  const [scale, setScale] = useState(1);
  const [maxS, setMaxS] = useState(MIN_MAX_SCALE);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    kind: 'tap' | 'pan' | 'pinch';
    x0: number;
    y0: number;
    d0: number;
    v0: View;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (pending.current && clearTimeout(pending.current)), []);

  // The closest zoom: a spot about MAX_CELL_PX wide.
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const measure = () => el.clientWidth > 0 && setMaxS(Math.max(MIN_MAX_SCALE, (MAX_CELL_PX * grid.cols) / el.clientWidth));
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [grid.cols]);

  /** Shows the view (clamped so the picture always covers the map); `commit`: also for the buttons. */
  const apply = (v: View, commit: boolean) => {
    const s = clamp(v.s, 1, maxS);
    const next = { s, fx: clamp(v.fx, 1 - s, 0), fy: clamp(v.fy, 1 - s, 0) };
    view.current = next;
    const el = svg.current;
    if (el) el.style.transform = s === 1 ? '' : `translate(${next.fx * 100}%, ${next.fy * 100}%) scale(${s})`;
    vp.current?.classList.toggle('is-zoomed', s > 1);
    if (commit) setScale(s);
  };
  /** Zooms to scale `s`, keeping the point (fx, fy of the map) where it is. */
  const zoomAt = (s: number, px = 0.5, py = 0.5) => {
    const v = view.current;
    const ns = clamp(s, 1, maxS);
    const u = (px - v.fx) / v.s;
    const w = (py - v.fy) / v.s;
    apply({ s: ns, fx: px - u * ns, fy: py - w * ns }, true);
  };

  const rel = (x: number, y: number) => {
    const r = vp.current!.getBoundingClientRect();
    return { px: (x - r.left) / r.width, py: (y - r.top) / r.height, w: r.width, h: r.height };
  };
  const tap = (x: number, y: number) => {
    const now = performance.now();
    const last = lastTap.current;
    if (last && now - last.t < DOUBLE_MS && Math.hypot(x - last.x, y - last.y) < DOUBLE_PX) {
      // A double-tap: closer at that place; at the closest zoom, the whole picture again.
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
      lastTap.current = null;
      const { px, py } = rel(x, y);
      if (view.current.s >= maxS - 0.01) apply({ s: 1, fx: 0, fy: 0 }, true);
      else zoomAt(view.current.s * STEP, px, py);
      return;
    }
    lastTap.current = { t: now, x, y };
    const r = svg.current!.getBoundingClientRect();
    const cx = ((x - r.left) / r.width) * grid.cols;
    const cy = ((y - r.top) / r.height) * grid.rows;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      onPick(cx, cy);
    }, DOUBLE_MS);
  };

  const onDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // A pointer the browser no longer knows (it ended already): nothing to capture.
    }
    if (pts.current.size === 1) gesture.current = { kind: 'tap', x0: e.clientX, y0: e.clientY, d0: 0, v0: view.current, moved: false };
    else if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = {
        kind: 'pinch',
        x0: (a.x + b.x) / 2,
        y0: (a.y + b.y) / 2,
        d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        v0: view.current,
        moved: true,
      };
      vp.current?.classList.add('is-moving');
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch' && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const m0 = rel(g.x0, g.y0);
      const m = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
      const ns = clamp((g.v0.s * d) / g.d0, 1, maxS);
      const u = (m0.px - g.v0.fx) / g.v0.s;
      const w = (m0.py - g.v0.fy) / g.v0.s;
      apply({ s: ns, fx: m.px - u * ns, fy: m.py - w * ns }, false);
      return;
    }
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.moved && Math.hypot(dx, dy) > SLOP) {
      g.moved = true;
      if (view.current.s > 1) {
        g.kind = 'pan';
        vp.current?.classList.add('is-moving');
      }
    }
    if (g.kind === 'pan') {
      const r = vp.current!.getBoundingClientRect();
      apply({ s: g.v0.s, fx: g.v0.fx + dx / r.width, fy: g.v0.fy + dy / r.height }, false);
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (!g) return;
    if (pts.current.size === 1) {
      // One finger left after a pinch: it drags from here.
      const [p] = [...pts.current.values()] as [{ x: number; y: number }];
      gesture.current = { kind: 'pan', x0: p.x, y0: p.y, d0: 0, v0: view.current, moved: true };
      return;
    }
    if (pts.current.size > 0) return;
    gesture.current = null;
    vp.current?.classList.remove('is-moving');
    if (g.kind === 'tap' && !g.moved) tap(e.clientX, e.clientY);
    else apply(view.current, true);
  };
  const onCancel = (e: PointerEvent) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size) return;
    gesture.current = null;
    vp.current?.classList.remove('is-moving');
    apply(view.current, true);
  };

  // The picture's marks: one path dims the spots not in the puzzle, one draws the rings' halos; a ring per waiting piece.
  const marks = useMemo(() => {
    const { cols, rows } = grid;
    const cellAspect = (aspect * rows) / cols;
    const rx = 0.3;
    const ry = rx * cellAspect;
    let dim = '';
    let halo = '';
    const rings: Cell[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const v = cellState[r * cols + c];
        if (v === 1) continue;
        dim += `M${c} ${r}h1v1h-1z`;
        if (v === 2) {
          rings.push([c, r]);
          halo += `M${c + 0.5 - rx} ${r + 0.5}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
        }
      }
    return (
      <>
        {dim && <path d={dim} class="pic-left" />}
        {open?.map(([c, r]) =>
          cellState[r * cols + c] === 1 ? null : (
            <rect key={`o${c},${r}`} x={c} y={r} width={1} height={1} class="spot-open pic-open" vector-effect="non-scaling-stroke" />
          ),
        )}
        {halo && <path d={halo} class="pic-sure-halo" vector-effect="non-scaling-stroke" />}
        {rings.map(([c, r]) => (
          <ellipse key={`${c},${r}`} cx={c + 0.5} cy={r + 0.5} rx={rx} ry={ry} class="pic-sure" vector-effect="non-scaling-stroke" />
        ))}
      </>
    );
  }, [cellState, grid.cols, grid.rows, aspect, open]);

  return (
    <div class="pic-map-wrap">
      <div
        ref={vp}
        class="pic-map"
        style={{ aspectRatio: String(aspect) }}
        data-testid="progress-map"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      >
        <svg
          ref={svg}
          class="pic-map-svg"
          viewBox={`0 0 ${grid.cols} ${grid.rows}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={label}
          data-testid="fill-picture"
          data-scale={scale.toFixed(2)}
        >
          <image href={boxUrl} x={0} y={0} width={grid.cols} height={grid.rows} preserveAspectRatio="none" />
          {marks}
          {selected && (
            <g>
              <rect x={selected[0]} y={selected[1]} width={1} height={1} class="crop-ring-halo" vector-effect="non-scaling-stroke" />
              <rect x={selected[0]} y={selected[1]} width={1} height={1} class="pic-sel" vector-effect="non-scaling-stroke" data-testid="fill-picture-sel" />
            </g>
          )}
        </svg>
      </div>
      <div class="pic-map-bar">
        {children}
        <span class="pic-grow" />
        <div class="pic-zoom" role="group" aria-label="Zoom the picture">
          {/* Zoomed in: back to the whole picture (an icon button, so the bar stays one line at 375 px). */}
          {scale > 1 && (
            <button type="button" class="pic-zoom-btn" aria-label="Whole picture" data-testid="map-whole" onClick={() => apply({ s: 1, fx: 0, fy: 0 }, true)}>
              <Icon name="image" />
            </button>
          )}
          <button
            type="button"
            class="pic-zoom-btn"
            aria-label="Zoom out"
            data-testid="map-zoom-out"
            disabled={scale <= 1}
            onClick={() => zoomAt(view.current.s / STEP)}
          >
            <Minus />
          </button>
          <button
            type="button"
            class="pic-zoom-btn"
            aria-label="Zoom in"
            data-testid="map-zoom-in"
            disabled={scale >= maxS - 0.01}
            onClick={() => zoomAt(view.current.s * STEP)}
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>
    </div>
  );
}
