/**
 * Touching pieces after the scale is settled (src/cv/splitClumps.ts, M10 part 1): split into piece-shaped
 * parts with the cut marked, single pieces flagged as touching un-flagged, round blobs (the coin) left, and
 * how many pieces a blob left touching holds. Drawn outlines on a plain photo; the owner's photos are
 * measured in cv-real-counts.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { localPieceArea, localSizeSure, refineClumps, SPLIT } from '../../src/cv/splitClumps';
import { readPiece } from '../../src/cv/readPiece';
import type { FoundPiece } from '../../src/cv/pieceFinder';
import type { PieceFlags } from '../../src/project/types';
import { aboutPieces, piecesHeld, piecesIn } from '../../src/app/pieceCounts';
import { piecesResult } from '../../src/app/scanResult';
import { planMerge, type FoundForCatalog } from '../../src/project/catalog';

const PPM = 5;
const S = 80; // a piece's top face, px
const W = 1600;
const H = 1200;
const photo = { data: new Uint8Array(W * H * 4).fill(235), width: W, height: H, stride: W * 4 };

/**
 * A walk round a piece-like outline (clockwise on screen) from (x, y), `len` px per side; each side
 * has a knob out (+1), in (−1) or is flat (0), given top, right, bottom, left.
 */
function sideWalk(out: number[], x0: number, y0: number, dx: number, dy: number, len: number, knob: number): void {
  const nx = -dy;
  const ny = dx; // outwards for a clockwise walk in screen axes
  const steps = 40;
  for (let k = 0; k < steps; k++) {
    const t = k / steps;
    let bump = 0;
    if (knob && t > 0.35 && t < 0.65) bump = knob * 0.22 * len * Math.sin(((t - 0.35) / 0.3) * Math.PI);
    out.push(x0 + dx * t * len - nx * bump, y0 + dy * t * len - ny * bump);
  }
}
function pieceOutline(x: number, y: number, knobs: [number, number, number, number], len = S): number[] {
  const o: number[] = [];
  sideWalk(o, x, y, 1, 0, len, knobs[0]);
  sideWalk(o, x + len, y, 0, 1, len, knobs[1]);
  sideWalk(o, x + len, y + len, -1, 0, len, knobs[2]);
  sideWalk(o, x, y + len, 0, -1, len, knobs[3]);
  return o;
}
function found(outlineImg: number[], flags: PieceFlags = {}): FoundPiece {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < outlineImg.length; i += 2) {
    const j = (i + 2) % outlineImg.length;
    const cr = outlineImg[i]! * outlineImg[j + 1]! - outlineImg[j]! * outlineImg[i + 1]!;
    a += cr;
    cx += (outlineImg[i]! + outlineImg[j]!) * cr;
    cy += (outlineImg[i + 1]! + outlineImg[j + 1]!) * cr;
  }
  const xs = outlineImg.filter((_, i) => i % 2 === 0);
  const ys = outlineImg.filter((_, i) => i % 2 === 1);
  const bx = Math.min(...xs);
  const by = Math.min(...ys);
  return {
    outlineImg,
    outlineMm: outlineImg.map((v) => v / PPM),
    centreMm: [cx / (3 * a) / PPM, cy / (3 * a) / PPM],
    angleDeg: 0,
    areaMm2: Math.abs(a / 2) / PPM / PPM,
    sizeMm: [(Math.max(...xs) - bx) / PPM, (Math.max(...ys) - by) / PPM],
    meanLab: [40, 10, 10],
    hueHist: [1, 0, 0, 0, 0, 0, 0, 0],
    bboxImg: [bx, by, Math.max(...xs) - bx, Math.max(...ys) - by],
    flags,
    score: 0.5,
  };
}
/** Clean single pieces spread over the photo (they give the local single-piece size). */
const singles = Array.from({ length: 8 }, (_, i) => found(pieceOutline(100 + (i % 4) * 300, 100 + Math.floor(i / 4) * 300, [1, -1, 1, -1])));

