/** Capability probe that runs inside a worker (Device check: "what can a background worker do?"). */
import type { WorkerCapabilities } from './types';

export async function probeWorkerCapabilities(): Promise<WorkerCapabilities> {
  const g = globalThis as unknown as Record<string, unknown> & { navigator?: { gpu?: { requestAdapter(): Promise<unknown> } } };
  const has = (name: string) => typeof g[name] !== 'undefined';
  const ctx = (type: string) => {
    try {
      if (!has('OffscreenCanvas')) return false;
      const C = g.OffscreenCanvas as new (w: number, h: number) => { getContext(t: string): unknown };
      return new C(4, 4).getContext(type) != null;
    } catch {
      return false;
    }
  };
  let webgpu = false;
  try {
    if (g.navigator?.gpu) {
      const adapter = await Promise.race([g.navigator.gpu.requestAdapter(), new Promise((r) => setTimeout(() => r(null), 3000))]);
      webgpu = adapter != null;
    }
  } catch {
    webgpu = false;
  }
  return {
    mediaStreamTrackProcessor: has('MediaStreamTrackProcessor'),
    videoFrame: has('VideoFrame'),
    offscreenCanvas2d: ctx('2d'),
    offscreenCanvasWebgl: ctx('webgl'),
    offscreenCanvasWebgl2: ctx('webgl2'),
    createImageBitmap: has('createImageBitmap'),
    webgpu,
    indexedDb: has('indexedDB'),
  };
}
