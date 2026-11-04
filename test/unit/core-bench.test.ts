/**
 * The OpenCV speed benchmark (src/cv/bench.ts) that the Device check runs on the phone.
 * Running it here gives the Mac baseline for the phone-to-Mac speed factor (PLAN §8).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeBenchImage, runCvBench } from '../../src/cv/bench';
import { cvLoadMs, wasmBytes } from '../../src/cv/loadCv';
import { cvCounters, withScope } from '../../src/cv/scope';
import { getCv, type Cv } from '../helpers/cv';
import { FrameAnalyser } from '../../src/cv/frameAnalyser';

let cv: Cv;

beforeAll(async () => {
  cv = await getCv();
});

const EXPECTED_STAGES = [
  'Colour → grey',
  'Blur 5×5',
  'Threshold (Otsu)',
  'Morphology open',
  'Find outlines',
  'Perspective warp',
  'Live frame (shrink + markers + sharpness)',
  'Optical flow (200 points)',
  'Photo shrink 12 MP → ¼',
  'Photo sharpness 12 MP',
];

describe('runCvBench', () => {
  it('runs every stage, each taking measurable time, and leaks nothing', () => {
    const persistentBefore = cvCounters.livePersistent;
    const r = runCvBench(cv, cvLoadMs());
    expect(r.stages.map((s) => s.name)).toEqual(EXPECTED_STAGES);
    for (const s of r.stages) {
      expect(Number.isFinite(s.ms), s.name).toBe(true);
      expect(s.ms, s.name).toBeGreaterThan(0);
      expect(s.size, s.name).toMatch(/\d+×\d+/);
    }
    expect(r.loadMs).toBe(cvLoadMs());
    expect(r.wasmBytesAfter).toBe(wasmBytes(cv));
    expect(cvCounters.liveScoped).toBe(0);
    expect(cvCounters.livePersistent).toBe(persistentBefore);

    // Mac baseline, printed for the phone-to-Mac speed factor (run with --silent=false to see it
    // when Vitest's minimal reporter hides logs of passing tests).
    const table = r.stages.map((s) => ({ stage: s.name, size: s.size, ms: Number(s.ms.toFixed(2)) }));
    const text = [
      `OpenCV benchmark on ${process.platform}/${process.arch}, Node ${process.version}`,
      `load ${r.loadMs.toFixed(1)} ms, WASM heap ${(r.wasmBytesAfter / 1048576).toFixed(0)} MiB`,
      ...table.map((t) => `${t.stage.padEnd(44)} ${t.size.padEnd(12)} ${t.ms.toFixed(2).padStart(9)} ms`),
    ].join('\n');
    console.info(`\n${text}\n`);
  });

  it('the bench image contains a findable marker (so the live-frame stage does real work)', () => {
    const analyser = new FrameAnalyser(cv);
    try {
      const ids = withScope((s) => {
        const img = makeBenchImage(cv, 1920, 1080, s);
        const data = new Uint8Array(img.data as Uint8Array);
        return analyser.analyseGray({ data, width: 1920, height: 1080, stride: 1920 }).markers.map((m) => m.id);
      });
      expect(ids).toEqual([7]);
    } finally {
      analyser.dispose();
    }
    expect(cvCounters.liveScoped).toBe(0);
  });
});