/** Two pieces side by side, touching along a whole edge (one outline). */
function pair(x: number, y: number): number[] {
  const o: number[] = [];
  sideWalk(o, x, y, 1, 0, S, 1);
  sideWalk(o, x + S, y, 1, 0, S, -1);
  sideWalk(o, x + 2 * S, y, 0, 1, S, 1);
  sideWalk(o, x + 2 * S, y + S, -1, 0, S, 1);
  sideWalk(o, x + S, y + S, -1, 0, S, -1);
  sideWalk(o, x, y + S, 0, -1, S, 1);
  return o;
}
function disc(cx: number, cy: number, r: number): number[] {
  const o: number[] = [];
  for (let k = 0; k < 90; k++) o.push(cx + r * Math.cos((k / 90) * 2 * Math.PI), cy + r * Math.sin((k / 90) * 2 * Math.PI));
  return o;
}

describe('refineClumps', () => {
  it('splits two touching pieces into two piece-sized parts, each marked split with its cut', () => {
    const r = refineClumps(photo, [...singles, found(pair(400, 800), { clump: true })], { regions: [], pieceAreaMm2: 256, split: true });
    const parts = r.pieces.filter((p) => p.flags.split);
    expect(r.stats.split).toBe(1);
    expect(parts).toHaveLength(2);
    for (const p of parts) {
      expect(p.flags.clump).toBe(false);
      expect(p.areaMm2 / singles[0]!.areaMm2).toBeGreaterThan(0.8);
      expect(p.areaMm2 / singles[0]!.areaMm2).toBeLessThan(1.25);
      // The cut runs down the middle (x ≈ 480).
      const xs = p.cutImg!.filter((_, i) => i % 2 === 0);
      expect(Math.min(...xs)).toBeGreaterThan(470);
      expect(Math.max(...xs)).toBeLessThan(490);
    }
    // Each part's centre in mm follows its outline (mapped like the blob's).
    expect(parts.map((p) => Math.round(p.centreMm[0])).sort((a, b) => a - b)).toEqual([88, 104]);
  });

  it('leaves a round blob (the coin) touching, with how many pieces its size holds', () => {
    const r = refineClumps(photo, [...singles, found(disc(500, 900, 105), { clump: true })], { regions: [], pieceAreaMm2: 256, split: true });
    const coin = r.pieces.find((p) => p.flags.clump)!;
    expect(r.stats.split).toBe(0);
    expect(coin.flags.touching).toBeGreaterThanOrEqual(4);
  });

  it('a single piece flagged as touching that reads as one clean piece is one piece again', () => {
    const long = found(pieceOutline(500, 800, [1, 1, -1, 1]), { clump: true });
    const r = refineClumps(photo, [...singles, long], { regions: [], pieceAreaMm2: 256, split: true });
    expect(r.stats.rescued).toBe(1);
    expect(r.pieces.filter((p) => p.flags.clump)).toHaveLength(0);
  });

  it('leaves touching pieces next to an assembled area alone', () => {
    const blob = found(pair(400, 800), { clump: true });
    const area = { kind: 'assembled' as const, outlineImg: [400, 905, 1400, 905, 1400, 1190, 400, 1190], outlineMm: [], areaMm2: 1 };
    const r = refineClumps(photo, [...singles, blob], { regions: [area], pieceAreaMm2: 256, split: true });
    expect(r.stats.split).toBe(0);
    expect(r.pieces.find((p) => p.flags.clump)!.flags.touching).toBe(2);
  });

  it('splits only a blob clearly the size of k pieces (review 2026-11-11: pieces cut wrongly on IMG_9245 and IMG_9246)', () => {
    // The same two pieces drawn bigger: 2.3 × a single piece is split in two; 2.46 × (as IMG_9246's 2.55 for 3) is not cut.
    const two = found(pair(400, 800)).areaMm2 / found(pieceOutline(0, 0, [1, -1, 1, -1])).areaMm2;
    const scaled = (rel: number) => pair(400, 800).map((v, i) => (i % 2 ? 800 : 400) + (v - (i % 2 ? 800 : 400)) * Math.sqrt(rel / two));
    const clear = refineClumps(photo, [...singles, found(scaled(2.3), { clump: true })], { regions: [], pieceAreaMm2: 256, split: true });
    expect(clear.stats.split).toBe(1);
    const unclear = refineClumps(photo, [...singles, found(scaled(2.46), { clump: true })], { regions: [], pieceAreaMm2: 256, split: true });
    expect(unclear.stats.split).toBe(0);
    expect(unclear.pieces.find((p) => p.flags.clump)!.flags.touching).toBe(2);
  });

  it('on a steep photo (single pieces of very different sizes) splits nothing, and a piece-shaped blob counts as one', () => {
    // Clean "single pieces" half and full size mixed across the photo (fragments of the picture, far and near pieces).
    const mixed = Array.from({ length: 12 }, (_, i) =>
      found(pieceOutline(100 + (i % 4) * 300, 100 + Math.floor(i / 4) * 250, [1, -1, 1, -1], i % 2 ? S : S * 0.62)),
    );
    expect(localSizeSure(mixed, localPieceArea(mixed)!)).toBe(false);
    expect(localSizeSure(singles, localPieceArea(singles)!)).toBe(true);
    const big = found(pieceOutline(500, 900, [1, -1, 1, 1], S * 1.5), { clump: true });
    const r = refineClumps(photo, [...mixed, found(pair(900, 900), { clump: true }), found(disc(1400, 1000, 110), { clump: true }), big], {
      regions: [],
      pieceAreaMm2: 256,
      split: true,
    });
    expect(r.stats.split).toBe(0);
    // The big single piece: over 2 × the local piece by size, but shaped as one piece: 1. A blob not shaped as a piece: by its size.
    const kept = r.pieces.filter((p) => p.flags.clump);
    expect(kept.find((p) => p.bboxImg[0] < 700)!.flags.touching).toBe(1);
    expect(kept.find((p) => p.bboxImg[0] > 1200)!.flags.touching).toBeGreaterThanOrEqual(3);
    // The same pair on a photo whose single pieces agree is split.
    expect(refineClumps(photo, [...singles, found(pair(900, 900), { clump: true })], { regions: [], pieceAreaMm2: 256, split: true }).stats.split).toBe(1);
  });

  it('local single-piece size follows a tilted photo (bigger pieces nearer)', () => {
    const tilted = Array.from({ length: 16 }, (_, i) => {
      const y = 100 + Math.floor(i / 4) * 280;
      return found(pieceOutline(100 + (i % 4) * 300, y, [1, -1, 1, -1], S * (0.8 + y / 1500)));
    });
    const A = localPieceArea(tilted)!;
    expect(A(400, 1000) / A(400, 150)).toBeGreaterThan(1.6);
    expect(SPLIT.areaClamp[1]).toBeGreaterThan(1.9);
  });
});

