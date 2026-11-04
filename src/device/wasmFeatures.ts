/**
 * WebAssembly feature detection by validating tiny hand-written modules (the same technique as
 * the wasm-feature-detect library). Worker-safe.
 */
import type { WasmFeatures } from '../shared/probeApi';

/** func () -> v128 { i8x16.popcnt(i8x16.splat(i32.const 0)) } */
const SIMD = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11];
/** func () { try catch_all end } — legacy exception handling (what Emscripten -fwasm-exceptions emits). */
const EH_LEGACY = [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25, 11, 11];
/** func () { try_table (no catches) end } — new exception handling with exnref. */
const EH_EXNREF = [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 31, 64, 0, 11, 11];

interface WasmLike {
  validate(bytes: Uint8Array): boolean;
  Exception?: unknown;
  Tag?: unknown;
  Suspending?: unknown;
  promising?: unknown;
}

function validate(w: WasmLike, bytes: number[]): boolean {
  try {
    return w.validate(new Uint8Array(bytes));
  } catch {
    return false;
  }
}

export function detectWasmFeatures(): WasmFeatures {
  const w = (globalThis as unknown as { WebAssembly?: WasmLike }).WebAssembly;
  if (!w) return { simd: false, exceptions: false, exnref: false, exceptionApi: false, jspi: false };
  return {
    simd: validate(w, SIMD),
    exceptions: validate(w, EH_LEGACY),
    exnref: validate(w, EH_EXNREF),
    exceptionApi: typeof w.Exception === 'function' && typeof w.Tag === 'function',
    jspi: typeof w.Suspending === 'function' || typeof w.promising === 'function',
  };
}
