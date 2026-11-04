/**
 * WebGPU check for the Device check (RESEARCH §13, §19 item 7): adapter, info, limits, shader-f16,
 * device, then a timed compute self-test (n × n matrix multiply) whose result is verified on the
 * CPU. Runs on the main thread and inside the probe worker. Worker-safe.
 *
 * Small values are used so every product sum is an exact integer in float32: the GPU result
 * must match the CPU result exactly. Only a sample of cells is verified on the CPU, to keep
 * JavaScript work small on the iPhone.
 */
import type { GpuComputeResult, GpuProbeResult } from '../shared/probeApi';
import { errorMessage, TimeoutError, withTimeout } from './util';

// GPUBufferUsage / GPUMapMode values (spelled out so this file never touches WebGPU globals when there is no WebGPU).
const USAGE_MAP_READ = 0x0001;
const USAGE_COPY_SRC = 0x0004;
const USAGE_COPY_DST = 0x0008;
const USAGE_STORAGE = 0x0080;
const MAP_MODE_READ = 0x0001;
const WORKGROUP = 8;

export const GPU_LIMIT_KEYS = [
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxComputeWorkgroupSizeY',
  'maxComputeWorkgroupsPerDimension',
  'maxStorageBuffersPerShaderStage',
  'maxBindGroups',
  'maxTextureDimension2D',
  'maxUniformBufferBindingSize',
] as const;

const INFO_KEYS = ['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter', 'subgroupMinSize', 'subgroupMaxSize'];

export interface GpuProbeOptions {
  adapterTimeoutMs?: number;
  stepTimeoutMs?: number;
  /** Matrix size (multiple of 8). */
  n?: number;
  /** Timed repetitions after the first run. */
  reps?: number;
  /** Result cells verified on the CPU. */
  checkCells?: number;
}

/** Deterministic small-integer inputs (so float32 sums are exact). */
export function matmulInputs(n: number): { a: Float32Array<ArrayBuffer>; b: Float32Array<ArrayBuffer> } {
  const a = new Float32Array(n * n);
  const b = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    a[i] = ((i * 7) % 11) - 5;
    b[i] = ((i * 3) % 13) - 6;
  }
  return { a, b };
}

export function cpuCell(a: ArrayLike<number>, b: ArrayLike<number>, n: number, row: number, col: number): number {
  let sum = 0;
  for (let k = 0; k < n; k++) sum += (a[row * n + k] ?? 0) * (b[k * n + col] ?? 0);
  return sum;
}

/** Checks `cells` result cells (spread over the matrix) against the CPU. */
export function verifyMatmul(a: ArrayLike<number>, b: ArrayLike<number>, out: ArrayLike<number>, n: number, cells: number): { checked: number; wrong: number } {
  if (out.length < n * n) return { checked: 0, wrong: 0 };
  let checked = 0;
  let wrong = 0;
  const total = n * n;
  for (let s = 0; s < Math.min(cells, total); s++) {
    const idx = (s * 7919 + 13) % total;
    const row = Math.floor(idx / n);
    const col = idx % n;
    checked++;
    if (out[idx] !== cpuCell(a, b, n, row, col)) wrong++;
  }
  return { checked, wrong };
}

export function matmulShader(n: number): string {
  return /* wgsl */ `
const N: u32 = ${n}u;
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> c: array<f32>;

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let row = gid.y;
  let col = gid.x;
  if (row >= N || col >= N) {
    return;
  }
  var sum = 0.0;
  for (var k = 0u; k < N; k = k + 1u) {
    sum = sum + a[row * N + k] * b[k * N + col];
  }
  c[row * N + col] = sum;
}
`;
}

async function adapterInfo(adapter: GPUAdapter): Promise<Record<string, string | number | boolean>> {
  let info: unknown = (adapter as unknown as { info?: unknown }).info;
  if (!info) {
    // Older WebGPU builds: adapter.requestAdapterInfo().
    const req = (adapter as unknown as { requestAdapterInfo?: () => Promise<unknown> }).requestAdapterInfo;
    if (typeof req === 'function') info = await withTimeout(req.call(adapter), 2000, 'Reading graphics chip details').catch(() => null);
  }
  const out: Record<string, string | number | boolean> = {};
  if (info && typeof info === 'object') {
    for (const k of INFO_KEYS) {
      const v = (info as Record<string, unknown>)[k];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    }
  }
  const fallback = (adapter as unknown as { isFallbackAdapter?: unknown }).isFallbackAdapter;
  if (typeof fallback === 'boolean' && !('isFallbackAdapter' in out)) out.isFallbackAdapter = fallback;
  return out;
}

function readLimits(limits: GPUSupportedLimits): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of GPU_LIMIT_KEYS) {
    const v = (limits as unknown as Record<string, unknown>)[k];
    if (typeof v === 'number') out[k] = v;
  }
  return out;
}

function featureList(set: { forEach(cb: (value: string) => void): void }): string[] {
  const out: string[] = [];
  set.forEach((f) => out.push(f));
  return out.sort();
}

