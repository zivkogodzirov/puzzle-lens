/**
 * The Device check's probe worker (src/workers/probe.worker.ts), called through Comlink.
 * Declared here so the main thread never imports worker code. Worker-safe types only.
 */
import type { WorkerCapabilities } from './types';

/** Counts for one group of pixels compared against their known values. */
export interface PixelCompare {
  checked: number;
  mismatched: number;
  /** Largest difference in any colour channel (0..255). */
  maxDiff: number;
}

/**
 * Result of reading back a drawing whose pixels are known exactly (canvas-noise probe).
 * `exact` = solid colours, putImageData pixels and a drawImage copy of them (must match exactly);
 * `gradient` = a canvas gradient whose rows must be identical (±1 for dithering).
 */
export interface NoiseComparison {
  exact: PixelCompare;
  gradient: PixelCompare;
  /** Pixels changed by the text (sanity check that text really was drawn). */
  textPixels: number;
  /** clean = exact; noise = solid/known pixels changed; maybe = only the gradient rows differ. */
  verdict: 'clean' | 'noise' | 'maybe';
  samples: Array<{ x: number; y: number; expected: [number, number, number]; got: [number, number, number] }>;
}

export interface NoiseResult {
  /** 'canvas-main' | 'offscreen-worker' | 'videoframe-worker' */
  method: string;
  comparison: NoiseComparison | null;
  /** VideoFrame pixel format, for the video-frame method. */
  format?: string | null;
  error?: string;
  ms: number;
}

export interface GpuComputeResult {
  ok: boolean;
  /** Matrix size (n × n, multiplied by another n × n). */
  n: number;
  reps: number;
  /** First run including pipeline creation, upload and read-back. */
  firstMs: number;
  /** Average time per multiplication once warm. */
  msPerRun: number;
  gflops: number;
  /** Result cells verified on the CPU, and how many were wrong. */
  checked: number;
  wrong: number;
  error?: string;
}

export interface GpuProbeResult {
  where: 'main' | 'worker';
  /** navigator.gpu exists. */
  available: boolean;
  adapter: boolean;
  adapterTimedOut: boolean;
  adapterMs: number;
  info: Record<string, string | number | boolean> | null;
  limits: Record<string, number> | null;
  features: string[];
  f16: boolean;
  device: boolean;
  /** shader-f16 could be switched on when asking for the device. */
  f16Enabled: boolean;
  deviceError?: string;
  deviceLost?: string;
  compute: GpuComputeResult | null;
  error?: string;
  totalMs: number;
}

export interface WasmFeatures {
  simd: boolean;
  /** Legacy exception handling (try/catch), as emitted by Emscripten's -fwasm-exceptions. */
  exceptions: boolean;
  /** New exception handling (try_table / exnref). */
  exnref: boolean;
  /** WebAssembly.Exception and WebAssembly.Tag exist. */
  exceptionApi: boolean;
  /** JavaScript Promise Integration (WebAssembly.Suspending / promising). */
  jspi: boolean;
}

export interface ProbeWorkerCaps extends WorkerCapabilities {
  /** createImageBitmap(ImageData) really works. */
  createImageBitmapWorks: boolean;
  /** A JPEG Blob can be decoded with createImageBitmap (how photos are read). */
  createImageBitmapFromBlob: boolean;
  /** OffscreenCanvas.convertToBlob works (JPEG). */
  offscreenConvertToBlob: boolean;
  /** new VideoFrame(ImageBitmap) + copyTo works. */
  videoFrameCopyTo: boolean;
  wasm: WasmFeatures;
  hardwareConcurrency: number | null;
  /** Error messages from the probes above, by name. */
  errors: Record<string, string>;
}

export interface ProbeApi {
  capabilities(): Promise<ProbeWorkerCaps>;
  /** Canvas-noise probe inside the worker: OffscreenCanvas readback and VideoFrame.copyTo. */
  canvasNoise(): Promise<NoiseResult[]>;
  /** WebGPU adapter, limits and a timed compute self-test, inside the worker. */
  webgpu(): Promise<GpuProbeResult>;
}
