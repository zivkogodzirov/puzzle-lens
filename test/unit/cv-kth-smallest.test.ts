/** Quickselect (M8 part 3): the same value a full sort gives, for the texture check's levels. */
import { describe, expect, it } from 'vitest';
import { kthSmallest } from '../../src/cv/pieceFinder';

describe('kthSmallest', () => {
  it('matches sorting, with repeats and at the ends', () => {
    let s = 7;
    const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32) * 100;
    for (const n of [1, 2, 3, 10, 101, 5000]) {
      const v = Float32Array.from({ length: n }, (_, i) => (i % 7 === 0 ? 42 : Math.round(r() * 10) / 10));
      const sorted = [...v].sort((a, b) => a - b);
      for (const k of [0, Math.floor(n * 0.25), n >> 1, n - 1]) expect(kthSmallest(Float32Array.from(v), k)).toBe(sorted[k]);
    }
  });
});
