/**
 * Piece finding (src/cv/pieceFinder.ts) and the empty-table model (src/cv/tableModel.ts) on
 * synthetic photos of the owner's white glossy table (test/synth). Fast checks of the API, the
 * flags, glare, memory hygiene and a sanity floor on one validation photo; the real accuracy
 * numbers come from the slower, opt-in test/unit/cv-piece-accuracy.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wasmBytes } from '../../src/cv/loadCv';
import { findPieces, mergeGlare, minAreaRect, type FindResult, type FoundPiece } from '../../src/cv/pieceFinder';
import { cvCounters } from '../../src/cv/scope';
import { learnTable, pxPerMmAt, shrinkRgb } from '../../src/cv/tableModel';
import { applyH, invertH } from '../../src/geo/homography';
import { markerCornersMm, suggestedMarkerCentres } from '../../src/markers/layout';
import type { MarkerMap } from '../../src/project/types';
import { getCv, type Cv } from '../helpers/cv';
import { generatePuzzle, polygonIoU, renderScene, segmentationScore, type SceneOptions, type SynthScene } from '../synth/index';
import { sceneOptions, val48 } from '../synth/sets';

let cv: Cv;
const map: MarkerMap = {
  dictionary: 'DICT_4X4_50',
  markerSizeMm: 54,
  printScale: 1,
  markers: suggestedMarkerCentres(700, 500).map((c, id) => ({ id, cornersMm: markerCornersMm(c[0], c[1], 0) })),
  rmsMm: 0,
  createdAt: 0,
  snapId: 'synthetic',
};

function find(scene: SynthScene, extra: Partial<Parameters<typeof findPieces>[2]> = {}): FindResult {
  const imgToTable = invertH(scene.tableToImg)!;
  const pxPerMm = pxPerMmAt(scene.tableToImg, imgToTable, [(scene.width - 1) / 2, (scene.height - 1) / 2]);
  return findPieces(cv, { data: scene.rgba, width: scene.width, height: scene.height, stride: scene.stride }, { imgToTable, tableToImg: scene.tableToImg, map, table: null, pxPerMm, ...extra });
}

let overview: SynthScene;
let overviewRes: FindResult;
/** A 2× close-up: it cuts pieces at its edges (overviews show the whole area and all 8 markers). */
let detail: SynthScene;
let detailRes: FindResult;

beforeAll(async () => {
  cv = await getCv();
  overview = await renderScene(sceneOptions(val48.items[0]!));
  overviewRes = find(overview);
  detail = await renderScene(sceneOptions(val48.items[1]!));
  detailRes = find(detail, { zoom: 2 });
}, 180_000);

afterAll(() => {
  expect(cvCounters.liveScoped).toBe(0);
});

