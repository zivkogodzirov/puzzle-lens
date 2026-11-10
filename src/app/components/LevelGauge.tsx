import type { GaugeState } from '../../scan/autoCapture';
import { settings } from '../settings';

/**
 * The level-and-height gauge for hand-held photos (PLAN §2 "Phone"): a bubble that sits in the
 * middle when the phone is flat, a ring that fills while the phone is held still, an arrow towards
 * the next close-up, and one plain-English instruction.
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
  const ready = state.status === 'ready';
  const ring = 2 * Math.PI * (R + 6);
  return (
    <div class={`gauge gauge-${state.status}`} data-testid="level-gauge" data-status={state.status}>
      <svg viewBox="-60 -60 120 120" width="120" height="120" aria-hidden="true">
        <circle r={R} class="gauge-face" />
        <circle r={(maxTiltDeg / (2 * maxTiltDeg)) * (R - 12) + 12} class="gauge-target" />
        <circle
          r={R + 6}
          class="gauge-steady"
          style={{ strokeDasharray: `${ring}`, strokeDashoffset: `${ring * (1 - state.steady)}` }}
          transform="rotate(-90)"
        />
        {tiltDeg !== null && <circle cx={bx} cy={by} r={11} class={level ? 'gauge-bubble ok' : 'gauge-bubble'} />}
        {arrow && (
          <g transform={`rotate(${(Math.atan2(arrow[1], arrow[0]) * 180) / Math.PI})`}>
            <path d="M 18 0 L 40 0 M 32 -8 L 40 0 L 32 8" class="gauge-arrow" />
          </g>
        )}
      </svg>
      <p class={ready ? 'gauge-msg ok' : 'gauge-msg'} role="status" aria-live="polite">
        {state.message}
      </p>
      {/* Height and tilt in numbers: for testing only (M9 part 1, design plan §3.7). */}
      {state.heightMm !== null && settings.testerMode.value && (
        <p class="gauge-sub">
          {Math.round(state.heightMm / 10)} cm high · tilt {t.toFixed(0)}°
        </p>
      )}
    </div>
  );
}
