/**
 * The marker-free photo path (owner's decision: no printed markers): scale from the pieces
 * (estimatePxPerMm), findPieces without a marker map, registration of a photo's pieces onto the
 * catalog (src/geo/registerPieces.ts) and the whole pipeline (src/cv/scanMarkerless.ts), on
 * synthetic photos WITHOUT markers (`markers: []`). Tuning scenario: val300 puzzle 0.
 * The opt-in cv-markerless-accuracy.test.ts reports the same numbers over whole sets.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { estimatePxPerMm, findPieces } from '../../src/cv/pieceFinder';
import { scanMarkerless, type ScanMarkerlessResult } from '../../src/cv/scanMarkerless';
import { cvCounters } from '../../src/cv/scope';
import { applyH } from '../../src/geo/homography';
import { registerPieces, type RegCatalogPiece, type RegFoundPiece } from '../../src/geo/registerPieces';
import { planMerge } from '../../src/project/catalog';
import type { Mat3, PieceRow, Vec2 } from '../../src/project/types';
import { getCv, type Cv } from '../helpers/cv';
import { centroid, generatePuzzle, polygonIoU, renderScene, segmentationScore, type SceneOptions, type SynthScene } from '../synth/index';
import { sceneOptions, val300 } from '../synth/sets';

let cv: Cv;
const items = val300.items.filter((it) => it.puzzleKey === 'val300-p0');
const overviewItem = items.find((it) => it.kind === 'overview')!;
const base = sceneOptions(overviewItem);
const shot = (camera: Partial<SceneOptions['camera']>, from = base): Promise<SynthScene> => renderScene({ ...from, markers: [], camera: { ...from.camera, ...camera } });
const buf = (s: SynthScene) => ({ data: s.rgba, width: s.width, height: s.height, stride: s.stride });

/** Least-squares similarity src → dst (to compare a provisional frame with the truth). */
function fitSim(src: Vec2[], dst: Vec2[]): Mat3 {
  const n = src.length;
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i]![0];
    sy += src[i]![1];
    dx += dst[i]![0];
    dy += dst[i]![1];
  }
  sx /= n;
  sy /= n;
  dx /= n;
  dy /= n;
  let a = 0;
  let b = 0;
  let q = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i]![0] - sx;
    const y = src[i]![1] - sy;
    const u = dst[i]![0] - dx;
    const v = dst[i]![1] - dy;
    a += x * u + y * v;
    b += x * v - y * u;
    q += x * x + y * y;
  }
  a /= q;
  b /= q;
  return [a, -b, dx - (a * sx - b * sy), b, a, dy - (b * sx + a * sy), 0, 0, 1];
}

const q = (v: number[], p: number) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
};

let o1: SynthScene;
let o2: SynthScene;
let dMid: SynthScene;
let other: SynthScene;
let r1: ScanMarkerlessResult;
let catalog: PieceRow[] = [];
/** Catalog mm → truth table mm (one similarity fit on photo 1). */
let S: Mat3;
let nid = 0;

function merge(r: ScanMarkerlessResult, snapId: string): void {
  const plan = planMerge(catalog, r.pieces, { projectId: 'p', snapId, pxPerMm: r.pxPerMm ?? 4, now: 1, newId: () => `n${nid++}`, thumbId: (id) => id });
  const upd = new Map(plan.updates.map((u) => [u.id, u]));
  catalog = catalog.map((c) => upd.get(c.id) ?? c).concat(plan.added);
}

/** Centre errors (mm, vs truth) of the matched pieces of a registered photo. */
function centreErrors(r: ScanMarkerlessResult, s: SynthScene): number[] {
  const sc = segmentationScore(r.pieces, s.truth);
  return sc.matches.map((m) => {
    const p = applyH(S, r.pieces[m.foundIndex]!.centreMm);
    const t = centroid(s.truth.pieces.find((x) => x.id === m.id)!.outlineMm);
    return Math.hypot(p[0] - t[0], p[1] - t[1]);
  });
}

