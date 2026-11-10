/**
 * The reader worker's marker-free scan after decoding (src/cv/scanFreePixels.ts): when it scans a
 * photo again (without a stale scale hint, at the other zoom), the finished-puzzle check before
 * those retries, and the count of loose pieces beside a finished puzzle (2026-11-10), found again
 * at the puzzle's own scale when the scan settled far from it. The scan itself (scanMarkerless),
 * that one detection (findPiecesAt) and the seam reading are mocked here, so only these decisions
 * are tested; cv-real-scan-hint.test.ts runs them on the owner's photos.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssembledGrid } from '../../src/cv/assembledGrid';
import type { Cv } from '../../src/cv/loadCv';
import type { FoundPiece, FoundRegion } from '../../src/cv/pieceFinder';
import type { ScanMarkerlessOptions, ScanMarkerlessResult } from '../../src/cv/scanMarkerless';
import type { TableModel } from '../../src/project/types';

type FindAt = { pxPerMm: number; zoom: number; table: TableModel | null; pieceAreaMm2: number };
const mocks = vi.hoisted(() => ({
  scan: [] as Array<(o: ScanMarkerlessOptions) => ScanMarkerlessResult>,
  calls: [] as ScanMarkerlessOptions[],
  grid: null as ((outline: number[]) => AssembledGrid | null) | null,
  /** One detection at a given scale (findPiecesAt): what it was asked, and the pieces it finds. */
  findAt: [] as FindAt[],
  foundAt: [] as FoundPiece[],
}));
vi.mock('../../src/cv/scanMarkerless', async (orig) => ({
  ...(await orig<typeof import('../../src/cv/scanMarkerless')>()),
  scanMarkerless: (_cv: unknown, _rgba: unknown, o: ScanMarkerlessOptions) => {
    mocks.calls.push(o);
    const next = mocks.scan.shift();
    if (!next) throw new Error('unexpected scan');
    return next(o);
  },
  findPiecesAt: (_cv: unknown, _rgba: unknown, o: FindAt) => {
    mocks.findAt.push(o);
    return { frame: null, res: { pieces: mocks.foundAt, regions: [], timings: {} } };
  },
}));
vi.mock('../../src/cv/assembledGrid', async (orig) => ({
  ...(await orig<typeof import('../../src/cv/assembledGrid')>()),
  puzzleQuad: (_cv: unknown, _rgba: unknown, outline: number[]) => [[outline[0]!, outline[1]!]],
  readAssembledGrid: (_cv: unknown, _rgba: unknown, q: Array<[number, number]>) => mocks.grid?.(q.flat()) ?? null,
}));

const { gridPxPerMm, loosePiecesBeside, scanFreePixels } = await import('../../src/cv/scanFreePixels');

const W = 4032;
const H = 3024;
const cv = {} as Cv;
const rgba = { data: new Uint8Array(0), width: W, height: H, stride: W * 4 };

