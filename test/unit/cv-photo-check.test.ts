/**
 * The photo quality gate (src/cv/photoCheck.ts): blur from the marker edges, blown-out share,
 * markers found at full size.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCv, counters, type Cv } from '../helpers/cv';
import { gaussianBlur, markerFrame } from '../helpers/images';
import { clipped, markerEdgeWidth, PhotoChecker, MAX_EDGE_WIDTH_PX } from '../../src/cv/photoCheck';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';

let cv: Cv;
let checker: PhotoChecker;
let sharp: PixelBuffer;

beforeAll(async () => {
  cv = await getCv();
  checker = new PhotoChecker(cv);
  // Four 232 px markers (54 mm at ~4.3 px/mm), like an overview photo.
  sharp = markerFrame(cv, 4032, 3024, [
    { id: 0, x: 200, y: 200, side: 232 },
    { id: 1, x: 1900, y: 220, side: 232 },
    { id: 2, x: 3500, y: 240, side: 232 },
    { id: 6, x: 260, y: 2500, side: 232 },
  ]).image;
});

afterAll(() => checker.dispose());

function motionBlur(img: PixelBuffer, lengthPx: number): PixelBuffer {
  const src = new cv.Mat(img.height, img.width, cv.CV_8UC1);
  const dst = new cv.Mat();
  const k = cv.Mat.zeros(1, lengthPx, cv.CV_32F);
  try {
    src.data.set(img.data);
    for (let i = 0; i < lengthPx; i++) k.floatPtr(0, i)[0] = 1 / lengthPx;
    cv.filter2D(src, dst, -1, k);
    return { data: Uint8Array.from(dst.data), width: img.width, height: img.height, stride: img.width };
  } finally {
    src.delete();
    dst.delete();
    k.delete();
  }
}

describe('photo quality gate', () => {
  it('a sharp photo: all markers found, thin edges, passes', () => {
    const before = counters().liveScoped;
    const r = checker.check(sharp, { map: null, zoom: 1, kind: 'overview' });
    expect(r.markers.map((m) => m.id).sort()).toEqual([0, 1, 2, 6]);
    expect(r.edgeWidthPx).not.toBeNull();
    expect(r.edgeWidthPx!).toBeLessThan(2);
    expect(r.quality.ok).toBe(true);
    expect(counters().liveScoped).toBe(before);
  });

  it('defocus and hand shake widen the edges past the limit', () => {
    const soft = gaussianBlur(cv, sharp, 1, 3);
    const w1 = markerEdgeWidth(soft, checker.check(soft, { map: null, zoom: 1, kind: 'overview' }).markers)!;
    expect(w1).toBeGreaterThan(MAX_EDGE_WIDTH_PX);
    const shaken = motionBlur(sharp, 9);
    const r = checker.check(shaken, { map: null, zoom: 1, kind: 'overview' });
    expect(r.edgeWidthPx!).toBeGreaterThan(MAX_EDGE_WIDTH_PX);
    expect(r.quality.ok).toBe(false);
    expect(r.quality.reasons.join(' ')).toMatch(/Blurred/);
  });

  it('slight softness (σ 0.8, like a real phone photo) still passes', () => {
    const r = checker.check(gaussianBlur(cv, sharp, 1, 0.8), { map: null, zoom: 1, kind: 'overview' });
    expect(r.edgeWidthPx!).toBeLessThan(MAX_EDGE_WIDTH_PX);
  });

  it('reports a photo without markers', () => {
    const blank: PixelBuffer = { data: new Uint8Array(1008 * 756).fill(200), width: 1008, height: 756, stride: 1008 };
    const r = checker.check(blank, { map: null, zoom: 1, kind: 'overview' });
    expect(r.quality.ok).toBe(false);
    expect(r.quality.reasons[0]).toMatch(/No markers/);
    expect(r.edgeWidthPx).toBeNull();
  });

  it('counts blown-out pixels', () => {
    const img: PixelBuffer = { data: new Uint8Array(400 * 400).fill(120), width: 400, height: 400, stride: 400 };
    for (let y = 0; y < 100; y++) img.data.fill(255, y * 400, y * 400 + 400);
    expect(clipped(img)).toBeCloseTo(0.25, 2);
  });
});
