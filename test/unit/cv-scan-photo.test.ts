/**
 * The whole scan path on simulated photos (src/cv/scanPhoto.ts + catalog merge): set-up photo →
 * marker map + table model; overview → pieces in table mm; a second overview from another angle
 * adds no duplicates.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCv, type Cv } from '../helpers/cv';
import { generatePuzzle, renderScene, segmentationScore } from '../synth/index';
import type { SceneOptions, SynthPuzzle } from '../synth/types';
import { PhotoChecker } from '../../src/cv/photoCheck';
import { setupFromPhoto, toGray } from '../../src/cv/tableSetup';
import { scanPixels, tableFromPixels } from '../../src/cv/scanPhoto';
import { planMerge } from '../../src/project/catalog';
import type { MarkerMap, PieceRow, TableModel } from '../../src/project/types';

let cv: Cv;
let checker: PhotoChecker;
let puzzle: SynthPuzzle;
let map: MarkerMap;
let table: TableModel;

const base = (over: Partial<SceneOptions>): SceneOptions => ({
  puzzle,
  seed: 31,
  layout: { areaMm: [700, 500], originMm: [55, 55] },
  camera: { x: 405, y: 305, heightMm: 700, tiltDeg: 1 },
  light: { dirDeg: 200 },
  ...over,
});

beforeAll(async () => {
  cv = await getCv();
  checker = new PhotoChecker(cv);
  puzzle = generatePuzzle({ cols: 10, rows: 8, cellMm: [17.8, 19.4], seed: 77 });
  const empty = await renderScene(base({ pieceIds: [] }));
  const rgba = { data: empty.rgba, width: empty.width, height: empty.height, stride: empty.width * 4 };
  const r = setupFromPhoto(cv, checker, toGray(cv, rgba), { printScale: 1, snapId: 'setup', now: 1 });
  expect(r.ok).toBe(true);
  map = r.map!;
  table = tableFromPixels(cv, rgba, { imgToTable: r.imgToTable!, map, snapId: 'setup' });
}, 120_000);
afterAll(() => checker.dispose());

describe('scan photo end to end', () => {
  let first: PieceRow[] = [];

  it('an overview finds the pieces and places them on the table', async () => {
    const scene = await renderScene(base({}));
    const r = scanPixels(cv, checker, { data: scene.rgba, width: scene.width, height: scene.height, stride: scene.width * 4 }, { map, table, zoom: 1, kind: 'overview' });
    expect(r.imgToTable).not.toBeNull();
    const score = segmentationScore(r.pieces, scene.truth);
    // Honest bar for this small scene; the full accuracy run is cv-piece-accuracy.test.ts.
    expect(score.recall).toBeGreaterThan(0.85);
    expect(score.precision).toBeGreaterThan(0.85);
    let n = 0;
    const plan = planMerge([], r.pieces, { projectId: 'p', snapId: 's1', pxPerMm: r.pxPerMm!, now: 1, newId: () => `a${++n}`, thumbId: (id) => `t-${id}` });
    first = plan.added;
    expect(first.length).toBeGreaterThan(0.85 * scene.truth.pieces.filter((p) => !p.faceDown && p.visibleShare > 0.99).length);
  }, 120_000);

  it('a second overview from another spot adds (almost) no duplicates', async () => {
    const scene = await renderScene(base({ camera: { x: 420, y: 290, heightMm: 720, tiltDeg: 4, tiltDirDeg: 140, yawDeg: 5 } }));
    const r = scanPixels(cv, checker, { data: scene.rgba, width: scene.width, height: scene.height, stride: scene.width * 4 }, { map, table, zoom: 1, kind: 'overview' });
    let n = 0;
    const plan = planMerge(first, r.pieces, { projectId: 'p', snapId: 's2', pxPerMm: r.pxPerMm!, now: 2, newId: () => `b${++n}`, thumbId: (id) => `t-${id}` });
    // New ones may only be pieces the first photo missed (≤ 5 % of the catalog).
    expect(plan.added.length).toBeLessThanOrEqual(Math.ceil(0.05 * first.length) + 2);
    expect(plan.updates.length).toBeGreaterThan(0.85 * first.length);
  }, 120_000);
});
