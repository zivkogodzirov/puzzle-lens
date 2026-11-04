/**
 * Loads the custom OpenCV.js build (vendor/opencv/opencv.mjs + opencv.wasm).
 * Works in a module Web Worker (the app) and in Node (the automated tests): the same file
 * is used in both, so tests exercise exactly what ships.
 */
import createOpenCv from '../../vendor/opencv/opencv.mjs';

/**
 * OpenCV.js has no maintained type definitions for a custom whitelist build, so the module is
 * typed loosely here and every use goes through small, typed helper functions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Cv = any;

let pending: Promise<Cv> | undefined;
let loadMs = 0;

export function loadCv(): Promise<Cv> {
  if (!pending) {
    const t0 = performance.now();
    pending = createOpenCv({
      // Keep OpenCV's own console noise out of the way; real errors are thrown and caught.
      print: () => {},
      printErr: () => {},
    }).then((mod) => {
      loadMs = performance.now() - t0;
      const cv = mod as Cv;
      // Some Emscripten versions make the module "thenable"; awaiting it again would loop forever.
      if (cv && typeof cv.then === 'function') delete cv.then;
      return cv;
    });
  }
  return pending;
}

export function cvLoadMs(): number {
  return loadMs;
}

/**
 * Size of OpenCV's WebAssembly memory in bytes. It only ever grows. Newer Emscripten doesn't
 * export HEAPU8, so we read it from a tiny Mat's data view (which looks into the same memory).
 */
export function wasmBytes(cv: Cv): number {
  if (!cv) return 0;
  const heap: Uint8Array | undefined = cv.HEAPU8;
  if (heap) return heap.buffer.byteLength;
  let probe: { data: Uint8Array; delete(): void } | null = null;
  try {
    probe = new cv.Mat(1, 1, cv.CV_8UC1);
    return probe!.data.buffer.byteLength;
  } catch {
    return 0;
  } finally {
    probe?.delete();
  }
}

/**
 * Turns whatever OpenCV threw into a readable message. With native WebAssembly exceptions a
 * C++ cv::Exception arrives as a WebAssembly.Exception; Emscripten's helper decodes it.
 */
export function cvErrorMessage(cv: Cv, err: unknown): string {
  try {
    if (cv && typeof cv.getExceptionMessage === 'function' && isWasmException(err)) {
      const decoded = cv.getExceptionMessage(err) as [string, string] | string;
      return Array.isArray(decoded) ? decoded.filter(Boolean).join(': ') : String(decoded);
    }
  } catch {
    /* fall through */
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** An OpenCV (C++) error turned into a normal JavaScript error, safe to pass between workers. */
export class CvError extends Error {
  override name = 'CvError';
}

/**
 * Runs OpenCV work. If it throws, this rewinds the WebAssembly stack pointer and frees the C++
 * exception, then re-throws a plain Error with OpenCV's message.
 *
 * Why: with native WebAssembly exceptions, a C++ error caught in JavaScript does not rewind
 * Emscripten's stack pointer (~1 KiB lost per error; after ~65 errors the module dies with
 * "memory access out of bounds") and the exception object is never freed (~0.8 KiB each).
 * Every catch around OpenCV calls must go through this (or cvRecover).
 */
export function cvGuard<T>(cv: Cv, fn: () => T): T {
  const sp: number | null = typeof cv?.stackSave === 'function' ? cv.stackSave() : null;
  try {
    return fn();
  } catch (err) {
    throw cvRecover(cv, err, sp);
  }
}

/** The repair half of cvGuard, for code that saved the stack pointer itself. Returns the error to throw. */
export function cvRecover(cv: Cv, err: unknown, sp: number | null): Error {
  if (sp !== null) {
    try {
      cv.stackRestore(sp);
    } catch {
      /* ignore */
    }
  }
  if (isWasmException(err)) {
    const message = cvErrorMessage(cv, err);
    try {
      cv?.decrementExceptionRefcount?.(err);
    } catch {
      /* ignore */
    }
    return new CvError(message);
  }
  return err instanceof Error ? err : new Error(String(err));
}

function isWasmException(err: unknown): boolean {
  const W = (globalThis as { WebAssembly?: { Exception?: new (...a: never[]) => unknown } }).WebAssembly;
  return Boolean(W?.Exception && err instanceof W.Exception);
}