describe('findPieces on a 12 MP overview (val48)', () => {
  it('finds the pieces with accurate top-face outlines and centres', () => {
    const sc = segmentationScore(overviewRes.pieces, overview.truth);
    // A sanity floor on one tuning photo; the PLAN §7 bars are checked in cv-piece-accuracy.
    expect(sc.recall).toBeGreaterThanOrEqual(0.9);
    expect(sc.precision).toBeGreaterThanOrEqual(0.9);
    expect(sc.positionErrorMm.median).toBeLessThanOrEqual(1);
    expect(sc.positionErrorMm.p95).toBeLessThanOrEqual(2);
  });

  it('fills every field of FoundPiece consistently', () => {
    expect(overviewRes.pieces.length).toBeGreaterThan(20);
    const H = overview.truth.topToImg;
    for (const p of overviewRes.pieces) {
      expect(p.outlineImg.length).toBe(p.outlineMm.length);
      expect(p.outlineImg.length).toBeGreaterThanOrEqual(16);
      // outlineMm is the image outline mapped through the piece-top plane.
      const q = applyH(H, [p.outlineMm[0]!, p.outlineMm[1]!]);
      expect(Math.hypot(q[0] - p.outlineImg[0]!, q[1] - p.outlineImg[1]!)).toBeLessThan(0.01);
      const [bx, by, bw, bh] = p.bboxImg;
      for (let i = 0; i < p.outlineImg.length; i += 2) {
        expect(p.outlineImg[i]!).toBeGreaterThanOrEqual(bx - 1e-6);
        expect(p.outlineImg[i]!).toBeLessThanOrEqual(bx + bw + 1e-6);
        expect(p.outlineImg[i + 1]!).toBeGreaterThanOrEqual(by - 1e-6);
        expect(p.outlineImg[i + 1]!).toBeLessThanOrEqual(by + bh + 1e-6);
      }
      expect(p.hueHist).toHaveLength(8);
      const hs = p.hueHist.reduce((a, v) => a + v, 0);
      expect(hs === 0 || Math.abs(hs - 1) < 1e-9).toBe(true);
      expect(p.meanLab[0]).toBeGreaterThanOrEqual(0);
      expect(p.meanLab[0]).toBeLessThanOrEqual(100);
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(1);
      expect(p.angleDeg).toBeGreaterThanOrEqual(-45);
      expect(p.angleDeg).toBeLessThan(45);
    }
    // Whole, unflagged pieces have a Ravensburger-like size (17.8 × 19.4 mm cells plus knobs).
    const whole = overviewRes.pieces.filter((p) => !p.flags.cut && !p.flags.clump);
    const areas = whole.map((p) => p.areaMm2).sort((a, b) => a - b);
    const med = areas[areas.length >> 1]!;
    expect(med).toBeGreaterThan(300);
    expect(med).toBeLessThan(400);
    for (const p of whole) {
      expect(Math.max(...p.sizeMm)).toBeLessThan(32);
      expect(Math.min(...p.sizeMm)).toBeGreaterThan(14);
    }
  });

  it('finds each piece where the generator put it (table mm)', () => {
    const sc = segmentationScore(overviewRes.pieces, overview.truth);
    for (const m of sc.matches) {
      const t = overview.truth.pieces.find((p) => p.id === m.id)!;
      const f = overviewRes.pieces[m.foundIndex]!;
      // Same centroid as the true outline on the table (the outline's own centroid, not the cell centre).
      let tx = 0;
      let ty = 0;
      for (let i = 0; i < t.outlineMm.length; i += 2) {
        tx += t.outlineMm[i]!;
        ty += t.outlineMm[i + 1]!;
      }
      tx /= t.outlineMm.length / 2;
      ty /= t.outlineMm.length / 2;
      expect(Math.hypot(f.centreMm[0] - tx, f.centreMm[1] - ty)).toBeLessThan(2.5);
    }
  });

  it('flags pieces cut by the photo edge or a marker card', () => {
    // On the close-up (the overview shows the whole area, so nothing is cut there).
    const partial = detail.truth.pieces.filter((p) => p.visibleShare > 0.2 && p.visibleShare < 0.9);
    expect(partial.length).toBeGreaterThan(0);
    let seen = 0;
    let flagged = 0;
    for (const t of partial) {
      const f = detailRes.pieces.find((p) => polygonIoU(p.outlineImg, t.outlineImg) > 0.3);
      if (!f) continue;
      seen++;
      if (f.flags.cut) flagged++;
    }
    expect(seen).toBeGreaterThan(0);
    expect(flagged / seen).toBeGreaterThanOrEqual(0.9);
    // Whole pieces well inside the photo are not flagged, in either photo.
    for (const [scene, res] of [
      [detail, detailRes],
      [overview, overviewRes],
    ] as const) {
      const sc = segmentationScore(res.pieces, scene.truth);
      const wrongCut = sc.matches.filter((m) => res.pieces[m.foundIndex]!.flags.cut && scene.truth.pieces.find((p) => p.id === m.id)!.visibleShare === 1);
      expect(wrongCut.length).toBeLessThanOrEqual(1);
    }
  });

  it('reports timings and frees every OpenCV object; the WebAssembly heap stays modest', () => {
    expect(overviewRes.timings.total).toBeGreaterThan(0);
    for (const k of ['shrink', 'field', 'classify', 'masks', 'glare', 'pieces']) expect(overviewRes.timings[k]).toBeGreaterThanOrEqual(0);
    const before = cvCounters.liveScoped;
    const heap = wasmBytes(cv);
    find(overview);
    expect(cvCounters.liveScoped).toBe(before);
    // The 48 MB photo never enters WebAssembly memory; small masks and per-piece crops do, one
    // step at a time. (The heap already holds the generator's 40 MP warp, so only growth is checked.)
    expect(wasmBytes(cv) - heap).toBeLessThanOrEqual(64 * 2 ** 20);
  });

  it('accepts a padded row stride', () => {
    const W = overview.width;
    const H = overview.height;
    const stride = W * 4 + 64;
    const padded = new Uint8Array(stride * H);
    for (let y = 0; y < H; y++) padded.set(overview.rgba.subarray(y * W * 4, (y + 1) * W * 4), y * stride);
    const imgToTable = invertH(overview.tableToImg)!;
    const pxPerMm = pxPerMmAt(overview.tableToImg, imgToTable, [(W - 1) / 2, (H - 1) / 2]);
    const r = findPieces(cv, { data: padded, width: W, height: H, stride }, { imgToTable, tableToImg: overview.tableToImg, map, table: null, pxPerMm });
    expect(r.pieces.length).toBe(overviewRes.pieces.length);
    expect(r.pieces.map((p) => p.centreMm)).toEqual(overviewRes.pieces.map((p) => p.centreMm));
  });
});

