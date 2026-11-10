/** Fewer live-view frames while the phone is still (M8 part 3, src/cv/idleGate.ts). */
import { describe, expect, it } from 'vitest';
import { IDLE, IdleGate } from '../../src/cv/idleGate';
import type { Mat3 } from '../../src/project/types';

/** Table mm → frame px: 4 px per mm, shifted by (dx, dy) px. */
const H = (dx = 0, dy = 0): Mat3 => [4, 0, 100 + dx, 0, 4, 80 + dy, 0, 0, 1];

describe('idle gate', () => {
  it('still for a second → idle (fewer frames); the first movement → full rate again', () => {
    const g = new IdleGate();
    let t = 0;
    expect(g.update(H(), 960, 720, t)).toBe(false);
    for (; t <= IDLE.afterMs - 100; t += 100) expect(g.update(H(0.3, -0.2), 960, 720, t)).toBe(false);
    t += 200;
    expect(g.update(H(0.2, 0.1), 960, 720, t)).toBe(true);
    expect(g.interval(1000 / 30 - 2)).toBeCloseTo(1000 / IDLE.fps - 2);
    // A wobble of a few pixels (a re-match, a hand) keeps it still; a movement of more: back at once.
    expect(g.update(H(3, 1), 960, 720, t + 50)).toBe(true);
    expect(g.update(H(8, 0), 960, 720, t + 100)).toBe(false);
    expect(g.interval(1000 / 30 - 2)).toBeCloseTo(1000 / 30 - 2);
  });

  it('a lost table, or a turn of the phone, ends the stillness', () => {
    const g = new IdleGate();
    for (let t = 0; t <= 1500; t += 100) g.update(H(), 960, 720, t);
    expect(g.idle).toBe(true);
    expect(g.update(null, 960, 720, 1600)).toBe(false);
    for (let t = 1700; t <= 3300; t += 100) g.update(H(), 960, 720, t);
    expect(g.idle).toBe(true);
    // A small turn (1°) moves the frame's corners by more than a few pixels.
    const a = (1 * Math.PI) / 180;
    const turned: Mat3 = [4 * Math.cos(a), -4 * Math.sin(a), 100, 4 * Math.sin(a), 4 * Math.cos(a), 80, 0, 0, 1];
    expect(g.update(turned, 960, 720, 3400)).toBe(false);
  });
});
