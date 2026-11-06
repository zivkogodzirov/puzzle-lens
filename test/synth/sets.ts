/**
 * Frozen synthetic datasets (PLAN §7). Definitions only: every image is rendered on demand from
 * these numbers, so nothing is committed and the sets never drift.
 *
 *   set        puzzles                      batches / scenes
 *   val48      10 × (8 × 6)                  1 overview (1×) + 1 close-up (2×) each  → 20 scenes
 *   test48     10 × (8 × 6)                  same                                    → 20 scenes
 *   val300     4 × (15 × 20)                 1 overview + 4 close-up tiles (2 × 2)   → 20 scenes
 *   test300    4 × (15 × 20)                 same                                    → 20 scenes
 *   val1000    2 × (28 × 36 = 1008)          4 batches (300, 300, 300, 108) × (1 overview + 4 tiles) → 40 scenes
 *   test1000   2 × (28 × 36)                 same                                    → 40 scenes
 *
 * - Cells are the owner's Ravensburger 1000 cells, portrait: 17.8 mm wide × 19.4 mm tall
 *   (28 × 36 cells = 498 × 698 mm, the 50 × 70 cm box size). The smaller tiers use the same cells.
 * - Overviews: hand-held at 650–750 mm, 1× (≈ 3.7–4.3 px/mm), tilt ≤ 6°, always showing all 8
 *   markers. Close-ups: 600–650 mm at 2×, tilt ≤ 10°. The camera is aimed at its target (foot
 *   offset against the tilt). Yaw ±6°.
 * - Also varied: lamp glare on about half, side-light direction and elevation, hand/phone shadow
 *   on ~30 %, blur, motion blur, noise, JPEG quality 85–95, small white-balance and exposure
 *   offsets on top of auto-exposure; 3 % touching and 2 % face-down pieces per batch; ~20 % of
 *   puzzles use the 'uniform' cut.
 * - HELD OUT: validation sets use art seeds 1000+, test sets 9000+ (and different cut and scene
 *   seeds), so tuning on val never sees test artwork.
 * - Tune on val*, report only on test* (RESEARCH §16).
 *
 * Use: `for (const item of val48.items) { const scene = await renderScene(sceneOptions(item)); … }`.
 * Override `imageSize` for speed if a test needs it (e.g. [2016, 1512]).
 */
import { rng } from '../helpers/images';
import { applyH, invertH } from '../../src/geo/homography';
import { nominalIntrinsics } from '../../src/geo/pose';
import { markerCornersMm, suggestedMarkerCentres } from '../../src/markers/layout';
import { generatePuzzle } from './index';
import { cameraHomography } from './scene';
import type { GeneratePuzzleOptions, SceneOptions, SynthPuzzle } from './types';

export interface SynthSetItem {
  name: string;
  /** Identifies the puzzle (items of one puzzle share it). */
  puzzleKey: string;
  puzzle: GeneratePuzzleOptions;
  /** Ids of the pieces in this batch (all scenes of a batch show the same layout). */
  pieceIds?: string[];
  scene: Omit<SceneOptions, 'puzzle' | 'pieceIds'>;
  kind: 'overview' | 'detail';
}

export interface SynthSet {
  name: string;
  items: SynthSetItem[];
}

const CELL: [number, number] = [17.8, 19.4];
const AREA: [number, number] = [700, 500];
const ORIGIN = 55; // MARKER_CARD_MM / 2 + 10, as in suggestedMarkerCentres
const CENTRE: [number, number] = [ORIGIN + AREA[0] / 2, ORIGIN + AREA[1] / 2];

/** True if all 8 suggested markers (black squares, with a 20 px margin) are inside the photo. */
export function allMarkersInView(cam: { x: number; y: number; heightMm: number; tiltDeg: number; tiltDirDeg?: number; yawDeg?: number; zoom?: 1 | 2; imageSize?: [number, number] }): boolean {
  const [W, H] = cam.imageSize ?? [4032, 3024];
  const H0 = cameraHomography(nominalIntrinsics(W, H, cam.zoom ?? 1), cam);
  return suggestedMarkerCentres(AREA[0], AREA[1]).every(([mx, my]) =>
    markerCornersMm(mx, my).every((p) => {
      const q = applyH(H0, p);
      return q[0] > 20 && q[1] > 20 && q[0] < W - 21 && q[1] < H - 21;
    }),
  );
}

