/**
 * Table geometry (src/geo): homographies, camera pose from markers, and the marker map.
 */
import { describe, expect, it } from 'vitest';
import { applyH, fitHomography, fitHomographyGroups, invertH, mulH } from '../../src/geo/homography';
import { homographyForCamera, nominalIntrinsics, poseFromHomography } from '../../src/geo/pose';
import { MarkerMapError, solveMarkerMap } from '../../src/geo/markerMap';
import { markerCornersMm, MARKER_SIZE_MM, suggestedMarkerCentres } from '../../src/markers/layout';
import type { Vec2 } from '../../src/project/types';
import { rng } from '../helpers/images';

const W = 4032;
const H = 3024;

function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

describe('homography', () => {
  it('recovers a known mapping exactly and inverts it', () => {
    const T = [1.2, 0.1, 30, -0.05, 0.9, 12, 1e-4, -2e-4, 1];
    const src: Vec2[] = [
      [0, 0],
      [500, 20],
      [480, 400],
      [10, 380],
      [250, 200],
    ];
    const dst = src.map((p) => applyH(T, p));
    const F = fitHomography(src, dst)!;
    for (const p of src) {
      const a = applyH(F, p);
      const b = applyH(T, p);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-6);
    }
    const I = mulH(invertH(F)!, F);
    const p = applyH(I, [123, 456]);
    expect(p[0]).toBeCloseTo(123, 6);
    expect(p[1]).toBeCloseTo(456, 6);
  });

  it('returns null for points on a line', () => {
    const src: Vec2[] = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ];
    expect(fitHomography(src, src)).toBeNull();
  });

  it('drops a marker that was moved and keeps the rest', () => {
    const K = nominalIntrinsics(W, H);
    const tableToImg = homographyForCamera(K, { x: 450, y: 330, heightMm: 550, tiltDeg: 4, tiltDirDeg: 30 });
    const centres = suggestedMarkerCentres();
    const groups = centres.map(([x, y], id) => {
      const table = markerCornersMm(x, y, 0);
      // Marker 5 was nudged 25 mm after the map was made.
      const real = id === 5 ? markerCornersMm(x + 25, y, 0) : table;
      return { key: id, src: real.map((p) => applyH(tableToImg, p)), dst: table };
    });
    const fit = fitHomographyGroups(groups, 2)!;
    expect(fit.dropped).toEqual([5]);
    expect(fit.rms).toBeLessThan(1e-3);
  });
});

describe('camera pose from the table mapping', () => {
  for (const c of [
    { tiltDeg: 0, heightMm: 550, zoom: 1 },
    { tiltDeg: 5, heightMm: 500, zoom: 1, tiltDirDeg: 90 },
    { tiltDeg: 12, heightMm: 300, zoom: 1, tiltDirDeg: 200, yawDeg: 40 },
    { tiltDeg: 3, heightMm: 550, zoom: 2, tiltDirDeg: -45, yawDeg: 170 },
  ]) {
    it(`tilt ${c.tiltDeg}°, height ${c.heightMm} mm, ${c.zoom}×`, () => {
      const K = nominalIntrinsics(W, H, c.zoom);
      const Ht = homographyForCamera(K, { x: 400, y: 300, ...c });
      const pose = poseFromHomography(Ht, K)!;
      expect(pose.tiltDeg).toBeCloseTo(c.tiltDeg, 4);
      expect(pose.heightMm).toBeCloseTo(c.heightMm, 2);
      expect(pose.footMm[0]).toBeCloseTo(400, 2);
      expect(pose.footMm[1]).toBeCloseTo(300, 2);
    });
  }

  it('tilt survives realistic marker noise (0.3 px corners) within 1°', () => {
    const K = nominalIntrinsics(W, H);
    const r = rng(7);
    const Ht = homographyForCamera(K, { x: 420, y: 320, heightMm: 540, tiltDeg: 4, tiltDirDeg: 60 });
    const table = suggestedMarkerCentres().flatMap(([x, y]) => markerCornersMm(x, y, 0));
    const img = table.map((p) => applyH(Ht, p)).map((p): Vec2 => [p[0] + 0.3 * gauss(r), p[1] + 0.3 * gauss(r)]);
    const fit = fitHomography(table, img)!;
    const pose = poseFromHomography(fit, K)!;
    expect(Math.abs(pose.tiltDeg - 4)).toBeLessThan(1);
    expect(Math.abs(pose.heightMm - 540)).toBeLessThan(10);
  });
});