/** Truth pieces that have more than one catalog row within 6 mm. */
function duplicates(s: SynthScene): number {
  const count = new Map<string, number>();
  for (const c of catalog) {
    const p = applyH(S, [c.table.x, c.table.y]);
    let best = '';
    let bd = 6;
    for (const t of s.truth.pieces) {
      const tc = centroid(t.outlineMm);
      const d = Math.hypot(p[0] - tc[0], p[1] - tc[1]);
      if (d < bd) {
        bd = d;
        best = t.id;
      }
    }
    if (best) count.set(best, (count.get(best) ?? 0) + 1);
  }
  return [...count.values()].filter((v) => v > 1).length;
}

beforeAll(async () => {
  cv = await getCv();
  o1 = await shot({});
  // Another overview: phone turned 90°, higher, moved.
  o2 = await shot({ x: base.camera.x + 30, y: base.camera.y - 20, yawDeg: 90, heightMm: 820 });
  // The middle close-up of a 3 × 3 plan (2×), turned 20°.
  dMid = await shot({ zoom: 2, heightMm: 620, tiltDeg: 3, yawDeg: 20 });
  // A close-up of a DIFFERENT puzzle.
  const otherItem = val300.items.find((it) => it.puzzleKey === 'val300-p1' && it.kind === 'detail')!;
  other = await renderScene({ ...sceneOptions(otherItem), markers: [] });
  r1 = scanMarkerless(cv, buf(o1), { catalog: [], zoom: 1, kind: 'overview', table: null, pieceAreaShare: 1 });
  merge(r1, 'o1');
  const sc = segmentationScore(r1.pieces, o1.truth);
  S = fitSim(
    sc.matches.map((m) => r1.pieces[m.foundIndex]!.centreMm),
    sc.matches.map((m) => centroid(o1.truth.pieces.find((x) => x.id === m.id)!.outlineMm)),
  );
}, 240_000);

afterAll(() => {
  expect(cvCounters.liveScoped).toBe(0);
});

describe('scale and pieces without markers', () => {
  it('estimates px/mm from the pieces within a few %', () => {
    for (const [s, zoom] of [
      [o1, 1],
      [dMid, 2],
    ] as const) {
      const e = estimatePxPerMm(cv, buf(s), { pitchMm: 18.6, zoom })!;
      expect(e).not.toBeNull();
      expect(e.nPieces).toBeGreaterThan(20);
      expect(Math.abs(e.pxPerMm / s.truth.pxPerMm - 1)).toBeLessThan(0.05);
    }
  });

  it('findPieces works with no marker map', () => {
    const ppm = o1.truth.pxPerMm;
    const cx = (o1.width - 1) / 2;
    const cy = (o1.height - 1) / 2;
    const r = findPieces(cv, buf(o1), { imgToTable: [1 / ppm, 0, -cx / ppm, 0, 1 / ppm, -cy / ppm, 0, 0, 1], tableToImg: [ppm, 0, cx, 0, ppm, cy, 0, 0, 1], map: null, table: null, pxPerMm: ppm, zoom: 1 });
    const sc = segmentationScore(r.pieces, o1.truth);
    expect(sc.recall).toBeGreaterThan(0.85);
    expect(sc.precision).toBeGreaterThan(0.85);
    expect(r.glareShare).toBeGreaterThanOrEqual(0);
  });
});

