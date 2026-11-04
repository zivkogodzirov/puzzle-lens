/**
 * Synthetic test images built with OpenCV (fast, no slow per-pixel work beyond one-time noise).
 * Every helper returns plain JavaScript buffers (PixelBuffer) and frees all OpenCV objects it
 * used, so tests can check that the code under test leaves `cvCounters.liveScoped` at 0.
 */
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import type { Cv } from './cv';

type Mat = {
  delete(): void;
  data: Uint8Array;
  rows: number;
  cols: number;
  channels(): number;
  roi(r: unknown): Mat;
  clone(): Mat;
  copyTo(dst: Mat): void;
  convertTo(dst: Mat, type: number, alpha?: number, beta?: number): void;
  isContinuous(): boolean;
};

/** Small deterministic random generator (mulberry32). Returns numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noiseBytes(n: number, seed: number): Uint8Array {
  const r = rng(seed);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (r() * 256) | 0;
  return out;
}

/** Copies a Mat (any type with 8-bit channels) into a tightly packed PixelBuffer. */
export function matToBuffer(mat: Mat): PixelBuffer {
  const m = mat.isContinuous() ? mat : mat.clone();
  try {
    const channels = m.channels();
    return { data: new Uint8Array(m.data), width: m.cols, height: m.rows, stride: m.cols * channels };
  } finally {
    if (m !== mat) m.delete();
  }
}

/** Creates a Mat (caller deletes) from a PixelBuffer of 1 or 4 channels. */
export function bufferToMat(cv: Cv, buf: PixelBuffer, channels: 1 | 4): Mat {
  const mat: Mat = new cv.Mat(buf.height, buf.width, channels === 1 ? cv.CV_8UC1 : cv.CV_8UC4);
  const rowBytes = buf.width * channels;
  const dst = mat.data;
  for (let y = 0; y < buf.height; y++) dst.set(buf.data.subarray(y * buf.stride, y * buf.stride + rowBytes), y * rowBytes);
  return mat;
}

export interface TextureOptions {
  seed: number;
  /** Output range. */
  lo?: number;
  hi?: number;
  /** [cell size in px, weight] per layer; cell size 1 = per-pixel detail. */
  layers?: Array<[number, number]>;
}

/** Multi-scale random texture ("puzzle print"-like), grey, as a Mat the caller must delete. */
export function textureMat(cv: Cv, width: number, height: number, opts: TextureOptions): Mat {
  const { seed, lo = 0, hi = 255 } = opts;
  const layers = opts.layers ?? [
    [64, 1],
    [16, 1],
    [4, 1],
    [1, 0.5],
  ];
  const acc: Mat = new cv.Mat(height, width, cv.CV_32FC1, new cv.Scalar(0));
  const out: Mat = new cv.Mat();
  try {
    let i = 0;
    for (const [cell, weight] of layers) {
      const sw = Math.max(2, Math.ceil(width / cell));
      const sh = Math.max(2, Math.ceil(height / cell));
      const small: Mat = new cv.Mat(sh, sw, cv.CV_8UC1);
      const big: Mat = new cv.Mat();
      const bigF: Mat = new cv.Mat();
      try {
        small.data.set(noiseBytes(sw * sh, seed * 7919 + i++));
        if (sw === width && sh === height) small.copyTo(big);
        else cv.resize(small, big, new cv.Size(width, height), 0, 0, cv.INTER_CUBIC);
        big.convertTo(bigF, cv.CV_32F, weight, 0);
        cv.add(acc, bigF, acc);
      } finally {
        small.delete();
        big.delete();
        bigF.delete();
      }
    }
    cv.normalize(acc, out, lo, hi, cv.NORM_MINMAX, cv.CV_8U);
    return out;
  } catch (err) {
    out.delete();
    throw err;
  } finally {
    acc.delete();
  }
}

export function texture(cv: Cv, width: number, height: number, opts: TextureOptions): PixelBuffer {
  const m = textureMat(cv, width, height, opts);
  try {
    return matToBuffer(m);
  } finally {
    m.delete();
  }
}

export interface MarkerSpec {
  id: number;
  /** Top-left pixel of the black marker square. */
  x: number;
  y: number;
  /** Side of the black square in px (a multiple of 6 keeps the 4x4+border cells exact). */
  side: number;
  /** White margin around the marker in px (default side / 4). */
  quiet?: number;
}

export interface ExpectedMarker {
  id: number;
  /**
   * Geometric corners of the black square (TL, TR, BR, BL), in OpenCV's pixel-centre
   * convention: the outer edge of pixel column x is at x - 0.5.
   */
  corners: number[];
}