describe('table model, glare, clumps', () => {
  const p48 = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 77, art: { kind: 'procedural-kiss-like', seed: 1077 } });
  const lamp = { lampMm: [390, 300, 1300] as [number, number, number] };
  const base: Omit<SceneOptions, 'camera'> = {
    puzzle: p48,
    seed: 5,
    layout: { areaMm: [700, 500] },
    // A slightly greyer table keeps it below clipping, so glare is visible as glare. (Not a
    // negative exposure: the generator clips table + glare at 255 BEFORE applying exposure, so
    // with exposure < 0 its glare is no brighter than the table.)
    table: { rgb: [205, 205, 200] },
    light: { dirDeg: 200, glare: lamp },
  };
  const camera = { x: 405, y: 305, heightMm: 600, tiltDeg: 2, imageSize: [4032, 3024] as [number, number] };

  it('learns the empty table: colour, brightness map, glare share', async () => {
    const empty = await renderScene({ ...base, pieceIds: [], camera });
    const imgToTable = invertH(empty.tableToImg)!;
    const model = learnTable(cv, { data: empty.rgba, width: empty.width, height: empty.height, stride: empty.stride }, { imgToTable, map, snapId: 'empty-1' });
    expect(model.snapId).toBe('empty-1');
    expect(model.meanLab[0]).toBeGreaterThan(55);
    expect(Math.abs(model.meanLab[1])).toBeLessThan(6);
    expect(Math.abs(model.meanLab[2])).toBeLessThan(10);
    expect(model.covLab).toHaveLength(9);
    expect(model.covLab[0]!).toBeGreaterThanOrEqual(0);
    expect(model.covLab[0]!).toBeLessThan(25); // L spread of table pixels: a few units at most
    const m = model.map!;
    expect(m.cols * m.rows).toBe(m.L.length);
    expect(m.L.filter((v) => v > 0).length).toBeGreaterThan(0.5 * m.L.length);
    // The lamp reflection is a few % of the area (truth: share of all photo pixels under glare).
    expect(model.glareShare).toBeGreaterThan(0);
    expect(model.glareShare).toBeLessThan(0.15);
    expect(empty.truth.glareMaskShare).toBeGreaterThan(0);

    // Finding pieces with the learned model works as well as without one.
    const scene = await renderScene({ ...base, camera });
    const a = segmentationScore(find(scene).pieces, scene.truth);
    const b = segmentationScore(find(scene, { table: model }).pieces, scene.truth);
    expect(b.recall).toBeGreaterThanOrEqual(a.recall - 0.03);
    expect(b.precision).toBeGreaterThanOrEqual(0.9);
  }, 120_000);

  it('finds glare, reports its share and flags pieces under it', async () => {
    const scene = await renderScene({ ...base, camera });
    const res = find(scene);
    expect(res.glareMaskImg).toBeDefined();
    const g = res.glareMaskImg!;
    expect(g.data.length).toBe(g.width * g.height);
    expect(res.glareShare).toBeGreaterThan(0.002);
    // The detected glare is where the lamp's mirror image is (truth: glareShare per piece).
    const under = scene.truth.pieces.filter((p) => p.glareShare > 0.3 && p.visibleShare === 1 && !p.faceDown);
    for (const t of under) {
      const f = res.pieces.find((p) => polygonIoU(p.outlineImg, t.outlineImg) > 0.5);
      if (f) expect(f.flags.glare, t.id).toBe(true);
    }
    // No glare in a photo without a lamp.
    const noLamp = await renderScene({ ...base, light: { dirDeg: 200, glare: null }, camera });
    expect(noLamp.truth.glareMaskShare).toBe(0);
    expect(find(noLamp).glareShare).toBeLessThan(0.002);
  }, 120_000);

  it('flags touching pieces as a clump instead of returning a wrong outline', async () => {
    const scene = await renderScene({ ...base, layout: { areaMm: [700, 500], touchingShare: 0.4 }, light: { dirDeg: 200, glare: null }, camera });
    const res = find(scene);
    const pairs = scene.truth.pieces.filter((p) => p.touching.length && p.visibleShare === 1);
    expect(pairs.length).toBeGreaterThanOrEqual(4);
    let covered = 0;
    let flagged = 0;
    for (const t of pairs) {
      const f = res.pieces.find((p) => polygonIoU(p.outlineImg, t.outlineImg) > 0.3);
      if (!f) continue;
      covered++;
      // Either flagged as a clump, or split cleanly into the right piece.
      if (f.flags.clump || polygonIoU(f.outlineImg, t.outlineImg) >= 0.85) flagged++;
    }
    expect(covered).toBeGreaterThan(0);
    expect(flagged / covered).toBeGreaterThanOrEqual(0.8);
  }, 120_000);
});

