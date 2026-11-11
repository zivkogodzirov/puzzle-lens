import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Coverage } from '../../scan/coverage';
import { TestStrip } from './TestSteps';
import type { PieceRow, Vec2 } from '../../project/types';
import type { BadgeMark } from '../overlay';
import { OverlayLegendButton, OverlayLegendSheet, SvgBadge, SvgCross } from './OverlayLegend';

/**
 * How many drawing units (photo px) one screen px is in an SVG drawn with preserveAspectRatio "meet" over
 * `view` (width, height), so badges and labels keep their screen size on any photo (M9 part 3).
 */
export function useSvgScale(ref: { current: SVGSVGElement | null }, vw: number, vh: number): number {
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const measure = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) setK(Math.max(vw / r.width, vh / r.height));
    };
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, [vw, vh]);
  return k;
}

/** An outline's bounding box and centre (flat x, y points). */
export function boxOf(pts: number[]): { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = pts[i]!;
    const y = pts[i + 1]!;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    sx += x;
    sy += y;
  }
  const n = Math.max(1, pts.length / 2);
  return { x0, y0, x1, y1, cx: sx / n, cy: sy / n };
}

/** The badge of a scan flag (photo result). */
const FLAG_MARK: Partial<Record<OutlineFlag, BadgeMark>> = { weak: 'faint', clump: 'touching' };

/**
 * A small map of the table for marker-free scanning (no live position without markers): dots for
 * the pieces found, green where a close-up already covers, and a frame showing where the next
 * close-up should go. Table "up" (away from you) is up.
 */
export function CoverageMap({
  pieces,
  coverage,
  target,
  view,
  // M9 part 5 camera: the map opened large has its own test id.
  testId = 'coverage-map',
}: {
  pieces: PieceRow[];
  coverage: Coverage | null;
  target: Vec2 | null;
  view: Vec2 | null;
  testId?: string;
}) {
  if (!coverage || !pieces.length) return null;
  const a = coverage.area;
  const pad = 20;
  const w = a.x1 - a.x0 + 2 * pad;
  const h = a.y1 - a.y0 + 2 * pad;
  const cells = [];
  for (let i = 0; i < coverage.best.length; i++) {
    if (!coverage.isCovered(i)) continue;
    const c = coverage.cellCentre(i);
    cells.push(<rect key={i} x={c[0] - 5} y={c[1] - 5} width={10} height={10} class="cov-cell" />);
  }
  return (
    <svg
      class="coverage-map"
      viewBox={`${a.x0 - pad} ${a.y0 - pad} ${w} ${h}`}
      role="img"
      aria-label="Map of your pieces: green parts have a close-up"
      data-testid={testId}
    >
      <rect x={a.x0 - pad} y={a.y0 - pad} width={w} height={h} class="cov-bg" />
      {cells}
      {pieces.map((p) => (
        <circle key={p.id} cx={p.table.x} cy={p.table.y} r={Math.max(4, Math.sqrt(p.areaMm2) / 3)} class={p.flags.weak ? 'cov-piece weak' : 'cov-piece'} />
      ))}
      {target && view && <rect x={target[0] - view[0] / 2} y={target[1] - view[1] / 2} width={view[0]} height={view[1]} class="cov-target" />}
    </svg>
  );
}

/** How an outline on the photo result is drawn: pieces (ok/clump/weak), areas, a finished puzzle's frame and its gaps. */
export type OutlineFlag = 'ok' | 'clump' | 'weak' | 'assembled' | 'object' | 'finished' | 'gap';

/** The flags a person can act on in the photo viewer: a tap on one zooms to it and offers "Retake" or "It's fine". */
const ACTIONABLE: Partial<Record<OutlineFlag, string>> = {
  weak: 'A faint outline: check the piece is outlined whole.',
  clump: 'Pieces touching: spread them apart and take the photo again.',
};

/** Two taps within DOUBLE_MS and DOUBLE_PX are a double-tap; a finger that moves more than SLOP (px) drags. */
const DOUBLE_MS = 300;
const DOUBLE_PX = 30;
const SLOP = 8;
/** A double-tap zooms in by this much; the closest zoom. */
const STEP = 2.5;
const MAX_SCALE = 6;
/** A tap this close (screen px) to a flagged outline's box picks it. */
const PICK_PX = 14;

