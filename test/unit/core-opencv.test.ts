/**
 * The custom OpenCV build (vendor/opencv): loads in Node, has what Puzzle Lens needs, lacks what
 * was trimmed, and turns C++ errors into catchable JavaScript errors.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { CvError, cvErrorMessage, cvGuard, cvLoadMs, loadCv, wasmBytes } from '../../src/cv/loadCv';
import { wasmMemoryLimits } from '../../scripts/opencv/check-wasm.mjs';
import { freshCv, smallCvJob, type Cv } from '../helpers/cv';

let cv: Cv;

beforeAll(async () => {
  cv = await loadCv();
});

/** Calls findHomography with only 2 point pairs (needs ≥ 4): OpenCV throws a cv::Exception. */
function badHomography(c: Cv): void {
  const src = c.matFromArray(2, 1, c.CV_32FC2, [0, 0, 10, 10]);
  const dst = c.matFromArray(2, 1, c.CV_32FC2, [0, 0, 10, 10]);
  try {
    const H = c.findHomography(src, dst);
    H.delete();
  } finally {
    src.delete();
    dst.delete();
  }
}

describe('OpenCV build: loading', () => {
  it('loads, is not thenable, and reports a load time', async () => {
    expect(cv).toBeTruthy();
    expect(typeof cv.then).toBe('undefined'); // would make `await` loop forever
    expect(cvLoadMs()).toBeGreaterThan(0);
    // loadCv() is a singleton: the same module object every time.
    expect(await loadCv()).toBe(cv);
  });

  it('has every function Puzzle Lens needs', () => {
    const required = [
      'Mat',
      'MatVector',
      'matFromArray',
      'aruco_ArucoDetector',
      'aruco_DetectorParameters',
      'aruco_RefineParameters',
      'getPredefinedDictionary',
      'generateImageMarker',
      'cornerSubPix',
      'calcOpticalFlowPyrLK',
      'findHomography',
      'decomposeHomographyMat',
      'estimateAffinePartial2D',
      'goodFeaturesToTrack',
      'warpPerspective',
      'findContours',
      'Laplacian',
      'meanStdDev',
      'getExceptionMessage',
    ];
    const missing = required.filter((name) => typeof cv[name] !== 'function');
    expect(missing).toEqual([]);
    expect(typeof cv.DICT_4X4_50).toBe('number');
  });

  it('does not contain the trimmed dnn and photo modules', () => {
    const dnnOrPhoto = ['dnn_Net', 'readNet', 'readNetFromONNX', 'blobFromImage', 'inpaint', 'fastNlMeansDenoising', 'seamlessClone', 'createTonemap', 'createMergeMertens'];
    expect(dnnOrPhoto.filter((name) => name in cv)).toEqual([]);
    expect(Object.keys(cv).filter((k) => /^dnn_|inpaint|Denois|Tonemap|seamlessClone/i.test(k))).toEqual([]);
  });

  it('reports the WebAssembly memory size (HEAPU8 is not exported, so via a probe Mat)', () => {
    expect(cv.HEAPU8).toBeUndefined();
    const bytes = wasmBytes(cv);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes % 65536).toBe(0); // whole WebAssembly pages
    expect(wasmBytes(null)).toBe(0);
    // Growing the heap is visible.
    const big = new cv.Mat(4096, 8192, cv.CV_8UC4); // 128 MiB
    try {
      expect(wasmBytes(cv)).toBeGreaterThan(bytes);
    } finally {
      big.delete();
    }
  });
});

describe('OpenCV build: errors', () => {
  it('an OpenCV error is catchable and readable, and the module keeps working', () => {
    const before = smallCvJob(cv);
    let caught: unknown = null;
    try {
      badHomography(cv);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(WebAssembly.Exception);
    const msg = cvErrorMessage(cv, caught);
    expect(msg).toMatch(/findHomography|Homography/);
    expect(msg).toContain('cv::Exception');
    // Still works afterwards and gives the same answer.
    expect(smallCvJob(cv)).toBe(before);
  });

  it('cvErrorMessage handles plain errors and non-errors', () => {
    expect(cvErrorMessage(cv, new Error('plain JS error'))).toBe('plain JS error');
    expect(cvErrorMessage(cv, 'just a string')).toBe('just a string');
    expect(cvErrorMessage(null, new TypeError('no cv'))).toBe('no cv');
  });

  it('survives a few dozen caught errors', async () => {
    const c = await freshCv();
    const before = smallCvJob(c);
    for (let i = 0; i < 40; i++) expect(() => badHomography(c)).toThrow();
    expect(smallCvJob(c)).toBe(before);
  });

  /**
   * With native WebAssembly exceptions, a C++ error caught in JavaScript does not rewind
   * Emscripten's stack pointer (~1 KiB lost per findHomography error: dead after ~65) and the
   * exception object is never freed (~0.8 KiB each). cvGuard (src/cv/loadCv.ts) repairs both.
   */
  it('survives 2,000 caught errors in a row when they go through cvGuard', async () => {
    const c = await freshCv(); // private instance in case this ever breaks it
    const before = smallCvJob(c);
    const highWater = () => {
      const p = c._malloc(8 * 1048576) as number;
      c._free(p);
      return p;
    };
    const h0 = highWater();
    let messages = 0;
    for (let i = 0; i < 2000; i++) {
      try {
        cvGuard(c, () => badHomography(c));
      } catch (err) {
        expect(err).toBeInstanceOf(CvError);
        if ((err as Error).message.includes('cv::Exception')) messages++;
      }
    }
    expect(messages).toBe(2000);
    expect(smallCvJob(c)).toBe(before);
    // The exceptions were freed: the heap's high-water mark didn't move (unfreed: ~1.6 MiB).
    expect(highWater() - h0).toBeLessThan(65536);
  });

  it('without cvGuard the stack leak is real (documents why cvGuard exists)', async () => {
    const c = await freshCv(); // this instance is deliberately broken
    let broke = false;
    for (let i = 0; i < 400 && !broke; i++) {
      try {
        badHomography(c);
      } catch {
        /* expected */
      }
      try {
        smallCvJob(c);
      } catch {
        broke = true;
      }
    }
    expect(broke).toBe(true);
  });

  it('cvGuard passes results through and leaves plain JavaScript errors alone', () => {
    expect(cvGuard(cv, () => smallCvJob(cv))).toBeGreaterThan(0);
    const e = new TypeError('plain');
    expect(() => cvGuard(cv, () => {
      throw e;
    })).toThrow(e);
  });

  it('the WebAssembly memory starts at 32 MiB (OpenCV\'s 128 MiB default is patched out)', () => {
    const lim = wasmMemoryLimits(readFileSync(new URL('../../vendor/opencv/opencv.wasm', import.meta.url)));
    expect((lim.initialPages * 65536) / 1048576).toBe(32);
    expect((lim.maximumPages! * 65536) / 1048576).toBe(1024);
  });
});
