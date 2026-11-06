/**
 * Piece finding accuracy on the frozen synthetic sets (PLAN §7 "Segmentation" and "Position").
 *
 * Slow (renders every 12 MP photo of the sets: ~3 minutes for test48 + test300 on an M-series
 * Mac), so it is opt-in and stays out of the CI run:
 *
 *   PIECE_ACCURACY=1 npx vitest run --project unit test/unit/cv-piece-accuracy.test.ts
 *   PIECE_ACCURACY=1 PIECE_SETS=val48,val300 npx vitest run …   (tuning sets; default test48,test300)
 *
 * Rules (RESEARCH §16): thresholds were tuned on val48/val300 only; test sets are for reporting.
 * The assertions are the PLAN §7 bars, unchanged: if a bar is not met this test fails and the
 * printed table says by how much (see the report in the M2 notes). Pooled per set:
 *   - recall / precision at IoU ≥ 0.85 with the true top face, non-touching pieces (score.ts);
 *   - centre error (table mm) of matched pieces: median ≤ 1 mm, 95th percentile ≤ 2 mm;
 *   - split by 1× / 2×, glare on / off, hand shadow, and pale pieces (cell colour within ΔE 15 of
 *     the table).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wasmBytes } from '../../src/cv/loadCv';
import { findPieces } from '../../src/cv/pieceFinder';
import { cvCounters } from '../../src/cv/scope';
import { deltaE, pxPerMmAt, rgbToLab } from '../../src/cv/tableModel';
import { invertH } from '../../src/geo/homography';
import { markerCornersMm, suggestedMarkerCentres } from '../../src/markers/layout';
import type { MarkerMap } from '../../src/project/types';
import { getCv, type Cv } from '../helpers/cv';
import { cellMeanRgb, renderScene, segmentationScore } from '../synth/index';
import { ALL_SETS, puzzleFor, sceneOptions, type SynthSet } from '../synth/sets';

const RUN = process.env.PIECE_ACCURACY === '1';
const SETS = (process.env.PIECE_SETS ?? 'test48,test300').split(',').map((s) => s.trim()) as Array<keyof typeof ALL_SETS>;

/** The suggested marker layout the generator uses, as a marker map. */
function suggestedMap(): MarkerMap {
  return {
    dictionary: 'DICT_4X4_50',
    markerSizeMm: 54,
    printScale: 1,
    markers: suggestedMarkerCentres(700, 500).map((c, id) => ({ id, cornersMm: markerCornersMm(c[0], c[1], 0) })),
    rmsMm: 0,
    createdAt: 0,
    snapId: 'synthetic',
  };
}

interface Tally {
  eligible: number;
  matched: number;
  considered: number;
  fp: number;
  pos: number[];
}
const tally = (): Tally => ({ eligible: 0, matched: 0, considered: 0, fp: 0, pos: [] });

function quantile(v: number[], q: number): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
}

/** Lower end of the Wilson 95 % interval (PLAN §7: pass/fail on the conservative end). */
function wilsonLow(k: number, n: number): number {
  if (!n) return NaN;
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
}