describe('scanMarkerless', () => {
  it('the first overview defines the frame (levelled, metric)', () => {
    expect(r1.isNewFrame).toBe(true);
    expect(r1.registered).toBe(true);
    expect(r1.pieces.length).toBeGreaterThan(250);
    // The frame is metric: the similarity to the truth has scale ≈ 1.
    expect(Math.abs(Math.hypot(S[0]!, S[3]!) - 1)).toBeLessThan(0.05);
    const e = centreErrors(r1, o1);
    expect(q(e, 0.5)).toBeLessThanOrEqual(1);
    expect(q(e, 0.95)).toBeLessThanOrEqual(2);
  });

  it('registers a second overview with the phone turned 90°, and a 2× close-up; no duplicates', () => {
    for (const [s, zoom, kind] of [
      [o2, 1, 'overview'],
      [dMid, 2, 'detail'],
    ] as const) {
      const r = scanMarkerless(cv, buf(s), { catalog, zoom, kind, table: null, pieceAreaShare: 1 });
      expect(r.registered).toBe(true);
      expect(r.isNewFrame).toBe(false);
      expect(r.rmsMm).toBeLessThan(1);
      expect(r.inliers).toBeGreaterThan(0.6 * r.pieces.length);
      expect(Math.abs(r.pxPerMm! / s.truth.pxPerMm - 1)).toBeLessThan(0.05);
      const e = centreErrors(r, s);
      expect(q(e, 0.5)).toBeLessThanOrEqual(1);
      expect(q(e, 0.95)).toBeLessThanOrEqual(2);
      merge(r, kind);
      expect(r.timings.total).toBeGreaterThan(0);
    }
    // ≤ 1 % of the pieces end up twice in the catalog (pieces cut by a photo edge or found only
    // in one photo can still be added twice; see the report).
    expect(duplicates(o1)).toBeLessThanOrEqual(3);
  }, 120_000);

  it('refuses a photo of different pieces', () => {
    const r = scanMarkerless(cv, buf(other), { catalog, zoom: 2, kind: 'detail', table: null, pieceAreaShare: 1 });
    expect(r.registered).toBe(false);
    expect(r.pieces).toHaveLength(0);
  }, 60_000);

  it('still registers when 10 % of the pieces were moved and 10 % taken away', () => {
    let seed = 7;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
    const changed = catalog
      .filter(() => rnd() > 0.1)
      .map((c) => (rnd() < 0.11 ? { ...c, table: { ...c.table, x: c.table.x + (rnd() - 0.5) * 120, y: c.table.y + (rnd() - 0.5) * 120 } } : c));
    const r = scanMarkerless(cv, buf(dMid), { catalog: changed, zoom: 2, kind: 'detail', table: null, pieceAreaShare: 1 });
    expect(r.registered).toBe(true);
    expect(r.rmsMm).toBeLessThan(1);
    expect(q(centreErrors(r, dMid), 0.5)).toBeLessThanOrEqual(1);
  }, 60_000);
});

describe('the app\'s free-scan flow (e2e scan-free.spec.ts, in Node)', () => {
  it('registers a 2× close-up reported as 1× (the fake camera can\'t say 2×), with the default (real) piece-area share', async () => {
    const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 12 });
    const base: SceneOptions = { puzzle, seed: 44, markers: [], layout: { areaMm: [600, 450], originMm: [100, 80] }, camera: { x: 400, y: 305, heightMm: 680, tiltDeg: 1, imageSize: [4032, 3024] }, light: { dirDeg: 200 } };
    const overview = await renderScene(base);
    const closeUp = await renderScene({ ...base, camera: { x: 280, y: 220, heightMm: 620, tiltDeg: 2, tiltDirDeg: 40, zoom: 2, imageSize: [4032, 3024] } });
    // Exactly what the app does: defaults everywhere (pieceAreaShare 0.79, a real-photo value).
    const r1 = scanMarkerless(cv, buf(overview), { catalog: [], pitchMm: 18.6, zoom: 1, kind: 'overview', table: null });
    expect(r1.isNewFrame).toBe(true);
    let n = 0;
    const rows = planMerge([], r1.pieces, { projectId: 'p', snapId: 'o', pxPerMm: r1.pxPerMm ?? 4, now: 1, newId: () => `r${n++}`, thumbId: (id) => id }).added;
    expect(rows.length).toBeGreaterThan(30);
    const r2 = scanMarkerless(cv, buf(closeUp), { catalog: rows, pitchMm: 18.6, zoom: 1, kind: 'detail', table: null });
    expect(r2.registered).toBe(true);
    expect(r2.inliers).toBeGreaterThanOrEqual(10);
    expect(r2.rmsMm).toBeLessThan(1.5);
    // Same scale relation between the two photos as in reality (2.2×), whatever the area share.
    expect(r2.pxPerMm! / r1.pxPerMm!).toBeCloseTo(closeUp.truth.pxPerMm / overview.truth.pxPerMm, 1);
  }, 120_000);
});

