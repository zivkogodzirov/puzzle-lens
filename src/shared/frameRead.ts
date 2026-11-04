/**
 * Getting pixels out of a VideoFrame without a canvas. Canvas readback can be noise-injected by
 * Safari's fingerprinting protection, so camera frames are copied with VideoFrame.copyTo
 * (RESEARCH §3). Worker-safe.
 */
import type { PixelBuffer } from '../cv/frameAnalyser';

export interface ReadFrame {
  kind: 'gray' | 'rgba' | 'bgra';
  buffer: PixelBuffer;
  format: string | null;
  copyMs: number;
}

/**
 * 8-bit YUV formats whose first plane is the grey (luma) image. 10-bit formats (I420P10…) are left
 * out on purpose: their samples are 16-bit, so they return null and take the canvas/GPU path.
 */
const LUMA_FORMATS = new Set(['NV12', 'I420', 'I420A', 'I422', 'I444', 'NV12A']);
const RGBA_FORMATS = new Set(['RGBA', 'RGBX']);
const BGRA_FORMATS = new Set(['BGRA', 'BGRX']);

/** Reusable scratch buffer so we don't allocate megabytes per frame. */
let scratch: Uint8Array | null = null;

function scratchOf(size: number): Uint8Array {
  if (!scratch || scratch.byteLength < size) scratch = new Uint8Array(size);
  return scratch;
}

/**
 * Copies the frame (or a rectangle of it) and returns either its luma plane (YUV formats) or its
 * 4-channel pixels. Returns null if the browser gives an opaque frame (format === null).
 * The returned buffer is only valid until the next call.
 */
export async function readVideoFrame(frame: VideoFrame, rect?: { x: number; y: number; width: number; height: number }): Promise<ReadFrame | null> {
  const format = frame.format;
  if (!format) return null;
  const t0 = performance.now();
  const options = rect ? { rect } : undefined;
  const size = frame.allocationSize(options);
  const buf = scratchOf(size);
  const view = buf.subarray(0, size);
  const layout = await frame.copyTo(view, options);
  const w = rect?.width ?? frame.visibleRect?.width ?? frame.codedWidth;
  const h = rect?.height ?? frame.visibleRect?.height ?? frame.codedHeight;
  const plane0 = layout[0];
  if (!plane0) return null;
  const copyMs = performance.now() - t0;
  if (LUMA_FORMATS.has(format)) {
    return { kind: 'gray', format, copyMs, buffer: { data: view.subarray(plane0.offset), width: w, height: h, stride: plane0.stride } };
  }
  if (RGBA_FORMATS.has(format) || BGRA_FORMATS.has(format)) {
    return {
      kind: RGBA_FORMATS.has(format) ? 'rgba' : 'bgra',
      format,
      copyMs,
      buffer: { data: view.subarray(plane0.offset), width: w, height: h, stride: plane0.stride },
    };
  }
  return null;
}