function makeSet(name: string, opts: { cols: number; rows: number; puzzles: number; batch: number; tiles: number; artBase: number; seedBase: number }): SynthSet {
  const items: SynthSetItem[] = [];
  const r = rng(opts.seedBase);
  const u = (a: number, b: number) => a + (b - a) * r();
  for (let p = 0; p < opts.puzzles; p++) {
    const puzzle: GeneratePuzzleOptions = {
      cols: opts.cols,
      rows: opts.rows,
      cellMm: CELL,
      seed: opts.seedBase + p * 17 + 1,
      cut: r() < 0.2 ? 'uniform' : 'classic',
      art: { kind: 'procedural-kiss-like', seed: opts.artBase + p },
    };
    const puzzleKey = `${name}-p${p}`;
    const ids: string[] = [];
    for (let y = 0; y < opts.rows; y++) for (let x = 0; x < opts.cols; x++) ids.push(`r${y}c${x}`);
    // Batches: a fixed shuffle of the pieces, cut into groups of `batch`.
    const order = [...ids];
    for (let i = order.length - 1; i > 0; i--) {
      const k = Math.floor(r() * (i + 1));
      [order[i], order[k]] = [order[k]!, order[i]!];
    }
    const batches: string[][] = [];
    for (let i = 0; i < order.length; i += opts.batch) batches.push(order.slice(i, i + opts.batch));
    batches.forEach((pieceIds, b) => {
      const layoutSeed = opts.seedBase + p * 1000 + b * 10 + 3;
      const glareOn = r() < 0.5;
      const lightDir = u(0, 360);
      const common = {
        layout: { areaMm: AREA, gapMm: 3, touchingShare: 0.03, faceDownShare: 0.02 },
        markers: 'suggested' as const,
        light: {
          dirDeg: lightDir,
          elevationDeg: u(35, 65),
          gradient: u(0.05, 0.2),
          ambient: u(0.45, 0.7),
          glare: glareOn ? { lampMm: [CENTRE[0] + u(-350, 350), CENTRE[1] + u(-250, 450), u(900, 1600)] as [number, number, number] } : null,
        },
      };
      const IMG: [number, number] = [4032, 3024];
      const shot = (kind: 'overview' | 'detail', x: number, y: number, k: number): SynthSetItem => {
        const zoom = kind === 'overview' ? 1 : 2;
        // Hand-held: the owner aims at the target, so the camera foot is offset against the tilt.
        // Overviews (650–750 mm, 1×) must show all 8 markers: re-draw until they do.
        let camera: SynthSetItem['scene']['camera'] | null = null;
        for (let tries = 0; tries < 50 && !camera; tries++) {
          const c = {
            heightMm: kind === 'overview' ? u(650, 750) : u(600, 650),
            tiltDeg: u(0, kind === 'overview' ? 6 : 10),
            tiltDirDeg: u(0, 360),
            yawDeg: u(-6, 6),
          };
          const tx = x + u(-15, 15);
          const ty = y + u(-15, 15);
          const K = nominalIntrinsics(IMG[0], IMG[1], zoom);
          const H0 = cameraHomography(K, { x: 0, y: 0, ...c });
          const centre = applyH(invertH(H0)!, [(IMG[0] - 1) / 2, (IMG[1] - 1) / 2]);
          const cand = { x: tx - centre[0], y: ty - centre[1], ...c, zoom: zoom as 1 | 2, imageSize: IMG };
          if (kind === 'overview' && !allMarkersInView(cand)) continue;
          camera = cand;
        }
        if (!camera) throw new Error(`sets: no camera keeps all markers in view (${name})`);
        return {
          name: `${puzzleKey}-b${b}-${kind}${kind === 'detail' ? k : ''}`,
          puzzleKey,
          puzzle,
          pieceIds: pieceIds.length === ids.length ? undefined : pieceIds,
          kind,
          scene: {
            ...common,
            seed: layoutSeed, // same seed → same layout for every photo of the batch
            camera,
            handShadow: r() < 0.3,
            blurPx: u(0.4, 1.2),
            motionBlurPx: r() < 0.25 ? u(0.5, 2) : 0,
            noise: u(0.7, 1.6),
            jpegQuality: Math.round(u(85, 95)),
            whiteBalanceShift: [u(0.95, 1.05), 1, u(0.93, 1.04)],
            exposure: u(-0.15, 0.1),
          },
        };
      };
      items.push(shot('overview', CENTRE[0], CENTRE[1], 0));
      const tiles = opts.tiles === 1 ? [[0, 0]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      tiles.forEach(([tx, ty], k) => items.push(shot('detail', CENTRE[0] + tx! * 175, CENTRE[1] + ty! * 125, k)));
    });
  }
  return { name, items };
}

export const val48 = makeSet('val48', { cols: 8, rows: 6, puzzles: 10, batch: 48, tiles: 1, artBase: 1000, seedBase: 101 });
export const test48 = makeSet('test48', { cols: 8, rows: 6, puzzles: 10, batch: 48, tiles: 1, artBase: 9000, seedBase: 901 });
export const val300 = makeSet('val300', { cols: 15, rows: 20, puzzles: 4, batch: 300, tiles: 4, artBase: 1100, seedBase: 202 });
export const test300 = makeSet('test300', { cols: 15, rows: 20, puzzles: 4, batch: 300, tiles: 4, artBase: 9100, seedBase: 902 });
export const val1000 = makeSet('val1000', { cols: 28, rows: 36, puzzles: 2, batch: 300, tiles: 4, artBase: 1200, seedBase: 303 });
export const test1000 = makeSet('test1000', { cols: 28, rows: 36, puzzles: 2, batch: 300, tiles: 4, artBase: 9200, seedBase: 903 });

export const ALL_SETS = { val48, test48, val300, test300, val1000, test1000 };

const puzzleCache = new Map<string, SynthPuzzle>();

/** The puzzle of a set item (generated once per process and cached). */
export function puzzleFor(item: SynthSetItem): SynthPuzzle {
  let p = puzzleCache.get(item.puzzleKey);
  if (!p) {
    p = generatePuzzle(item.puzzle);
    puzzleCache.set(item.puzzleKey, p);
  }
  return p;
}

/** Ready-to-render scene options for a set item (optionally at a smaller image size). */
export function sceneOptions(item: SynthSetItem, imageSize?: [number, number]): SceneOptions {
  return {
    ...item.scene,
    puzzle: puzzleFor(item),
    pieceIds: item.pieceIds,
    camera: { ...item.scene.camera, imageSize: imageSize ?? item.scene.camera.imageSize },
  };
}
