import { describe, expect, it } from 'vitest';
import { detectWasmFeatures } from '../../src/device/wasmFeatures';
import { cpuCell, matmulInputs, matmulShader, probeWebGpu, verifyMatmul } from '../../src/device/gpuTest';

describe('WebAssembly feature detection', () => {
  it('detects SIMD and exception handling in Node 22 (which has both)', () => {
    const f = detectWasmFeatures();
    expect(f.simd).toBe(true);
    expect(f.exceptions).toBe(true);
    expect(typeof f.exnref).toBe('boolean');
    expect(typeof f.jspi).toBe('boolean');
    expect(f.exceptionApi).toBe(true);
  });
});

describe('WebGPU self-test (CPU side)', () => {
  it('uses small integers so float32 sums are exact', () => {
    const n = 64;
    const { a, b } = matmulInputs(n);
    let maxAbs = 0;
    for (let i = 0; i < n * n; i++) maxAbs = Math.max(maxAbs, Math.abs(a[i]!), Math.abs(b[i]!));
    expect(maxAbs).toBeLessThanOrEqual(6);
    expect(Number.isInteger(cpuCell(a, b, n, 3, 7))).toBe(true);
  });

  it('verifies a correct result and catches a wrong one', () => {
    const n = 32;
    const { a, b } = matmulInputs(n);
    const out = new Float32Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[r * n + c] = cpuCell(a, b, n, r, c);
    expect(verifyMatmul(a, b, out, n, 200)).toEqual({ checked: 200, wrong: 0 });
    const bad = out.slice();
    for (let i = 0; i < bad.length; i++) bad[i] = bad[i]! + 1;
    expect(verifyMatmul(a, b, bad, n, 50).wrong).toBe(50);
    expect(verifyMatmul(a, b, new Float32Array(3), n, 50)).toEqual({ checked: 0, wrong: 0 });
  });

  it('builds a shader for the requested size', () => {
    expect(matmulShader(256)).toContain('const N: u32 = 256u;');
    expect(matmulShader(256)).toContain('@workgroup_size(8, 8)');
  });
});

describe('probeWebGpu', () => {
  it('reports "not available" without navigator.gpu', async () => {
    const r = await probeWebGpu(undefined, 'main');
    expect(r.available).toBe(false);
    expect(r.adapter).toBe(false);
    expect(r.compute).toBeNull();
  });

  it('gives up on a hanging requestAdapter', async () => {
    const gpu = { requestAdapter: () => new Promise(() => {}) } as unknown as GPU;
    const r = await probeWebGpu(gpu, 'worker', { adapterTimeoutMs: 30 });
    expect(r.available).toBe(true);
    expect(r.adapterTimedOut).toBe(true);
    expect(r.adapter).toBe(false);
  });

  it('records a null adapter and a requestDevice failure without throwing', async () => {
    const noAdapter = { requestAdapter: async () => null } as unknown as GPU;
    expect((await probeWebGpu(noAdapter, 'main')).adapter).toBe(false);

    const features = new Set(['shader-f16']);
    const adapter = {
      info: { vendor: 'test-vendor', architecture: 'test-arch', description: '', device: '', isFallbackAdapter: false },
      limits: { maxBufferSize: 268435456, maxComputeInvocationsPerWorkgroup: 256 },
      features,
      requestDevice: async () => {
        throw new Error('no device for you');
      },
    };
    const r = await probeWebGpu({ requestAdapter: async () => adapter } as unknown as GPU, 'main');
    expect(r.adapter).toBe(true);
    expect(r.info).toMatchObject({ vendor: 'test-vendor', architecture: 'test-arch', isFallbackAdapter: false });
    expect(r.limits).toEqual({ maxBufferSize: 268435456, maxComputeInvocationsPerWorkgroup: 256 });
    expect(r.f16).toBe(true);
    expect(r.device).toBe(false);
    expect(r.deviceError).toBe('no device for you');
  });
});
