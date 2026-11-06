/**
 * Box picture straightening (src/cv/rectify.ts) with the app's own OpenCV build in Node.
 *
 * Synthetic "photos" are made like a real camera would: a flat picture of known shape is placed
 * in 3-D, tilted and turned, and projected through a pinhole camera (focal length f, centre in
 * the middle of the photo). That keeps the test honest about the aspect estimate.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getCv, counters, type Cv } from '../helpers/cv';
import { checkQuad, estimateAspect, findBoxQuad, orderCorners, rectifiedSize, rectifyQuad, type Point } from '../../src/cv/rectify';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';

let cv: Cv;
beforeAll(async () => {
  cv = await getCv();
});

/** Projects the corners of a w × h (mm) picture, rotated by (tiltX, tiltY, spin) degrees at distance z. */
function project(wMm: number, hMm: number, opts: { tiltX: number; tiltY: number; spin: number; z: number; f: number; W: number; H: number; shift?: Point }): Point[] {
  const r = (d: number) => (d * Math.PI) / 180;
  const [ax, ay, az] = [r(opts.tiltX), r(opts.tiltY), r(opts.spin)];
  const rot = (p: [number, number, number]): [number, number, number] => {
    let [x, y, z] = p;
    [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
    [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
    [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
    return [x, y, z];
  };
  const [sx, sy] = opts.shift ?? [0, 0];
  return ([
    [-wMm / 2, -hMm / 2, 0],
    [wMm / 2, -hMm / 2, 0],
    [wMm / 2, hMm / 2, 0],
    [-wMm / 2, hMm / 2, 0],
  ] as Array<[number, number, number]>).map((p) => {
    const [x, y, z] = rot(p);
    const Z = z + opts.z;
    return [opts.W / 2 + (opts.f * (x + sx)) / Z, opts.H / 2 + (opts.f * (y + sy)) / Z] as Point;
  });
}

/** A recognisable test picture: coloured quadrants, a grid of dots, RGBA. */
function testPicture(w: number, h: number): PixelBuffer {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const q = (x < w / 2 ? 0 : 1) + (y < h / 2 ? 0 : 2);
      const base = [
        [200, 40, 40],
        [40, 160, 60],
        [40, 70, 200],
        [220, 200, 40],
      ][q]!;
      const dot = (x % 40 < 10 && y % 40 < 10) || Math.abs(x - y * (w / h)) < 3;
      data[i] = dot ? 20 : base[0]!;
      data[i + 1] = dot ? 20 : base[1]!;
      data[i + 2] = dot ? 20 : base[2]!;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h, stride: w * 4 };
}

/** Renders `picture` into a W × H photo on a white "table" with the given corners. */
function photograph(picture: PixelBuffer, corners: Point[], W: number, H: number): PixelBuffer {
  const src = new cv.Mat(picture.height, picture.width, cv.CV_8UC4);
  const dst = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, picture.width, 0, picture.width, picture.height, 0, picture.height]);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flat());
  const M = cv.getPerspectiveTransform(from, to);
  try {
    src.data.set(picture.data);
    cv.warpPerspective(src, dst, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(245, 245, 245, 255));
    return { data: new Uint8ClampedArray(dst.data), width: W, height: H, stride: W * 4 };
  } finally {
    for (const m of [src, dst, from, to, M]) m.delete();
  }
}

/** Mean absolute difference (0–255) between two RGBA images of the same size, ignoring a border. */
function meanDiff(a: PixelBuffer, b: PixelBuffer, border = 0.06): number {
  let sum = 0;
  let n = 0;
  const bx = Math.round(a.width * border);
  const by = Math.round(a.height * border);
  for (let y = by; y < a.height - by; y++) {
    for (let x = bx; x < a.width - bx; x++) {
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 3; c++) sum += Math.abs(a.data[i + c]! - b.data[i + c]!);
      n += 3;
    }
  }
  return sum / n;
}

