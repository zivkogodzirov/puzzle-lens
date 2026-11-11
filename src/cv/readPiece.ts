/**
 * One found piece read for the catalog: its corners and sides (shape reading, M3), the straightened
 * patch (box placement, M4) and its fingerprint (re-identification, M5 part 3). Used by the photo
 * helper's scan and by the tests, so both make exactly the same patches.
 */
import { extractPatch, type PiecePatch } from './placement';
import { readShape, READ_OK } from './shapeRead';
import { pieceFingerprint } from './fingerprint';
import type { PixelBuffer } from './frameAnalyser';
import type { Vec2 } from '../project/types';

/**
 * A side of a piece cut from touching ones lies on the cut when a point of its chord (at 0.3, 0.5,
 * 0.7) is within this × its length of the cut: the neighbouring sides' chords are about half a side
 * away from it, the cut side's within a knob's depth (~0.2).
 */
export const SPLIT_SIDE_NEAR = 0.22;

/** A found piece straightened, with its shape read and fingerprint. */
export interface PieceRead {
  patch: PiecePatch;
  flats: boolean[];
  sure: boolean;
  sides: string;
  sideConf: number[];
  fp: number[] | null;
}

/**
 * Reads one found piece (outline in photo px; `pxPerMm` the photo's scale): its corners and sides,
 * the straightened patch, and its fingerprint. Null for cut pieces, clumps and unreadable shapes.
 * Used by the photo helper's scan and by the tests, so both make exactly the same patches.
 */
export function readPiece(
  photo: PixelBuffer,
  piece: { outlineImg: number[]; flags: { cut?: boolean; clump?: boolean; part?: boolean; split?: boolean }; cutImg?: number[] },
  pxPerMm: number,
): PieceRead | null {
  if (piece.flags.cut || piece.flags.clump) return null;
  const rd = readShape(
    piece.outlineImg.map((v) => v / pxPerMm),
    null,
  );
  if (!rd) return null;
  const patch = extractPatch(
    photo,
    rd.corners.map(([x, y]) => [x * pxPerMm, y * pxPerMm] as Vec2),
    piece.outlineImg,
  );
  if (!patch) return null;
  // An outline found only in part: its sides are not the piece's (a cut across it can read as flat).
  if (piece.flags.part) return { patch, flats: [false, false, false, false], sure: false, sides: 'uuuu', sideConf: [0, 0, 0, 0], fp: pieceFingerprint(patch) };
  // M10 split: cut from touching pieces (src/cv/splitClumps.ts): the side along the cut is only as good as the
  // cut (a straight cut reads as flat), so it is not read, and the piece's kind is not trusted.
  if (piece.flags.split && piece.cutImg?.length) {
    const cut = piece.cutImg.map((v) => v / pxPerMm);
    const onCut = rd.sides.map((sd, k) => {
      const [ax, ay] = rd.corners[k]!;
      const [bx, by] = rd.corners[(k + 1) % 4]!;
      return [0.3, 0.5, 0.7].some((t) => {
        const x = ax + t * (bx - ax);
        const y = ay + t * (by - ay);
        for (let i = 0; i < cut.length; i += 2) if (Math.hypot(cut[i]! - x, cut[i + 1]! - y) < SPLIT_SIDE_NEAR * sd.lengthMm) return true;
        return false;
      });
    });
    return {
      patch,
      flats: rd.sides.map((sd, k) => !onCut[k] && sd.kind === 'flat'),
      sure: false,
      sides: rd.sides.map((sd, k) => (onCut[k] || sd.kind === 'unsure' ? 'u' : sd.kind[0])).join(''),
      sideConf: rd.sides.map((sd, k) => (onCut[k] ? 0 : Math.round(sd.conf * 100) / 100)),
      fp: pieceFingerprint(patch),
    };
  }
  return {
    patch,
    flats: rd.sides.map((sd) => sd.kind === 'flat'),
    sure: Boolean(rd.kind) && rd.quality >= READ_OK,
    sides: rd.sides.map((sd) => (sd.kind === 'unsure' ? 'u' : sd.kind[0])).join(''),
    sideConf: rd.sides.map((sd) => Math.round(sd.conf * 100) / 100),
    fp: pieceFingerprint(patch),
  };
}
