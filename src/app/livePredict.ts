/**
 * Smoother live outlines (M5 part 4, PLAN §6 M5 "timestamped homographies with forward
 * prediction"). The tracker's table position is for a frame captured a little while ago (the
 * frame's way to the worker plus its analysis), so while the phone moves the outlines trail
 * behind the picture. From the last two positions (on the frames' own clock) this predicts where
 * the table is in the picture being shown now, and when the phone is still it calms the small
 * frame-to-frame jitter.
 *
 * Four reference points (table mm, inside the view) are followed in frame pixels; the shown mapping
 * is the homography through their predicted places.
 */
import { applyH, fitHomography, invertH } from '../geo/homography';
import type { Mat3, Vec2 } from '../project/types';

export const PREDICT = {
  /** Never predict further ahead than this (ms). */
  maxAheadMs: 120,
  /** Ignore a velocity from fixes further apart than this (ms): a stall, not a motion. */
  maxGapMs: 250,
  /** Below this speed (frame px per ms, ≈ 0.6 px per frame at 30 fps) the phone counts as still. */
  stillPxPerMs: 0.02,
  /** Share of the way towards the new position each screen refresh, when still (calms jitter). */
  stillAlpha: 0.3,
  /** Added to the estimated age of a fix (ms): the shown picture's own delay, tuned by test. */
  leadAdjustMs: 0,
};

export interface FixSample {
  /** The tracker's frame number (a new fix has a new one). */
  frame: number;
  /** The frame's capture time on its own clock (ms; VideoFrame.timestamp / 1000). */
  t: number;
  /** performance.now() when the result arrived. */
  arrive: number;
  /** The tracker's processing time for the frame (ms). */
  proc: number;
  /** Table mm → frame px. */
  H: Mat3;
  width: number;
  height: number;
}

export class OverlayPredictor {
  private hist: FixSample[] = [];
  private ref: Vec2[] | null = null;
  private shown: Vec2[] | null = null;
  enabled = true;

  /** A new tracker fix (the same frame twice is ignored). */
  push(s0: FixSample): void {
    const last = this.hist[this.hist.length - 1];
    if (last && last.frame === s0.frame) return;
    // Frames whose own clock doesn't advance (some browsers stamp every frame the same): use the
    // results' arrival times instead.
    const s = last && !(s0.t > last.t) ? { ...s0, t: last.t + Math.max(1, s0.arrive - last.arrive) } : s0;
    if (last && (last.width !== s.width || last.height !== s.height)) this.reset();
    this.hist.push(s);
    if (this.hist.length > 3) this.hist.shift();
    // Reference points: the frame's corners pulled 15 % in, on the table; kept while they stay
    // roughly in view (smoothing compares positions of the same table points).
    const inView = this.ref?.every((q) => {
      const p = applyH(s.H, q);
      return p[0] > -0.5 * s.width && p[0] < 1.5 * s.width && p[1] > -0.5 * s.height && p[1] < 1.5 * s.height;
    });
    if (!inView) {
      const inv = invertH(s.H);
      if (inv) {
        const m = 0.15;
        this.ref = (
          [
            [m * s.width, m * s.height],
            [(1 - m) * s.width, m * s.height],
            [(1 - m) * s.width, (1 - m) * s.height],
            [m * s.width, (1 - m) * s.height],
          ] as Vec2[]
        ).map((p) => applyH(inv, p));
        this.shown = null;
      }
    }
  }

  reset(): void {
    this.hist = [];
    this.ref = null;
    this.shown = null;
  }

  /** Table mm → frame px for the picture shown at performance time `now` (null without a fix). */
  at(now: number): Mat3 | null {
    const last = this.hist[this.hist.length - 1];
    if (!last) return null;
    if (!this.enabled || !this.ref) return last.H;
    const ref = this.ref;
    const p1 = ref.map((q) => applyH(last.H, q));
    let target = p1;
    let speed = 0;
    const prev = this.hist[this.hist.length - 2];
    const dt = prev ? last.t - prev.t : 0;
    if (prev && dt > 0 && dt <= PREDICT.maxGapMs) {
      const p0 = ref.map((q) => applyH(prev.H, q));
      const v = p1.map((q, i) => [(q[0] - p0[i]![0]) / dt, (q[1] - p0[i]![1]) / dt] as Vec2);
      speed = Math.max(...v.map((q) => Math.hypot(q[0], q[1])));
      if (speed >= PREDICT.stillPxPerMs) {
        const ahead = Math.min(PREDICT.maxAheadMs, Math.max(0, now - last.arrive + last.proc + PREDICT.leadAdjustMs));
        target = p1.map((q, i) => [q[0] + v[i]![0] * ahead, q[1] + v[i]![1] * ahead] as Vec2);
      }
    }
    // Still: ease towards the new position (jitter calms); moving: follow at once.
    const alpha = speed < PREDICT.stillPxPerMs ? PREDICT.stillAlpha : 1;
    if (!this.shown || alpha >= 1) this.shown = target.map((q) => [q[0], q[1]] as Vec2);
    else this.shown = this.shown.map((q, i) => [q[0] + alpha * (target[i]![0] - q[0]), q[1] + alpha * (target[i]![1] - q[1])] as Vec2);
    return fitHomography(ref, this.shown) ?? last.H;
  }
}
