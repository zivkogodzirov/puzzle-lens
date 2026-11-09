/** Smoother live outlines (src/app/livePredict.ts, M5 part 4). */
import { describe, expect, it } from 'vitest';
import { OverlayPredictor } from '../../src/app/livePredict';
import { applyH } from '../../src/geo/homography';
import type { Mat3 } from '../../src/project/types';

/** Table mm → frame px: 3 px per mm, shifted by (dx, dy) px. */
const H = (dx: number, dy: number): Mat3 => [3, 0, 100 + dx, 0, 3, 80 + dy, 0, 0, 1];
const fix = (frame: number, t: number, arrive: number, dx: number, dy = 0) => ({ frame, t, arrive, proc: 20, H: H(dx, dy), width: 960, height: 720 });

describe('live outline prediction', () => {
  it('a steady pan: the outlines are put where the table is now, not where it was in the analysed frame', () => {
    const p = new OverlayPredictor();
    // The picture moves 0.3 px per ms; fixes for frames 33 ms apart arrive 30 ms after capture.
    p.push(fix(1, 1000, 1030, 0));
    p.push(fix(2, 1033, 1063, 9.9));
    const now = 1080;
    const shown = applyH(p.at(now)!, [50, 50]);
    // The fix's frame was captured at ≈ 1063 − 20 (processing) = 1043: by 1080 the table moved on 0.3 × 37 ≈ 11 px.
    const truthX = 100 + 9.9 + 150 + 0.3 * (now - 1063 + 20);
    expect(Math.abs(shown[0] - truthX)).toBeLessThan(0.5);
    // Without prediction it trails by ~11 px.
    p.enabled = false;
    expect(Math.abs(applyH(p.at(now)!, [50, 50])[0] - truthX)).toBeGreaterThan(10);
  });

  it('a still phone: small jitter is calmed, a real move is followed at once', () => {
    const p = new OverlayPredictor();
    p.push(fix(1, 1000, 1030, 0));
    p.at(1031);
    p.push(fix(2, 1033, 1063, 0.4)); // jitter: 0.4 px in 33 ms (below the "still" speed)
    const x = applyH(p.at(1064)!, [50, 50])[0];
    expect(x - 250).toBeGreaterThan(0);
    expect(x - 250).toBeLessThan(0.4);
  });

  it('the same frame twice is one fix; frames stamped with the same time use arrival times', () => {
    const p = new OverlayPredictor();
    p.push(fix(1, 0, 1000, 0));
    p.push(fix(1, 0, 1010, 50)); // same frame number: ignored
    expect(applyH(p.at(1010)!, [50, 50])[0]).toBeCloseTo(250, 6);
    p.push(fix(2, 0, 1033, 9.9)); // same timestamp 0, a new frame: moved 9.9 px in 33 ms of arrival time
    const x = applyH(p.at(1033)!, [50, 50])[0];
    expect(x).toBeGreaterThan(259.9);
  });
});
