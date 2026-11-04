/** Types for check-wasm.mjs (used by the unit tests). */
export function wasmMemoryLimits(bytes: Uint8Array): { initialPages: number; maximumPages: number | null; imported: boolean };
