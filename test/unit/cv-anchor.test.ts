/**
 * Live view without markers (src/cv/anchor.ts): where the camera is over the table, found from
 * the pieces in the puzzle's overview photo. Synthetic: the val300 puzzle-0 overview is the
 * reference; live frames (960 × 720) are rendered from other camera positions (moved, turned,
 * tilted, higher and lower), and the fix is compared with the renderer's truth on the pieces in
 * view. PLAN §7 target: ≤ 2 mm on the table. Opt-in real check: the owner's IMG_9263 → IMG_9264.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ANCHOR, plausible, TableAnchor, upscaleH, type AnchorFix } from '../../src/cv/anchor';
import { FrameAnalyser } from '../../src/cv/frameAnalyser';
import { cvCounters } from '../../src/cv/scope';
import { applyH, invertH, mulH } from '../../src/geo/homography';
import type { Mat3 } from '../../src/project/types';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import { getCv, type Cv } from '../helpers/cv';
import { resizeBuffer } from '../helpers/images';
import { renderScene, type SceneOptions, type SynthScene } from '../synth/index';
import { sceneOptions, val300 } from '../synth/sets';

let cv: Cv;
const item = val300.items.find((it) => it.puzzleKey === 'val300-p0' && it.kind === 'overview')!;
const base = sceneOptions(item);
const shot = (camera: Partial<SceneOptions['camera']>): Promise<SynthScene> =>
  renderScene({ ...base, markers: [], camera: { ...base.camera, imageSize: [960, 720], ...camera } });
const buf = (s: SynthScene): PixelBuffer => ({ data: s.rgba, width: s.width, height: s.height, stride: s.stride });

/** Grey Mat of a scene (caller deletes). */
function grayOf(s: SynthScene) {
  const m = new cv.Mat(s.height, s.width, cv.CV_8UC4);
  m.data.set(s.rgba);
  const g = new cv.Mat();
  cv.cvtColor(m, g, cv.COLOR_RGBA2GRAY);
  m.delete();
  return g;
}

/** Error on the table (mm) at the centres of the pieces in view: truth px → estimated mm. */
function errorsMm(fix: AnchorFix, scene: SynthScene): number[] {
  const out: number[] = [];
  for (const p of scene.truth.pieces) {
    const px = applyH(scene.truth.topToImg, p.centreMm);
    if (px[0] < 0 || px[1] < 0 || px[0] >= scene.width || px[1] >= scene.height) continue;
    const mm = applyH(fix.imgToTable, px);
    out.push(Math.hypot(mm[0] - p.centreMm[0], mm[1] - p.centreMm[1]));
  }
  return out;
}

const max = (v: number[]) => v.reduce((a, b) => Math.max(a, b), 0);
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;

let anchor: TableAnchor;
let ref: SynthScene;

beforeAll(async () => {
  cv = await getCv();
  ref = await renderScene({ ...base, markers: [] });
  // The app reads the reference photo at ANCHOR.refMaxSide.
  const s = ANCHOR.refMaxSide / Math.max(ref.width, ref.height);
  const w = Math.round(ref.width * s);
  const h = Math.round(ref.height * s);
  const small = resizeBuffer(cv, buf(ref), 4, w, h, cv.INTER_AREA);
  const imgToTable = mulH(invertH(ref.truth.topToImg)!, upscaleH(ref.width / w));
  anchor = new TableAnchor(cv);
  const n = anchor.setReferences([{ pixels: small, channels: 4, imgToTable }]);
  expect(n).toBeGreaterThan(1000);
}, 120_000);

