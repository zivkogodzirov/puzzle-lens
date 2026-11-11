/**
 * The outline language explained (M9 part 3, design plan §3.2 "Legend"): a "?" icon button on the camera
 * chrome opens a sheet with the colours, patterns and badges drawn over the live view and photos; and a
 * one-time tip, the first time labels show, that "17·9" means column 17, row 9 (remembered in the settings).
 */
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/icons';
import { Sheet } from '../ui/Sheet';
import { settings } from '../settings';
import { BADGE_R, DASH_SVG, HALO, HALO_SCALE, OVERLAY_STATE, SPLIT_GLYPH, type BadgeMark } from '../overlay';
import { OV } from '../tokens';

/** A badge as SVG (centre cx, cy; `k` = drawing units per screen px). */
export function SvgBadge({ mark, cx, cy, k = 1 }: { mark: BadgeMark; cx: number; cy: number; k?: number }) {
  const r = BADGE_R * k;
  const ring = 2 * k;
  const pill = mark === 'moved';
  const hw = pill ? 26 * k : r;
  return (
    <g class="ov-badge" data-mark={mark} data-testid="ov-badge" pointer-events="none">
      <rect x={cx - hw - ring} y={cy - r - ring} width={2 * (hw + ring)} height={2 * (r + ring)} rx={r + ring} fill={HALO} />
      <rect x={cx - hw} y={cy - r} width={2 * hw} height={2 * r} rx={r} fill={pill ? OV.bad : OV.warn} />
      {mark === 'touching' ? (
        <path
          d={SPLIT_GLYPH}
          transform={`translate(${cx - 7 * k} ${cy - 7 * k}) scale(${(14 / 16) * k})`}
          fill="none"
          stroke={OV.ink}
          stroke-width={2.2}
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      ) : (
        <text
          x={cx}
          y={cy}
          fill={OV.ink}
          font-size={(pill ? 13 : 15) * k}
          font-weight={pill ? 600 : 700}
          text-anchor="middle"
          dominant-baseline="central"
          class="ov-badge-text"
        >
          {pill ? 'moved?' : '?'}
        </text>
      )}
    </g>
  );
}

/** The ✕ "not a piece" marker as SVG. */
export function SvgCross({ cx, cy, k = 1 }: { cx: number; cy: number; k?: number }) {
  const r = 7 * k;
  const d = `M${cx - r} ${cy - r}L${cx + r} ${cy + r}M${cx + r} ${cy - r}L${cx - r} ${cy + r}`;
  return (
    <g class="ov-cross" data-testid="ov-cross" pointer-events="none">
      <path d={d} stroke={HALO} stroke-width={3 * HALO_SCALE * k} stroke-linecap="round" />
      <path d={d} stroke={OV.bad} stroke-width={3 * k} stroke-linecap="round" />
    </g>
  );
}

/** A small sample line (legend): solid or dashed, on its halo. */
function Sample({ colour, dashed, children }: { colour: string; dashed?: boolean; children?: ComponentChildren }) {
  return (
    <svg class="ov-sample" width="64" height="28" viewBox="0 0 64 28" aria-hidden="true">
      <rect x="0" y="0" width="64" height="28" rx="6" fill={OV.found} />
      <path d="M6 18 H38" stroke={HALO} stroke-width={2.5 * HALO_SCALE} />
      <path d="M6 18 H38" stroke={colour} stroke-width={2.5} stroke-dasharray={dashed ? DASH_SVG : undefined} />
      {children}
    </svg>
  );
}

function Row({ sample, children }: { sample: ComponentChildren; children: ComponentChildren }) {
  return (
    <li class="ov-legend-row">
      {sample}
      <span>{children}</span>
    </li>
  );
}

