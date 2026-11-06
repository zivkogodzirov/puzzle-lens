/**
 * Wizard step 5 on simulated photos of the empty table (src/cv/tableSetup.ts): the marker map
 * from one hand-held photo, checked against where the generator really put the markers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCv, counters, type Cv } from '../helpers/cv';
import { generatePuzzle, renderScene } from '../synth/index';
import { setupFromPhoto, toGray } from '../../src/cv/tableSetup';
import { PhotoChecker } from '../../src/cv/photoCheck';
import { suggestedMarkerCentres } from '../../src/markers/layout';
import type { SynthPuzzle } from '../synth/types';

let cv: Cv;
let checker: PhotoChecker;
let puzzle: SynthPuzzle;

beforeAll(async () => {
  cv = await getCv();
  checker = new PhotoChecker(cv);
  puzzle = generatePuzzle({ cols: 4, rows: 3, cellMm: [17.8, 19.4], seed: 3 });
});
afterAll(() => checker.dispose());

async function emptyTable(cam: { x: number; y: number; heightMm: number; tiltDeg: number; tiltDirDeg?: number; yawDeg?: number }, extra: { glare?: boolean; motionBlurPx?: number } = {}) {
  const scene = await renderScene({
    puzzle,
    pieceIds: [],
    seed: 11,
    camera: cam,
    light: { dirDeg: 200, glare: extra.glare ? { lampMm: [300, 200, 1400] } : null },
    motionBlurPx: extra.motionBlurPx ?? 0,
  });
  return toGray(cv, { data: scene.rgba, width: scene.width, height: scene.height, stride: scene.width * 4 });
}

describe('marker map from a photo of the empty table', () => {
  for (const cam of [
    { x: 405, y: 305, heightMm: 700, tiltDeg: 0 },
    { x: 400, y: 310, heightMm: 760, tiltDeg: 4, tiltDirDeg: 225, yawDeg: 3 },
  ]) {
    it(`finds all 8 markers within 2 mm (tilt ${cam.tiltDeg}°)`, async () => {
      const before = counters().liveScoped;
      const r = setupFromPhoto(cv, checker, await emptyTable(cam), { printScale: 1, snapId: 's1', now: 1 });
      expect(r.problems).toEqual([]);
      expect(r.ok).toBe(true);
      const truth = suggestedMarkerCentres();
      for (const m of r.map!.markers) {
        const c = m.cornersMm.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
        expect(Math.hypot(c[0]! - truth[m.id]![0], c[1]! - truth[m.id]![1]), `marker ${m.id}`).toBeLessThan(2);
      }
      expect(r.map!.rmsMm).toBeLessThan(0.6);
      expect(counters().liveScoped).toBe(before);
    }, 60_000);
  }

  it('says which markers are missing when the phone is too low', async () => {
    const r = setupFromPhoto(cv, checker, await emptyTable({ x: 200, y: 150, heightMm: 450, tiltDeg: 0 }), { printScale: 1, snapId: 's2' });
    expect(r.ok).toBe(false);
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.problems[0]).toMatch(/of 8 markers found|No markers/);
  }, 60_000);

  it('refuses a shaken photo', async () => {
    const r = setupFromPhoto(cv, checker, await emptyTable({ x: 405, y: 305, heightMm: 700, tiltDeg: 0 }, { motionBlurPx: 14 }), { printScale: 1, snapId: 's3' });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/Blurred|markers found/);
  }, 60_000);
});