describe('marker map from one photo', () => {
  function photo(seed: number, opts: { noisePx?: number; drop?: number[]; tiltDeg?: number; angles?: boolean } = {}) {
    const r = rng(seed);
    const K = nominalIntrinsics(W, H);
    // Markers lie roughly, not exactly, where suggested, each turned a little.
    const truth = suggestedMarkerCentres().map(([x, y], id) => ({
      id,
      x: id === 0 ? 0 : x + (r() - 0.5) * 60,
      y: id === 0 ? 0 : y + (r() - 0.5) * 60,
      a: id === 0 ? 0 : opts.angles === false ? 0 : (r() - 0.5) * 40,
    }));
    const Ht = homographyForCamera(K, { x: 400, y: 300, heightMm: 600, tiltDeg: opts.tiltDeg ?? 6, tiltDirDeg: 120, yawDeg: 15 });
    const sightings = truth
      .filter((m) => !opts.drop?.includes(m.id))
      .map((m) => ({
        id: m.id,
        corners: markerCornersMm(m.x, m.y, m.a).map((p) => applyH(Ht, p)).map((p): Vec2 => [p[0] + (opts.noisePx ?? 0) * gauss(r), p[1] + (opts.noisePx ?? 0) * gauss(r)]),
      }));
    return { truth, sightings };
  }

  it('finds every marker exactly from a clean photo', () => {
    const { truth, sightings } = photo(1);
    const sol = solveMarkerMap(sightings, MARKER_SIZE_MM);
    expect(sol.map.rmsMm).toBeLessThan(1e-3);
    for (const m of sol.map.markers) {
      const t = truth[m.id]!;
      const c = m.cornersMm.reduce<Vec2>((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
      expect(Math.hypot(c[0] - t.x, c[1] - t.y)).toBeLessThan(0.01);
    }
  });

  it('places markers within 2.5 mm with realistic corner noise (0.4 px) over an ~80 cm area', () => {
    for (const seed of [2, 3, 4, 5]) {
      const { truth, sightings } = photo(seed, { noisePx: 0.4 });
      const sol = solveMarkerMap(sightings, MARKER_SIZE_MM);
      for (const m of sol.map.markers) {
        const t = truth[m.id]!;
        const c = m.cornersMm.reduce<Vec2>((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
        expect(Math.hypot(c[0] - t.x, c[1] - t.y), `seed ${seed} marker ${m.id}`).toBeLessThan(2.5);
      }
      expect(sol.map.rmsMm).toBeLessThan(0.5);
    }
  });

  it('works without marker 0 (the lowest id seen becomes the origin) and needs at least 4', () => {
    const { sightings } = photo(6, { drop: [0, 3] });
    const sol = solveMarkerMap(sightings, MARKER_SIZE_MM);
    expect(sol.map.markers.map((m) => m.id)).toEqual([1, 2, 4, 5, 6, 7]);
    expect(() => solveMarkerMap(sightings.slice(0, 3), MARKER_SIZE_MM)).toThrow(MarkerMapError);
  });

  it('gives the photo → table mapping too', () => {
    const { truth, sightings } = photo(8, { noisePx: 0.2 });
    const sol = solveMarkerMap(sightings, MARKER_SIZE_MM);
    const m4 = sightings.find((s) => s.id === 4)!;
    const c = m4.corners.map((p) => applyH(sol.imgToTable, p)).reduce<Vec2>((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
    expect(Math.hypot(c[0] - truth[4]!.x, c[1] - truth[4]!.y)).toBeLessThan(2);
  });
});