describe('an assembled area and objects on the table (synthetic)', () => {
  it('reports the assembled frame and the objects as regions, and still finds the loose pieces, inside the frame too', async () => {
    const puzzle = generatePuzzle({ cols: 28, rows: 36, cellMm: [17.8, 19.4], seed: 501, art: { kind: 'procedural-kiss-like', seed: 1501 } });
    // Assembled: a 14 × 14-cell window's frame plus a 4-column strip; loose: ~190 others, ~20 of
    // them lying inside the frame.
    const asmIds: string[] = [];
    const loose: string[] = [];
    for (const p of puzzle.pieces) {
      const inWin = p.row >= 22 && p.col <= 13;
      if (inWin && (p.row === 22 || p.row === 35 || p.col === 0 || p.col === 13 || p.col <= 3)) asmIds.push(p.id);
      else if (!inWin && loose.length < 160 && (p.col * 7 + p.row * 3) % 5 === 0) loose.push(p.id);
    }
    for (const p of puzzle.pieces) if (p.row >= 24 && p.row <= 33 && p.col >= 5 && p.col <= 12 && (p.row + p.col) % 4 === 0) loose.push(p.id);
    const objects: NonNullable<SceneOptions['objects']> = [
      { shape: 'rect', centreMm: [620, 80], sizeMm: [160, 45], angleDeg: 20, rgb: [235, 235, 238] }, // a white remote
      { shape: 'disc', centreMm: [520, 120], sizeMm: [95, 95], rgb: [60, 60, 70] }, // a coaster
      { shape: 'rect', centreMm: [700, 420], sizeMm: [70, 140], angleDeg: -10, rgb: [25, 25, 28] }, // a phone
    ];
    const s = await renderScene({
      puzzle,
      seed: 77,
      pieceIds: [...asmIds, ...loose],
      markers: [],
      assembled: { ids: asmIds, originMm: [140, 30 - 22 * 19.4] },
      objects,
      layout: { areaMm: [700, 500], touchingShare: 0.03 },
      camera: { x: 405, y: 305, heightMm: 720, tiltDeg: 3, imageSize: [4032, 3024] },
      light: { dirDeg: 200, elevationDeg: 45 },
    });
    const r = scanMarkerless(cv, buf(s), { catalog: [], zoom: 1, kind: 'overview', table: null, pieceAreaShare: 1 });
    // The frame is one assembled region; its outer outline encloses the 14 × 14-cell window
    // (≈ 67 700 mm²). The table inside the frame is not filled in: the loose pieces there are found.
    const asm = r.regions.filter((g) => g.kind === 'assembled');
    expect(asm).toHaveLength(1);
    expect(asm[0]!.areaMm2).toBeGreaterThan(55_000);
    expect(asm[0]!.areaMm2).toBeLessThan(90_000);
    // The coaster and the phone are objects; nothing on any object is reported as a piece.
    expect(r.regions.filter((g) => g.kind === 'object' && g.areaMm2 > 5000).length).toBeGreaterThanOrEqual(2);
    for (const o of objects) {
      const c = applyH(s.tableToImg, o.centreMm);
      expect(r.pieces.filter((p) => Math.hypot(p.bboxImg[0] + p.bboxImg[2] / 2 - c[0], p.bboxImg[1] + p.bboxImg[3] / 2 - c[1]) < 25 * s.truth.pxPerMm)).toHaveLength(0);
    }
    // Loose pieces: found as well as without the assembled area; those inside the frame too.
    const sc = segmentationScore(r.pieces, s.truth);
    expect(sc.recall).toBeGreaterThan(0.85);
    expect(sc.precision).toBeGreaterThan(0.85);
    const insideIds = new Set(puzzle.pieces.filter((p) => p.row >= 24 && p.row <= 33 && p.col >= 5 && p.col <= 12 && (p.row + p.col) % 4 === 0).map((p) => p.id));
    const inside = s.truth.pieces.filter((t) => insideIds.has(t.id) && t.touching.length === 0);
    const foundInside = inside.filter((t) => r.pieces.some((p) => polygonIoU(p.outlineImg, t.outlineImg) >= 0.85));
    expect(foundInside.length).toBeGreaterThanOrEqual(0.8 * inside.length);
    expect(Math.abs(r.pxPerMm! / s.truth.pxPerMm - 1)).toBeLessThan(0.05);
  }, 120_000);
});

