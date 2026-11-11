/**
 * M9 part 6 (tiles): the piece cut out of its thumbnail by its outline (src/app/screens/puzzle/pieceCutout.ts) and
 * the tile's VoiceOver name (PiecesGrid.tsx).
 */
import { describe, expect, it } from 'vitest';
import { cutoutIn, fitsThumb, frameFor, photoFrame, photoFrames, CUT_SHARE } from '../../src/app/screens/puzzle/pieceCutout';
import { tileFacts, tileName } from '../../src/app/screens/puzzle/PiecesGrid';
import type { PieceRow, SnapRow } from '../../src/project/types';

/** A 10 mm square piece at (x, y) on the table. */
function piece(extra: Partial<PieceRow> = {}, x = 50, y = 50): PieceRow {
  return {
    id: 'p1',
    projectId: 'pr',
    createdAt: 1,
    updatedAt: 1,
    status: 'table',
    table: { x, y, angleDeg: 0, lastSeen: 1, snapId: 's1' },
    outlineMm: [-5, -5, 5, -5, 5, 5, -5, 5],
    areaMm2: 100,
    sizeMm: [10, 10],
    colour: { meanLab: [50, 0, 0], hueHist: [0, 0, 0, 0, 0, 0, 0, 0] },
    thumbBlobId: 't',
    seen: 1,
    bestPxPerMm: 10,
    flags: {},
    ...extra,
  };
}

/** A photo: table mm = photo px ÷ ppm, turned by `turn` quarter turns. */
function snap(id: string, ppm: number, turn = 0, pieceIds: string[] = ['p1'], size = 1000): SnapRow {
  const c = Math.round(Math.cos((turn * Math.PI) / 2));
  const s = Math.round(Math.sin((turn * Math.PI) / 2));
  return {
    id,
    projectId: 'pr',
    kind: 'overview',
    ts: 1,
    width: size,
    height: size,
    zoom: 1,
    imgToTable: [c / ppm, -s / ppm, 0, s / ppm, c / ppm, 0, 0, 0, 1],
    quality: null,
    blobId: null,
    pieceIds,
  };
}

describe('a photo frame', () => {
  it('reads the scale, the turn and a mirror', () => {
    const f = photoFrame(snap('s1', 10))!;
    expect(f.ppm).toBeCloseTo(10, 6);
    expect(f.turn).toBeCloseTo(0, 6);
    expect(f.flip).toBe(false);
    expect(Math.abs(photoFrame(snap('s2', 10, 1))!.turn)).toBeCloseTo(Math.PI / 2, 6);
    expect(photoFrame({ imgToTable: [0.1, 0, 0, 0, -0.1, 0, 0, 0, 1], width: 100, height: 100 })!.flip).toBe(true);
    expect(photoFrame({ imgToTable: null, width: 100, height: 100 })).toBeNull();
  });
});

describe('the cut-out', () => {
  it('puts the piece in the middle at 72 % and clips the thumbnail box by the outline', () => {
    const c = cutoutIn(piece(), photoFrame(snap('s1', 10))!)!;
    // The piece is 100 px; its box with 12 % to spare is 124 px; 72 % of the tile is the 100 px.
    expect(c.aspect).toBeCloseTo(1, 6);
    expect(c.width).toBeCloseTo(124 * (CUT_SHARE / 100) * 100, 0);
    expect(c.left).toBeCloseTo(50 - 62 * CUT_SHARE, 0);
    expect(c.clip).toBe('polygon(9.7% 9.7%, 90.3% 9.7%, 90.3% 90.3%, 9.7% 90.3%)');
  });

  it('is clamped to the photo as the reader clamps the box (a piece at its edge)', () => {
    const c = cutoutIn(piece({}, 95, 50), photoFrame(snap('s1', 10))!)!;
    // Box 888…1000 px across (only 0 px to spare on the right), 124 px down.
    expect(c.aspect).toBeCloseTo(112 / 124, 6);
    expect(c.clip.startsWith('polygon(10.7% 9.7%')).toBe(true);
  });

  it('thins a long outline to at most 64 corners', () => {
    const n = 500;
    const outlineMm = Array.from({ length: n }, (_, i) => [5 * Math.cos((2 * Math.PI * i) / n), 5 * Math.sin((2 * Math.PI * i) / n)]).flat();
    const c = cutoutIn(piece({ outlineMm }), photoFrame(snap('s1', 10))!)!;
    expect(c.clip.split(',').length).toBeLessThanOrEqual(64);
  });

  it('none without an outline', () => {
    expect(cutoutIn(piece({ outlineMm: [] }), photoFrame(snap('s1', 10))!)).toBeNull();
  });

  it('checks the loaded thumbnail has the box shape', () => {
    const c = cutoutIn(piece({}, 95, 50), photoFrame(snap('s1', 10))!)!;
    expect(fitsThumb(c, 145, 160)).toBe(true);
    expect(fitsThumb(c, 160, 145)).toBe(false);
    expect(fitsThumb(c, 0, 0)).toBe(false);
  });
});