async function evaluate(cv: Cv, set: SynthSet): Promise<{ groups: Record<string, Tally>; ms: number[] }> {
  const map = suggestedMap();
  const tableLab = rgbToLab(236, 236, 232);
  const groups: Record<string, Tally> = {};
  const ms: number[] = [];
  const add = (k: string, e: number, m: number, c: number, fp: number, pos: number[]) => {
    const g = (groups[k] ??= tally());
    g.eligible += e;
    g.matched += m;
    g.considered += c;
    g.fp += fp;
    g.pos.push(...pos);
  };
  for (const item of set.items) {
    const scene = await renderScene(sceneOptions(item));
    const imgToTable = invertH(scene.tableToImg)!;
    const ppm = pxPerMmAt(scene.tableToImg, imgToTable, [(scene.width - 1) / 2, (scene.height - 1) / 2]);
    const t0 = performance.now();
    const res = findPieces(cv, { data: scene.rgba, width: scene.width, height: scene.height, stride: scene.stride }, { imgToTable, tableToImg: scene.tableToImg, map, table: null, pxPerMm: ppm, zoom: item.scene.camera.zoom });
    ms.push(performance.now() - t0);
    const sc = segmentationScore(res.pieces, scene.truth);
    const eligible = new Set(scene.truth.pieces.filter((p) => p.visibleShare >= 0.99 && !p.faceDown && p.touching.length === 0).map((p) => p.id));
    const matchedIds = new Set(sc.matches.filter((m) => eligible.has(m.id)).map((m) => m.id));
    const pos = sc.matches.filter((m) => eligible.has(m.id)).map((m) => m.positionErrorMm);
    const keys = ['all', item.scene.camera.zoom === 2 ? '2×' : '1×', item.scene.light?.glare ? 'glare on' : 'glare off', item.scene.handShadow ? 'hand shadow' : 'no hand shadow'];
    for (const k of keys) add(k, sc.eligible, sc.matched, sc.considered, sc.falsePositives.length, pos);
    // Pale pieces (cell colour within ΔE 15 of the table) and pieces lying in lamp glare.
    const puzzle = puzzleFor(item);
    const byId = new Map(puzzle.pieces.map((p) => [p.id, p]));
    const pale = [...eligible].filter((id) => {
      const sp = byId.get(id)!;
      const c = cellMeanRgb(puzzle, sp.col, sp.row);
      return deltaE(rgbToLab(c[0], c[1], c[2]), tableLab) < 15;
    });
    add('pale (ΔE<15)', pale.length, pale.filter((id) => matchedIds.has(id)).length, 0, 0, []);
    const inGlare = scene.truth.pieces.filter((p) => eligible.has(p.id) && p.glareShare > 0).map((p) => p.id);
    add('piece in glare', inGlare.length, inGlare.filter((id) => matchedIds.has(id)).length, 0, 0, []);
  }
  return { groups, ms };
}

describe.skipIf(!RUN)('piece finding accuracy (PLAN §7)', () => {
  let cv: Cv;
  beforeAll(async () => {
    cv = await getCv();
  });
  afterAll(() => {
    expect(cvCounters.liveScoped).toBe(0);
  });

  for (const name of SETS) {
    it(
      `${name}: recall/precision ≥ 98 % (IoU ≥ 0.85), position median ≤ 1 mm, p95 ≤ 2 mm`,
      async () => {
        const { groups, ms } = await evaluate(cv, ALL_SETS[name]);
        const lines = Object.entries(groups).map(([k, g]) => {
          const r = g.matched / g.eligible;
          const p = g.considered ? 1 - g.fp / g.considered : NaN;
          const pos = g.pos.length ? ` | centre median ${quantile(g.pos, 0.5).toFixed(2)} mm, p95 ${quantile(g.pos, 0.95).toFixed(2)} mm` : '';
          const prec = g.considered ? `, precision ${(p * 100).toFixed(1)} % (${g.considered - g.fp}/${g.considered})` : '';
          return `  ${k.padEnd(15)} recall ${(r * 100).toFixed(1)} % (${g.matched}/${g.eligible}; 95 % low ${(wilsonLow(g.matched, g.eligible) * 100).toFixed(1)} %)${prec}${pos}`;
        });
        console.log(`\n${name}: ${ALL_SETS[name].items.length} photos, findPieces ${quantile(ms, 0.5).toFixed(0)} ms median / ${Math.max(...ms).toFixed(0)} ms max, WASM ${(wasmBytes(cv) / 2 ** 20).toFixed(0)} MB\n${lines.join('\n')}`);
        const all = groups.all!;
        expect.soft(wilsonLow(all.matched, all.eligible), 'recall (95 % lower bound)').toBeGreaterThanOrEqual(0.98);
        expect.soft(wilsonLow(all.considered - all.fp, all.considered), 'precision (95 % lower bound)').toBeGreaterThanOrEqual(0.98);
        expect.soft(quantile(all.pos, 0.5), 'centre error median (mm)').toBeLessThanOrEqual(1);
        expect.soft(quantile(all.pos, 0.95), 'centre error p95 (mm)').toBeLessThanOrEqual(2);
      },
      30 * 60_000,
    );
  }
});
