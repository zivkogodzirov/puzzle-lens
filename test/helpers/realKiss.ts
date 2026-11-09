/**
 * The owner's real puzzle (The Kiss, 28 × 36) as the app sees it, from photos in
 * test/fixtures/real/ (kept out of git; tests skip when missing): the box picture (shot-9294), the
 * 21 holes of the nearly finished puzzle (IMG_9280) and the 21 loose pieces (IMG_9276), read and
 * placed among the holes the way the app does it.
 */
import { existsSync } from 'node:fs';
import { puzzleQuad, readAssembledGrid } from '../../src/cv/assembledGrid';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { readShape, READ_OK, type ShapeRead } from '../../src/cv/shapeRead';
import { buildBoxGrid, extractPatch, patchStats, placePiece, spotStats, type BoxGrid, type PiecePatch } from '../../src/cv/placement';
import type { PlacementCache } from '../../src/project/placements';
import type { PieceRow, Vec2 } from '../../src/project/types';
import type { Cv } from '../../src/cv/loadCv';
import { decodeRgba, REAL_DIR } from './realFixtures';

export const KISS = { cols: 28, rows: 36 };

/** The 21 empty spots (column, row; 0-based). */
export const HOLES: Array<[number, number]> = [];
for (const r of [0, 1]) for (let c = 23; c <= 27; c++) HOLES.push([c, r]);
for (const r of [6, 7]) for (let c = 16; c <= 19; c++) HOLES.push([c, r]);
for (let c = 16; c <= 18; c++) HOLES.push([c, 8]);

/**
 * Truth from M4 (piece # in scan order of IMG_9276 → its spot), worked out from knob shapes and the
 * finished puzzle. #9 and #18 look alike and fit either spot; #1 and #19 aren't pieces.
 */
export const TRUTH: Record<number, [number, number]> = {
  2: [16, 7],
  3: [16, 8],
  4: [18, 6],
  5: [19, 7],
  6: [17, 8],
  7: [16, 6],
  8: [25, 0],
  9: [24, 1],
  10: [26, 0],
  11: [26, 1],
  12: [27, 0],
  13: [27, 1],
  14: [25, 1],
  15: [18, 7],
  16: [18, 8],
  17: [17, 7],
  18: [23, 1],
  20: [24, 0],
  21: [17, 6],
};
/** Pieces that can swap spots. */
export const ALIKE: Array<[number, number]> = [[9, 18]];

export const HAS_KISS = ['shot-9294.jpeg', 'IMG_9280.jpeg', 'IMG_9276.jpeg'].every((f) => existsSync(REAL_DIR + f));

export interface KissPiece {
  /** Scan order, from 1. */
  k: number;
  rd: ShapeRead;
  patch: PiecePatch;
  flats: boolean[];
  sure: boolean;
  sides: string;
  conf: number[];
}

export interface Kiss {
  box: BoxGrid;
  pieces: KissPiece[];
  colour: { from: NonNullable<ReturnType<typeof patchStats>>; to: NonNullable<ReturnType<typeof spotStats>> };
  /** The holes' sides as read from IMG_9280 (same order as HOLES). */
  spotSides: string[];
  /** Placements among the holes, as the app caches them. */
  cache: PlacementCache;
  /** The pieces as the app stores them (id = String(k)). */
  rows: PieceRow[];
}

export async function loadKiss(cv: Cv): Promise<Kiss> {
  const BW = 1120;
  const BH = 1569;
  const shot = await decodeRgba(REAL_DIR + 'shot-9294.jpeg');
  const boxA = new Uint8Array(BW * BH * 4);
  for (let y = 0; y < BH; y++) boxA.set(shot.data.subarray((1059 + y) * shot.stride + 400, (1059 + y) * shot.stride + 400 + BW * 4), y * BW * 4);
  const box = buildBoxGrid({ data: boxA, width: BW, height: BH, stride: BW * 4 }, KISS.cols, KISS.rows);
  const holes = await decodeRgba(REAL_DIR + 'IMG_9280.jpeg');
  const rh = scanMarkerless(cv, holes, { catalog: [], zoom: 1, kind: 'overview', table: null });
  const reg = rh.regions.filter((g) => g.kind === 'assembled').sort((a, b) => b.areaMm2 - a.areaMm2)[0]!;
  const g = readAssembledGrid(cv, holes, puzzleQuad(cv, holes, reg.outlineImg)!, { pieceCount: 1000, grid: KISS })!;
  const sideOf = new Map(g.gaps.map(([c, r], k) => [`${c},${r}`, g.gapSides[k]!]));
  const spotSides = HOLES.map(([c, r]) => sideOf.get(`${c},${r}`) ?? '????');
  const img = await decodeRgba(REAL_DIR + 'IMG_9276.jpeg');
  const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
  const ppm = r.pxPerMm ?? 4;
  const pieces: KissPiece[] = [];
  for (const p of r.pieces) {
    if (p.flags.cut || p.flags.clump) continue;
    const rd = readShape(
      p.outlineImg.map((v) => v / ppm),
      null,
    );
    if (!rd) continue;
    const patch = extractPatch(
      img,
      rd.corners.map(([x, y]) => [x * ppm, y * ppm] as Vec2),
      p.outlineImg,
    );
    if (!patch) continue;
    pieces.push({
      k: pieces.length + 1,
      rd,
      patch,
      flats: rd.sides.map((s) => s.kind === 'flat'),
      sure: Boolean(rd.kind) && rd.quality >= READ_OK,
      sides: rd.sides.map((s) => (s.kind === 'unsure' ? 'u' : s.kind[0])).join(''),
      conf: rd.sides.map((s) => s.conf),
    });
  }
  const colour = { from: patchStats(pieces.map((p) => p.patch))!, to: spotStats(box, HOLES)! };
  const inH = new Set(HOLES.map(([c, rr]) => rr * KISS.cols + c));
  const byPiece: PlacementCache['byPiece'] = {};
  for (const p of pieces)
    byPiece[String(p.k)] = {
      ts: 1,
      placement: placePiece(box, p.patch, { flats: p.flats, flatsSure: p.sure, colour, only: (c, rr) => inH.has(rr * KISS.cols + c), full: true }),
    };
  const cache: PlacementCache = { boxKey: 'k', colour: null, open: { cells: HOLES, sides: spotSides, turn: 0, fit: 1, runnerUp: 0 } as never, byPiece };
  const rows = pieces.map(
    (p) =>
      ({
        id: String(p.k),
        projectId: 'p',
        status: 'table',
        patch: { blobId: '', flats: p.flats, sure: p.sure, ts: 1, sides: p.sides, sideConf: p.conf },
      }) as unknown as PieceRow,
  );
  return { box, pieces, colour, spotSides, cache, rows };
}
