/** Is a known piece still at its spot? (src/cv/presence.ts, M5 part 4) */
import { describe, expect, it } from 'vitest';
import { judgePresence, pieceContrast, PRESENCE, type GreyImage } from '../../src/cv/presence';
import type { Mat3 } from '../../src/project/types';

/** A 200 × 200 grey picture: table 220, with a textured dark square (the piece) where `piece` is true. */
function picture(piece: boolean, tone = 90): GreyImage {
  const data = new Uint8Array(200 * 200).fill(220);
  if (piece) for (let y = 80; y < 120; y++) for (let x = 80; x < 120; x++) data[y * 200 + x] = tone + ((x * 7 + y * 13) % 30);
  return { data, width: 200, height: 200, stride: 200 };
}
const toImg: Mat3 = [2, 0, 0, 0, 2, 0, 0, 0, 1]; // 2 px per mm
const piece = { id: 'a', outline: [40, 40, 60, 40, 60, 60, 40, 60] };

describe('piece presence', () => {
  it('a piece at its spot stands out; an empty spot does not', () => {
    const base = pieceContrast(picture(true), toImg, piece, 2)!;
    expect(base).toBeGreaterThan(100);
    expect(judgePresence(pieceContrast(picture(true), toImg, piece, 2), base)).toBe('there');
    expect(judgePresence(pieceContrast(picture(false), toImg, piece, 2), base)).toBe('gone');
  });

  it('a piece that hardly stands out in the scan photo (pale on white) is never called gone', () => {
    const pale = pieceContrast(picture(true, 205), toImg, piece, 2)!;
    expect(pale).toBeLessThan(PRESENCE.minBase + 10);
    expect(judgePresence(pieceContrast(picture(false), toImg, piece, 2), Math.min(pale, PRESENCE.minBase - 1))).toBe('unknown');
  });

  it('a spot partly outside the picture is unknown', () => {
    expect(pieceContrast(picture(true), [2, 0, -100, 0, 2, 0, 0, 0, 1], piece, 2)).toBeNull();
    expect(judgePresence(null, 120)).toBe('unknown');
  });
});