/** Nearest-neighbour resize of an RGBA image (for comparing). */
function resizeTo(img: PixelBuffer, w: number, h: number): PixelBuffer {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / w));
      const sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / h));
      out.set(img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), (y * w + x) * 4);
    }
  }
  return { data: out, width: w, height: h, stride: w * 4 };
}

const W = 1600;
const H = 1200;
const F = 0.8 * W;

describe('aspect from corner geometry', () => {
  const views = [
    { name: 'straight on', tiltX: 0, tiltY: 0, spin: 0 },
    { name: 'tilted 25° forward', tiltX: 25, tiltY: 0, spin: 0 },
    { name: 'tilted 20° and 15°, turned 10°', tiltX: 20, tiltY: 15, spin: 10 },
    { name: 'tilted 35°, turned 80°', tiltX: 35, tiltY: -10, spin: 80 },
  ];
  for (const v of views) {
    for (const aspect of [699 / 497, 497 / 699]) {
      it(`${v.name}, picture ${aspect.toFixed(3)}: within 2 %`, () => {
        const c = project(aspect * 300, 300, { ...v, z: 650, f: F, W, H });
        const est = estimateAspect(orderCorners(c), W, H);
        // A turned picture is seen from a different side: compare against the shape as photographed.
        const expected = Math.abs(v.spin) > 45 ? 1 / aspect : aspect;
        expect(Math.abs(est.aspect / expected - 1)).toBeLessThan(0.02);
      });
    }
  }

  it('recovers the focal length when the perspective is strong', () => {
    const c = project(420, 300, { tiltX: 30, tiltY: 20, spin: 5, z: 600, f: F, W, H });
    const est = estimateAspect(c, W, H);
    expect(est.method).toBe('perspective');
    expect(Math.abs(est.focalPx / F - 1)).toBeLessThan(0.05);
    // A longer lens (e.g. 2× zoom) is measured too, so the shape stays right.
    const c2 = project(420, 300, { tiltX: 30, tiltY: 25, spin: 5, z: 1200, f: 1.6 * W, W, H });
    const est2 = estimateAspect(c2, W, H);
    expect(est2.method).toBe('perspective');
    expect(Math.abs(est2.aspect / 1.4 - 1)).toBeLessThan(0.02);
  });

  it('chooses an output size with that aspect, at most 2048 px', () => {
    const c: Point[] = [[0, 0], [3000, 0], [3000, 2000], [0, 2000]];
    expect(rectifiedSize(c, 1.5)).toEqual({ width: 2048, height: 1365 });
    expect(rectifiedSize(c, 0.75, 1024)).toEqual({ width: 768, height: 1024 });
    expect(rectifiedSize([[0, 0], [100, 0], [100, 50], [0, 50]], 2)).toEqual({ width: 100, height: 50 });
  });
});

describe('corner helpers', () => {
  it('orders corners as top-left, top-right, bottom-right, bottom-left', () => {
    expect(orderCorners([[90, 95], [10, 10], [12, 90], [95, 8]])).toEqual([[10, 10], [95, 8], [90, 95], [12, 90]]);
  });

  it('rejects crossed, flat or tiny outlines in words', () => {
    expect(checkQuad([[0, 0], [10, 0], [10, 10], [0, 10]])).toBeNull();
    expect(checkQuad([[0, 0], [10, 10], [10, 0], [0, 10]])).toMatch(/crosses/);
    expect(checkQuad([[0, 0], [5, 0], [10, 0], [0, 10]])).toMatch(/straight line/);
    expect(checkQuad([[0, 0], [1, 0], [1, 1], [0, 1]], 5)).toMatch(/too small/);
  });
});

