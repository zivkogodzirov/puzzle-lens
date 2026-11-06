/**
 * Synthetic puzzle generator: cut a picture into a realistic jigsaw, lay the pieces on the
 * owner's white glossy table with the 8 printed markers, and "photograph" them with a hand-held
 * iPhone. Every output comes with exact ground truth. See README.md in this folder.
 */
import { makeArt } from './art';
import { cutPuzzle } from './cut';
import type { GeneratePuzzleOptions, SynthPuzzle } from './types';

export { renderScene, cellMeanRgb, cameraHomography } from './scene';
export { segmentationScore, positionErrorMm } from './score';
export type { SegmentationScore, SegmentationScoreOptions } from './score';
export { polygonIoU, rasterize, centroid, bbox, mapPoly, placePoly, signedArea } from './raster';
export * from './types';

export function generatePuzzle(opts: GeneratePuzzleOptions): SynthPuzzle {
  const { cols, rows, cellMm, seed } = opts;
  if (!(cols >= 2 && rows >= 2)) throw new Error('generatePuzzle: need at least 2 × 2 pieces');
  const cut = opts.cut ?? 'classic';
  const { pieces } = cutPuzzle(cols, rows, cellMm, seed, cut);
  const art = makeArt([cols * cellMm[0], rows * cellMm[1]], opts.art ?? { kind: 'procedural-kiss-like' }, seed);
  return { cols, rows, cellMm: [cellMm[0], cellMm[1]], seed, cut, art, pieces };
}
