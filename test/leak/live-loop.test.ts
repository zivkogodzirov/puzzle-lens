/**
 * OpenCV leak tracker (PLAN §6 M1 "Tests", §7 "10-minute live loop"; BRIEF §2).
 *
 * Simulates 10 minutes of live camera at 30 fps = 18,000 frames through THE TRACKER'S OWN CODE
 * (src/cv/trackerCore.ts, the same class tracker.worker.ts runs), with counting stand-ins for
 * VideoFrame / ImageBitmap / OffscreenCanvas:
 *   - most frames: 960×720 NV12 on the direct path (copyTo, no canvas);
 *   - every 10th: a 1920×1440 frame, which takes the "shrink on the GPU first" path
 *     (an extra ImageBitmap + VideoFrame per frame that must also be closed);
 *   - every 25th: the fallback path (an ImageBitmap from the main thread → VideoFrame);
 *   - thumbnails for reports every 3 s (another ImageBitmap + canvas);
 *   - injected failures: copyTo errors, a GPU shrink that fails, a VideoFrame that can't be made.
 * Every 300 frames a Snap is simulated with tileStats on a 1024×1024 RGBA tile.
 *
 * Pass criteria (PLAN §7): WASM memory growth after warm-up ≤ 1 %; live OpenCV objects back to
 * 0 after every frame; every frame and bitmap closed exactly once. Extra: the heap's high-water
 * mark (an 8 MiB malloc probe) must not creep up, which catches leaks too small to grow memory.
 *
 * LEAK_FRAMES=3000 npm run test:leak   runs a shorter version.
 */
import { describe, expect, it } from 'vitest';
import { FrameAnalyser } from '../../src/cv/frameAnalyser';
import { wasmBytes } from '../../src/cv/loadCv';
import { tileStats } from '../../src/cv/photoAnalysis';
import { cvCounters } from '../../src/cv/scope';
import { TrackerCore, type TrackerEnv } from '../../src/cv/trackerCore';
import { readVideoFrame } from '../../src/shared/frameRead';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import { getCv, type Cv } from '../helpers/cv';
import { grayToRgba, markerFrame, maxCornerError, resizeBuffer, texture, type ExpectedMarker } from '../helpers/images';
import { FakeFrameSource, type FakeVideoFrame } from '../helpers/videoFrame';

const FPS = 30;
const FRAMES = Number(process.env.LEAK_FRAMES ?? 10 * 60 * FPS); // 18,000
const W = 960;
const H = 720;
const STRIDE = 1024; // padded rows, like real camera frames
const WARMUP = Math.min(600, Math.floor(FRAMES / 4));
const SNAP_EVERY = 300;
const BIG_EVERY = 10;
const BITMAP_EVERY = 25;
/** Failure injection (primes, so they hit different paths over the run). */
const FAIL_COPY_EVERY = 997;
const FAIL_SHRINK_EVERY = 1009; // checked on big frames only
const FAIL_WRAP_EVERY = 1013; // checked on big frames only
const MARKER_ID = 7;
const MiB = 1048576;

/** Address of a fresh 8 MiB block = lowest place with 8 MiB free: rises if memory leaks. */
function heapHighWater(cv: Cv): number {
  const p = cv._malloc(8 * MiB) as number;
  cv._free(p);
  return p;
}

/** Stand-in ImageBitmap: knows its grey pixels (so it can become a frame) and counts closes. */
class FakeBitmap {
  closed = false;
  constructor(
    readonly luma: PixelBuffer,
    private readonly owner: FakeBitmaps,
  ) {}
  get width(): number {
    return this.luma.width;
  }
  get height(): number {
    return this.luma.height;
  }
  close(): void {
    if (this.closed) {
      this.owner.doubleClosed++;
      return;
    }
    this.closed = true;
    this.owner.open--;
  }
}

