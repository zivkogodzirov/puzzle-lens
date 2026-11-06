/**
 * Hand-held capture: the tracker's table position (src/geo/tableFix.ts), the auto-capture gauge
 * (src/scan/autoCapture.ts) and the close-up coverage map (src/scan/coverage.ts).
 */
import { describe, expect, it } from 'vitest';
import { applyH } from '../../src/geo/homography';
import { homographyForCamera, nominalIntrinsics } from '../../src/geo/pose';
import { locateOnTable } from '../../src/geo/tableFix';
import { markerCornersMm, MARKER_SIZE_MM, suggestedMarkerCentres } from '../../src/markers/layout';
import { AutoCapture, type CaptureContext } from '../../src/scan/autoCapture';
import { Coverage, sortingArea } from '../../src/scan/coverage';
import type { MarkerMap, Vec2 } from '../../src/project/types';

const W = 4032;
const H = 3024;
const frame = { width: W, height: H };

const map: MarkerMap = {
  dictionary: 'DICT_4X4_50',
  markerSizeMm: MARKER_SIZE_MM,
  printScale: 1,
  markers: suggestedMarkerCentres().map(([x, y], id) => ({ id, cornersMm: markerCornersMm(x, y, 0) })),
  rmsMm: 0.1,
  createdAt: 0,
  snapId: 's',
};

/** What the tracker would report for a camera at this pose (markers outside the image are not seen). */
function sighting(cam: { x: number; y: number; heightMm: number; tiltDeg: number; tiltDirDeg?: number; yawDeg?: number }, zoom = 1, moved?: { id: number; dx: number }) {
  const K = nominalIntrinsics(W, H, zoom);
  const Ht = homographyForCamera(K, cam);
  return map.markers
    .map((m) => ({
      id: m.id,
      corners: m.cornersMm.flatMap((p) => applyH(Ht, moved?.id === m.id ? [p[0] + moved.dx, p[1]] : p)),
    }))
    .filter((m) => m.corners.every((v, i) => v >= 0 && v <= (i % 2 ? H : W)));
}

describe('table position from live markers', () => {
  it('gives tilt, height and the point under the image centre', () => {
    const fix = locateOnTable(sighting({ x: 405, y: 305, heightMm: 720, tiltDeg: 3, tiltDirDeg: 45 }), map, frame)!;
    expect(fix.used.length).toBe(8);
    expect(fix.tiltDeg).toBeCloseTo(3, 3);
    expect(fix.heightMm).toBeCloseTo(720, 1);
    expect(fix.pxPerMm).toBeGreaterThan(3.5);
    expect(fix.pxPerMm).toBeLessThan(4.5);
  });

  it('ignores a marker that was moved since the map was made', () => {
    const fix = locateOnTable(sighting({ x: 405, y: 305, heightMm: 720, tiltDeg: 2 }, 1, { id: 3, dx: 30 }), map, frame)!;
    expect(fix.dropped).toEqual([3]);
    expect(fix.tiltDeg).toBeCloseTo(2, 2);
  });

  it('works from a single marker in a 2× close-up', () => {
    const s = sighting({ x: 60, y: 60, heightMm: 520, tiltDeg: 4, tiltDirDeg: 10 }, 2);
    expect(s.length).toBeGreaterThanOrEqual(1);
    const fix = locateOnTable(s.slice(0, 1), map, frame, 2)!;
    expect(Math.abs(fix.tiltDeg - 4)).toBeLessThan(0.5);
    expect(Math.abs(fix.heightMm - 520)).toBeLessThan(5);
    expect(fix.pxPerMm).toBeGreaterThan(9);
  });

  it('returns null when no known marker is in view', () => {
    expect(locateOnTable([{ id: 40, corners: [0, 0, 10, 0, 10, 10, 0, 10] }], map, frame)).toBeNull();
  });
});