describe('readPiece of a piece cut from touching ones', () => {
  it('does not read the side along the cut, and does not trust its kind', () => {
    const w = 140;
    const data = new Uint8ClampedArray(w * w * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 255));
    const img = { data, width: w, height: w, stride: w * 4 };
    const o = pieceOutline(30, 30, [1, 0, 1, -1], 70);
    const cut: number[] = [];
    for (let t = 0; t <= 10; t++) cut.push(100, 30 + 7 * t);
    const whole = readPiece(img, { outlineImg: o, flags: {} }, 3)!;
    const split = readPiece(img, { outlineImg: o, flags: { split: true }, cutImg: cut }, 3)!;
    expect(whole.sides).toContain('f');
    expect(split.sure).toBe(false);
    expect(split.sides.split('').filter((c) => c === 'u')).toHaveLength(1);
    expect(split.sides).not.toContain('f');
    expect(split.flats.every((f) => !f)).toBe(true);
  });
});

describe('pieces held by outlines of touching pieces', () => {
  it('counts a touching group by its estimate, older rows as one', () => {
    expect(piecesIn({ clump: true, touching: 3 })).toBe(3);
    expect(piecesIn({ clump: true })).toBe(1);
    expect(piecesIn({ touching: 3 })).toBe(1);
    expect(piecesHeld([{ flags: {} }, { flags: { clump: true, touching: 3 } }])).toEqual({ total: 4, extra: 2 });
    expect(aboutPieces(4, 2)).toBe('about 4 pieces');
    expect(aboutPieces(1, 0)).toBe('1 piece');
  });
  it('the scan result says "about" and how many pieces the touching spots hold', () => {
    const base = () => ({
      kind: 'overview' as const,
      count: 59,
      about: true,
      inClumps: 13,
      added: 50,
      ready: 40,
      clumps: 5,
      faint: 0,
      part: 0,
      back: 0,
      moved: 0,
      pending: 0,
      missing: 0,
      reasons: [],
      coinLines: [],
      quick: false,
      photo: true,
    });
    const x = piecesResult(base());
    expect(x.title).toBe('Found about 59 pieces');
    expect(x.items.map((i) => i.text).join(' ')).toContain('5 spots where pieces touch (about 13 pieces)');
    // A first photo: the new pieces counted the same way as the found ones (review 2026-11-11: "Found about 68" beside "51 new, 17 seen before").
    const first = piecesResult({ ...base(), count: 59, about: true, added: 59, addedAbout: true });
    expect([first.title, first.sub]).toEqual(['Found about 59 pieces', 'about 59 new']);
  });
});

