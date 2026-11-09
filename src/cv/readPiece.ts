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
export function readPiece(photo: PixelBuffer, piece: { outlineImg: number[]; flags: { cut?: boolean; clump?: boolean } }, pxPerMm: number): PieceRead | null {
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
  return {
    patch,
    flats: rd.sides.map((sd) => sd.kind === 'flat'),
    sure: Boolean(rd.kind) && rd.quality >= READ_OK,
    sides: rd.sides.map((sd) => (sd.kind === 'unsure' ? 'u' : sd.kind[0])).join(''),
    sideConf: rd.sides.map((sd) => Math.round(sd.conf * 100) / 100),
    fp: pieceFingerprint(patch),
  };
}