describe('which photo the outline is drawn into', () => {
  it('every photo of the piece turned alike: its last one', () => {
    const fr = photoFrames([snap('s1', 5), snap('s0', 10)]);
    expect(frameFor(piece(), fr)).toBe(fr.frames.get('s1'));
  });
  it('photos turned differently: the one as sharp as its best', () => {
    const fr = photoFrames([snap('s1', 5, 1), snap('s0', 10)]);
    expect(frameFor(piece(), fr)).toBe(fr.frames.get('s0'));
  });
  it('photos turned differently and none as sharp as its best: none (the plain thumbnail)', () => {
    expect(frameFor(piece({ bestPxPerMm: 7 }), photoFrames([snap('s1', 5, 1), snap('s0', 10)]))).toBeNull();
    expect(frameFor(piece(), photoFrames([]))).toBeNull();
  });
});

/** A photo turned by `deg` degrees (table mm = photo px ÷ ppm). */
function snapDeg(id: string, ppm: number, deg: number): SnapRow {
  const a = (deg * Math.PI) / 180;
  return { ...snap(id, ppm), imgToTable: [Math.cos(a) / ppm, -Math.sin(a) / ppm, 0, Math.sin(a) / ppm, Math.cos(a) / ppm, 0, 0, 0, 1] };
}

describe('a re-scan turned a little (the outline may be from the earlier photo)', () => {
  it('turned 8° and as sharp: neither can be told, so the plain thumbnail', () => {
    expect(frameFor(piece(), photoFrames([snapDeg('s1', 10, 8), snapDeg('s0', 10, 0)]))).toBeNull();
  });
  it('turned 8° and less sharp: the photo as sharp as its best, not the last one', () => {
    const fr = photoFrames([snapDeg('s1', 7, 8), snapDeg('s0', 10, 0)]);
    expect(frameFor(piece(), fr)).toBe(fr.frames.get('s0'));
  });
  it('turned 1°: the same turn, its last photo', () => {
    const fr = photoFrames([snapDeg('s1', 10, 1), snapDeg('s0', 10, 0)]);
    expect(frameFor(piece(), fr)).toBe(fr.frames.get('s1'));
  });
});

describe("a tile's VoiceOver name", () => {
  it('says the kind, the spot, the side, what to check and the colour group', () => {
    const place = { verdict: 'strong' as const, top: [{ col: 16, row: 7, rot: 0 as const, score: 1, p: 0.9 }] };
    expect(tileName(tileFacts(piece({ flags: { weak: true } }), 'edge', place, null, null))).toBe('Edge piece, very likely column 17 row 8, check outline');
    const maybe = { verdict: 'likely' as const, top: [{ col: 0, row: 0, rot: 0 as const, score: 1, p: 0.6 }] };
    expect(tileName(tileFacts(piece(), 'corner', maybe, 'top-left', { letter: 'B', hex: '', ink: '', also: 'C' }))).toBe(
      'Corner piece, maybe column 1 row 1, top-left corner, colour group B and C',
    );
    expect(tileName(tileFacts(piece({ status: 'pending' }), 'unsure', null, null, null))).toBe('Shape not sure yet, to check, may be a piece you moved');
    expect(tileName(tileFacts(piece(), 'unsure', null, null, null), 7)).toBe('Shape not sure yet, number 7');
  });
  it('picks the badges: a check for the spot, else a violet dot when the shape is read', () => {
    expect(tileFacts(piece(), 'interior', null, null, null).spot).toBe('shape');
    expect(tileFacts(piece(), 'unsure', null, null, null).spot).toBeNull();
    expect(tileFacts(piece({ flags: { clump: true, weak: true } }), 'interior', null, null, null).check).toBe('clump');
    // Touching and faint are told apart (M9 part 6 fixes).
    expect(tileName(tileFacts(piece({ flags: { clump: true } }), 'interior', null, null, null))).toBe('Inside piece, touching another piece');
    expect(tileName(tileFacts(piece({ flags: { weak: true } }), 'interior', null, null, null))).toBe('Inside piece, check outline');
  });
});