describe('live view without markers', () => {
  const c = base.camera;
  const poses: Array<[string, Partial<SceneOptions['camera']>]> = [
    ['same place', {}],
    ['moved 80 mm and turned 25°', { x: c.x + 80, y: c.y - 40, yawDeg: (c.yawDeg ?? 0) + 25 }],
    ['turned 90° (phone held the other way)', { yawDeg: (c.yawDeg ?? 0) + 90 }],
    ['tilted 18°', { tiltDeg: 18, tiltDirDeg: 120 }],
    ['30 % lower (closer)', { heightMm: c.heightMm * 0.7 }],
    ['30 % higher', { heightMm: c.heightMm * 1.3 }],
  ];
  for (const [name, pose] of poses) {
    it(`${name}: pieces within 2 mm`, async () => {
      const live = await shot(pose);
      const g = grayOf(live);
      try {
        anchor.reset();
        const t0 = performance.now();
        const fix = anchor.track(g)!;
        const ms = performance.now() - t0;
        expect(fix).not.toBeNull();
        expect(fix.via).toBe('features');
        const e = errorsMm(fix, live);
        console.log(
          `${name}: ${e.length} pieces, median ${median(e).toFixed(2)} mm, worst ${max(e).toFixed(2)} mm, ${fix.inliers}/${fix.candidates} points, ${ms.toFixed(0)} ms`,
        );
        expect(e.length).toBeGreaterThan(20);
        expect(median(e)).toBeLessThan(1);
        expect(max(e)).toBeLessThan(2);
        expect(fix.quality).toBe('good');
      } finally {
        g.delete();
      }
      expect(cvCounters.liveScoped).toBe(0);
    }, 60_000);
  }

  it('a slow pan: optical flow follows between full matches, and stays within 2 mm', async () => {
    anchor.reset();
    const vias: string[] = [];
    const worst: number[] = [];
    const times: number[] = [];
    for (let i = 0; i < 14; i++) {
      const live = await shot({ x: c.x + 4 * i, y: c.y + 2 * i, yawDeg: (c.yawDeg ?? 0) + 0.6 * i });
      const g = grayOf(live);
      try {
        const t0 = performance.now();
        const fix = anchor.track(g)!;
        times.push(performance.now() - t0);
        expect(fix).not.toBeNull();
        vias.push(fix.via);
        worst.push(max(errorsMm(fix, live)));
      } finally {
        g.delete();
      }
    }
    console.log(`pan: ${vias.join(' ')}; worst ${max(worst).toFixed(2)} mm; ms ${times.map((t) => t.toFixed(0)).join(' ')}`);
    expect(vias.filter((v) => v === 'flow').length).toBeGreaterThanOrEqual(10);
    expect(max(worst)).toBeLessThan(2);
    expect(cvCounters.liveScoped).toBe(0);
  }, 120_000);

  it('somewhere else (an empty part of the table): no fix, no guess', async () => {
    anchor.reset();
    const live = await shot({ x: c.x + 2000, y: c.y + 2000 });
    const g = grayOf(live);
    try {
      expect(anchor.track(g)).toBeNull();
    } finally {
      g.delete();
    }
  }, 60_000);

  it('in the live camera’s analyser: a 1920 × 1440 frame is analysed at 960 px, the fix comes back in frame px, markers are skipped', async () => {
    const live = await shot({ x: c.x + 30, yawDeg: (c.yawDeg ?? 0) + 10, imageSize: [1920, 1440] });
    const analyser = new FrameAnalyser(cv, { analysisWidth: 960 });
    analyser.anchor = anchor;
    analyser.markers = false;
    anchor.reset();
    const a = analyser.analyseRgba(buf(live));
    analyser.anchor = null;
    analyser.dispose();
    expect(a.analysisWidth).toBe(960);
    expect(a.markers).toEqual([]);
    expect(a.anchor).toBeTruthy();
    const e = errorsMm(a.anchor!, live);
    expect(e.length).toBeGreaterThan(20);
    expect(max(e)).toBeLessThan(2);
    expect(a.timings.anchor).toBeGreaterThan(0);
    expect(cvCounters.liveScoped).toBe(0);
  }, 60_000);

  it('implausible mappings are refused (mirrored, or wildly stretched)', () => {
    const ok: Mat3 = [3, 0, 100, 0, 3, 50, 0, 0, 1];
    expect(plausible(ok, 960, 720).ok).toBe(true);
    expect(plausible(ok, 960, 720).pxPerMm).toBeCloseTo(3, 6);
    expect(plausible([-3, 0, 900, 0, 3, 50, 0, 0, 1], 960, 720).ok).toBe(false);
    expect(plausible([9, 0, 100, 0, 1, 50, 0, 0, 1], 960, 720).ok).toBe(false);
  });

  it('frees everything it kept', () => {
    const before = cvCounters.livePersistent;
    anchor.dispose();
    expect(cvCounters.livePersistent).toBeLessThan(before);
    expect(anchor.ready).toBe(false);
  });
});