/** A grey frame with ArUco DICT_4X4_50 markers (white quiet zone) on a textured background. */
export function markerFrame(
  cv: Cv,
  width: number,
  height: number,
  markers: MarkerSpec[],
  opts: { seed?: number; lo?: number; hi?: number } = {},
): { image: PixelBuffer; expected: ExpectedMarker[] } {
  const img = textureMat(cv, width, height, {
    seed: opts.seed ?? 1,
    lo: opts.lo ?? 70,
    hi: opts.hi ?? 170,
    layers: [
      [96, 1],
      [24, 0.6],
      [6, 0.3],
      [1, 0.15],
    ],
  });
  const dict = cv.getPredefinedDictionary(cv.DICT_4X4_50);
  const expected: ExpectedMarker[] = [];
  try {
    for (const m of markers) {
      const q = m.quiet ?? Math.round(m.side / 4);
      cv.rectangle(img, new cv.Point(m.x - q, m.y - q), new cv.Point(m.x + m.side + q - 1, m.y + m.side + q - 1), new cv.Scalar(255), -1);
      const marker: Mat = new cv.Mat();
      try {
        cv.generateImageMarker(dict, m.id, m.side, marker, 1);
        const dst = img.roi(new cv.Rect(m.x, m.y, m.side, m.side));
        try {
          marker.copyTo(dst);
        } finally {
          dst.delete();
        }
      } finally {
        marker.delete();
      }
      const x0 = m.x - 0.5;
      const y0 = m.y - 0.5;
      const x1 = m.x + m.side - 0.5;
      const y1 = m.y + m.side - 0.5;
      expected.push({ id: m.id, corners: [x0, y0, x1, y0, x1, y1, x0, y1] });
    }
    return { image: matToBuffer(img), expected };
  } finally {
    dict.delete();
    img.delete();
  }
}

/** Copies an image into a buffer with a larger row stride; padding bytes are filled with junk. */
export function withStride(buf: PixelBuffer, channels: number, stride: number): PixelBuffer {
  const rowBytes = buf.width * channels;
  if (stride < rowBytes) throw new Error('stride too small');
  const data = new Uint8Array(stride * buf.height).fill(0xab);
  for (let y = 0; y < buf.height; y++) data.set(buf.data.subarray(y * buf.stride, y * buf.stride + rowBytes), y * stride);
  return { data, width: buf.width, height: buf.height, stride };
}

/** Grey → 4-channel (R = G = gray, B = `blue` or gray, A = 255). */
export function grayToRgba(cv: Cv, gray: PixelBuffer, blue?: PixelBuffer): PixelBuffer {
  const g = bufferToMat(cv, gray, 1);
  const b = blue ? bufferToMat(cv, blue, 1) : null;
  const a: Mat = new cv.Mat(gray.height, gray.width, cv.CV_8UC1, new cv.Scalar(255));
  const vec = new cv.MatVector();
  const out: Mat = new cv.Mat();
  try {
    vec.push_back(g);
    vec.push_back(g);
    vec.push_back(b ?? g);
    vec.push_back(a);
    cv.merge(vec, out);
    return matToBuffer(out);
  } finally {
    g.delete();
    b?.delete();
    a.delete();
    vec.delete();
    out.delete();
  }
}

/** Swaps the first and third channel (RGBA ⇄ BGRA). */
export function swapRedBlue(cv: Cv, rgba: PixelBuffer): PixelBuffer {
  const src = bufferToMat(cv, rgba, 4);
  const dst: Mat = new cv.Mat();
  try {
    cv.cvtColor(src, dst, cv.COLOR_RGBA2BGRA);
    return matToBuffer(dst);
  } finally {
    src.delete();
    dst.delete();
  }
}

export function gaussianBlur(cv: Cv, buf: PixelBuffer, channels: 1 | 4, sigma: number): PixelBuffer {
  const src = bufferToMat(cv, buf, channels);
  const dst: Mat = new cv.Mat();
  try {
    cv.GaussianBlur(src, dst, new cv.Size(0, 0), sigma, sigma);
    return matToBuffer(dst);
  } finally {
    src.delete();
    dst.delete();
  }
}

export function resizeBuffer(cv: Cv, buf: PixelBuffer, channels: 1 | 4, width: number, height: number, interpolation: number): PixelBuffer {
  const src = bufferToMat(cv, buf, channels);
  const dst: Mat = new cv.Mat();
  try {
    cv.resize(src, dst, new cv.Size(width, height), 0, 0, interpolation);
    return matToBuffer(dst);
  } finally {
    src.delete();
    dst.delete();
  }
}

/** Copies a rectangle out of an image (tightly packed result). */
export function cropBuffer(buf: PixelBuffer, channels: number, x: number, y: number, width: number, height: number): PixelBuffer {
  const rowBytes = width * channels;
  const data = new Uint8Array(rowBytes * height);
  for (let r = 0; r < height; r++) {
    const start = (y + r) * buf.stride + x * channels;
    data.set(buf.data.subarray(start, start + rowBytes), r * rowBytes);
  }
  return { data, width, height, stride: rowBytes };
}

/**
 * A view of a rectangle inside an image WITHOUT copying: same bytes, the parent's stride.
 * Exercises the padded-stride path of `copyRows`.
 */
export function viewRect(buf: PixelBuffer, channels: number, x: number, y: number, width: number, height: number): PixelBuffer {
  const start = y * buf.stride + x * channels;
  return { data: buf.data.subarray(start), width, height, stride: buf.stride };
}

/** A solid 4-channel tile. */
export function solidRgba(width: number, height: number, rgba: [number, number, number, number]): PixelBuffer {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return { data, width, height, stride: width * 4 };
}

/** Max distance between corresponding corner points (x0,y0,…). */
export function maxCornerError(a: number[], b: number[]): number {
  let max = 0;
  for (let i = 0; i < 8; i += 2) max = Math.max(max, Math.hypot((a[i] ?? NaN) - (b[i] ?? NaN), (a[i + 1] ?? NaN) - (b[i + 1] ?? NaN)));
  return max;
}