describe('auto-capture gauge', () => {
  const overview: CaptureContext = { kind: 'overview', map, frame };

  function run(ac: AutoCapture, ctx: CaptureContext, poses: Array<{ t: number; cam: Parameters<typeof sighting>[0]; zoom?: number }>) {
    return poses.map(({ t, cam, zoom }) => ac.update(t, locateOnTable(sighting(cam, zoom ?? 1), map, frame, zoom ?? 1), ctx));
  }

  it('fires an overview once the phone is flat, high enough and still for 400 ms', () => {
    const ac = new AutoCapture();
    const cam = { x: 405, y: 305, heightMm: 720, tiltDeg: 2 };
    const states = run(ac, overview, [0, 100, 200, 300, 450].map((t) => ({ t, cam })));
    expect(states.slice(0, 4).map((s) => s.status)).toEqual(['hold-still', 'hold-still', 'hold-still', 'hold-still']);
    expect(states[4]!.status).toBe('ready');
  });

  it('says what is wrong, one thing at a time', () => {
    const ac = new AutoCapture();
    expect(ac.update(0, null, overview).status).toBe('no-markers');
    expect(run(ac, overview, [{ t: 0, cam: { x: 405, y: 305, heightMm: 720, tiltDeg: 12 } }])[0]!.status).toBe('tilted');
    expect(run(ac, overview, [{ t: 0, cam: { x: 200, y: 150, heightMm: 450, tiltDeg: 1 } }])[0]!.status).toBe('area-out');
    expect(ac.update(0, null, { ...overview, map: null }).status).toBe('no-map');
  });

  it('a shaky hand restarts the steady timer', () => {
    const ac = new AutoCapture();
    const poses = [0, 100, 200, 300, 400, 500].map((t, i) => ({ t, cam: { x: 405 + (i === 3 ? 12 : 0), y: 305, heightMm: 720, tiltDeg: 2 } }));
    const states = run(ac, overview, poses);
    expect(states.every((s) => s.status !== 'ready')).toBe(true);
  });

  it('does not fire again straight after a photo', () => {
    const ac = new AutoCapture();
    const cam = { x: 405, y: 305, heightMm: 720, tiltDeg: 1 };
    const s1 = run(ac, overview, [0, 200, 450].map((t) => ({ t, cam })));
    expect(s1[2]!.status).toBe('ready');
    ac.noteFired(450);
    const s2 = run(ac, overview, [500, 700, 950, 1200].map((t) => ({ t, cam })));
    expect(s2.some((s) => s.status === 'ready')).toBe(false);
    const s3 = run(ac, overview, [2000, 2200, 2500].map((t) => ({ t, cam })));
    expect(s3[2]!.status).toBe('ready');
  });

  it('detail photos: too high at 1×, fine at 2×, and point towards the target', () => {
    const ctx: CaptureContext = { kind: 'detail', map, frame, targetMm: [165, 115], targetTolMm: 50 };
    const ac = new AutoCapture();
    expect(run(ac, ctx, [{ t: 0, cam: { x: 165, y: 115, heightMm: 600, tiltDeg: 1 } }])[0]!.status).toBe('too-high');
    const far = run(ac, ctx, [{ t: 0, cam: { x: 255, y: 115, heightMm: 600, tiltDeg: 1 }, zoom: 2 }])[0]!;
    expect(far.status).toBe('move');
    expect(far.targetDirImg).not.toBeNull();
    const near = run(ac, ctx, [0, 200, 500].map((t) => ({ t, cam: { x: 168, y: 112, heightMm: 600, tiltDeg: 1 }, zoom: 2 })));
    expect(near[2]!.status).toBe('ready');
  });
});

describe('coverage map', () => {
  // A 3 × 3 plan's middle close-up can't see the ring's markers: that one is located from the tilt
  // sensor live and from the pieces of the overview afterwards (RESEARCH §5).
  for (const [heightMm, maxShots, maxBlind] of [
    [650, 9, 2],
    [600, 10, 2],
  ] as const) {
    it(`2× close-ups from ${heightMm / 10} cm cover a 70 × 50 cm area in ≤ ${maxShots} photos, all but ${maxBlind} with a marker in view`, () => {
      const area = sortingArea(map);
      expect(area.x1 - area.x0).toBeCloseTo(720, 0);
      const cov = new Coverage(area);
      const centres = suggestedMarkerCentres();
      const K = nominalIntrinsics(W, H, 2);
      const fix0 = locateOnTable(sighting({ x: 0, y: 0, heightMm, tiltDeg: 0 }, 2), map, frame, 2)!;
      const fullView: Vec2 = [W / fix0.pxPerMm, H / fix0.pxPerMm];
      let shots = 0;
      let blind = 0;
      const log: string[] = [];
      for (;;) {
        const target = cov.nextTarget(fullView, centres);
        if (!target) break;
        // The hand is never exact: a little off target and tilted.
        const cam = { x: target[0] + 5, y: target[1] - 4, heightMm, tiltDeg: 2, tiltDirDeg: 30 * shots };
        const fix = locateOnTable(sighting(cam, 2), map, frame, 2);
        if (!fix) blind++;
        cov.addPhoto(fix?.tableToImg ?? homographyForCamera(K, cam), frame, fix?.pxPerMm ?? fix0.pxPerMm);
        shots++;
        log.push(`${target.map(Math.round).join(',')}${fix ? '' : ' (blind)'} → ${Math.round(cov.share() * 100)}%`);
        if (shots > 12) break;
      }
      expect(shots, `${cov.plan(fullView, centres).length} planned; ${log.join(' | ')}`).toBeLessThanOrEqual(maxShots);
      expect(blind).toBeLessThanOrEqual(maxBlind);
      expect(cov.share()).toBeGreaterThanOrEqual(0.98);
    });
  }

  it('an overview photo is not sharp enough to count', () => {
    const cov = new Coverage(sortingArea(map));
    const Ht = homographyForCamera(nominalIntrinsics(W, H), { x: 405, y: 305, heightMm: 720, tiltDeg: 0 });
    expect(cov.addPhoto(Ht, frame, 5)).toBe(0);
    expect(cov.share()).toBe(0);
  });
});
