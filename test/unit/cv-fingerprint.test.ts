/** A piece's fingerprint (src/cv/fingerprint.ts, M5 part 3): its printed picture as a small grid, compared at 4 turns. */
import { describe, expect, it } from 'vitest';
import { fingerprintDistance, pieceFingerprint } from '../../src/cv/fingerprint';
import { PATCH_SIZE, type PiecePatch } from '../../src/cv/placement';

/** A patch painted by colour(x, y); turned q quarter turns clockwise; brightness scaled. */
function patch(colour: (x: number, y: number) => [number, number, number], q = 0, gain = 1): PiecePatch {
  const S = PATCH_SIZE;
  const rgba = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      // Turning the picture q times clockwise: the pixel at (x, y) shows the source at the turned-back place.
      let sx = x;
      let sy = y;
      for (let k = 0; k < q; k++) [sx, sy] = [sy, S - 1 - sx];
      const c = colour(sx, sy).map((v) => Math.min(255, Math.round(v * gain)));
      rgba.set([c[0]!, c[1]!, c[2]!, 255], (y * S + x) * 4);
    }
  return { size: S, rgba };
}
const quarters = (x: number, y: number): [number, number, number] =>
  x < 28 ? (y < 28 ? [200, 60, 50] : [40, 90, 200]) : y < 28 ? [230, 220, 90] : [60, 160, 70];
const stripes = (x: number, y: number): [number, number, number] => (Math.floor(y / 7) % 2 ? [180, 140, 100] : [90, 70, 50]);

describe('piece fingerprint', () => {
  it('the same picture turned any quarter turn, and lit 10 % brighter, is the same piece (and the turn is found)', () => {
    const a = pieceFingerprint(patch(quarters))!;
    for (let q = 0; q < 4; q++) {
      const b = pieceFingerprint(patch(quarters, q, 1.1))!;
      const r = fingerprintDistance(a, b);
      // Brightness is taken relative to the piece; colour strength still changes a little with the light.
      expect(r.d).toBeLessThan(8);
      expect(r.rot).toBe(q);
    }
  });

  it('a different picture is far', () => {
    const a = pieceFingerprint(patch(quarters))!;
    const b = pieceFingerprint(patch(stripes))!;
    expect(fingerprintDistance(a, b).d).toBeGreaterThan(25);
  });

  it('side shapes read the other way round in the turn compared cost extra', () => {
    const a = pieceFingerprint(patch(quarters))!;
    expect(fingerprintDistance(a, a, 'tbtb', 'tbtb').d).toBeCloseTo(0, 6);
    expect(fingerprintDistance(a, a, 'tbtb', 'bbtb').d).toBeGreaterThanOrEqual(6);
  });
});