describe('mergeGlare', () => {
  const piece = (x: number, y: number, flags: FoundPiece['flags'] = {}): FoundPiece => ({
    outlineImg: [x, y, x + 10, y, x + 10, y + 10, x, y + 10],
    outlineMm: [x, y, x + 10, y, x + 10, y + 10, x, y + 10],
    centreMm: [x + 5, y + 5],
    angleDeg: 0,
    areaMm2: 100,
    sizeMm: [10, 10],
    meanLab: [50, 0, 0],
    hueHist: new Array(8).fill(0),
    bboxImg: [x, y, 10, 10],
    flags,
    score: 1,
  });
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  it('replaces glare-covered pieces from the second photo and adds pieces lost under glare', () => {
    const mask = { width: 100, height: 100, factor: 1, data: new Uint8Array(100 * 100) };
    for (let y = 60; y < 80; y++) for (let x = 60; x < 80; x++) mask.data[y * 100 + x] = 1;
    const a: FindResult = { pieces: [piece(10, 10), piece(30, 30, { glare: true })], glareShare: 0.04, glareMaskImg: mask, timings: {} };
    const b: FindResult = { pieces: [piece(10.5, 10), piece(31, 30), piece(65, 65), piece(5, 85)], glareShare: 0, timings: {} };
    const merged = mergeGlare({ result: a, tableToImg: I }, { result: b, tableToImg: I });
    expect(merged.map((p) => [p.centreMm, p.source])).toEqual([
      [[15, 15], 0],
      [[36, 35], 1],
      [[70, 70], 1],
    ]);
  });
});

describe('helpers', () => {
  it('shrinkRgb is an exact area average', () => {
    const W = 7;
    const H = 5;
    const data = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) data.set([i * 3, 100, 200 - i, 255], i * 4);
    const s = shrinkRgb({ data, width: W, height: H, stride: W * 4 }, 2.5);
    expect([s.width, s.height]).toEqual([2, 2]);
    // Output pixel (0,0) covers x, y in [0, 2.5): weights 1, 1, 0.5 per axis.
    let r = 0;
    let wsum = 0;
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) {
        const wgt = (x === 2 ? 0.5 : 1) * (y === 2 ? 0.5 : 1);
        r += data[(y * W + x) * 4]! * wgt;
        wsum += wgt;
      }
    expect(s.rgb[0]).toBe(Math.round(r / wsum));
    expect(s.rgb[1]).toBe(100);
  });

  it('minAreaRect returns the side lengths along the rectangle', () => {
    const a = (30 * Math.PI) / 180;
    const pts: number[] = [];
    for (const [x, y] of [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ] as const)
      pts.push(x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a));
    const r = minAreaRect(pts);
    expect(r.angleDeg).toBeCloseTo(30, 6);
    expect(r.size[0]).toBeCloseTo(20, 6);
    expect(r.size[1]).toBeCloseTo(10, 6);
  });
});