/** What the sheet says. */
export function OverlayLegendBody() {
  return (
    <div class="ov-legend" data-testid="overlay-legend-body">
      <h3 class="ov-legend-head">Outlines</h3>
      <ul class="ov-legend-list">
        <Row sample={<Sample colour={OVERLAY_STATE.placed} />}>Solid line: fine.</Row>
        <Row
          sample={
            <Sample colour={OV.warn} dashed>
              <SvgBadge mark="faint" cx={51} cy={14} k={0.9} />
            </Sample>
          }
        >
          Dashed with “?”: a faint outline. Check the piece is whole.
        </Row>
        <Row
          sample={
            <Sample colour={OV.warn} dashed>
              <SvgBadge mark="touching" cx={51} cy={14} k={0.9} />
            </Sample>
          }
        >
          Dashed with arrows apart: touching pieces. Spread them apart.
        </Row>
        <Row
          sample={
            <svg class="ov-sample" width="64" height="28" viewBox="0 0 64 28" aria-hidden="true">
              <rect x="0" y="0" width="64" height="28" rx="6" fill={OV.found} />
              <SvgBadge mark="moved" cx={32} cy={14} k={0.9} />
            </svg>
          }
        >
          Dashed with “moved?” (live view): not where it was. Scan again to update.
        </Row>
        <Row
          sample={
            <svg class="ov-sample" width="64" height="28" viewBox="0 0 64 28" aria-hidden="true">
              <rect x="0" y="0" width="64" height="28" rx="6" fill={OV.found} />
              <SvgCross cx={32} cy={14} />
            </svg>
          }
        >
          A cross in the middle: not a piece.
        </Row>
      </ul>
      <h3 class="ov-legend-head">Colours</h3>
      <ul class="ov-legend-list">
        <Row sample={<Sample colour={OVERLAY_STATE.placed} />}>Green: its spot on the box picture is known.</Row>
        <Row sample={<Sample colour={OVERLAY_STATE.shape} />}>Violet: its shape is read, its spot isn’t sure yet.</Row>
        <Row sample={<Sample colour={OVERLAY_STATE.found} />}>Light: found; a close-up reads its shape.</Row>
        <Row sample={<Sample colour={OV.warn} dashed />}>Amber, dashed: have a look (the badge says why).</Row>
      </ul>
      <h3 class="ov-legend-head">Labels</h3>
      <ul class="ov-legend-list">
        <Row
          sample={
            <svg class="ov-sample" width="64" height="28" viewBox="0 0 64 28" aria-hidden="true">
              <rect x="10" y="2" width="44" height="24" rx="12" fill={OV.labelBg} />
              <text x="32" y="14.5" fill={OV.labelText} font-size="15" font-weight="600" text-anchor="middle" dominant-baseline="central">
                17·9
              </text>
            </svg>
          }
        >
          “17·9”: column 17, row 9 on the box picture (counted from the top-left).
        </Row>
        <Row
          sample={
            <svg class="ov-sample" width="64" height="28" viewBox="0 0 64 28" aria-hidden="true">
              <rect x="0" y="0" width="64" height="28" rx="6" fill={OV.found} />
              <circle cx="32" cy="14" r="6" fill={HALO} />
              <circle cx="32" cy="14" r="4" fill={OVERLAY_STATE.placed} />
            </svg>
          }
        >
          A small dot: its spot isn’t sure yet. Tap the piece to see the best guess.
        </Row>
        <Row
          sample={
            <svg class="ov-sample" width="64" height="28" viewBox="0 0 64 28" aria-hidden="true">
              <rect x="0" y="0" width="64" height="28" rx="6" fill={OV.found} />
              <path d="M8 6 H56 V22 H8 Z" fill={OV.joinOk} fill-opacity="0.25" stroke={HALO} stroke-width={7} />
              <path d="M8 6 H56 V22 H8 Z" fill="none" stroke={OV.joinOk} stroke-width={3} />
            </svg>
          }
        >
          A green shape with one label (“17–18 · 7–8”): 4 pieces that fit together as a square.
        </Row>
        <Row
          sample={
            <svg class="ov-sample" width="64" height="28" viewBox="0 0 64 28" aria-hidden="true">
              <rect x="0" y="0" width="64" height="28" rx="6" fill={OV.found} />
              <path d="M6 14 H58" stroke={OV.joinHalo} stroke-width={6} />
              <path d="M6 14 H58" stroke={OV.join} stroke-width={3} stroke-dasharray="9 6" />
            </svg>
          }
        >
          A line between two pieces: they may join.
        </Row>
      </ul>
    </div>
  );
}

/** The "?" icon button and its sheet. */
export function OverlayLegendButton({ class: extra = 'btn-cam', onOpen }: { class?: string; onOpen: () => void }) {
  return (
    <IconButton
      label="What the outlines mean"
      class={extra}
      testId="overlay-legend-open"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <Icon name="help-circle" />
    </IconButton>
  );
}

/**
 * The legend's sheet. Put it at the end of the screen's markup, outside any bar with a z-index of its own
 * (a sheet inside the camera's top bar would be painted under the bottom bar).
 */
export function OverlayLegendSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="What the outlines mean" testId="overlay-legend">
      <OverlayLegendBody />
    </Sheet>
  );
}

/**
 * The one-time tip (design plan §3.2): the first time a column·row label shows (`active`), a capsule says what
 * "17·9" means, until "Got it". Remembered at once in the settings, so it shows once only.
 */
export function LabelTip({ active }: { active: boolean }) {
  const [state, setState] = useState<'idle' | 'shown' | 'done'>('idle');
  useEffect(() => {
    if (active && state === 'idle' && !settings.labelTipShown.value) {
      setState('shown');
      settings.labelTipShown.value = true;
    }
  }, [active, state]);
  if (state !== 'shown') return null;
  return (
    <div class="ov-tip" role="status" data-testid="overlay-tip">
      <span class="ov-tip-text">
        <strong>17·9</strong> means column 17, row 9 on the box picture.
      </span>
      <button
        type="button"
        class="ov-tip-ok"
        data-testid="overlay-tip-ok"
        onClick={(e) => {
          e.stopPropagation();
          setState('done');
        }}
      >
        Got it
      </button>
    </div>
  );
}