async function computeTest(device: GPUDevice, n: number, reps: number, checkCells: number, stepMs: number): Promise<GpuComputeResult> {
  const res: GpuComputeResult = { ok: false, n, reps, firstMs: 0, msPerRun: 0, gflops: 0, checked: 0, wrong: 0 };
  const buffers: GPUBuffer[] = [];
  try {
    const { a, b } = matmulInputs(n);
    const bytes = n * n * 4;
    const t0 = performance.now();
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code: matmulShader(n) });
    const pipeline = await withTimeout(
      device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } }),
      stepMs,
      'Preparing the graphics test',
    );
    const make = (usage: number) => {
      const buf = device.createBuffer({ size: bytes, usage });
      buffers.push(buf);
      return buf;
    };
    const bufA = make(USAGE_STORAGE | USAGE_COPY_DST);
    const bufB = make(USAGE_STORAGE | USAGE_COPY_DST);
    const bufC = make(USAGE_STORAGE | USAGE_COPY_SRC);
    const read = make(USAGE_MAP_READ | USAGE_COPY_DST);
    device.queue.writeBuffer(bufA, 0, a);
    device.queue.writeBuffer(bufB, 0, b);
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bufA } },
        { binding: 1, resource: { buffer: bufB } },
        { binding: 2, resource: { buffer: bufC } },
      ],
    });
    const groups = Math.ceil(n / WORKGROUP);
    // Small command buffers only (an iOS GPU-process crash on large submissions is open; RESEARCH §13).
    const submit = (count: number, copy: boolean) => {
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      for (let i = 0; i < count; i++) pass.dispatchWorkgroups(groups, groups);
      pass.end();
      if (copy) enc.copyBufferToBuffer(bufC, 0, read, 0, bytes);
      device.queue.submit([enc.finish()]);
    };
    submit(1, true);
    const scopeError = await device.popErrorScope();
    if (scopeError) throw new Error(scopeError.message);
    await withTimeout(read.mapAsync(MAP_MODE_READ), stepMs, 'Reading the graphics result');
    const out = new Float32Array(read.getMappedRange().slice(0));
    read.unmap();
    res.firstMs = performance.now() - t0;
    const v = verifyMatmul(a, b, out, n, checkCells);
    res.checked = v.checked;
    res.wrong = v.wrong;

    const t1 = performance.now();
    submit(reps, false);
    await withTimeout(device.queue.onSubmittedWorkDone(), stepMs, 'Timing the graphics test');
    res.msPerRun = (performance.now() - t1) / Math.max(1, reps);
    res.gflops = res.msPerRun > 0 ? (2 * n ** 3) / (res.msPerRun * 1e6) : 0;
    res.ok = res.checked > 0 && res.wrong === 0;
  } catch (err) {
    res.error = errorMessage(err);
  } finally {
    for (const buf of buffers) {
      try {
        buf.destroy();
      } catch {
        /* ignore */
      }
    }
  }
  return res;
}

/** Runs every WebGPU step; never throws, never hangs (each step has a timeout). */
export async function probeWebGpu(gpu: GPU | null | undefined, where: 'main' | 'worker', opts: GpuProbeOptions = {}): Promise<GpuProbeResult> {
  const adapterTimeoutMs = opts.adapterTimeoutMs ?? 3000;
  const stepMs = opts.stepTimeoutMs ?? 10_000;
  const n = opts.n ?? 256;
  const reps = opts.reps ?? 20;
  const checkCells = opts.checkCells ?? 1024;
  const t0 = performance.now();
  const res: GpuProbeResult = {
    where,
    available: Boolean(gpu),
    adapter: false,
    adapterTimedOut: false,
    adapterMs: 0,
    info: null,
    limits: null,
    features: [],
    f16: false,
    device: false,
    f16Enabled: false,
    compute: null,
    totalMs: 0,
  };
  const done = (): GpuProbeResult => {
    res.totalMs = performance.now() - t0;
    return res;
  };
  if (!gpu) return done();
  let device: GPUDevice | null = null;
  try {
    const ta = performance.now();
    let adapter: GPUAdapter | null = null;
    try {
      adapter = await withTimeout(gpu.requestAdapter(), adapterTimeoutMs, 'Finding the graphics chip');
    } catch (err) {
      if (err instanceof TimeoutError) res.adapterTimedOut = true;
      else res.error = errorMessage(err);
    }
    res.adapterMs = performance.now() - ta;
    if (!adapter) return done();
    res.adapter = true;
    res.info = await adapterInfo(adapter);
    res.limits = readLimits(adapter.limits);
    res.features = featureList(adapter.features);
    res.f16 = res.features.includes('shader-f16');
    try {
      device = await withTimeout(adapter.requestDevice(res.f16 ? { requiredFeatures: ['shader-f16'] } : undefined), stepMs, 'Starting the graphics chip');
    } catch (err) {
      res.deviceError = errorMessage(err);
      if (res.f16) {
        try {
          device = await withTimeout(adapter.requestDevice(), stepMs, 'Starting the graphics chip');
        } catch (err2) {
          res.deviceError = errorMessage(err2);
        }
      }
    }
    if (!device) return done();
    res.device = true;
    res.f16Enabled = featureList(device.features).includes('shader-f16');
    void device.lost.then((info) => {
      if (info.reason !== 'destroyed') res.deviceLost = `${info.reason}: ${info.message}`;
    });
    res.compute = await computeTest(device, n, reps, checkCells, stepMs);
  } catch (err) {
    res.error = errorMessage(err);
  } finally {
    try {
      device?.destroy();
    } catch {
      /* ignore */
    }
  }
  return done();
}
