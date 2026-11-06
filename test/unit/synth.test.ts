/**
 * Self-checks of the synthetic puzzle generator (test/synth): the yardstick has to be right
 * before anything is measured with it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameAnalyser } from '../../src/cv/frameAnalyser';
import { cvCounters } from '../../src/cv/scope';
import { applyH, invertH } from '../../src/geo/homography';
import { nominalIntrinsics, poseFromHomography } from '../../src/geo/pose';
import { getCv, type Cv } from '../helpers/cv';
import { maxCornerError } from '../helpers/images';
import { bbox, cameraHomography, generatePuzzle, rasterize, renderScene, segmentationScore, signedArea, type SceneOptions, type SynthPuzzle } from '../synth/index';
import { ALL_SETS, allMarkersInView, sceneOptions, val48 } from '../synth/sets';

let cv: Cv;
let p48: SynthPuzzle;

beforeAll(async () => {
  cv = await getCv();
  p48 = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 42 });
});

afterAll(() => {
  expect(cvCounters.liveScoped).toBe(0);
});

const quiet: Partial<SceneOptions> = { noise: 0, blurPx: 0, light: { gradient: 0, glare: null, ambient: 1 } };

function sideGlobal(p: SynthPuzzle, id: string, side: number): number[] {
  const pc = p.pieces.find((q) => q.id === id)!;
  const n = pc.outlineMm.length / 2;
  const from = pc.cornerIdx[side]!;
  const to = side === 3 ? n : pc.cornerIdx[side + 1]!;
  const cx = (pc.col + 0.5) * p.cellMm[0];
  const cy = (pc.row + 0.5) * p.cellMm[1];
  const out: number[] = [];
  for (let i = from; i <= to; i++) {
    const k = i % n;
    out.push(pc.outlineMm[2 * k]! + cx, pc.outlineMm[2 * k + 1]! + cy);
  }
  return out;
}

function reversePts(a: number[]): number[] {
  const out: number[] = [];
  for (let i = a.length - 2; i >= 0; i -= 2) out.push(a[i]!, a[i + 1]!);
  return out;
}

describe('puzzle cut', () => {
  it('is deterministic', () => {
    const a = generatePuzzle({ cols: 4, rows: 3, cellMm: [17.8, 19.4], seed: 7 });
    const b = generatePuzzle({ cols: 4, rows: 3, cellMm: [17.8, 19.4], seed: 7 });
    expect(a.pieces).toEqual(b.pieces);
    expect(Buffer.from(a.art.rgba).equals(Buffer.from(b.art.rgba))).toBe(true);
    const c = generatePuzzle({ cols: 4, rows: 3, cellMm: [17.8, 19.4], seed: 8 });
    expect(c.pieces[5]!.outlineMm).not.toEqual(a.pieces[5]!.outlineMm);
  });

  it('has the right numbers of corner and edge pieces, and sane outlines', () => {
    for (const [C, R] of [
      [8, 6],
      [15, 20],
    ] as const) {
      const p = C === 8 ? p48 : generatePuzzle({ cols: C, rows: R, cellMm: [17.8, 19.4], seed: 3, art: { kind: 'procedural-kiss-like', pxPerMm: 1 } });
      const flats = p.pieces.map((q) => q.sides.filter((s) => s === 'flat').length);
      expect(flats.filter((f) => f >= 1).length).toBe(2 * (C + R) - 4);
      expect(flats.filter((f) => f === 2).length).toBe(4);
      for (const q of p.pieces) {
        expect(q.outlineMm.length / 2).toBeGreaterThanOrEqual(200);
        expect(signedArea(q.outlineMm)).toBeGreaterThan(0); // clockwise on screen
        expect(q.cornersMm).toHaveLength(8);
      }
    }
  });

  it('gives neighbouring pieces exactly complementary sides (tab ↔ blank, same curve)', () => {
    for (const p of [p48, generatePuzzle({ cols: 5, rows: 4, cellMm: [17.8, 19.4], seed: 9, cut: 'uniform', art: { kind: 'procedural-kiss-like', pxPerMm: 1 } })]) {
      for (const q of p.pieces) {
        const right = p.pieces.find((o) => o.row === q.row && o.col === q.col + 1);
        if (right) {
          expect([q.sides[1], right.sides[3]].sort()).toEqual(['blank', 'tab']);
          expect(sideGlobal(p, q.id, 1)).toEqual(reversePts(sideGlobal(p, right.id, 3)));
        }
        const below = p.pieces.find((o) => o.col === q.col && o.row === q.row + 1);
        if (below) {
          expect([q.sides[2], below.sides[0]].sort()).toEqual(['blank', 'tab']);
          expect(sideGlobal(p, q.id, 2)).toEqual(reversePts(sideGlobal(p, below.id, 0)));
        }
      }
    }
  });
});

describe('scene', () => {
  it("uses a camera that the app's pose maths reads back exactly", () => {
    const K = nominalIntrinsics(4032, 3024, 2);
    const cam = { x: 420, y: 290, heightMm: 560, tiltDeg: 8, tiltDirDeg: 250, yawDeg: 4 };
    const H = cameraHomography(K, cam);
    const pose = poseFromHomography(H, K)!;
    expect(pose.heightMm).toBeCloseTo(560, 6);
    expect(pose.tiltDeg).toBeCloseTo(8, 6);
    expect(pose.footMm[0]).toBeCloseTo(420, 6);
    expect(pose.footMm[1]).toBeCloseTo(290, 6);
    // Not mirrored: table x → image right, table y → image down (yaw is small).
    const o = applyH(H, [cam.x, cam.y]);
    const ex = applyH(H, [cam.x + 10, cam.y]);
    const ey = applyH(H, [cam.x, cam.y + 10]);
    expect((ex[0] - o[0]) * (ey[1] - o[1]) - (ex[1] - o[1]) * (ey[0] - o[0])).toBeGreaterThan(0);
  });

  it('is deterministic to the byte', async () => {
    const opts: SceneOptions = { puzzle: p48, seed: 3, camera: { x: 405, y: 305, heightMm: 600, tiltDeg: 5, tiltDirDeg: 30, imageSize: [640, 480] }, light: { glare: { lampMm: [400, 500, 1200] } }, handShadow: true, motionBlurPx: 1.5 };
    const a = await renderScene(opts);
    const b = await renderScene(opts);
    expect(a.jpeg.equals(b.jpeg)).toBe(true);
    expect(a.truth).toEqual(b.truth);
    expect(cvCounters.liveScoped).toBe(0);
  });

  it('draws each top face exactly under its truth outline', async () => {
    const scene = await renderScene({ ...quiet, puzzle: p48, seed: 11, layout: { areaMm: [700, 500], touchingShare: 0, faceDownShare: 0 }, camera: { x: 405, y: 305, heightMm: 560, tiltDeg: 6, tiltDirDeg: 120, imageSize: [2016, 1512] } });
    const W = scene.width;
    const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
    const seen: number[] = [];
    const expected: number[] = [];
    let ringBright = 0;
    let ringN = 0;
    for (const t of scene.truth.pieces) {
      if (t.visibleShare < 1) continue;
      // Rendered: mean inside the outline, 2 px in from the edge.
      const b = bbox(t.outlineImg);
      const x0 = Math.floor(b.x0) - 3;
      const y0 = Math.floor(b.y0) - 3;
      const w = Math.ceil(b.x1) + 4 - x0;
      const h = Math.ceil(b.y1) + 4 - y0;
      const m = rasterize(t.outlineImg, x0 - 0.5, y0 - 0.5, 1, w, h);
      const sil = rasterize(t.silhouetteImg, x0 - 0.5, y0 - 0.5, 1, w, h);
      let s = 0;
      let n = 0;
      for (let j = 2; j < h - 2; j++)
        for (let i = 2; i < w - 2; i++) {
          let all = true;
          for (let dj = -2; dj <= 2 && all; dj++) for (let di = -2; di <= 2 && all; di++) all = m[(j + dj) * w + i + di] === 1;
          if (!all) continue;
          const k = ((y0 + j) * W + x0 + i) * 4;
          s += lum(scene.rgba[k]!, scene.rgba[k + 1]!, scene.rgba[k + 2]!);
          n++;
        }
      seen.push(s / n);
      // Expected: mean of the art over the same piece shape.
      const sp = p48.pieces.find((q) => q.id === t.id)!;
      const [ppx, ppy] = p48.art.pxPerMm;
      const cx = (sp.col + 0.5) * p48.cellMm[0];
      const cy = (sp.row + 0.5) * p48.cellMm[1];
      const artPoly = sp.outlineMm.map((v, i) => (i % 2 ? (v + cy) * ppy : (v + cx) * ppx));
      const ab = bbox(artPoly);
      const ax0 = Math.max(0, Math.floor(ab.x0));
      const ay0 = Math.max(0, Math.floor(ab.y0));
      const aw = Math.min(p48.art.width, Math.ceil(ab.x1)) - ax0;
      const ah = Math.min(p48.art.height, Math.ceil(ab.y1)) - ay0;
      const am = rasterize(artPoly, ax0, ay0, 1, aw, ah);
      let es = 0;
      let en = 0;
      for (let j = 0; j < ah; j++)
        for (let i = 0; i < aw; i++) {
          if (!am[j * aw + i]) continue;
          const k = ((ay0 + j) * p48.art.width + ax0 + i) * 4;
          es += lum(p48.art.rgba[k]!, p48.art.rgba[k + 1]!, p48.art.rgba[k + 2]!);
          en++;
        }
      expected.push(es / en);
      // Just outside the silhouette (beyond walls and the short shadow): table.
      for (let j = 0; j < h; j += 2)
        for (let i = 0; i < w; i += 2) {
          if (sil[j * w + i]) continue;
          let near = false;
          for (let dj = -4; dj <= 4 && !near; dj++)
            for (let di = -4; di <= 4 && !near; di++) {
              const jj = j + dj;
              const ii = i + di;
              if (jj >= 0 && ii >= 0 && jj < h && ii < w && sil[jj * w + ii]) near = Math.hypot(di, dj) <= 4;
            }
          if (!near) continue;
          let close = false;
          for (let dj = -2; dj <= 2 && !close; dj++)
            for (let di = -2; di <= 2 && !close; di++) {
              const jj = j + dj;
              const ii = i + di;
              if (jj >= 0 && ii >= 0 && jj < h && ii < w && sil[jj * w + ii]) close = true;
            }
          if (close) continue; // 3–4 px out only
          const k = ((y0 + j) * W + x0 + i) * 4;
          ringN++;
          if (lum(scene.rgba[k]!, scene.rgba[k + 1]!, scene.rgba[k + 2]!) > 185) ringBright++;
        }
    }
    expect(seen.length).toBeGreaterThan(30);
    // Rendered vs expected brightness: strongly correlated, and close after a global gain.
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const ms = mean(seen);
    const me = mean(expected);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    seen.forEach((v, i) => {
      sxy += (v - ms) * (expected[i]! - me);
      sxx += (v - ms) ** 2;
      syy += (expected[i]! - me) ** 2;
    });
    expect(sxy / Math.sqrt(sxx * syy)).toBeGreaterThan(0.98);
    const gain = ms / me;
    for (let i = 0; i < seen.length; i++) expect(Math.abs(seen[i]! - expected[i]! * gain)).toBeLessThan(14);
    expect(ringBright / ringN).toBeGreaterThan(0.97);
  });

  it('draws markers that OpenCV finds, with corners within 1 px of the truth (1×)', async () => {
    for (const cam of [
      { x: 405, y: 305, heightMm: 660, tiltDeg: 0 },
      { x: 420, y: 290, heightMm: 600, tiltDeg: 7, tiltDirDeg: 250, yawDeg: 4 },
    ]) {
      const scene = await renderScene({ puzzle: p48, seed: 5, camera: { ...cam, imageSize: [2016, 1512] }, light: { glare: { lampMm: [300, 700, 1300] } } });
      const analyser = new FrameAnalyser(cv, { analysisWidth: scene.width });
      try {
        const res = analyser.analyseRgba({ data: scene.rgba, width: scene.width, height: scene.height, stride: scene.stride });
        const inside = scene.truth.markers.filter((m) => m.cornersImg.every((v, i) => v > 8 && v < (i % 2 ? scene.height : scene.width) - 8));
        expect(inside.length).toBeGreaterThanOrEqual(3);
        for (const m of inside) {
          const d = res.markers.find((x) => x.id === m.id);
          expect(d, `marker ${m.id}`).toBeDefined();
          expect(maxCornerError(d!.corners, m.cornersImg)).toBeLessThan(1);
        }
        for (const d of res.markers) expect(d.id).toBeLessThan(8);
      } finally {
        analyser.dispose();
      }
    }
  });

  it('puts the glare spot at the lamp mirror point, which moves with the camera', async () => {
    const lamp: [number, number, number] = [300, 650, 1200];
    const spots: Array<[number, number]> = [];
    for (const x of [330, 480]) {
      const H = 600;
      const scene = await renderScene({
        ...quiet,
        light: { gradient: 0, ambient: 1, glare: { lampMm: lamp } },
        puzzle: p48,
        pieceIds: ['r0c0', 'r0c1'],
        seed: 2,
        camera: { x, y: 305, heightMm: H, tiltDeg: 0, imageSize: [1008, 756] },
      });
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let y = 0; y < scene.height; y++)
        for (let xx = 0; xx < scene.width; xx++) {
          const k = (y * scene.width + xx) * 4;
          if (scene.rgba[k + 1]! >= 252) {
            sx += xx;
            sy += y;
            n++;
          }
        }
      expect(n).toBeGreaterThan(50);
      const p = applyH(invertH(scene.tableToImg)!, [sx / n, sy / n]);
      const f = H / (H + lamp[2]);
      const want: [number, number] = [x + (lamp[0] - x) * f, 305 + (lamp[1] - 305) * f];
      // Within ~¾ of the spot's core radius (20 mm here): vignetting skews the blown-out area a little.
      expect(Math.hypot(p[0] - want[0], p[1] - want[1])).toBeLessThan(15);
      expect(scene.truth.glareMaskShare).toBeGreaterThan(0);
      spots.push(p);
    }
    // Camera moved 150 mm → the spot moves 150 · lz / (H + lz) ≈ 100 mm on the table.
    expect(spots[1]![0] - spots[0]![0]).toBeGreaterThan(80);
  });

  it('shows and detects all 8 markers in a dataset overview, with a sane exposure', async () => {
    const item = val48.items.find((i) => i.kind === 'overview')!;
    const scene = await renderScene(sceneOptions(item, [2016, 1512]));
    const analyser = new FrameAnalyser(cv, { analysisWidth: 1008 });
    try {
      const res = analyser.analyseRgba({ data: scene.rgba, width: scene.width, height: scene.height, stride: scene.stride });
      expect(res.markers.map((m) => m.id).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    } finally {
      analyser.dispose();
    }
    let clipped = 0;
    for (let i = 0; i < scene.rgba.length; i += 4) if (scene.rgba[i]! >= 250 && scene.rgba[i + 1]! >= 250 && scene.rgba[i + 2]! >= 250) clipped++;
    expect(clipped / (scene.width * scene.height)).toBeLessThan(0.02);
  });

  it('frees every OpenCV object', () => {
    expect(cvCounters.liveScoped).toBe(0);
  });
});

describe('segmentation score', () => {
  it('gives full marks to the truth, none to shifted outlines, and counts false positives', async () => {
    const scene = await renderScene({ puzzle: p48, seed: 4, layout: { areaMm: [700, 500], touchingShare: 0.05, faceDownShare: 0.05 }, camera: { x: 405, y: 305, heightMm: 560, tiltDeg: 3, imageSize: [1008, 756] } });
    const truth = scene.truth;
    const perfect = segmentationScore(truth.pieces.map((p) => ({ outlineImg: p.outlineImg })), truth);
    expect(perfect.eligible).toBeGreaterThan(20);
    expect(perfect.recall).toBe(1);
    expect(perfect.precision).toBe(1);
    expect(perfect.positionErrorMm.max).toBeLessThan(1e-6);
    // 3 mm shift (≈ 3.6 px here): IoU drops below 0.85 for every piece.
    const shift = 3 * truth.pxPerMm;
    const shifted = segmentationScore(truth.pieces.map((p) => ({ outlineImg: p.outlineImg.map((v, i) => (i % 2 ? v : v + shift)) })), truth);
    expect(shifted.recall).toBeLessThan(0.1);
    // A 0.5 mm shift still matches, and the position error says 0.5 mm.
    const small = segmentationScore(truth.pieces.map((p) => ({ outlineImg: p.outlineImg.map((v, i) => (i % 2 ? v : v + 0.5 * truth.pxPerMm)) })), truth);
    expect(small.recall).toBe(1);
    expect(small.positionErrorMm.median).toBeGreaterThan(0.4);
    expect(small.positionErrorMm.median).toBeLessThan(0.6);
    // An extra blob on empty table is a false positive.
    const fp = segmentationScore([...truth.pieces.map((p) => ({ outlineImg: p.outlineImg })), { outlineImg: [5, 5, 30, 5, 30, 30, 5, 30] }], truth);
    expect(fp.falsePositives).toHaveLength(1);
    expect(fp.precision).toBeLessThan(1);
    // Silhouettes (top + wall) still count as matches at this resolution.
    const sil = segmentationScore(truth.pieces.map((p) => ({ outlineImg: p.silhouetteImg })), truth);
    expect(sil.recall).toBeGreaterThan(0.9);
  });
});

describe('datasets', () => {
  it('are defined deterministically with held-out art', () => {
    const artSeeds = (name: keyof typeof ALL_SETS) => new Set(ALL_SETS[name].items.map((i) => (i.puzzle.art as { seed: number }).seed));
    for (const [v, t] of [
      ['val48', 'test48'],
      ['val300', 'test300'],
      ['val1000', 'test1000'],
    ] as const) {
      const a = artSeeds(v);
      for (const s of artSeeds(t)) expect(a.has(s)).toBe(false);
    }
    expect(new Set(val48.items.map((i) => i.puzzleKey)).size).toBe(10);
    expect(ALL_SETS.val300.items.length).toBe(20);
    expect(ALL_SETS.val1000.items.length).toBe(40);
    let hands = 0;
    for (const set of Object.values(ALL_SETS))
      for (const it of set.items) {
        const c = it.scene.camera;
        if (it.kind === 'overview') {
          // Hand-held 1× overview at 65–75 cm that shows all 8 markers.
          expect(c.zoom).toBe(1);
          expect(c.heightMm).toBeGreaterThanOrEqual(650);
          expect(c.heightMm).toBeLessThanOrEqual(750);
          expect(allMarkersInView(c), it.name).toBe(true);
        } else {
          expect(c.zoom).toBe(2);
          expect(c.heightMm).toBeGreaterThanOrEqual(600);
          expect(c.heightMm).toBeLessThanOrEqual(650);
        }
        expect(c.tiltDeg).toBeLessThanOrEqual(10);
        if (it.scene.handShadow) hands++;
      }
    expect(hands).toBeGreaterThan(10);
  });
});
