/**
 * OpenCV in Node for the automated tests. Uses exactly the files the app ships
 * (vendor/opencv/opencv.mjs + opencv.wasm) through the app's own loader.
 */
import createOpenCv from '../../vendor/opencv/opencv.mjs';
import { loadCv, type Cv } from '../../src/cv/loadCv';
import { cvCounters } from '../../src/cv/scope';

export type { Cv };

/** The shared OpenCV instance (same singleton the app code uses inside this test file). */
export function getCv(): Promise<Cv> {
  return loadCv();
}

/**
 * A brand-new, private OpenCV instance. Use it for tests that may damage the module
 * (e.g. the repeated-error test), so the shared instance stays healthy for other tests.
 */
export async function freshCv(): Promise<Cv> {
  const mod = (await createOpenCv({ print: () => {}, printErr: () => {} })) as Cv;
  if (mod && typeof mod.then === 'function') delete mod.then;
  return mod;
}

/** Snapshot of the OpenCV object counters (src/cv/scope.ts). */
export function counters(): { liveScoped: number; livePersistent: number; createdScoped: number } {
  return { ...cvCounters };
}

/** A small OpenCV job that exercises allocation, filtering and reading back; returns a checksum. */
export function smallCvJob(cv: Cv): number {
  const a = new cv.Mat(64, 64, cv.CV_8UC1, new cv.Scalar(10));
  const b = new cv.Mat();
  try {
    cv.rectangle(a, new cv.Point(16, 16), new cv.Point(47, 47), new cv.Scalar(200), -1);
    cv.GaussianBlur(a, b, new cv.Size(5, 5), 0);
    return (cv.mean(b) as number[])[0] ?? NaN;
  } finally {
    a.delete();
    b.delete();
  }
}
