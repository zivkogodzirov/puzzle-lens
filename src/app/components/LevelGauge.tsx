import type { GaugeState } from '../../scan/autoCapture';
import { settings } from '../settings';

/**
 * The level for hand-held photos (PLAN §2 "Phone"; M9 part 5, design plan §3.5 camera chrome): a 104 px
 * reticle in the middle of the picture, with no panel behind it, so the view stays clear. A bubble sits in
 * the middle when the phone is flat and an arrow points towards the next close-up. The one instruction is
 * in the status capsule at the top (CameraStatus) and the steadiness ring is around the shutter
 * (TableCamera), as in the iPhone Camera app.
 *
 * `lean` is in screen coordinates (x right, y down). The bubble moves the way a spirit level's
 * bubble would: away from the low side.
 */
export function LevelGauge({
  state,
  lean,
  tiltDeg,
  maxTiltDeg,
  arrow,
}: {
  state: GaugeState;
  lean: [number, number];
  tiltDeg: number | null;
  maxTiltDeg: number;
  arrow: [number, number] | null;
}) {
  const R = 46;
  const t = tiltDeg ?? 0;
  // Full deflection at twice the allowed tilt.
  const k = Math.min(1, t / (2 * maxTiltDeg));
  const bx = -lean[0] * k * (R - 12);
  const by = -lean[1] * k * (R - 12);
  const level = tiltDeg !== null && t <= maxTiltDeg;
  return (
    <div class={`gauge gauge-${state.status}`} data-testid="level-gauge" data-status={state.status} aria-hidden="true">
      <svg viewBox="-52 -52 104 104" width="104" height="104">
        {/* Each line over a dark halo, so it reads over a white table as well as a dark one (§3.1). */}
        <circle r={R} class="gauge-halo" />
        <circle r={R} class="gauge-face" />
        <circle r={(maxTiltDeg / (2 * maxTiltDeg)) * (R - 12) + 12} class="gauge-target" />
        <path d="M -8 0 H 8 M 0 -8 V 8" class="gauge-cross-halo" />
        <path d="M -8 0 H 8 M 0 -8 V 8" class="gauge-cross" />
        {tiltDeg !== null && <circle cx={bx} cy={by} r={11} class={level ? 'gauge-bubble ok' : 'gauge-bubble'} />}
        {arrow && (
          <g transform={`rotate(${(Math.atan2(arrow[1], arrow[0]) * 180) / Math.PI})`}>
            <path d="M 18 0 L 40 0 M 32 -8 L 40 0 L 32 8" class="gauge-arrow" />
          </g>
        )}
      </svg>
    </div>
  );
}

/**
 * The status capsule at the top of a camera screen: a level dot (green when the phone is flat, amber when
 * not, grey without a reading) and the one instruction. In Tester mode the gauge's numbers ("cm high ·
 * tilt") follow on a second line.
 */
export function CameraStatus({ state, tiltDeg, maxTiltDeg }: { state: GaugeState | null; tiltDeg: number | null; maxTiltDeg: number }) {
  if (!state) return null;
  const dot = tiltDeg === null ? 'none' : tiltDeg <= maxTiltDeg ? 'level' : 'tilted';
  const ready = state.status === 'ready';
  return (
    <div class="cam-status" data-testid="camera-status" data-level={dot}>
      <span class={`cam-status-dot cam-status-dot-${dot}`} aria-hidden="true" />
      <span class="cam-status-words">
        <span class={ready ? 'gauge-msg ok' : 'gauge-msg'} role="status" aria-live="polite">
          {state.message}
        </span>
        {/* Height and tilt in numbers: for testing only (M9 part 1, design plan §3.7). */}
        {state.heightMm !== null && settings.testerMode.value && (
          <span class="gauge-sub">
            {Math.round(state.heightMm / 10)} cm high · tilt {(tiltDeg ?? 0).toFixed(0)}°
          </span>
        )}
      </span>
    </div>
  );
}
