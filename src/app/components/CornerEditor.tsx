/**
 * Drag the 4 corners of the box picture on a photo (wizard step 2). Made for one thumb:
 * - touch anywhere near a corner to grab it (the nearest one within reach), so the finger never has
 *   to land exactly on the dot, and the dot keeps its distance from the finger while dragging;
 * - a magnifier ("loupe") above the finger shows the corner 3× enlarged with a cross-hair, because
 *   the finger hides the very spot being placed.
 * The thick edge is the top of the picture. Corners are fractions (0–1) of the photo, in the order
 * top-left, top-right, bottom-right, bottom-left.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

export type Corner = [number, number];

interface Props {
  /** The photo (an object URL of a preview JPEG). */
  src: string;
  corners: Corner[];
  onChange: (corners: Corner[]) => void;
  disabled?: boolean;
}

const GRAB_PX = 80;
const LOUPE_PX = 132;
const ZOOM = 3;
const NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

interface Drag {
  index: number;
  pointerId: number;
  /** Corner minus finger, in fractions. */
  dx: number;
  dy: number;
}

export function CornerEditor({ src, corners, onChange, disabled }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The photo's width / height, so the editor is exactly the size of the shown photo. */
  const [ratio, setRatio] = useState<number | null>(null);
  const latest = useRef(corners);
  latest.current = corners;

  // Track the displayed size of the photo (it changes with rotation and when the image loads).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setBox({ w: r.width, h: r.height });
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      removeEventListener('resize', measure);
    };
  }, [src]);

  const toFraction = (ev: PointerEvent): Corner | null => {
    const el = wrap.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height];
  };

  const onPointerDown = (ev: PointerEvent) => {
    if (disabled || !box) return;
    const p = toFraction(ev);
    if (!p) return;
    let best = -1;
    let bestD = GRAB_PX;
    latest.current.forEach(([x, y], i) => {
      const d = Math.hypot((x - p[0]) * box.w, (y - p[1]) * box.h);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return;
    ev.preventDefault();
    try {
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    const c = latest.current[best]!;
    setDrag({ index: best, pointerId: ev.pointerId, dx: c[0] - p[0], dy: c[1] - p[1] });
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const p = toFraction(ev);
    if (!p) return;
    ev.preventDefault();
    const next = latest.current.map((c) => [...c] as Corner);
    next[drag.index] = [Math.min(1, Math.max(0, p[0] + drag.dx)), Math.min(1, Math.max(0, p[1] + drag.dy))];
    onChange(next);
  };

  const endDrag = (ev: PointerEvent) => {
    if (drag && ev.pointerId === drag.pointerId) setDrag(null);
  };

  const pts = corners.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ');
  const active = drag ? corners[drag.index] : null;
  let loupe = null;
  if (active && box) {
    const cx = active[0] * box.w;
    const cy = active[1] * box.h;
    // Above the finger; below it when the corner is near the top of the photo.
    const top = cy - LOUPE_PX - 56 >= -40 ? cy - LOUPE_PX - 56 : cy + 56;
    const left = Math.min(box.w - LOUPE_PX / 2, Math.max(LOUPE_PX / 2, cx)) - LOUPE_PX / 2;
    loupe = (
      <div
        class="loupe"
        data-testid="corner-loupe"
        style={{
          left: `${left}px`,
          top: `${top}px`,
          width: `${LOUPE_PX}px`,
          height: `${LOUPE_PX}px`,
          backgroundImage: `url("${src}")`,
          backgroundSize: `${box.w * ZOOM}px ${box.h * ZOOM}px`,
          backgroundPosition: `${LOUPE_PX / 2 - cx * ZOOM}px ${LOUPE_PX / 2 - cy * ZOOM}px`,
        }}
      >
        <div class="loupe-cross" />
      </div>
    );
  }

  return (
    <div
      class={`corner-editor${disabled ? ' is-disabled' : ''}`}
      ref={wrap}
      data-testid="corner-editor"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={ratio ? { width: `min(100%, calc(62vh * ${ratio.toFixed(4)}))` } : undefined}
    >
      <img
        src={src}
        alt="Your box photo"
        draggable={false}
        onLoad={(e) => {
          const img = e.currentTarget as HTMLImageElement;
          if (img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight);
          if (wrap.current) setBox({ w: wrap.current.clientWidth, h: wrap.current.clientHeight });
        }}
      />
      <svg class="corner-lines" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        <polygon points={pts} />
        <line
          class="top-edge"
          x1={corners[0]![0] * 1000}
          y1={corners[0]![1] * 1000}
          x2={corners[1]![0] * 1000}
          y2={corners[1]![1] * 1000}
        />
      </svg>
      {corners.map(([x, y], i) => (
        <div
          key={i}
          class={`corner-handle${drag?.index === i ? ' is-active' : ''}`}
          data-testid={`corner-handle-${i}`}
          aria-label={`${NAMES[i]} corner`}
          data-x={x.toFixed(4)}
          data-y={y.toFixed(4)}
          style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
        />
      ))}
      {loupe}
    </div>
  );
}
