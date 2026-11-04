/// <reference lib="webworker" />
/**
 * PROBE worker (Device check only): what can a background worker do on this iPhone?
 * Capabilities (incl. a real createImageBitmap / VideoFrame.copyTo), the canvas-noise probe in an
 * OffscreenCanvas and via VideoFrame.copyTo, and the WebGPU self-test. No OpenCV here, so it
 * starts in milliseconds. Started and terminated by src/device/probeClient.ts.
 */
import * as Comlink from 'comlink';
import { probeWorkerCapabilities } from '../shared/workerCaps';
import type { NoiseResult, ProbeApi, ProbeWorkerCaps } from '../shared/probeApi';
import { compareNoisePattern, drawNoisePattern, NOISE_H, NOISE_W } from '../device/noise';
import { probeWebGpu } from '../device/gpuTest';
import { detectWasmFeatures } from '../device/wasmFeatures';
import { errorMessage } from '../device/util';

function offscreen2d(): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  const canvas = new OffscreenCanvas(NOISE_W, NOISE_H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D drawing in this worker');
  return { canvas, ctx };
}

const api: ProbeApi = {
  async capabilities(): Promise<ProbeWorkerCaps> {
    const errors: Record<string, string> = {};
    const base = await probeWorkerCapabilities();
    let createImageBitmapWorks = false;
    let createImageBitmapFromBlob = false;
    let offscreenConvertToBlob = false;
    let videoFrameCopyTo = false;

    try {
      const bmp = await createImageBitmap(new ImageData(2, 2));
      createImageBitmapWorks = bmp.width === 2 && bmp.height === 2;
      bmp.close();
    } catch (err) {
      errors.createImageBitmap = errorMessage(err);
    }

    try {
      const canvas = new OffscreenCanvas(8, 6);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No 2D context');
      ctx.fillStyle = 'rgb(220, 40, 40)';
      ctx.fillRect(0, 0, 8, 6);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      offscreenConvertToBlob = blob.size > 0;
      const bmp = await createImageBitmap(blob);
      createImageBitmapFromBlob = bmp.width === 8 && bmp.height === 6;
      bmp.close();
    } catch (err) {
      errors.jpegRoundTrip = errorMessage(err);
    }

    if (typeof VideoFrame !== 'undefined') {
      let bmp: ImageBitmap | null = null;
      let frame: VideoFrame | null = null;
      try {
        bmp = await createImageBitmap(new ImageData(4, 4));
        frame = new VideoFrame(bmp, { timestamp: 0 });
        const buf = new Uint8Array(frame.allocationSize());
        await frame.copyTo(buf);
        videoFrameCopyTo = true;
      } catch (err) {
        errors.videoFrameCopyTo = errorMessage(err);
      } finally {
        frame?.close();
        bmp?.close();
      }
    }

    const hc = (self.navigator as WorkerNavigator | undefined)?.hardwareConcurrency;
    return {
      ...base,
      createImageBitmapWorks,
      createImageBitmapFromBlob,
      offscreenConvertToBlob,
      videoFrameCopyTo,
      wasm: detectWasmFeatures(),
      hardwareConcurrency: typeof hc === 'number' ? hc : null,
      errors,
    };
  },

  async canvasNoise(): Promise<NoiseResult[]> {
    const out: NoiseResult[] = [];

    // 1. OffscreenCanvas → getImageData (what canvas-based photo reading would see).
    let t0 = performance.now();
    try {
      const { ctx } = offscreen2d();
      drawNoisePattern(ctx);
      const img = ctx.getImageData(0, 0, NOISE_W, NOISE_H);
      out.push({ method: 'offscreen-worker', comparison: compareNoisePattern(img.data, NOISE_W, NOISE_H, NOISE_W * 4, 'RGBA'), ms: performance.now() - t0 });
    } catch (err) {
      out.push({ method: 'offscreen-worker', comparison: null, error: errorMessage(err), ms: performance.now() - t0 });
    }

    // 2. The same drawing read through VideoFrame.copyTo (how the app reads camera frames and photos).
    t0 = performance.now();
    if (typeof VideoFrame === 'undefined') {
      out.push({ method: 'videoframe-worker', comparison: null, error: 'VideoFrame is not available in workers', ms: 0 });
    } else {
      let bmp: ImageBitmap | null = null;
      let frame: VideoFrame | null = null;
      try {
        const { canvas, ctx } = offscreen2d();
        drawNoisePattern(ctx);
        bmp = canvas.transferToImageBitmap();
        frame = new VideoFrame(bmp, { timestamp: 0 });
        const format = frame.format;
        if (!format) throw new Error('The browser gave an opaque frame (no pixel format)');
        const order = format === 'RGBA' || format === 'RGBX' ? 'RGBA' : format === 'BGRA' || format === 'BGRX' ? 'BGRA' : null;
        if (!order) {
          out.push({ method: 'videoframe-worker', comparison: null, format, error: `Frame format ${format} can't be compared`, ms: performance.now() - t0 });
        } else {
          const buf = new Uint8Array(frame.allocationSize());
          const layout = await frame.copyTo(buf);
          const plane = layout[0];
          const offset = plane?.offset ?? 0;
          const stride = plane?.stride ?? NOISE_W * 4;
          const cmp = compareNoisePattern(buf.subarray(offset), frame.codedWidth, frame.codedHeight, stride, order);
          out.push({ method: 'videoframe-worker', comparison: cmp, format, ms: performance.now() - t0 });
        }
      } catch (err) {
        out.push({ method: 'videoframe-worker', comparison: null, error: errorMessage(err), ms: performance.now() - t0 });
      } finally {
        frame?.close();
        bmp?.close();
      }
    }
    return out;
  },

  async webgpu() {
    const gpu = (self.navigator as (WorkerNavigator & { gpu?: GPU }) | undefined)?.gpu;
    return probeWebGpu(gpu, 'worker');
  },
};

Comlink.expose(api);
