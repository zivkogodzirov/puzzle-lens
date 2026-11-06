/**
 * One scan photo (overview or close-up) from start to finish, on the decoded pixels: quality gate,
 * place it on the table (markers + marker map), find the pieces. Runs in the reader worker; a pure
 * function of the pixels so it is tested in Node on simulated photos.
 */
import type { Cv } from './loadCv';
import type { PixelBuffer } from './frameAnalyser';
import { PhotoChecker } from './photoCheck';
import { findPieces, type FoundPiece } from './pieceFinder';
import { learnTable } from './tableModel';
import { toGray } from './tableSetup';
import type { CaptureKind } from '../scan/autoCapture';
import type { Mat3, MarkerMap, PhotoQuality, TableModel } from '../project/types';

export interface ScanPhotoResult {
  quality: PhotoQuality;
  /** Photo → table mapping (null: no known marker in view, so the photo can't be placed yet). */
  imgToTable: Mat3 | null;
  tableToImg: Mat3 | null;
  pxPerMm: number | null;
  pieces: FoundPiece[];
  glareShare: number;
  timings: Record<string, number>;
}

/** Swaps BGRA → RGBA in place when needed (the piece finder expects RGBA). */
export function ensureRgba(img: PixelBuffer & { order?: 'RGBA' | 'BGRA' }): PixelBuffer {
  if (img.order !== 'BGRA') return img;
  const d = img.data;
  for (let y = 0; y < img.height; y++) {
    const row = y * img.stride;
    for (let x = 0; x < img.width; x++) {
      const i = row + 4 * x;
      const b = d[i]!;
      d[i] = d[i + 2]!;
      d[i + 2] = b;
    }
  }
  return img;
}

export function scanPixels(
  cv: Cv,
  checker: PhotoChecker,
  rgba: PixelBuffer,
  opts: { map: MarkerMap; table: TableModel | null; zoom: number; kind: CaptureKind; pieceAreaMm2?: number },
): ScanPhotoResult {
  const t0 = performance.now();
  const gray = toGray(cv, rgba, 'RGBA');
  const check = checker.check(gray, { map: opts.map, zoom: opts.zoom, kind: opts.kind });
  const timings: Record<string, number> = { check: performance.now() - t0 };
  const fix = check.fix;
  if (!fix) {
    return { quality: check.quality, imgToTable: null, tableToImg: null, pxPerMm: null, pieces: [], glareShare: 0, timings };
  }
  const found = findPieces(cv, rgba, {
    imgToTable: fix.imgToTable,
    tableToImg: fix.tableToImg,
    map: opts.map,
    table: opts.table,
    pxPerMm: fix.pxPerMm,
    zoom: opts.zoom,
    pieceAreaMm2: opts.pieceAreaMm2,
    withGlareMask: false,
  });
  for (const [k, v] of Object.entries(found.timings)) timings[`find.${k}`] = v;
  timings.total = performance.now() - t0;
  const quality: PhotoQuality = { ...check.quality, glareShare: found.glareShare };
  if (found.glareShare > 0.05) {
    quality.reasons = [...quality.reasons, 'Glare covers part of the table: take another photo from a slightly different angle'];
  }
  return { quality, imgToTable: fix.imgToTable, tableToImg: fix.tableToImg, pxPerMm: fix.pxPerMm, pieces: found.pieces, glareShare: found.glareShare, timings };
}

/** The table model from the set-up photo (after the marker map was solved from it). */
export function tableFromPixels(cv: Cv, rgba: PixelBuffer, opts: { imgToTable: Mat3; map: MarkerMap; snapId: string }): TableModel {
  return learnTable(cv, rgba, opts);
}