class FakeBitmaps {
  created = 0;
  open = 0;
  doubleClosed = 0;
  make(luma: PixelBuffer): FakeBitmap {
    this.created++;
    this.open++;
    return new FakeBitmap(luma, this);
  }
}

interface Sample {
  frame: number;
  simulatedMin: number;
  wasmMiB: number;
  highWaterMiB: number;
  jsHeapMiB: number;
  msPerFrame: number;
}

describe('10-minute live loop', () => {
  it(`${FRAMES} frames (${(FRAMES / FPS / 60).toFixed(1)} simulated minutes) through TrackerCore keep memory flat and close every frame`, async () => {
    const cv = await getCv();
    const persistentAtStart = cvCounters.livePersistent;

    // 8 small frames: the marker drifts a few pixels per frame (hand-held phone); in the last one
    // it is covered, like a hand passing over it. Plus one big frame with a known marker.
    const small: Array<{ image: PixelBuffer; expected: ExpectedMarker[] }> = [];
    for (let k = 0; k < 8; k++) {
      const markers = [{ id: 3, x: 72, y: 66, side: 96 }];
      if (k < 7) markers.push({ id: MARKER_ID, x: 380 + 3 * k, y: 260 + 2 * k, side: 120 });
      small.push(markerFrame(cv, W, H, markers, { seed: 100 + k }));
    }
    const big = markerFrame(cv, 2 * W, 2 * H, [{ id: MARKER_ID, x: 760, y: 520, side: 240 }], { seed: 200 });
    const bigShrunk = resizeBuffer(cv, big.image, 1, W, H, cv.INTER_AREA);
    const tiles = [grayToRgba(cv, texture(cv, 1024, 1024, { seed: 1 })), grayToRgba(cv, texture(cv, 1024, 1024, { seed: 2 }))];

    const frames = new FakeFrameSource();
    const bitmaps = new FakeBitmaps();
    let canvases = 0;
    let thumbsMade = 0;
    let simulatedNow = 0;
    let failNextShrink = false;
    let failNextWrap = false;

    const env: TrackerEnv = {
      readVideoFrame: (f) => readVideoFrame(f),
      async createImageBitmap(src, opts) {
        if (failNextShrink) {
          failNextShrink = false;
          throw new DOMException('simulated GPU shrink failure', 'InvalidStateError');
        }
        const s = src as unknown as FakeVideoFrame | FakeBitmap;
        if ((s as FakeVideoFrame).closed === true) throw new DOMException('source is closed', 'InvalidStateError');
        // Shrinking the big frame → the pre-shrunk copy; thumbnails → any small picture.
        const w = opts.resizeWidth ?? 0;
        if (w === W && (s as FakeVideoFrame).displayWidth === 2 * W) return bitmaps.make(bigShrunk) as unknown as ImageBitmap;
        return bitmaps.make({ data: new Uint8Array(w * Math.round((w * 3) / 4)), width: w, height: Math.round((w * 3) / 4), stride: w }) as unknown as ImageBitmap;
      },
      makeVideoFrame(bmp, timestamp) {
        if (failNextWrap) {
          failNextWrap = false;
          throw new TypeError('simulated VideoFrame construction failure');
        }
        return frames.make((bmp as unknown as FakeBitmap).luma, { timestamp }) as unknown as VideoFrame;
      },
      makeCanvas(w, h) {
        canvases++;
        return {
          width: w,
          height: h,
          getContext: () => ({ drawImage() {} }),
          convertToBlob: async () => {
            thumbsMade++;
            return new Blob([new Uint8Array(64)], { type: 'image/jpeg' });
          },
        } as unknown as OffscreenCanvas;
      },
      now: () => performance.now(),
      // Simulated wall clock: 1/30 s per frame, so thumbnails come every 90 frames like on the phone.
      nowAbs: () => simulatedNow,
    };

    const analyser = new FrameAnalyser(cv, { analysisWidth: 960 });
    const core = new TrackerCore(cv, analyser, env);
    core.setRate(0);

    let found = 0;
    let results = 0;
    let bigResults = 0;
    let worstBigCornerErr = 0;
    let snaps = 0;
    let scopedViolations = 0;
    let firstScopedViolation = -1;
    let persistentChanges = 0;
    let wasmAfterWarmup = 0;
    let highWaterAfterWarmup = 0;
    let persistentAfterWarmup = 0;
    let expectedErrors = 0;
    let bitmapPathFrames = 0;
    const samples: Sample[] = [];

    const t0 = performance.now();
    let tBlock = t0;
    for (let i = 0; i < FRAMES; i++) {
      simulatedNow = (i * 1000) / FPS;
      const timestamp = Math.round((i * 1e6) / FPS);
      let r;
      if (i % BITMAP_EVERY === BITMAP_EVERY - 1) {
        // Fallback path: the main thread sent a bitmap.
        bitmapPathFrames++;
        r = await core.processBitmap(bitmaps.make(small[i % small.length]!.image) as unknown as ImageBitmap, timestamp);
      } else if (i % BIG_EVERY === BIG_EVERY - 1) {
        const n = Math.floor(i / BIG_EVERY);
        if (n % FAIL_SHRINK_EVERY === FAIL_SHRINK_EVERY - 1) {
          failNextShrink = true;
          expectedErrors++;
        } else if (n % FAIL_WRAP_EVERY === FAIL_WRAP_EVERY - 1) {
          failNextWrap = true;
          expectedErrors++;
        }
        r = await core.processVideoFrame(frames.make(big.image, { timestamp, stride: 2 * STRIDE }) as unknown as VideoFrame);
        if (r) {
          bigResults++;
          const hit = r.markers.find((m) => m.id === MARKER_ID);
          if (hit) worstBigCornerErr = Math.max(worstBigCornerErr, maxCornerError(hit.corners, big.expected[0]!.corners));
          expect(r.width).toBe(2 * W);
          expect(r.format).toContain('→scaled');
        }
      } else {
        const failCopy = i % FAIL_COPY_EVERY === FAIL_COPY_EVERY - 1;
        if (failCopy) expectedErrors++;
        r = await core.processVideoFrame(frames.make(small[i % small.length]!.image, { timestamp, stride: STRIDE, failCopy }) as unknown as VideoFrame);
      }
      if (r) {
        results++;
        if (r.markers.some((m) => m.id === MARKER_ID)) found++;
      }
      if (cvCounters.liveScoped !== 0) {
        scopedViolations++;
        if (firstScopedViolation < 0) firstScopedViolation = i;
      }

      if (i % SNAP_EVERY === SNAP_EVERY - 1) {
        const s = tileStats(cv, tiles[snaps % 2]!);
        expect(s.pixels).toBe(1024 * 1024);
        snaps++;
        if (cvCounters.liveScoped !== 0) scopedViolations++;
      }

      if (i === WARMUP - 1) {
        wasmAfterWarmup = wasmBytes(cv);
        highWaterAfterWarmup = heapHighWater(cv);
        persistentAfterWarmup = cvCounters.livePersistent;
      } else if (i >= WARMUP && cvCounters.livePersistent !== persistentAfterWarmup) {
        persistentChanges++;
      }

      if ((i + 1) % 1800 === 0 || i === FRAMES - 1) {
        const now = performance.now();
        const n = (i % 1800) + 1;
        samples.push({
          frame: i + 1,
          simulatedMin: Number(((i + 1) / FPS / 60).toFixed(1)),
          wasmMiB: Number((wasmBytes(cv) / MiB).toFixed(1)),
          highWaterMiB: Number((heapHighWater(cv) / MiB).toFixed(2)),
          jsHeapMiB: Number((process.memoryUsage().heapUsed / MiB).toFixed(1)),
          msPerFrame: Number(((now - tBlock) / n).toFixed(2)),
        });
        tBlock = now;
      }
    }
    // Let any thumbnail promise settle.
    await new Promise((r) => setTimeout(r, 0));
    const totalMs = performance.now() - t0;
    const wasmEnd = wasmBytes(cv);
    const highWaterEnd = heapHighWater(cv);
    analyser.dispose();

    const growth = (wasmEnd - wasmAfterWarmup) / wasmAfterWarmup;
    const report = [
      `Leak test: ${FRAMES} frames through TrackerCore (${W}×${H}, every ${BIG_EVERY}th ${2 * W}×${2 * H}, every ${BITMAP_EVERY}th via bitmap) + ${snaps} Snap tiles in ${(totalMs / 1000).toFixed(1)} s`,
      `  ${(totalMs / FRAMES).toFixed(2)} ms per frame on ${process.platform}/${process.arch} (budget on the phone: 25 ms)`,
      `  WASM heap: ${(wasmAfterWarmup / MiB).toFixed(1)} MiB after warm-up → ${(wasmEnd / MiB).toFixed(1)} MiB (${(growth * 100).toFixed(2)} %)`,
      `  heap high-water: ${((highWaterEnd - highWaterAfterWarmup) / MiB).toFixed(3)} MiB change after warm-up`,
      `  frames: created ${frames.created}, closed ${frames.closed}, double-closed ${frames.doubleClosed}; bitmaps: created ${bitmaps.created}, open ${bitmaps.open}, double-closed ${bitmaps.doubleClosed}`,
      `  errors ${core.counters.errors} (expected ${expectedErrors}); thumbnails ${thumbsMade} (canvases ${canvases}); big-frame worst corner error ${worstBigCornerErr.toFixed(2)} px`,
      `  marker ${MARKER_ID} found in ${found}/${results} results; live persistent OpenCV objects ${persistentAfterWarmup}`,
    ].join('\n');
    console.info(`\n${report}`);
    console.table(samples);

    // Every frame and bitmap closed exactly once — including the ones the tracker made itself.
    expect(frames.open).toBe(0);
    expect(frames.openFrames.size).toBe(0);
    expect(frames.closed).toBe(frames.created);
    expect(frames.doubleClosed).toBe(0);
    expect(bitmaps.open).toBe(0);
    expect(bitmaps.doubleClosed).toBe(0);
    expect(core.counters.openFrames).toBe(0);
    expect(core.counters.openBitmaps).toBe(0);
    expect(core.memory().openFrames).toBe(0);
    // Big frames made an extra bitmap + frame each, fallback frames a VideoFrame each.
    expect(bitmaps.created).toBeGreaterThanOrEqual(Math.floor(FRAMES / BIG_EVERY) * 0.9 + bitmapPathFrames);

    // Failures were counted, and every other frame produced a result.
    expect(core.counters.errors).toBe(expectedErrors);
    expect(core.counters.received).toBe(FRAMES);
    expect(results).toBe(FRAMES - expectedErrors);
    expect(core.consecutiveErrors).toBe(0);
    expect(found / results).toBeGreaterThan(0.8);
    expect(bigResults).toBeGreaterThan(0);
    expect(worstBigCornerErr).toBeLessThanOrEqual(1);
    expect(thumbsMade).toBeGreaterThanOrEqual(Math.floor(FRAMES / 90) - 2);
    expect(snaps).toBe(Math.floor(FRAMES / SNAP_EVERY));

    // OpenCV objects: scoped back to 0 after every frame and Snap; persistent constant.
    expect(scopedViolations, `liveScoped ≠ 0 first after frame ${firstScopedViolation}`).toBe(0);
    expect(cvCounters.liveScoped).toBe(0);
    expect(persistentChanges).toBe(0);
    expect(cvCounters.livePersistent).toBe(persistentAtStart);

    // Memory flat after warm-up.
    expect(growth).toBeLessThanOrEqual(0.01);
    expect(highWaterEnd - highWaterAfterWarmup).toBeLessThanOrEqual(1 * MiB);
  });
});
