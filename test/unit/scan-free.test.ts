/**
 * Marker-free capture: live piece statistics (src/cv/frameAnalyser.ts pieceStats) on simulated
 * frames, and the gauge logic (src/scan/autoCapture.ts FreeCapture).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getCv, counters, type Cv } from '../helpers/cv';
import { generatePuzzle, renderScene } from '../synth/index';
import { FrameAnalyser } from '../../src/cv/frameAnalyser';
import { FreeCapture, pxPerMmFromPieces, type FreeInput } from '../../src/scan/autoCapture';
import { toGray } from '../../src/cv/tableSetup';

let cv: Cv;
beforeAll(async () => {
  cv = await getCv();
});

describe('live piece statistics (no markers)', () => {
  it('measures piece size well enough for the height gauge', async () => {
    const puzzle = generatePuzzle({ cols: 10, rows: 8, cellMm: [17.8, 19.4], seed: 5 });
    for (const heightMm of [700, 500]) {
      const scene = await renderScene({ puzzle, seed: 9, markers: [], layout: { areaMm: [600, 450], originMm: [100, 80] }, camera: { x: 400, y: 305, heightMm, tiltDeg: 2, imageSize: [4032, 3024] } });
      const gray = toGray(cv, { data: scene.rgba, width: scene.width, height: scene.height, stride: scene.width * 4 });
      const a = new FrameAnalyser(cv, { analysisWidth: 960 });
      a.pieceStats = true;
      const before = counters().liveScoped;
      const r = a.analyseGray(gray);
      expect(counters().liveScoped).toBe(before);
      a.dispose();
      const p = r.pieces!;
      const visible = scene.truth.pieces.filter((q) => q.visibleShare > 0.99 && !q.faceDown).length;
      expect(p.count, `height ${heightMm}`).toBeGreaterThan(0.6 * visible);
      const ppm = pxPerMmFromPieces(p.medianAreaPx, Math.sqrt(17.8 * 19.4))!;
      // Within 20 % of the truth: enough to say "lower" / "higher".
      expect(Math.abs(ppm / scene.truth.pxPerMm - 1), `height ${heightMm}: ${ppm} vs ${scene.truth.pxPerMm}`).toBeLessThan(0.2);
    }
  }, 120_000);
});

describe('marker-free gauge', () => {
  const frame = { width: 4032, height: 3024 };
  const pitch = 18.6;
  // ~4 px/mm: a piece of 18.6 mm ≈ 74 px → area ≈ 5500 px².
  const pieces = (over: Partial<NonNullable<FreeInput['pieces']>> = {}): FreeInput['pieces'] => ({ count: 40, medianAreaPx: 5500, atEdge: 0, bbox: [500, 400, 3500, 2600], ...over });
  const ctx = { kind: 'overview' as const, pitchMm: pitch, sensor: true };

  it('fires once flat, high enough, everything in view and still', () => {
    const fc = new FreeCapture();
    const s = [0, 200, 460].map((t) => fc.update(t, { tiltDeg: 2, pieces: pieces(), frame }, ctx));
    expect(s.map((x) => x.status)).toEqual(['hold-still', 'hold-still', 'ready']);
    expect(s[2]!.heightMm).toBeGreaterThan(500);
    expect(s[2]!.heightMm).toBeLessThan(900);
  });

  it('says one thing at a time', () => {
    const fc = new FreeCapture();
    expect(fc.update(0, { tiltDeg: 12, pieces: pieces(), frame }, ctx).status).toBe('tilted');
    expect(fc.update(0, { tiltDeg: 1, pieces: null, frame }, ctx).status).toBe('no-markers');
    expect(fc.update(0, { tiltDeg: 1, pieces: pieces({ medianAreaPx: 1500 }), frame }, ctx).status).toBe('too-high');
    expect(fc.update(0, { tiltDeg: 1, pieces: pieces({ atEdge: 2 }), frame }, ctx).status).toBe('area-out');
    // Close-ups may cut pieces off; they need ~2× the size.
    expect(fc.update(0, { tiltDeg: 1, pieces: pieces({ atEdge: 2 }), frame }, { ...ctx, kind: 'detail' }).status).toBe('too-high');
    expect(fc.update(0, { tiltDeg: 1, pieces: pieces({ atEdge: 2, medianAreaPx: 24000 }), frame }, { ...ctx, kind: 'detail' }).status).toBe('hold-still');
  });

  it('a moving picture restarts the wait; without the sensor tilt is not checked', () => {
    const fc = new FreeCapture();
    const s = [0, 150, 300, 450, 600].map((t, i) => fc.update(t, { tiltDeg: 1, pieces: pieces({ bbox: [500 + (i === 2 ? 80 : 0), 400, 3500, 2600] }), frame }, ctx));
    expect(s.some((x) => x.status === 'ready')).toBe(false);
    const fc2 = new FreeCapture();
    const s2 = [0, 500].map((t) => fc2.update(t, { tiltDeg: null, pieces: pieces(), frame }, { ...ctx, sensor: false }));
    expect(s2[1]!.status).toBe('ready');
  });
});

describe('marker-free gauge after a photo', () => {
  const frame = { width: 4032, height: 3024 };
  const ctx = { kind: 'detail' as const, pitchMm: 18.6, sensor: true };
  const at = (x: number): FreeInput['pieces'] => ({ count: 30, medianAreaPx: 24000, atEdge: 0, bbox: [x, 400, x + 2000, 2600] });

  it('does not take the same spot twice; moving on re-arms it', () => {
    const fc = new FreeCapture();
    expect([0, 500].map((t) => fc.update(t, { tiltDeg: 1, pieces: at(500), frame }, ctx).status)[1]).toBe('ready');
    fc.noteFired(500);
    const same = [2100, 2700, 3300].map((t) => fc.update(t, { tiltDeg: 1, pieces: at(520), frame }, ctx).status);
    expect(same.every((s) => s === 'move')).toBe(true);
    const moved = [3400, 3900].map((t) => fc.update(t, { tiltDeg: 1, pieces: at(1400), frame }, ctx).status);
    expect(moved[1]).toBe('ready');
  });
});
