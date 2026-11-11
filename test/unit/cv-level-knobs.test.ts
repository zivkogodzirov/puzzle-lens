/**
 * levelFromSizes (marker-free first photo: tilt from how piece sizes change across the photo) with
 * the knob term (M10, review FS4). Pure geometry: cut pieces placed on a table, seen through a
 * pinhole camera at 650 mm, outlines in the photo's provisional mm (px / scale at the centre).
 *
 * 1. A flat photo whose pieces happen to lie with more tabs on one side: a fit that ignores knobs
 *    reads that as a tilt (here several degrees) and "corrects" it; with the knob term nothing moves.
 * 2. A photo tilted 4°: levelled centres agree with the table within a fraction of a mm.
 */
import { describe, expect, it } from 'vitest';
import type { FoundPiece } from '../../src/cv/pieceFinder';
import { levelFromSizes } from '../../src/cv/scanMarkerless';
import { applyH, IDENTITY } from '../../src/geo/homography';
import { nominalIntrinsics } from '../../src/geo/pose';
import type { Mat3, Vec2 } from '../../src/project/types';
import { centroid } from '../synth/index';
import { cutPuzzle } from '../synth/cut';

const W = 4032;
const H = 3024;
const HEIGHT = 650;
const F = nominalIntrinsics(W, H, 1).f;
const PPM = F / HEIGHT;

function polyArea(p: number[]): number {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[2 * i]! * p[2 * j + 1]! - p[2 * j]! * p[2 * i + 1]!;
  }
  return Math.abs(a / 2);
}

/** Table mm (camera foot at the origin) → provisional photo mm, camera tilted by `tiltDeg` towards `dirDeg`. */
function project(tiltDeg: number, dirDeg: number): (p: Vec2) => Vec2 {
  const t = (tiltDeg * Math.PI) / 180;
  const d = (dirDeg * Math.PI) / 180;
  // Rotation by t about the in-table axis (−sin d, cos d, 0) (Rodrigues).
  const ux = -Math.sin(d);
  const uy = Math.cos(d);
  const c = Math.cos(t);
  const s = Math.sin(t);
  const C = 1 - c;
  const R = [c + ux * ux * C, ux * uy * C, uy * s, uy * ux * C, c + uy * uy * C, -ux * s, -uy * s, ux * s, c];
  return ([X, Y]) => {
    const px = R[0]! * X + R[1]! * Y + R[2]! * HEIGHT;
    const py = R[3]! * X + R[4]! * Y + R[5]! * HEIGHT;
    const pz = R[6]! * X + R[7]! * Y + R[8]! * HEIGHT;
    return [(F * px) / pz / PPM, (F * py) / pz / PPM];
  };
}

/** 48 cut pieces on a 7 × 7 grid (60 mm apart), turned at random; `order` sorts them left to right. */
function scene(tiltDeg: number, dirDeg: number, order: 'random' | 'tabs right') {
  const cut = cutPuzzle(8, 6, [17.8, 19.4], 5, 'classic').pieces;
  let seed = 11;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const tabs = (p: (typeof cut)[number]) => p.sides.filter((s) => s === 'tab').length - p.sides.filter((s) => s === 'blank').length;
  const list = order === 'tabs right' ? [...cut].sort((a, b) => tabs(a) - tabs(b)) : cut;
  const proj = project(tiltDeg, dirDeg);
  const truth: Vec2[] = [];
  const found: FoundPiece[] = [];
  list.forEach((p, i) => {
    // Column-major: the first pieces of the list go to the left.
    const gx = Math.floor(i / 7);
    const gy = i % 7;
    const cx = -180 + gx * 60;
    const cy = -180 + gy * 60;
    const a = rnd() * 2 * Math.PI;
    const table: number[] = [];
    for (let k = 0; k < p.outlineMm.length; k += 2) {
      const x = p.outlineMm[k]!;
      const y = p.outlineMm[k + 1]!;
      table.push(cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a));
    }
    truth.push(centroid(table) as Vec2);
    const outlineMm: number[] = [];
    for (let k = 0; k < table.length; k += 2) outlineMm.push(...proj([table[k]!, table[k + 1]!]));
    found.push({ outlineMm, centreMm: centroid(outlineMm) as Vec2, areaMm2: polyArea(outlineMm), flags: {} } as unknown as FoundPiece);
  });
  return { truth, found };
}

/** Largest centre error after one similarity fit of the levelled centres to the table. */
function worstError(found: FoundPiece[], truth: Vec2[], Hm: Mat3): number {
  const src = found.map((p) => applyH(Hm, p.centreMm));
  const n = src.length;
  const ms = src.reduce((s, q) => [s[0] + q[0] / n, s[1] + q[1] / n], [0, 0]);
  const md = truth.reduce((s, q) => [s[0] + q[0] / n, s[1] + q[1] / n], [0, 0]);
  let a = 0;
  let b = 0;
  let q2 = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i]![0] - ms[0];
    const y = src[i]![1] - ms[1];
    const u = truth[i]![0] - md[0];
    const v = truth[i]![1] - md[1];
    a += x * u + y * v;
    b += x * v - y * u;
    q2 += x * x + y * y;
  }
  a /= q2;
  b /= q2;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i]![0] - ms[0];
    const y = src[i]![1] - ms[1];
    worst = Math.max(worst, Math.hypot(a * x - b * y + md[0] - truth[i]![0], b * x + a * y + md[1] - truth[i]![1]));
  }
  return worst;
}

describe('levelFromSizes with the knob term', () => {
  const o = { W, H, zoom: 1, pxPerMm: PPM };

  it('a flat photo with the tabs on one side is left as it is', () => {
    const { truth, found } = scene(0, 0, 'tabs right');
    const Hm = levelFromSizes(found, o) ?? IDENTITY;
    // The knob-blind fit (before M10) "levelled" this flat photo: 9.0 mm worst error (now 0.15).
    expect(worstError(found, truth, Hm)).toBeLessThan(0.3);
  });

  it('a photo tilted 4° is levelled to within a millimetre', () => {
    const { truth, found } = scene(4, 30, 'random');
    expect(worstError(found, truth, IDENTITY)).toBeGreaterThan(3);
    const Hm = levelFromSizes(found, o);
    expect(Hm).not.toBeNull();
    // Not levelled 4.7 mm; the knob-blind fit (before M10) 3.1 mm; now 0.5 mm.
    expect(worstError(found, truth, Hm!)).toBeLessThan(0.8);
  });
});