interface View {
  /** Scale, and the photo box's top-left as a share of the viewer's width / height (≤ 0). */
  s: number;
  fx: number;
  fy: number;
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pointsOf = (pts: number[]) => pts.reduce((s, v, k) => s + (k % 2 ? `,${v.toFixed(0)} ` : `${v.toFixed(0)}`), '');

/** One entry of the legend row: a sample of the line (the same CSS classes as on the photo) and its word. */
function LegendEntry({ flag, children }: { flag: OutlineFlag; children: string }) {
  const mark = FLAG_MARK[flag];
  return (
    <li class="photo-legend-item">
      <svg width="40" height="22" viewBox="0 0 40 22" aria-hidden="true">
        {flag === 'gap' ? (
          <>
            <rect x="13" y="4" width="14" height="14" class="res-halo res-halo-gap" />
            <rect x="13" y="4" width="14" height="14" class="res-outline res-gap" />
          </>
        ) : flag === 'object' ? (
          <SvgCross cx={20} cy={11} k={0.8} />
        ) : (
          <>
            <path d="M3 13 H27" class={`res-halo res-halo-${flag}`} />
            <path d="M3 13 H27" class={`res-outline res-${flag}`} />
            {mark && <SvgBadge mark={mark} cx={30} cy={11} k={0.75} />}
          </>
        )}
      </svg>
      {children}
    </li>
  );
}

const LEGEND: Array<[OutlineFlag, string]> = [
  ['ok', 'Fine'],
  ['weak', 'Faint'],
  ['clump', 'Touching'],
  ['object', 'Not a piece'],
  ['assembled', 'Joined pieces'],
  ['finished', 'The puzzle'],
  ['gap', 'Possible gap'],
];

/**
 * The photo viewer (M9 part 5, design plan §4 item 5): the last photo with the outlines of what was found in
 * it, full screen and zoomable like the Picture tab's map (screens/puzzle/PictureMap.tsx): pinch, double-tap
 * (again at the closest zoom: back to the whole photo), and drag once zoomed in (the SVG's viewBox, written
 * straight to the element during a gesture, so the lines stay thin at any zoom). A legend row says
 * what the outlines on this photo mean, and "Done" closes it. A tap on a flagged outline (faint, touching)
 * zooms to it and offers "Retake" (back to the camera) or "It's fine" (closes the offer; nothing is changed:
 * there is no "mark as fine" in the catalog yet).
 */
export function PhotoResult({
  url,
  size,
  outlines,
  onClose,
  onRetake,
}: {
  url: string;
  size: { width: number; height: number };
  outlines: Array<{ points: number[]; flag: OutlineFlag }>;
  onClose: () => void;
  /** "Retake" on a flagged outline: close the viewer and go back to the camera (default: just close). */
  onRetake?: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const vp = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const k0 = useSvgScale(svg, size.width, size.height);
  const [legendOpen, setLegendOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const view = useRef<View>({ s: 1, fx: 0, fy: 0 });
  // The part of the photo in view (photo px: x, y, width, height) while zoomed in; null: the whole photo.
  const shown = useRef<[number, number, number, number] | null>(null);
  // Photo px per screen px at this zoom: badges and crosses keep their screen size.
  const k = k0 / scale;
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'tap' | 'pan' | 'pinch'; x0: number; y0: number; d0: number; v0: View; moved: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (pending.current && clearTimeout(pending.current)), []);
  // VoiceOver and the keyboard start on "Done"; Escape closes the viewer (the legend sheet closes itself first).
  useEffect(() => {
    try {
      done.current?.focus({ preventScroll: true });
    } catch {
      done.current?.focus();
    }
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !legendOpen) onClose();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [legendOpen, onClose]);

  // M9 part 3, the outline language: dashed amber with a badge = have a look ("?" faint outline, arrows apart =
  // touching pieces); a cross at the centre = not a piece (CSS .res-* in "M9 part 3: outline language").
  // One badge per dashed outline, but not on top of another badge (the dashes still say "have a look").
  const kept: Array<{ x: number; y: number }> = [];
  const marks = outlines.map((o) => {
    const mark = FLAG_MARK[o.flag];
    const box = o.flag === 'object' || mark ? boxOf(o.points) : null;
    if (mark && box) {
      const at = { x: clampX(box.x1, k, size.width), y: clampY(box.y0, k, size.height) };
      if (kept.some((q) => Math.abs(q.x - at.x) < 24 * k && Math.abs(q.y - at.y) < 24 * k)) return { o, mark: undefined, box: null };
      kept.push(at);
    }
    return { o, mark, box };
  });
  const flagged = useMemo(() => outlines.flatMap((o, i) => (ACTIONABLE[o.flag] ? [{ i, box: boxOf(o.points) }] : [])), [outlines]);
  const present = new Set(outlines.map((o) => o.flag));
  const legend = LEGEND.filter(([f]) => present.has(f));

  /**
   * Shows the view (clamped so the photo's box always covers the viewer); `commit`: also re-renders. The zoom
   * changes the SVG's viewBox, written straight to the element (not a CSS transform, which would also make the
   * outlines' lines and halos thicker): the lines stay thin at any zoom.
   */
  const apply = (v: View, commit: boolean) => {
    const s = clamp(v.s, 1, MAX_SCALE);
    const next = { s, fx: clamp(v.fx, 1 - s, 0), fy: clamp(v.fy, 1 - s, 0) };
    view.current = next;
    const el = svg.current;
    const port = vp.current;
    if (el && port && port.clientWidth > 0 && port.clientHeight > 0) {
      const vw = port.clientWidth;
      const vh = port.clientHeight;
      // The whole photo fits the viewer at sc0 screen px per photo px, centred (ox, oy).
      const sc0 = Math.min(vw / size.width, vh / size.height);
      const ox = (vw - size.width * sc0) / 2;
      const oy = (vh - size.height * sc0) / 2;
      shown.current = s === 1 ? null : [((-next.fx * vw) / s - ox) / sc0, ((-next.fy * vh) / s - oy) / sc0, vw / (s * sc0), vh / (s * sc0)];
      el.setAttribute('viewBox', shown.current ? shown.current.map((n) => n.toFixed(2)).join(' ') : `0 0 ${size.width} ${size.height}`);
    }
    port?.classList.toggle('is-zoomed', s > 1);
    if (commit) setScale(s);
  };
  const rel = (x: number, y: number) => {
    const r = vp.current!.getBoundingClientRect();
    return { px: (x - r.left) / r.width, py: (y - r.top) / r.height };
  };
  const zoomAt = (s: number, px: number, py: number) => {
    const v = view.current;
    const ns = clamp(s, 1, MAX_SCALE);
    apply({ s: ns, fx: px - ((px - v.fx) / v.s) * ns, fy: py - ((py - v.fy) / v.s) * ns }, true);
  };
  /** The photo point (photo px) under a screen point, and the photo's screen px per photo px. */
  const toPhoto = (x: number, y: number): [number, number, number] => {
    const r = svg.current!.getBoundingClientRect();
    const b = shown.current;
    if (b) return [b[0] + ((x - r.left) / r.width) * b[2], b[1] + ((y - r.top) / r.height) * b[3], r.width / b[2]];
    const sc = Math.min(r.width / size.width, r.height / size.height);
    return [(x - r.left - (r.width - size.width * sc) / 2) / sc, (y - r.top - (r.height - size.height * sc) / 2) / sc, sc];
  };
  /** Zooms so that outline `i` fills about half the viewer, centred. */
  const zoomTo = (i: number) => {
    const el = vp.current;
    if (!el) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const sc = Math.min(vw / size.width, vh / size.height);
    const b = boxOf(outlines[i]!.points);
    const bw = Math.max(8, (b.x1 - b.x0) * sc);
    const bh = Math.max(8, (b.y1 - b.y0) * sc);
    const cx = (vw - size.width * sc) / 2 + ((b.x0 + b.x1) / 2) * sc;
    const cy = (vh - size.height * sc) / 2 + ((b.y0 + b.y1) / 2) * sc;
    const s = clamp(Math.min((0.5 * vw) / bw, (0.5 * vh) / bh), 1, MAX_SCALE);
    apply({ s, fx: 0.5 - (s * cx) / vw, fy: 0.5 - (s * cy) / vh }, true);
  };
  /** A single tap: the flagged outline under it (the smallest, if several) is picked and zoomed to. */
  const pickAt = (x: number, y: number) => {
    const [px, py, sc] = toPhoto(x, y);
    const m = PICK_PX / sc;
    let best: { i: number; area: number } | null = null;
    for (const f of flagged) {
      const b = f.box;
      if (px < b.x0 - m || px > b.x1 + m || py < b.y0 - m || py > b.y1 + m) continue;
      const area = (b.x1 - b.x0) * (b.y1 - b.y0);
      if (!best || area < best.area) best = { i: f.i, area };
    }
    if (best) {
      setPicked(best.i);
      zoomTo(best.i);
    } else setPicked(null);
  };
  const tap = (x: number, y: number) => {
    const now = performance.now();
    const last = lastTap.current;
    if (last && now - last.t < DOUBLE_MS && Math.hypot(x - last.x, y - last.y) < DOUBLE_PX) {
      // A double-tap: closer at that place; at the closest zoom, the whole photo again.
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
      lastTap.current = null;
      const { px, py } = rel(x, y);
      if (view.current.s >= MAX_SCALE - 0.01) apply({ s: 1, fx: 0, fy: 0 }, true);
      else zoomAt(view.current.s * STEP, px, py);
      return;
    }
    lastTap.current = { t: now, x, y };
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      pickAt(x, y);
    }, DOUBLE_MS);
  };

