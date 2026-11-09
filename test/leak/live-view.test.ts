/**
 * Leak test for the live view without markers (M5 part 1; PLAN §6 M5 "10-minute memory leak
 * test"). 10 simulated minutes at 30 fps through THE TRACKER'S OWN CODE (TrackerCore +
 * FrameAnalyser + TableAnchor) with the table finder on: a slow pan over a textured "table"
 * (optical flow most frames, a full ORB match every few), a hand covering the view now and then
 * (lost → found again), the camera switching between 960 × 720 and 1280 × 960 frames, and the
 * reference photos replaced every 3,000 frames (as when the owner rescans).
 *
 * Pass: WASM memory growth after warm-up ≤ 1 %; live OpenCV objects back to 0 after every frame;
 * persistent objects back to where they started once the live view is switched off.
 *
 * LEAK_FRAMES=3000 npm run test:leak   runs a shorter version.
 */
import { describe, expect, it } from 'vitest';
import { FrameAnalyser, type PixelBuffer } from '../../src/cv/frameAnalyser';
import { wasmBytes } from '../../src/cv/loadCv';
import { cvCounters } from '../../src/cv/scope';
import { TrackerCore, type TrackerEnv } from '../../src/cv/trackerCore';
import { readVideoFrame } from '../../src/shared/frameRead';
import { getCv, type Cv } from '../helpers/cv';
import { resizeBuffer, texture } from '../helpers/images';
import { FakeFrameSource } from '../helpers/videoFrame';

const FPS = 30;
const FRAMES = Number(process.env.LEAK_FRAMES ?? 10 * 60 * FPS);
const WARMUP = Math.min(600, Math.floor(FRAMES / 4));
const MiB = 1048576;
/** The "table" photo: 2400 × 1800 px = 800 × 600 mm (3 px per mm). */
const TW = 2400;
const TH = 1800;
const PX_PER_MM = 3;

function crop(src: PixelBuffer, x: number, y: number, w: number, h: number): PixelBuffer {
  const out = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) out.set(src.data.subarray((y + r) * src.stride + x, (y + r) * src.stride + x + w), r * w);
  return { data: out, width: w, height: h, stride: w };
}

describe('10-minute live view (table finder on)', () => {
  it(`${FRAMES} frames keep memory flat and free every OpenCV object`, async () => {
    const cv: Cv = await getCv();
    const persistentAtStart = cvCounters.livePersistent;
    const table = texture(cv, TW, TH, {
      seed: 11,
      layers: [
        [48, 1],
        [12, 1],
        [3, 0.8],
        [1, 0.3],
      ],
    });
    const other = texture(cv, 960, 720, { seed: 99 });
    const refA = {
      pixels: resizeBuffer(cv, table, 1, 1280, 960, cv.INTER_AREA),
      channels: 1 as const,
      imgToTable: [TW / 1280 / PX_PER_MM, 0, 0, 0, TH / 960 / PX_PER_MM, 0, 0, 0, 1],
    };
    // The same table photographed again (another reference, as after a rescan).
    const refB = {
      pixels: resizeBuffer(cv, table, 1, 1024, 768, cv.INTER_AREA),
      channels: 1 as const,
      imgToTable: [TW / 1024 / PX_PER_MM, 0, 0, 0, TH / 768 / PX_PER_MM, 0, 0, 0, 1],
    };
    // Pre-cut frames along the pan (cutting is not what's measured).
    const pan: PixelBuffer[] = [];
    for (let k = 0; k < 60; k++) {
      const t = k / 60;
      pan.push(crop(table, Math.round(200 + 1000 * Math.abs(Math.sin(Math.PI * t))), Math.round(150 + 600 * t), 960, 720));
    }
    const panBig = pan.slice(0, 10).map((f) => resizeBuffer(cv, f, 1, 1280, 960, cv.INTER_LINEAR));

    const frames = new FakeFrameSource();
    const env: TrackerEnv = {
      readVideoFrame: (f) => readVideoFrame(f),
      createImageBitmap: async () => {
        throw new Error('not used');
      },
      makeVideoFrame: null,
      makeCanvas: null,
      now: () => performance.now(),
      nowAbs: () => performance.now(),
    };
    const analyser = new FrameAnalyser(cv, { analysisWidth: 960 });
    const core = new TrackerCore(cv, analyser, env);
    core.setRate(0);
    expect(core.setAnchor([refA])).toBeGreaterThan(500);

    let fixes = 0;
    let lost = 0;
    let flow = 0;
    let results = 0;
    let scopedViolations = 0;
    let wasmAfterWarmup = 0;
    let persistentAfterWarmup = 0;
    let persistentChanges = 0;
    const t0 = performance.now();
    for (let i = 0; i < FRAMES; i++) {
      if (i > 0 && i % 3000 === 0) core.setAnchor(i % 6000 === 0 ? [refA] : [refA, refB]);
      const covered = i % 450 >= 440;
      const big = i % 900 >= 870;
      const img = covered ? other : big ? panBig[i % panBig.length]! : pan[i % pan.length]!;
      const r = await core.processVideoFrame(frames.make(img, { timestamp: Math.round((i * 1e6) / FPS), format: 'I420' }) as unknown as VideoFrame);
      if (r) {
        results++;
        if (r.anchor) {
          fixes++;
          if (r.anchor.via === 'flow') flow++;
        } else lost++;
      }
      if (cvCounters.liveScoped !== 0) scopedViolations++;
      if (i === WARMUP - 1) {
        wasmAfterWarmup = wasmBytes(cv);
        persistentAfterWarmup = cvCounters.livePersistent;
      } else if (i >= WARMUP && i % 3000 !== 0 && cvCounters.livePersistent !== persistentAfterWarmup) persistentChanges++;
    }
    const totalMs = performance.now() - t0;
    const wasmEnd = wasmBytes(cv);
    const growth = (wasmEnd - wasmAfterWarmup) / wasmAfterWarmup;
    console.info(
      [
        `Live view leak test: ${FRAMES} frames in ${(totalMs / 1000).toFixed(1)} s (${(totalMs / FRAMES).toFixed(2)} ms per frame)`,
        `  table found in ${fixes}/${results} frames (${flow} by optical flow), not found in ${lost} (hand over the camera: ${Math.floor(FRAMES / 450) * 10} frames)`,
        `  WASM heap ${(wasmAfterWarmup / MiB).toFixed(1)} → ${(wasmEnd / MiB).toFixed(1)} MiB (${(growth * 100).toFixed(2)} %)`,
      ].join('\n'),
    );

    core.setAnchor(null);
    analyser.dispose();
    expect(results).toBe(FRAMES);
    expect(frames.open).toBe(0);
    expect(scopedViolations).toBe(0);
    expect(persistentChanges).toBe(0);
    expect(cvCounters.livePersistent).toBe(persistentAtStart);
    expect(fixes / results).toBeGreaterThan(0.9);
    expect(flow / fixes).toBeGreaterThan(0.6);
    expect(growth).toBeLessThanOrEqual(0.01);
  });
});