describe('rectifyQuad', () => {
  it('straightens a tilted photo of a picture back to the picture (shape and content)', () => {
    const picture = testPicture(560, 400); // aspect 1.4
    const corners = project(420, 300, { tiltX: 25, tiltY: 12, spin: 8, z: 700, f: F, W, H });
    const photo = photograph(picture, corners, W, H);
    const before = counters().liveScoped;
    const out = rectifyQuad(cv, photo, 'RGBA', corners, { maxSide: 800 });
    expect(counters().liveScoped).toBe(before);
    expect(Math.abs(out.aspect / 1.4 - 1)).toBeLessThan(0.02);
    expect(Math.abs(out.width / out.height / 1.4 - 1)).toBeLessThan(0.02);
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(800);
    expect(out.data.length).toBe(out.width * out.height * 4);
    const diff = meanDiff(resizeTo({ data: out.data, width: out.width, height: out.height, stride: out.width * 4 }, 560, 400), picture);
    expect(diff).toBeLessThan(25);
  });

  it('works on a crop of the photo (offset + full photo size) and on BGRA pixels', () => {
    const picture = testPicture(400, 560); // portrait
    const corners = project(300, 420, { tiltX: -20, tiltY: 10, spin: -5, z: 750, f: F, W, H });
    const photo = photograph(picture, corners, W, H);
    // Crop the photo around the picture.
    const x0 = Math.floor(Math.min(...corners.map((p) => p[0]))) - 4;
    const y0 = Math.floor(Math.min(...corners.map((p) => p[1]))) - 4;
    const x1 = Math.ceil(Math.max(...corners.map((p) => p[0]))) + 4;
    const y1 = Math.ceil(Math.max(...corners.map((p) => p[1]))) + 4;
    const cw = x1 - x0;
    const ch = y1 - y0;
    // Padded rows (stride > width × 4) and BGRA order, like VideoFrame.copyTo can give.
    const stride = cw * 4 + 32;
    const crop = new Uint8ClampedArray(stride * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const s = ((y + y0) * W + (x + x0)) * 4;
        const d = y * stride + x * 4;
        crop[d] = photo.data[s + 2]!;
        crop[d + 1] = photo.data[s + 1]!;
        crop[d + 2] = photo.data[s]!;
        crop[d + 3] = 255;
      }
    }
    const out = rectifyQuad(cv, { data: crop, width: cw, height: ch, stride }, 'BGRA', corners, { offset: [x0, y0], imageSize: { width: W, height: H } });
    expect(Math.abs(out.aspect / (300 / 420) - 1)).toBeLessThan(0.02);
    expect(out.height).toBeGreaterThan(out.width);
    const diff = meanDiff(resizeTo({ data: out.data, width: out.width, height: out.height, stride: out.width * 4 }, 400, 560), picture);
    expect(diff).toBeLessThan(25);
  });

  it('refuses a crossed outline with a message in words, leaking nothing', () => {
    const before = counters().liveScoped;
    expect(() => rectifyQuad(cv, testPicture(50, 50), 'RGBA', [[0, 0], [40, 40], [40, 0], [0, 40]])).toThrow(/crosses/);
    expect(counters().liveScoped).toBe(before);
  });
});

describe('findBoxQuad (automatic first guess)', () => {
  it('finds the picture on a white table within 2 % of the photo size', () => {
    const picture = testPicture(560, 400);
    const corners = project(420, 300, { tiltX: 18, tiltY: -10, spin: 6, z: 800, f: F, W, H, shift: [20, -10] });
    const photo = photograph(picture, corners, W, H);
    const before = counters().liveScoped;
    const found = findBoxQuad(cv, photo, 'RGBA');
    expect(counters().liveScoped).toBe(before);
    expect(found).not.toBeNull();
    const expected = orderCorners(corners).map(([x, y]) => [x / W, y / H]);
    for (let i = 0; i < 4; i++) {
      expect(Math.hypot(found![i]![0] - expected[i]![0]!, found![i]![1] - expected[i]![1]!)).toBeLessThan(0.02);
    }
  });

  it('gives null for a plain photo', () => {
    const w = 320;
    const h = 240;
    const data = new Uint8ClampedArray(w * h * 4).fill(240);
    expect(findBoxQuad(cv, { data, width: w, height: h, stride: w * 4 }, 'RGBA')).toBeNull();
  });
});
