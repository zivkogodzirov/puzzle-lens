import { useLayoutEffect, useRef, useState } from 'preact/hooks';
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
export function CoverageMap({ pieces, coverage, target, view }: { pieces: PieceRow[]; coverage: Coverage | null; target: Vec2 | null; view: Vec2 | null }) {
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
      data-testid="coverage-map"
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

/** The last photo (small preview) with the outlines of the pieces found in it. */
export function PhotoResult({
  url,
  size,
  outlines,
  onClose,
}: {
  url: string;
  size: { width: number; height: number };
  outlines: Array<{ points: number[]; flag: OutlineFlag }>;
  onClose: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const k = useSvgScale(svg, size.width, size.height);
  const [legendOpen, setLegendOpen] = useState(false);
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
  return (
    <div class="photo-result" data-testid="photo-result" onClick={onClose}>
      <TestStrip />
      <div class="photo-result-help" onClick={(e) => e.stopPropagation()}>
        <OverlayLegendButton onOpen={() => setLegendOpen(true)} />
      </div>
      <svg ref={svg} viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="xMidYMid meet">
        <image href={url} x={0} y={0} width={size.width} height={size.height} />
        {/* Every outline on a dark halo, all halos first (M9 part 1: pale lines vanish on a cream table). */}
        {[true, false].map((halo) =>
          outlines.map((o, i) => (
            <polygon
              key={`${halo ? 'h' : 'o'}${i}`}
              points={o.points.reduce((s, v, k) => s + (k % 2 ? `,${v.toFixed(0)} ` : `${v.toFixed(0)}`), '')}
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
      </svg>
      <p class="muted small">Tap to close</p>
      <div onClick={(e) => e.stopPropagation()}>
        <OverlayLegendSheet open={legendOpen} onClose={() => setLegendOpen(false)} />
      </div>
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