describe('catalog: a piece first known from a cut', () => {
  it('is the same piece when seen whole (its size not compared), and takes the whole outline', () => {
    let n = 0;
    const ctx = (now: number) => ({ projectId: 'p', snapId: `s${now}`, pxPerMm: 4, now, newId: () => `piece-${++n}`, thumbId: (id: string) => `t-${id}` });
    const part: FoundForCatalog = {
      outlineMm: [90, 88, 112, 88, 112, 112, 90, 112],
      centreMm: [101, 100],
      angleDeg: 0,
      areaMm2: 528,
      sizeMm: [22, 24],
      meanLab: [50, 0, 0],
      hueHist: [1, 0, 0, 0, 0, 0, 0, 0],
      flags: { split: true },
    };
    const cat = planMerge([], [part], ctx(1)).added;
    const whole: FoundForCatalog = {
      ...part,
      outlineMm: [86, 87, 114, 87, 114, 113, 86, 113],
      centreMm: [100, 100],
      areaMm2: 728,
      sizeMm: [28, 26],
      flags: {},
    };
    const plan = planMerge(cat, [whole], ctx(2));
    expect(plan.added).toHaveLength(0);
    expect(plan.updates[0]!.areaMm2).toBe(728);
    expect(plan.updates[0]!.flags.split).toBeFalsy();
  });

  const sq = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];
  const sighting = (o: number[], flags: PieceFlags): FoundForCatalog => {
    const xs = o.filter((_, i) => i % 2 === 0);
    const ys = o.filter((_, i) => i % 2 === 1);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    return {
      outlineMm: o,
      centreMm: [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2],
      angleDeg: 0,
      areaMm2: w * h,
      sizeMm: [w, h],
      meanLab: [50, 0, 0],
      hueHist: [1, 0, 0, 0, 0, 0, 0, 0],
      flags,
    };
  };
  const ctxAt = (now: number) => {
    let n = 0;
    return { projectId: 'p', snapId: `s${now}`, pxPerMm: 4, now, newId: () => `piece-${now}-${++n}`, thumbId: (id: string) => `t-${id}` };
  };

  it('one piece cut in three, then seen whole: one row takes it, the other parts go (review 2026-11-11: ghost rows)', () => {
    // A piece 26 × 26 mm at (100, 100) cut in three parts, and a separate piece cut from another blob nearby.
    const parts = [sq(87, 87, 100, 113), sq(100, 87, 113, 100), sq(100, 100, 113, 113)].map((o) => sighting(o, { split: true }));
    const other = sighting(sq(130, 87, 150, 113), { split: true });
    const cat = planMerge([], [...parts, other], ctxAt(1)).added;
    expect(cat).toHaveLength(4);
    const plan = planMerge(cat, [sighting(sq(87, 87, 113, 113), {}), sighting(sq(130, 87, 150, 113), { split: true })], ctxAt(2));
    expect(plan.added).toHaveLength(0);
    expect(plan.removed).toHaveLength(2);
    const after = cat.filter((p) => !plan.removed.includes(p.id));
    expect(after).toHaveLength(2);
    const kept = plan.updates.find((u) => u.areaMm2 === 26 * 26)!;
    expect(kept.flags.split).toBeFalsy();
    // Nothing left "on the table" over the whole piece but that row.
    expect(plan.updates.filter((u) => u.status === 'table')).toHaveLength(2);
  });

  it('a row known from a cut takes the whole outline even when the cut made it bigger than the piece (review 2026-11-11)', () => {
    // The cut gave this part a neighbour's knob: 30 × 26 mm; the piece alone is 20 × 26 (0.67 × that).
    const cat = planMerge([], [sighting(sq(85, 87, 115, 113), { split: true })], ctxAt(1)).added;
    const plan = planMerge(cat, [sighting(sq(90, 87, 110, 113), {})], ctxAt(2));
    expect(plan.added).toHaveLength(0);
    expect(plan.updates[0]!.areaMm2).toBe(20 * 26);
    expect(plan.updates[0]!.flags.split).toBeFalsy();
  });
});