function square(cx: number, cy: number, side: number): number[] {
  const h = side / 2;
  return [cx - h, cy - h, cx + h, cy - h, cx + h, cy + h, cx - h, cy + h];
}
function piece(flags: FoundPiece['flags'] = {}, at: [number, number] = [500, 500], side = 80): FoundPiece {
  const outlineImg = square(at[0], at[1], side);
  return {
    outlineImg,
    outlineMm: outlineImg,
    centreMm: at,
    angleDeg: 0,
    areaMm2: side * side,
    sizeMm: [side, side],
    meanLab: [50, 0, 0],
    hueHist: [0, 0, 0, 0, 0, 0, 0, 0],
    bboxImg: [at[0] - side / 2, at[1] - side / 2, side, side],
    flags,
    score: 1,
  };
}
function result(o: {
  clean?: number;
  clumps?: number;
  registered?: boolean;
  regions?: FoundRegion[];
  tag?: string;
  pxPerMm?: number;
  unplacedPxPerMm?: number;
}): ScanMarkerlessResult {
  const pieces = [...Array.from({ length: o.clean ?? 0 }, () => piece()), ...Array.from({ length: o.clumps ?? 0 }, () => piece({ clump: true }))];
  const registered = o.registered ?? true;
  return {
    pieces: registered ? pieces : [],
    regions: o.regions ?? [],
    photoToCatalog: null,
    imgToCatalog: null,
    registered,
    isNewFrame: false,
    pxPerMm: registered ? (o.pxPerMm ?? 4) : null,
    inliers: 0,
    rmsMm: 0,
    confidence: 0,
    timings: { [`tag.${o.tag ?? ''}`]: 1 },
    // Not placed: the pieces found at its scale are kept aside, as scanMarkerless does.
    ...(registered ? {} : { unplaced: pieces, ...(o.unplacedPxPerMm ? { unplacedPxPerMm: o.unplacedPxPerMm } : {}) }),
  };
}
/** The finished puzzle's assembled region: most of the photo. */
const PUZZLE: FoundRegion = { kind: 'assembled', outlineImg: [100, 100, 3900, 100, 3900, 2900, 100, 2900], outlineMm: [], areaMm2: 0 };
const GRID: AssembledGrid = {
  cornersPx: [
    [100, 100],
    [3900, 100],
    [3900, 2900],
    [100, 2900],
  ],
  aspect: 1,
  colsExact: 36,
  rowsExact: 28,
  cols: 36,
  rows: 28,
  seamStrength: 0.6,
  gaps: [],
  gapsPx: [],
  gapSides: [],
};
const ROW = {
  id: 'a',
  table: { x: 0, y: 0 },
  areaMm2: 270,
  sizeMm: [18, 19] as [number, number],
  colour: { meanLab: [50, 0, 0] as [number, number, number], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
};
const base = { catalog: [], pitchMm: 18.6, zoom: 1, kind: 'overview' as const, table: null, pieceCount: 1000, grid: { cols: 36, rows: 28 } };
/** A hint 2.6 × the nominal 4 px/mm, e.g. from a close-up taken much lower. */
const stale = { pxPerMm: 10.5, maxSide: W };
const tags = (r: ScanMarkerlessResult) => Object.keys(r.timings).filter((k) => k.startsWith('tag.'));

beforeEach(() => {
  mocks.scan = [];
  mocks.calls = [];
  mocks.grid = null;
  mocks.findAt = [];
  mocks.foundAt = [];
});

describe('scanning again without a stale scale hint', () => {
  it('a hinted scan with too few single pieces is scanned again from the nominal scale, and the better one kept', () => {
    mocks.scan = [() => result({ clean: 1, clumps: 5, tag: 'hinted' }), () => result({ clean: 27, tag: 'plain' })];
    const { r, finished } = scanFreePixels(cv, rgba, { ...base, scaleHint: stale });
    expect(mocks.calls.map((o) => o.ppmHint ?? null)).toEqual([10.5, null]);
    expect(mocks.calls[1]!.zoom).toBe(1);
    // Same photo, pitch, zoom and table: the second scan reuses the first one's scale pre-pass.
    expect(mocks.calls[1]!.prePass).toBeDefined();
    expect(mocks.calls[1]!.prePass).toBe(mocks.calls[0]!.prePass);
    expect(tags(r)).toEqual(['tag.plain']);
    expect(r.timings.retriedNoHint).toBe(1);
    expect(finished).toBeNull();
  });

  it('a hinted photo that is not placed, with too few clean pieces at its scale, is scanned again', () => {
    mocks.scan = [() => result({ registered: false, clean: 2, clumps: 6, tag: 'hinted' }), () => result({ clean: 12, tag: 'plain' })];
    const { r } = scanFreePixels(cv, rgba, { ...base, catalog: [ROW], scaleHint: { pxPerMm: 3.34, maxSide: W } });
    expect(mocks.calls.map((o) => [o.ppmHint ?? null, o.zoom])).toEqual([
      [3.34, 1],
      [null, 1],
    ]);
    expect(r.registered).toBe(true);
    expect(tags(r)).toEqual(['tag.plain']);
    expect(r.timings.retriedNoHint).toBe(1);
  });

  it('a hinted photo that is not placed but measured its scale (5 or more clean pieces) is not scanned again without the hint', () => {
    // Usually a good hint on a photo that doesn't match: scanning again gave the same answer at
    // 1.4–2× the time (check 2026-11-10). Only the other zoom is tried, as before.
    mocks.scan = [() => result({ registered: false, clean: 23, tag: 'hinted' }), () => result({ registered: false, tag: 'other' })];
    const { r } = scanFreePixels(cv, rgba, { ...base, catalog: [ROW], scaleHint: { pxPerMm: 3.34, maxSide: W } });
    expect(mocks.calls.map((o) => [o.ppmHint ?? null, o.zoom])).toEqual([
      [3.34, 1],
      [null, 2],
    ]);
    // The other zoom's scale pre-pass is its own.
    expect(mocks.calls[1]!.prePass).toBeUndefined();
    expect(tags(r)).toEqual(['tag.hinted']);
    expect(r.timings.retriedNoHint).toBeUndefined();
  });

  it('keeps the hinted result when the second scan is no better (the other zoom is tried as before)', () => {
    mocks.scan = [
      () => result({ registered: false, clean: 1, tag: 'hinted' }),
      () => result({ registered: false, tag: 'plain' }),
      () => result({ registered: false, tag: 'other' }),
    ];
    const { r } = scanFreePixels(cv, rgba, { ...base, catalog: [ROW], scaleHint: stale });
    expect(mocks.calls.map((o) => [o.ppmHint ?? null, o.zoom])).toEqual([
      [10.5, 1],
      [null, 1],
      [null, 2],
    ]);
    expect(tags(r)).toEqual(['tag.hinted']);
    expect(r.timings.retriedNoHint).toBeUndefined();
  });

  it('a good hint costs nothing extra', () => {
    mocks.scan = [() => result({ clean: 30, tag: 'hinted' })];
    scanFreePixels(cv, rgba, { ...base, catalog: [ROW], scaleHint: { pxPerMm: 7.1, maxSide: W } });
    expect(mocks.calls).toHaveLength(1);
  });

  it('no second scan when the hint is the nominal scale anyway (it would start from the same place)', () => {
    mocks.scan = [() => result({ clean: 2, tag: 'hinted' }), () => result({ clean: 2, tag: 'other' })];
    // 4.2 px/mm on a 4032 px photo: within 10 % of the nominal 4.
    scanFreePixels(cv, rgba, { ...base, scaleHint: { pxPerMm: 4.2, maxSide: W } });
    expect(mocks.calls.map((o) => o.zoom)).toEqual([1, 2]);
  });

  it('the hint is scaled to the photo size before it is compared', () => {
    // 8 px/mm on an 8064 px photo is 4 px/mm here: the nominal scale, so no second scan without it.
    mocks.scan = [() => result({ clean: 1, tag: 'hinted' }), () => result({ clean: 1, tag: 'other' })];
    scanFreePixels(cv, rgba, { ...base, scaleHint: { pxPerMm: 8, maxSide: 2 * W } });
    expect(mocks.calls.map((o) => [o.ppmHint ?? null, o.zoom])).toEqual([
      [4, 1],
      [null, 2],
    ]);
  });
});

describe('the finished-puzzle check comes before the retries', () => {
  it('a finished puzzle is not scanned again (its pieces are not used)', () => {
    mocks.grid = () => GRID;
    mocks.scan = [() => result({ clean: 0, regions: [PUZZLE], tag: 'hinted' })];
    const { r, finished } = scanFreePixels(cv, rgba, { ...base, catalog: [ROW], scaleHint: stale });
    expect(mocks.calls).toHaveLength(1);
    expect(finished).toBe(GRID);
    expect(tags(r)).toEqual(['tag.hinted']);
  });

  it('a seam count far from the box’s pieces is not a finished puzzle, so the other zoom is still tried', () => {
    mocks.grid = () => ({ ...GRID, cols: 32, rows: 35 });
    mocks.scan = [() => result({ clean: 0, regions: [PUZZLE] }), () => result({ clean: 0 })];
    const { finished } = scanFreePixels(cv, rgba, base);
    expect(mocks.calls).toHaveLength(2);
    expect(finished).toBeNull();
  });

  it('when the other-zoom scan replaces the result, the finished check is done again on its areas', () => {
    const other: FoundRegion = { ...PUZZLE, outlineImg: [111, 100, 3900, 100, 3900, 2900, 100, 2900] };
    mocks.grid = (q) => (q[0] === 111 ? GRID : null);
    mocks.scan = [() => result({ clean: 2, regions: [PUZZLE] }), () => result({ clean: 8, regions: [other], tag: 'other' })];
    const { r, finished } = scanFreePixels(cv, rgba, base);
    expect(r.timings.retriedOtherZoom).toBe(1);
    expect(finished).toBe(GRID);
  });

  it('without a piece count there is no finished check', () => {
    mocks.grid = () => GRID;
    mocks.scan = [() => result({ clean: 0, regions: [PUZZLE] }), () => result({ clean: 0 })];
    const { finished } = scanFreePixels(cv, rgba, { ...base, pieceCount: undefined });
    expect(finished).toBeNull();
    expect(mocks.calls).toHaveLength(2);
  });
});

describe('loose pieces beside a finished puzzle', () => {
  // 36 × 28 cells of 100 px from (100, 100) to (3700, 2900).
  const grid = {
    cornersPx: [
      [100, 100],
      [3700, 100],
      [3700, 2900],
      [100, 2900],
    ] as Array<[number, number]>,
    cols: 36,
    rows: 28,
  };
  const side = Math.sqrt(0.79) * 100;

  it('counts whole pieces at least half a cell outside the puzzle, touching ones once', () => {
    const pieces = [
      piece({}, [3850, 500], side), // 1.5 cells right of the puzzle
      piece({ weak: true }, [500, 3000], side), // pale, 1 cell below
      piece({ clump: true }, [2000, 3150], 1.6 * side), // two touching pieces, 2.5 cells below
      piece({}, [2000, 1500], side), // on the puzzle (a false "piece" on its picture)
      piece({}, [3740, 1500], side), // 0.4 cell outside: an edge piece of the puzzle
      piece({ cut: true }, [3980, 600], side), // cut by the photo's edge
      piece({ weak: true, part: true }, [3900, 2000], side), // found only in part
      piece({}, [1000, 2990], 0.5 * side), // a scrap: a quarter of a piece
    ];
    expect(loosePiecesBeside(pieces, grid)).toBe(3);
  });

  it('the same with the corners the other way round, and none on an empty table', () => {
    const turned = { ...grid, cornersPx: [...grid.cornersPx].reverse() };
    expect(loosePiecesBeside([piece({}, [3850, 500], side), piece({}, [2000, 1500], side)], turned)).toBe(1);
    expect(loosePiecesBeside([], grid)).toBe(0);
  });

  it('the puzzle’s own scale: one cell is one piece pitch', () => {
    expect(gridPxPerMm(grid, 18.6)).toBeCloseTo(100 / 18.6, 6);
  });
});

describe('the loose pieces of a finished puzzle found at the scan’s scale or again at the puzzle’s own', () => {
  // GRID: 36 × 28 cells of about 103 px, so about 5.5 px/mm at an 18.6 mm pitch.
  const own = gridPxPerMm(GRID, 18.6);
  const finishedAt = (o: Parameters<typeof result>[0]) => {
    mocks.grid = () => GRID;
    mocks.scan = [() => result({ clean: 3, regions: [PUZZLE], tag: 'scan', ...o })];
    return scanFreePixels(cv, rgba, base);
  };

  it('a scan that settled within RESCALE_LIMIT of the puzzle’s scale: its own pieces are counted, nothing is found again', () => {
    for (const k of [0.75, 1, 1.25]) {
      mocks.findAt = [];
      const { finished, looseFound } = finishedAt({ pxPerMm: k * own });
      expect(finished, String(k)).toBe(GRID);
      expect(looseFound, String(k)).toBeUndefined();
      expect(mocks.findAt, String(k)).toHaveLength(0);
    }
  });

  it('placed at a scale far from the puzzle’s own: one detection at the puzzle’s scale, nothing else changes', () => {
    // IMG_9244 with the batch's catalog and a 2.86 px/mm hint settled at 1.15 px/mm, the puzzle's
    // own scale being 3.49: 0 loose pieces counted instead of about 14 (review 2026-11-10).
    mocks.foundAt = [piece({}, [3980, 500])];
    const { r, finished, looseFound } = finishedAt({ pxPerMm: 0.65 * own });
    expect(mocks.findAt).toEqual([{ pxPerMm: own, zoom: 1, table: null, pieceAreaMm2: 0.79 * 18.6 * 18.6 }]);
    expect(looseFound).toEqual(mocks.foundAt);
    expect(finished).toBe(GRID);
    expect(tags(r)).toEqual(['tag.scan']);
    expect(r.pieces).toHaveLength(3);
    expect(mocks.calls).toHaveLength(1);
  });

  it('not placed: the scale its pieces were found at counts; when it is not known, nothing is found again', () => {
    finishedAt({ registered: false, unplacedPxPerMm: 1.4 * own });
    expect(mocks.findAt.map((o) => o.pxPerMm)).toEqual([own]);
    mocks.findAt = [];
    expect(finishedAt({ registered: false, unplacedPxPerMm: 1.2 * own }).looseFound).toBeUndefined();
    expect(finishedAt({ registered: false }).looseFound).toBeUndefined();
    expect(mocks.findAt).toHaveLength(0);
  });

  it('the pieces found again are marked "found only in part" as a scan marks them', () => {
    mocks.foundAt = [...Array.from({ length: 8 }, (_, i) => piece({}, [300 + 200 * i, 3000])), piece({}, [3980, 500], 30)];
    const { looseFound } = finishedAt({ pxPerMm: 2 * own });
    expect(looseFound!.map((p) => Boolean(p.flags.part))).toEqual([false, false, false, false, false, false, false, false, true]);
  });

  it('not for a photo that is not a finished puzzle', () => {
    mocks.scan = [() => result({ clean: 8, pxPerMm: 0.5 * own })];
    expect(scanFreePixels(cv, rgba, base).looseFound).toBeUndefined();
    expect(mocks.findAt).toHaveLength(0);
  });
});
