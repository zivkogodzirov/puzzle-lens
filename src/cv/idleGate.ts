/**
 * Battery (M8 part 3): while the phone is held still over the table, the live view needn't
 * analyse every camera frame. When the table hasn't moved in the picture (by more than STILL_SHARE
 * of the frame's size) for IDLE_AFTER_MS, the tracker drops to IDLE_FPS; the first movement brings
 * it straight back. Movement is measured at four points inside the frame (15 % in from its corners),
 * against where the table was when the stillness began (not frame to frame: the tracker's full
 * re-match every few frames lands a few px off the frames followed in between, and a hand-held
 * phone wobbles by that much too; measured in WebKit: 4.4 px at 1920 px every 6th frame).
 */
import { applyH, invertH } from '../geo/homography';
import type { Mat3, Vec2 } from '../project/types';

export const IDLE = {
  /** Still for this long before slowing down (ms). */
  afterMs: 1000,
  /** Frames analysed per second while still. */
  fps: 8,
  /** Still = the table stayed within this share of the frame's larger side of where it was when the stillness began. */
  stillShare: 0.004,
};

export class IdleGate {
  private lastH: Mat3 | null = null;
  private stillSince: number | null = null;
  idle = false;
  /** How far the table moved in the picture at the last fix (px; for the HUD and tests). */
  moved = 0;

  /** A new table fix (table mm → frame px) for a frame of this size, at `now` (ms). Null: no fix. */
  update(H: Mat3 | null, width: number, height: number, now: number): boolean {
    if (!H) {
      this.reset();
      return false;
    }
    const prev = this.lastH;
    if (!prev) {
      this.lastH = H;
      this.stillSince = now;
      this.idle = false;
      return false;
    }
    const inv = invertH(prev);
    if (!inv) {
      this.reset();
      return false;
    }
    let moved = 0;
    for (const [fx, fy] of [
      [0.15, 0.15],
      [0.85, 0.15],
      [0.85, 0.85],
      [0.15, 0.85],
    ] as const) {
      const p: Vec2 = [fx * width, fy * height];
      const q = applyH(H, applyH(inv, p));
      moved = Math.max(moved, Math.hypot(q[0] - p[0], q[1] - p[1]));
    }
    this.moved = moved;
    if (moved > IDLE.stillShare * Math.max(width, height)) {
      // Moved: the stillness (if any) starts again from here.
      this.lastH = H;
      this.stillSince = now;
      this.idle = false;
    } else this.idle = now - (this.stillSince ?? now) >= IDLE.afterMs;
    return this.idle;
  }

  reset(): void {
    this.lastH = null;
    this.stillSince = null;
    this.idle = false;
  }

  /** The smallest gap between analysed frames (ms) given the normal one. */
  interval(normalMs: number): number {
    return this.idle ? Math.max(normalMs, 1000 / IDLE.fps - 2) : normalMs;
  }
}
