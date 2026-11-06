import type { Coverage } from '../../scan/coverage';
import type { PieceRow, Vec2 } from '../../project/types';

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
    <svg class="coverage-map" viewBox={`${a.x0 - pad} ${a.y0 - pad} ${w} ${h}`} role="img" aria-label="Map of your pieces: green parts have a close-up" data-testid="coverage-map">
      <rect x={a.x0 - pad} y={a.y0 - pad} width={w} height={h} class="cov-bg" />
      {cells}
      {pieces.map((p) => (
        <circle key={p.id} cx={p.table.x} cy={p.table.y} r={Math.max(4, Math.sqrt(p.areaMm2) / 3)} class={p.flags.weak ? 'cov-piece weak' : 'cov-piece'} />
      ))}
      {target && view && <rect x={target[0] - view[0] / 2} y={target[1] - view[1] / 2} width={view[0]} height={view[1]} class="cov-target" />}
    </svg>
  );
}

/** The last photo (small preview) with the outlines of the pieces found in it. */
export function PhotoResult({ url, size, outlines, onClose }: { url: string; size: { width: number; height: number }; outlines: Array<{ points: number[]; flag: 'ok' | 'clump' | 'weak' }>; onClose: () => void }) {
  return (
    <div class="photo-result" data-testid="photo-result" onClick={onClose}>
      <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="xMidYMid meet">
        <image href={url} x={0} y={0} width={size.width} height={size.height} />
        {outlines.map((o, i) => (
          <polygon
            key={i}
            points={o.points.reduce((s, v, k) => s + (k % 2 ? `,${v.toFixed(0)} ` : `${v.toFixed(0)}`), '')}
            class={`res-outline res-${o.flag}`}
            vector-effect="non-scaling-stroke"
          />
        ))}
      </svg>
      <p class="muted small">Tap to close</p>
    </div>
  );
}