  const onDown = (e: PointerEvent) => {
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
      const ns = clamp((g.v0.s * d) / g.d0, 1, MAX_SCALE);
      apply({ s: ns, fx: m.px - ((m0.px - g.v0.fx) / g.v0.s) * ns, fy: m.py - ((m0.py - g.v0.fy) / g.v0.s) * ns }, false);
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

  const pick = picked !== null ? outlines[picked] : null;
  return (
    <div class="photo-result photo-view" data-testid="photo-result" role="dialog" aria-modal="true" aria-label="Your photo, with what was found">
      <TestStrip />
      <div class="photo-result-help">
        <OverlayLegendButton onOpen={() => setLegendOpen(true)} />
      </div>
      <div
        ref={vp}
        class="photo-view-port"
        data-testid="photo-view-port"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      >
        <svg
          ref={svg}
          class="photo-view-svg"
          viewBox={`0 0 ${size.width} ${size.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="The photo, with an outline round each piece found"
          data-testid="photo-view-svg"
          data-scale={scale.toFixed(2)}
        >
          <image href={url} x={0} y={0} width={size.width} height={size.height} />
          {/* Every outline on a dark halo, all halos first (M9 part 1: pale lines vanish on a cream table). */}
          {[true, false].map((halo) =>
            outlines.map((o, i) => (
              <polygon
                key={`${halo ? 'h' : 'o'}${i}`}
                points={pointsOf(o.points)}
                class={halo ? `res-halo res-halo-${o.flag}` : `res-outline res-${o.flag}`}
                vector-effect="non-scaling-stroke"
              />
            )),
          )}
          {marks.map(({ o, mark, box }, i) =>
            !box ? null : mark ? (
              <SvgBadge key={`b${i}`} mark={mark} k={k} cx={clampX(box.x1, k, size.width)} cy={clampY(box.y0, k, size.height)} />
            ) : o.flag === 'object' ? (
              <SvgCross key={`x${i}`} cx={box.cx} cy={box.cy} k={k} />
            ) : null,
          )}
          {pick && <polygon points={pointsOf(pick.points)} class="res-picked" vector-effect="non-scaling-stroke" data-testid="photo-picked" />}
        </svg>
      </div>
      <div class="photo-view-bottom">
        {pick ? (
          <div class="photo-view-offer" data-testid="flag-offer" role="group" aria-label="This outline">
            <p>{ACTIONABLE[pick.flag]}</p>
            <div class="photo-view-buttons">
              <button type="button" class="btn btn-filled" data-testid="flag-retake" onClick={() => (onRetake ? onRetake() : onClose())}>
                Retake
              </button>
              <button
                type="button"
                class="btn"
                data-testid="flag-fine"
                onClick={() => {
                  setPicked(null);
                  apply({ s: 1, fx: 0, fy: 0 }, true);
                }}
              >
                It’s fine
              </button>
            </div>
          </div>
        ) : (
          <>
            {legend.length > 0 && (
              <ul class="photo-legend" data-testid="photo-legend" role="list" aria-label="What the outlines mean">
                {legend.map(([f, w]) => (
                  <LegendEntry key={f} flag={f}>
                    {w}
                  </LegendEntry>
                ))}
              </ul>
            )}
            {flagged.length > 0 && <p class="photo-view-hint">Tap a dashed outline to look closer.</p>}
            {/* M9 part 6 help: the same as tapping a dashed outline, for VoiceOver (a tap on the photo has no name). */}
            {flagged.length > 0 && (
              <div class="sr-only" data-testid="flag-buttons">
                {flagged.slice(0, 12).map((f, n) => (
                  <button
                    key={f.i}
                    type="button"
                    onClick={() => {
                      setPicked(f.i);
                      zoomTo(f.i);
                    }}
                  >
                    {`Look closer at outline ${n + 1} of ${flagged.length}: ${outlines[f.i]!.flag === 'clump' ? 'pieces touching' : 'faint outline'}`}
                  </button>
                ))}
              </div>
            )}
            <button ref={done} type="button" class="btn btn-filled btn-block" data-testid="photo-done" onClick={onClose}>
              Done
            </button>
          </>
        )}
      </div>
      <OverlayLegendSheet open={legendOpen} onClose={() => setLegendOpen(false)} />
    </div>
  );
}

/** A badge's centre kept inside the photo (k = photo px per screen px). */
function clampX(x: number, k: number, w: number): number {
  const m = 14 * k;
  return Math.max(m, Math.min(w - m, x));
}
function clampY(y: number, k: number, h: number): number {
  const m = 14 * k;
  return Math.max(m, Math.min(h - m, y));
}
