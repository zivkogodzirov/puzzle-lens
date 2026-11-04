/**
 * src/cv/scope.ts (every OpenCV object gets freed, even on errors) and
 * src/shared/frameRead.ts (camera frame → pixels via VideoFrame.copyTo, no canvas).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { cvCounters, CvScope, freePersistent, persistent, withScope } from '../../src/cv/scope';
import { readVideoFrame } from '../../src/shared/frameRead';
import { getCv, type Cv } from '../helpers/cv';
import { FakeFrameSource } from '../helpers/videoFrame';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';

let cv: Cv;

beforeAll(async () => {
  cv = await getCv();
});

describe('CvScope / withScope', () => {
  it('frees everything registered, newest first, and counts it', () => {
    const order: string[] = [];
    const fake = (name: string) => ({ delete: () => order.push(name) });
    const before = { ...cvCounters };
    const value = withScope((s) => {
      s.keep(fake('a'));
      s.keep(fake('b'));
      expect(cvCounters.liveScoped).toBe(before.liveScoped + 2);
      return s.keep(fake('c')) && 42;
    });
    expect(value).toBe(42);
    expect(order).toEqual(['c', 'b', 'a']);
    expect(cvCounters.liveScoped).toBe(before.liveScoped);
    expect(cvCounters.createdScoped).toBe(before.createdScoped + 3);
  });

  it('frees real Mats even when the work throws (including an OpenCV error)', () => {
    let mat: { isDeleted(): boolean } | null = null;
    expect(() =>
      withScope((s) => {
        mat = s.keep(new cv.Mat(10, 10, cv.CV_8UC1));
        const empty = s.keep(new cv.Mat());
        cv.cvtColor(empty, s.keep(new cv.Mat()), cv.COLOR_RGBA2GRAY); // throws: empty input
      }),
    ).toThrow();
    expect(mat!.isDeleted()).toBe(true);
    expect(cvCounters.liveScoped).toBe(0);
  });

  it('skips objects that were already deleted and survives delete() throwing', () => {
    const s = new CvScope();
    const m = s.keep(new cv.Mat(2, 2, cv.CV_8UC1));
    m.delete(); // freed early by hand
    s.keep({
      delete() {
        throw new Error('boom');
      },
    });
    expect(() => s.release()).not.toThrow();
    expect(cvCounters.liveScoped).toBe(0);
    s.release(); // releasing twice is harmless
    expect(cvCounters.liveScoped).toBe(0);
  });

  it('persistent / freePersistent keep their own count', () => {
    const before = cvCounters.livePersistent;
    const m = persistent(new cv.Mat(4, 4, cv.CV_8UC1));
    expect(cvCounters.livePersistent).toBe(before + 1);
    freePersistent(m);
    expect(m.isDeleted()).toBe(true);
    expect(cvCounters.livePersistent).toBe(before);
    freePersistent(null);
    freePersistent(undefined);
    expect(cvCounters.livePersistent).toBe(before);
  });
});

describe('readVideoFrame', () => {
  const luma: PixelBuffer = { data: Uint8Array.from({ length: 64 * 48 }, (_, i) => i % 251), width: 64, height: 48, stride: 64 };

  it('NV12: returns the luma plane with the frame\'s own (padded) row stride', async () => {
    const src = new FakeFrameSource();
    const f = src.make(luma, { timestamp: 0, stride: 80 });
    const r = await readVideoFrame(f as unknown as VideoFrame);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('gray');
    expect(r!.format).toBe('NV12');
    expect(r!.buffer.width).toBe(64);
    expect(r!.buffer.height).toBe(48);
    expect(r!.buffer.stride).toBe(80);
    for (const y of [0, 17, 47]) {
      expect(Array.from(r!.buffer.data.subarray(y * 80, y * 80 + 64))).toEqual(Array.from(luma.data.subarray(y * 64, y * 64 + 64)));
    }
    expect(r!.copyMs).toBeGreaterThanOrEqual(0);
    f.close();
    expect(src.open).toBe(0);
  });

  it('a sub-rectangle is copied when asked for', async () => {
    const src = new FakeFrameSource();
    const f = src.make(luma, { timestamp: 0 });
    const r = await readVideoFrame(f as unknown as VideoFrame, { x: 8, y: 4, width: 16, height: 10 });
    expect(r!.buffer.width).toBe(16);
    expect(r!.buffer.height).toBe(10);
    expect(r!.buffer.data[0]).toBe(luma.data[4 * 64 + 8]);
    f.close();
  });

  it('an opaque frame (format null) or an unknown format gives null', async () => {
    const src = new FakeFrameSource();
    const opaque = src.make(luma, { timestamp: 0, format: null });
    expect(await readVideoFrame(opaque as unknown as VideoFrame)).toBeNull();
    opaque.close();
    const odd = src.make(luma, { timestamp: 0, format: 'P010' });
    expect(await readVideoFrame(odd as unknown as VideoFrame)).toBeNull();
    odd.close();
    expect(src.open).toBe(0);
  });

  it('RGBA / BGRA frames are returned as 4-channel pixels of the right order', async () => {
    const rgbaFrame = (format: string) => ({
      format,
      codedWidth: 4,
      codedHeight: 2,
      visibleRect: { x: 0, y: 0, width: 4, height: 2 },
      allocationSize: () => 4 * 2 * 4,
      copyTo: async (dest: Uint8Array) => {
        dest.fill(7);
        return [{ offset: 0, stride: 16 }];
      },
    });
    for (const [format, kind] of [
      ['RGBA', 'rgba'],
      ['RGBX', 'rgba'],
      ['BGRA', 'bgra'],
      ['BGRX', 'bgra'],
    ] as const) {
      const r = await readVideoFrame(rgbaFrame(format) as unknown as VideoFrame);
      expect(r?.kind, format).toBe(kind);
      expect(r!.buffer).toMatchObject({ width: 4, height: 2, stride: 16 });
    }
  });

  it('a failing copy rejects (the caller\'s finally must still close the frame)', async () => {
    const src = new FakeFrameSource();
    const f = src.make(luma, { timestamp: 0, failCopy: true });
    try {
      await expect(readVideoFrame(f as unknown as VideoFrame)).rejects.toThrow(/copyTo/);
    } finally {
      f.close();
    }
    expect(src.closed).toBe(1);
  });
});
