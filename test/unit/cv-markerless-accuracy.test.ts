/**
 * Marker-free scanning over whole synthetic sets (opt-in, several minutes):
 *
 *   MARKERLESS_ACCURACY=1 [MARKERLESS_SETS=val48,val300] npx vitest run --project unit test/unit/cv-markerless-accuracy.test.ts
 *
 * Per puzzle (first batch, the set's cameras, `markers: []`): overview 1 defines the frame; a
 * second overview (phone turned 90°, higher, moved) and a third (turned 180°, tilted 4°), the set's
 * 2× close-ups and a middle 2× close-up are registered and merged with planMerge. Reported, pooled:
 * registration rate, centre error vs truth after ONE similarity fit of frame 1 to the truth
 * (target median ≤ 1 mm, p95 ≤ 2 mm), duplicates after merging, refusal of the next puzzle's
 * close-up, registration with 10 % of the catalog moved and 10 % removed, scale error, timing.
 * Tuned on val sets; default sets are test48,test300 (reporting only).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { estimatePxPerMm } from '../../src/cv/pieceFinder';
import { scanMarkerless, type ScanMarkerlessResult } from '../../src/cv/scanMarkerless';
import { cvCounters } from '../../src/cv/scope';
import { applyH } from '../../src/geo/homography';
import { planMerge } from '../../src/project/catalog';
import type { Mat3, PieceRow, Vec2 } from '../../src/project/types';
import { getCv, type Cv } from '../helpers/cv';
import { centroid, renderScene, segmentationScore, type SynthScene } from '../synth/index';
import { ALL_SETS, sceneOptions, type SynthSetItem } from '../synth/sets';

const RUN = process.env.MARKERLESS_ACCURACY === '1';
const SETS = (process.env.MARKERLESS_SETS ?? 'test48,test300').split(',').map((s) => s.trim()) as Array<keyof typeof ALL_SETS>;

function fitSim(src: Vec2[], dst: Vec2[]): Mat3 {
  const n = src.length;
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i]![0];
    sy += src[i]![1];
    dx += dst[i]![0];
    dy += dst[i]![1];
  }
  sx /= n;
  sy /= n;
  dx /= n;
  dy /= n;
  let a = 0;
  let b = 0;
  let q = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i]![0] - sx;
    const y = src[i]![1] - sy;
    a += x * (dst[i]![0] - dx) + y * (dst[i]![1] - dy);
    b += x * (dst[i]![1] - dy) - y * (dst[i]![0] - dx);
    q += x * x + y * y;
  }
  a /= q;
  b /= q;
  return [a, -b, dx - (a * sx - b * sy), b, a, dy - (b * sx + a * sy), 0, 0, 1];
}
const quant = (v: number[], p: number) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
};
const buf = (s: SynthScene) => ({ data: s.rgba, width: s.width, height: s.height, stride: s.stride });

describe.skipIf(!RUN)('marker-free scanning accuracy', () => {
  let cv: Cv;
  beforeAll(async () => {
    cv = await getCv();
  });
  afterAll(() => {
    expect(cvCounters.liveScoped).toBe(0);
  });

  for (const name of SETS) {
    it(
      name,
      async () => {
        const set = ALL_SETS[name];
        const keys = [...new Set(set.items.map((i) => i.puzzleKey))];
        const frameErr: number[] = [];
        const laterErr: number[] = [];
        const scaleErr: number[] = [];
        const ms: number[] = [];
        let photos = 0;
        let registered = 0;
        let dups = 0;
        let catalogRows = 0;
        let falseMissing = 0;
        let movedFalse = 0;
        let refusals = 0;
        let refusalTries = 0;
        let movedOk = 0;
        let movedTries = 0;
        for (let k = 0; k < keys.length; k++) {
          const items = set.items.filter((i) => i.puzzleKey === keys[k] && i.name.includes('-b0-'));
          const ov = items.find((i) => i.kind === 'overview')!;
          const base = sceneOptions(ov);
          const shots: Array<{ cam: Partial<SynthSetItem['scene']['camera']>; zoom: 1 | 2 }> = [
            { cam: {}, zoom: 1 },
            { cam: { x: base.camera.x + 30, y: base.camera.y - 20, yawDeg: 90, heightMm: 820 }, zoom: 1 },
            { cam: { x: base.camera.x - 25, y: base.camera.y + 15, yawDeg: 180, tiltDeg: 4 }, zoom: 1 },
            ...items.filter((i) => i.kind === 'detail').map((i) => ({ cam: i.scene.camera, zoom: 2 as const })),
            { cam: { zoom: 2, heightMm: 620, tiltDeg: 3, yawDeg: 20 }, zoom: 2 },
          ];
          let catalog: PieceRow[] = [];
          let S: Mat3 | null = null;
          let nid = 0;
          let truth: SynthScene | null = null;
          let lastDetail: SynthScene | null = null;
          for (const [i, sh] of shots.entries()) {
            const s = await renderScene({ ...base, markers: [], camera: { ...base.camera, ...sh.cam } });
            truth ??= s;
            const est = estimatePxPerMm(cv, buf(s), { zoom: sh.zoom });
            if (est) scaleErr.push(est.pxPerMm / s.truth.pxPerMm - 1);
            const t0 = performance.now();
            const r: ScanMarkerlessResult = scanMarkerless(cv, buf(s), {
              catalog,
              zoom: sh.zoom,
              kind: sh.zoom === 2 ? 'detail' : 'overview',
              table: null,
              pieceAreaShare: 1,
            });
            ms.push(performance.now() - t0);
            photos++;
            if (!r.registered) continue;
            registered++;
            const sc = segmentationScore(r.pieces, s.truth);
            const pairs = sc.matches.map((m) => [r.pieces[m.foundIndex]!.centreMm, centroid(s.truth.pieces.find((p) => p.id === m.id)!.outlineMm)] as const);
            if (i === 0)
              S = fitSim(
                pairs.map((p) => p[0]),
                pairs.map((p) => p[1]),
              );
            for (const [a, b] of pairs) {
              const p = applyH(S!, a);
              (i === 0 ? frameErr : laterErr).push(Math.hypot(p[0] - b[0], p[1] - b[1]));
            }
            // The photo's view, as the app passes it (moved / missing pieces are looked for).
            const view: Vec2[] = (
              [
                [0, 0],
                [s.width - 1, 0],
                [s.width - 1, s.height - 1],
                [0, s.height - 1],
              ] as Vec2[]
            ).map((c) => applyH(r.imgToCatalog!, c));
            const plan = planMerge(catalog, r.pieces, {
              projectId: 'p',
              snapId: `s${i}`,
              pxPerMm: r.pxPerMm ?? 4,
              now: 1,
              newId: () => `n${nid++}`,
              thumbId: (id) => id,
              view,
            });
            movedFalse += plan.moved;
            const upd = new Map(plan.updates.map((u) => [u.id, u]));
            catalog = catalog.map((c) => upd.get(c.id) ?? c).concat(plan.added);
            if (sh.zoom === 2) lastDetail = s;
          }
          // Duplicates: truth pieces with more than one catalog row within 6 mm.
          if (S && truth) {
            const count = new Map<string, number>();
            for (const c of catalog) {
              const p = applyH(S, [c.table.x, c.table.y]);
              let best = '';
              let bd = 6;
              for (const t of truth.truth.pieces) {
                const tc = centroid(t.outlineMm);
                const d = Math.hypot(p[0] - tc[0], p[1] - tc[1]);
                if (d < bd) {
                  bd = d;
                  best = t.id;
                }
              }
              if (best) count.set(best, (count.get(best) ?? 0) + 1);
            }
            dups += [...count.values()].filter((v) => v > 1).length;
            catalogRows += catalog.length;
            // Nothing was moved or taken away between these photos: every "missing" is false.
            falseMissing += catalog.filter((c) => c.status === 'missing').length;
          }
          // Refusal: the next puzzle's close-up against this catalog.
          const otherKey = keys[(k + 1) % keys.length]!;
          const otherItem = set.items.find((i) => i.puzzleKey === otherKey && i.kind === 'detail')!;
          const other = await renderScene({ ...sceneOptions(otherItem), markers: [] });
          refusalTries++;
          if (!scanMarkerless(cv, buf(other), { catalog, zoom: 2, kind: 'detail', table: null, pieceAreaShare: 1 }).registered) refusals++;
          // 10 % moved, 10 % removed.
          if (lastDetail) {
            let seed = 7 + k;
            const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
            const changed = catalog
              .filter(() => rnd() > 0.1)
              .map((c) => (rnd() < 0.11 ? { ...c, table: { ...c.table, x: c.table.x + (rnd() - 0.5) * 120, y: c.table.y + (rnd() - 0.5) * 120 } } : c));
            movedTries++;
            if (scanMarkerless(cv, buf(lastDetail), { catalog: changed, zoom: 2, kind: 'detail', table: null, pieceAreaShare: 1 }).registered) movedOk++;
          }
        }
        console.log(
          `\n${name} (marker-free, ${keys.length} puzzles, ${photos} photos)\n` +
            `  registered          ${registered}/${photos}\n` +
            `  frame-1 error       median ${quant(frameErr, 0.5).toFixed(2)} mm, p95 ${quant(frameErr, 0.95).toFixed(2)} mm (n ${frameErr.length})\n` +
            `  later photos error  median ${quant(laterErr, 0.5).toFixed(2)} mm, p95 ${quant(laterErr, 0.95).toFixed(2)} mm (n ${laterErr.length})\n` +
            `  duplicates          ${dups} of ${catalogRows} catalog rows\n` +
            `  false "missing"     ${falseMissing} of ${catalogRows} catalog rows; false "moved" ${movedFalse}\n` +
            `  refused other puzzle ${refusals}/${refusalTries}; registered with 10 % moved + 10 % removed ${movedOk}/${movedTries}\n` +
            `  scale estimate      median ${(quant(scaleErr, 0.5) * 100).toFixed(1)} %, |err| p95 ${(quant(scaleErr.map(Math.abs), 0.95) * 100).toFixed(1)} %\n` +
            `  scanMarkerless      median ${quant(ms, 0.5).toFixed(0)} ms, max ${Math.max(...ms).toFixed(0)} ms`,
        );
        expect.soft(registered, 'all photos register').toBe(photos);
        expect.soft(refusals, 'refuses other puzzles').toBe(refusalTries);
        expect.soft(movedOk, 'registers with moved pieces').toBe(movedTries);
        expect.soft(quant(laterErr, 0.5), 'median centre error (mm)').toBeLessThanOrEqual(1);
        expect.soft(quant(laterErr, 0.95), 'p95 centre error (mm)').toBeLessThanOrEqual(2);
        expect.soft(dups, 'duplicates').toBe(0);
        expect.soft(falseMissing / Math.max(1, catalogRows), 'false missing share').toBeLessThanOrEqual(0.01);
      },
      60 * 60_000,
    );
  }
});
