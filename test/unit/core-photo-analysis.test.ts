/**
 * Photo (Snap) helpers in src/cv/photoAnalysis.ts: per-tile brightness / clipping / sharpness,
 * and the "is 2× a real sensor crop?" test from the Device check (PLAN §6 M1, RESEARCH §19 item 3).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { detailEnergy, tileStats, twoXRatio, twoXVerdict, twoXWindows } from '../../src/cv/photoAnalysis';
import { cvCounters } from '../../src/cv/scope';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import { getCv, type Cv } from '../helpers/cv';
import { gaussianBlur, grayToRgba, noiseBytes, resizeBuffer, solidRgba, texture, viewRect, withStride, cropBuffer } from '../helpers/images';

let cv: Cv;

beforeAll(async () => {
  cv = await getCv();
});

describe('tileStats', () => {
  const N = 256 * 256;

  it('all-white tile: every pixel clipped high, mean 255, no detail', () => {
    const s = tileStats(cv, solidRgba(256, 256, [255, 255, 255, 255]));
    expect(s.pixels).toBe(N);
    expect(s.clippedHigh).toBe(N);
    expect(s.clippedLow).toBe(0);
    expect(s.sumLuma / s.pixels).toBeCloseTo(255, 6);
    expect(s.lapVar).toBe(0);
  });

  it('all-black tile: every pixel clipped low, mean 0', () => {
    const s = tileStats(cv, solidRgba(256, 256, [0, 0, 0, 255]));
    expect(s.clippedLow).toBe(N);
    expect(s.clippedHigh).toBe(0);
    expect(s.sumLuma).toBe(0);
  });

  it('mid-grey tile: nothing clipped, mean luma right', () => {
    const s = tileStats(cv, solidRgba(256, 256, [128, 128, 128, 255]));
    expect(s.clippedHigh).toBe(0);
    expect(s.clippedLow).toBe(0);
    expect(s.sumLuma / s.pixels).toBeCloseTo(128, 6);
  });

  it('clipping thresholds: ≥ 250 counts as blown out, ≤ 5 as crushed', () => {
    for (const [v, high, low] of [
      [249, 0, 0],
      [250, N, 0],
      [5, 0, N],
      [6, 0, 0],
    ] as const) {
      const s = tileStats(cv, solidRgba(256, 256, [v, v, v, 255]));
      expect([v, s.clippedHigh, s.clippedLow]).toEqual([v, high, low]);
    }
  });

  it('half white / half black tile: half of each, mean ≈ 127.5', () => {
    const t = solidRgba(256, 256, [0, 0, 0, 255]);
    t.data.fill(255, 0, (N / 2) * 4); // top half white
    const s = tileStats(cv, t);
    expect(s.clippedHigh).toBe(N / 2);
    expect(s.clippedLow).toBe(N / 2);
    expect(s.sumLuma / s.pixels).toBeCloseTo(127.5, 6);
    expect(s.lapVar).toBeGreaterThan(0); // the edge between the halves
  });

  it('uses the right channel order: pure red has luma ≈ 76 as RGBA, ≈ 29 as BGRA', () => {
    const red = solidRgba(64, 64, [255, 0, 0, 255]);
    expect(tileStats(cv, red, 'RGBA').sumLuma / (64 * 64)).toBeCloseTo(76, 0); // 0.299 × 255
    expect(tileStats(cv, red, 'BGRA').sumLuma / (64 * 64)).toBeCloseTo(29, 0); // 0.114 × 255
  });

  it('padded stride and a view into a bigger photo give the same answer as a packed copy', () => {
    const photo = grayToRgba(cv, texture(cv, 800, 600, { seed: 3 }));
    const packed = cropBuffer(photo, 4, 100, 50, 256, 192);
    const view = viewRect(photo, 4, 100, 50, 256, 192);
    const padded = withStride(packed, 4, 256 * 4 + 40);
    const a = tileStats(cv, packed);
    expect(tileStats(cv, view)).toEqual(a);
    expect(tileStats(cv, padded)).toEqual(a);
    expect(a.lapVar).toBeGreaterThan(0);
  });

  it('a blurred tile has a lower Laplacian variance (sharpness) than the sharp one', () => {
    const sharp = grayToRgba(cv, texture(cv, 512, 512, { seed: 4 }));
    const soft = gaussianBlur(cv, sharp, 4, 2);
    expect(tileStats(cv, soft).lapVar).toBeLessThan(tileStats(cv, sharp).lapVar * 0.5);
  });

  it('frees every OpenCV object it creates', () => {
    tileStats(cv, solidRgba(128, 128, [10, 20, 30, 255]));
    expect(cvCounters.liveScoped).toBe(0);
  });
});

describe('detailEnergy', () => {
  it('is 0 for a flat image, higher for texture, lower after blur', () => {
    const flat: PixelBuffer = { data: new Uint8Array(200 * 100).fill(90), width: 200, height: 100, stride: 200 };
    expect(detailEnergy(cv, flat)).toBe(0);
    const tex = texture(cv, 400, 300, { seed: 8 });
    const e = detailEnergy(cv, tex);
    expect(e).toBeGreaterThan(1);
    expect(detailEnergy(cv, gaussianBlur(cv, tex, 1, 2))).toBeLessThan(e * 0.6);
    expect(cvCounters.liveScoped).toBe(0);
  });
});

describe('twoXVerdict thresholds', () => {
  const sizes = { one: [4032, 3024] as [number, number], two: [4032, 3024] as [number, number] };

  it('ratio ≥ 1.1 → true 2× (provisional threshold)', () => {
    expect(twoXVerdict(10, 11, sizes)).toMatchObject({ verdict: 'true-2x' });
    expect(twoXVerdict(10, 11, sizes).ratio).toBeCloseTo(1.1, 12);
    expect(twoXVerdict(10, 25, sizes).verdict).toBe('true-2x');
  });

  it('ratio ≤ 1.02 → digital zoom (including ratios below 1)', () => {
    expect(twoXVerdict(10, 10.2, sizes).verdict).toBe('digital-zoom');
    expect(twoXVerdict(10, 10, sizes).verdict).toBe('digital-zoom');
    expect(twoXVerdict(10, 6, sizes).verdict).toBe('digital-zoom');
  });

  it('1.02 < ratio < 1.1 → unclear', () => {
    expect(twoXVerdict(10, 10.21, sizes).verdict).toBe('unclear');
    expect(twoXVerdict(10, 10.99, sizes).verdict).toBe('unclear');
  });

  it('too little detail in either photo → unclear (and ratio 0 when the 1× photo is flat)', () => {
    expect(twoXVerdict(0.2, 10, sizes)).toMatchObject({ ratio: 0, verdict: 'unclear' });
    expect(twoXVerdict(10, 0.2, sizes).verdict).toBe('unclear');
    expect(twoXVerdict(0, 0, sizes)).toMatchObject({ ratio: 0, verdict: 'unclear' });
  });

  it('passes the photo sizes through', () => {
    const r = twoXVerdict(10, 11, { one: [4032, 3024], two: [3024, 4032] });
    expect(r.oneXSize).toEqual([4032, 3024]);
    expect(r.twoXSize).toEqual([3024, 4032]);
  });
});

describe('twoXWindows', () => {
  it('both windows show the same patch of the scene', () => {
    const w = twoXWindows(4032, 3024, 4032, 3024);
    expect(w.one).toEqual({ x: 1760, y: 1320, width: 512, height: 384 });
    expect(w.two).toEqual({ x: 1504, y: 1128, width: 1024, height: 768 });
    // 2× photo pixel (X, Y) shows 1× pixel (W/4 + X/2, H/4 + Y/2).
    expect(4032 / 4 + w.two.x / 2).toBe(w.one.x);
    expect(3024 / 4 + w.two.y / 2).toBe(w.one.y);
  });

  it('small photos get proportionally small windows', () => {
    const w = twoXWindows(1024, 768, 1024, 768);
    expect(w.one).toEqual({ x: 384, y: 288, width: 256, height: 192 });
    expect(w.two).toEqual({ x: 256, y: 192, width: 512, height: 384 });
  });
});

describe('twoXRatio on physically-motivated synthetic photo pairs', () => {
  /**
   * Scene: a detailed print seen by a sensor with twice the 1× resolution (S × 2).
   * - 1× photo   = the whole scene binned 2:1 (INTER_AREA) — what the 1× camera records.
   * - true 2×    = the middle half of the scene at full resolution (a real sensor crop / tele lens).
   * - digital 2× = the middle half of the 1× photo enlarged 2× (what "digital zoom" does).
   * All photos are the same size (1024 × 768), like a phone that always outputs one format.
   */
  const PW = 1024;
  const PH = 768;
  let oneX: PixelBuffer;
  let trueTwo: PixelBuffer;
  let digitalTwo: PixelBuffer;

  beforeAll(() => {
    // Detail at every scale, softened a little by the lens (σ 0.7 px at the fine sampling).
    const scene = gaussianBlur(
      cv,
      texture(cv, 2 * PW, 2 * PH, {
        seed: 42,
        layers: [
          [64, 1],
          [16, 1],
          [4, 1],
          [1, 1],
        ],
      }),
      1,
      0.7,
    );
    const sceneRgba = grayToRgba(cv, scene);
    oneX = resizeBuffer(cv, sceneRgba, 4, PW, PH, cv.INTER_AREA);
    trueTwo = cropBuffer(sceneRgba, 4, PW / 2, PH / 2, PW, PH);
    const oneCentre = cropBuffer(oneX, 4, PW / 4, PH / 4, PW / 2, PH / 2);
    digitalTwo = resizeBuffer(cv, oneCentre, 4, PW, PH, cv.INTER_LINEAR);
  });

  function run(two: PixelBuffer) {
    const w = twoXWindows(PW, PH, PW, PH);
    // Views into the full photos (no copies): exercises the padded-stride path too.
    const oneCrop = viewRect(oneX, 4, w.one.x, w.one.y, w.one.width, w.one.height);
    const twoCrop = viewRect(two, 4, w.two.x, w.two.y, w.two.width, w.two.height);
    return twoXRatio(cv, oneCrop, twoCrop, { one: [PW, PH], two: [PW, PH] });
  }

  /**
   * Fixed: the first detail measure (mean gradient after a σ = 1 blur) scored a real 2× crop at
   * only ≈ 1.05, the same as digital zoom. The band-pass measure (DoG σ 0.7/1.4) scores it ≈ 1.2.
   * The verdict is still provisional and not shown to the owner until checked on a real iPhone.
   */
  it('a real 2× sensor crop is recognised as true 2× (ratio ≥ 1.1)', () => {
    const r = run(trueTwo);
    expect(r.ratio).toBeGreaterThanOrEqual(1.1);
    expect(r.verdict).toBe('true-2x');
  });

  it('noise (±8) does not turn digital zoom into "true 2×"', () => {
    const noisy = (buf: PixelBuffer, seed: number): PixelBuffer => {
      const out = { ...buf, data: new Uint8Array(buf.data) };
      const n = noiseBytes(out.data.length, seed);
      for (let i = 0; i < out.data.length; i++) {
        if (i % 4 === 3) continue;
        out.data[i] = Math.max(0, Math.min(255, Math.round(out.data[i]! + ((n[i]! / 255) * 2 - 1) * 8)));
      }
      return out;
    };
    const oneCentre = cropBuffer(oneX, 4, PW / 4, PH / 4, PW / 2, PH / 2);
    const cubic = noisy(resizeBuffer(cv, oneCentre, 4, PW, PH, cv.INTER_CUBIC), 7);
    expect(run(cubic).verdict).not.toBe('true-2x');
    expect(run(noisy(trueTwo, 8)).verdict).toBe('true-2x');
  });

  it('measures the real 2× crop as having MORE detail than digital zoom (ordering is right)', () => {
    const t = run(trueTwo);
    const d = run(digitalTwo);
    console.info(`[twoX] measured ratios: true 2× = ${t.ratio.toFixed(3)} (${t.verdict}), digital zoom = ${d.ratio.toFixed(3)} (${d.verdict})`);
    expect(t.ratio).toBeGreaterThan(d.ratio + 0.1);
    expect(t.oneXSize).toEqual([PW, PH]);
    expect(t.twoXSize).toEqual([PW, PH]);
    expect(cvCounters.liveScoped).toBe(0);
  });

  it('digital zoom (1× centre enlarged) is recognised as digital zoom (ratio ≤ 1.02)', () => {
    const r = run(digitalTwo);
    expect(r.ratio).toBeLessThanOrEqual(1.02);
    expect(r.verdict).toBe('digital-zoom');
    expect(cvCounters.liveScoped).toBe(0);
  });

  it('digital zoom with a sharper (bicubic) enlargement is still digital zoom', () => {
    const oneCentre = cropBuffer(oneX, 4, PW / 4, PH / 4, PW / 2, PH / 2);
    const cubic = resizeBuffer(cv, oneCentre, 4, PW, PH, cv.INTER_CUBIC);
    const r = run(cubic);
    console.info(`[twoX] digital zoom (bicubic) ratio = ${r.ratio.toFixed(3)} → ${r.verdict}`);
    expect(r.verdict).toBe('digital-zoom');
  });

  it('a flat, featureless scene is "unclear", never a false verdict', () => {
    const flat = solidRgba(PW, PH, [120, 120, 120, 255]);
    const w = twoXWindows(PW, PH, PW, PH);
    const r = twoXRatio(
      cv,
      viewRect(flat, 4, w.one.x, w.one.y, w.one.width, w.one.height),
      viewRect(flat, 4, w.two.x, w.two.y, w.two.width, w.two.height),
      { one: [PW, PH], two: [PW, PH] },
    );
    expect(r.verdict).toBe('unclear');
  });
});