describe('registerPieces (points only)', () => {
  // A 20 × 15 grid of pieces with varied colours; found = a transformed subset.
  const cat: RegCatalogPiece[] = [];
  let seed = 3;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let j = 0; j < 15; j++)
    for (let i = 0; i < 20; i++) {
      const hue = new Array(8).fill(0);
      hue[Math.floor(rnd() * 8)] = 1;
      cat.push({
        id: `c${j}_${i}`,
        table: { x: i * 30 + rnd() * 8, y: j * 30 + rnd() * 8 },
        areaMm2: 345 * (0.9 + 0.2 * rnd()),
        sizeMm: [22, 24],
        colour: { meanLab: [20 + rnd() * 30, rnd() * 4, rnd() * 4], hueHist: hue },
      });
    }
  const view = (deg: number, scale: number, keep: (c: RegCatalogPiece) => boolean): RegFoundPiece[] => {
    const a = (deg * Math.PI) / 180;
    return cat.filter(keep).map((c) => {
      const x = c.table.x - 300;
      const y = c.table.y - 200;
      return {
        centreMm: [(Math.cos(a) * x - Math.sin(a) * y) / scale + rnd() * 0.3, (Math.sin(a) * x + Math.cos(a) * y) / scale + rnd() * 0.3],
        areaMm2: c.areaMm2 / (scale * scale),
        sizeMm: [22 / scale, 24 / scale],
        meanLab: [c.colour.meanLab[0] + rnd() * 2, c.colour.meanLab[1], c.colour.meanLab[2]],
        hueHist: c.colour.hueHist,
      };
    });
  };
  for (const [deg, scale] of [
    [0, 1],
    [90, 1],
    [180, 0.45],
    [-30, 2.2],
  ] as const)
    it(`finds the map for a ${deg}° turn at scale ${scale}, part of the table in view`, () => {
      const found = view(deg, scale, (c) => c.table.x > 150 && c.table.x < 400 && c.table.y > 100 && c.table.y < 300);
      const r = registerPieces(found, cat)!;
      expect(r).not.toBeNull();
      expect(r.inliers.length).toBeGreaterThan(0.9 * found.length);
      expect(r.rmsMm).toBeLessThan(1);
      expect(r.scale).toBeCloseTo(scale, 1);
    });

  it('refuses unrelated pieces', () => {
    const found: RegFoundPiece[] = Array.from({ length: 60 }, () => ({
      centreMm: [rnd() * 300, rnd() * 200] as Vec2,
      areaMm2: 345,
      sizeMm: [22, 24] as Vec2,
      meanLab: [20 + rnd() * 30, 0, 0] as [number, number, number],
      hueHist: [1, 0, 0, 0, 0, 0, 0, 0],
    }));
    expect(registerPieces(found, cat)).toBeNull();
  });
});
