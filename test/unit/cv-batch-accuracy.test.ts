/**
 * Batches (M7, PLAN §7 "multi-batch re-identification"), opt-in, minutes:
 *
 *   BATCH_ACCURACY=1 [BATCH_SETS=val300,val1000] [BATCH_SET='{"asideCost":12}'] npx vitest run --project unit test/unit/cv-batch-accuracy.test.ts
 *
 * Per puzzle: a first batch is spread out and photographed (overview, marker-free) and catalogued.
 * Then a new batch is started (every piece set aside) and a second batch spread in a new layout,
 * under other light: mostly new pieces, plus some returning from the first batch. Its first photo
 * starts a fresh table and is merged as the app does (src/project/catalog.ts planMerge).
 *
 * - val300 (15 × 20): first batch 150 pieces; second 100 new + 50 returning.
 * - val1000 (28 × 36): first batch = the set's first 300-piece batch; second = 200 of the next
 *   batch + 100 returning (300 on the table, 300 set aside).
 *
 * Reported: returning pieces recognised right / wrong / added twice / to check (with the right one
 * offered); new pieces added / wrongly merged into a set-aside piece / to check.
 */
import { describe, expect, it } from 'vitest';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { applyH } from '../../src/geo/homography';
import { BATCH, planMerge, shapeDistance, shapeSignature } from '../../src/project/catalog';
import { fingerprintDistance } from '../../src/cv/fingerprint';
import { readPiece } from '../../src/cv/readPiece';
import type { PieceRow, Vec2 } from '../../src/project/types';
import { getCv } from '../helpers/cv';
import { renderScene, segmentationScore, type SceneOptions, type SynthScene } from '../synth/index';
import { ALL_SETS, sceneOptions } from '../synth/sets';

const RUN = process.env.BATCH_ACCURACY === '1';
const SETS = (process.env.BATCH_SETS ?? 'val300').split(',').map((s) => s.trim()) as Array<keyof typeof ALL_SETS>;
if (process.env.BATCH_SET) Object.assign(BATCH, JSON.parse(process.env.BATCH_SET));
const buf = (s: SynthScene) => ({ data: s.rgba, width: s.width, height: s.height, stride: s.stride });

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = <T>(xs: T[], R: () => number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

describe.skipIf(!RUN)('batches (synthetic)', () => {
  for (const name of SETS)
    it(`${name}: a new batch with returning pieces`, async () => {
      const cv = await getCv();
      const set = ALL_SETS[name];
      const keys = [...new Set(set.items.map((i) => i.puzzleKey))].slice(0, Number(process.env.BATCH_PUZZLES ?? 99));
      const dump: number[][] = [];
      const T = { ret: 0, right: 0, wrong: 0, dup: 0, pend: 0, pendHas: 0, fresh: 0, freshOk: 0, freshWrong: 0, freshPend: 0 };
      for (let k = 0; k < keys.length; k++) {
        const ov0 = set.items.find((i) => i.puzzleKey === keys[k] && i.name.includes('-b0-') && i.kind === 'overview')!;
        const ov1 = set.items.find((i) => i.puzzleKey === keys[k] && i.name.includes('-b1-') && i.kind === 'overview');
        const base: SceneOptions = { ...sceneOptions(ov0), markers: [] };
        const R = rng(500 + k);
        const all = base.puzzle.pieces.map((p) => p.id);
        let first: string[];
        let second: string[];
        if (ov1) {
          first = base.pieceIds ?? all;
          const next = sceneOptions(ov1).pieceIds!;
          second = [...shuffle(next, R).slice(0, 200), ...shuffle(first, R).slice(0, 100)];
        } else {
          const order = shuffle(all, R);
          first = order.slice(0, 150);
          second = [...order.slice(150, 250), ...shuffle(first, R).slice(0, 50)];
        }
        const returning = new Set(second.filter((id) => first.includes(id)));
        // Batch 1.
        const s1 = await renderScene({ ...base, pieceIds: first });
        const r1 = scanMarkerless(cv, buf(s1), { catalog: [], zoom: 1, kind: 'overview', table: null, pieceAreaShare: 1 });
        const sc1 = segmentationScore(r1.pieces, s1.truth);
        const t1 = new Map(sc1.matches.map((m) => [m.foundIndex, m.id]));
        const patches = (s: SynthScene, r: ReturnType<typeof scanMarkerless>) =>
          r.pieces.map((p) => {
            const rp = readPiece(buf(s), p, r.pxPerMm ?? 4);
            return { ...p, patch: rp ? { blob: new Blob([]), flats: rp.flats, sure: rp.sure, sides: rp.sides, sideConf: rp.sideConf, fp: rp.fp } : null };
          });
        let nid = 0;
        const f1 = patches(s1, r1);
        const plan1 = planMerge([], f1, { projectId: 'p', snapId: 's1', pxPerMm: r1.pxPerMm ?? 4, now: 1, newId: () => `a${nid++}`, thumbId: (id) => id });
        const rowTruth = new Map<string, string>();
        for (const a of plan1.added) {
          const i = r1.pieces.findIndex((f) => f.centreMm[0] === a.table.x && f.centreMm[1] === a.table.y);
          const t = t1.get(i);
          if (t) rowTruth.set(a.id, t);
        }
        // A new batch: everything set aside; batch 2 in a new layout, other light.
        const aside: PieceRow[] = plan1.added.map((p) => ({ ...p, status: 'aside' }));
        const s2 = await renderScene({
          ...base,
          pieceIds: second,
          seed: base.seed + 7919,
          camera: { ...base.camera, yawDeg: (base.camera.yawDeg ?? 0) + 25, x: base.camera.x + 30 },
          exposure: 0.3,
          light: { ...base.light, dirDeg: ((base.light?.dirDeg ?? 0) + 140) % 360 },
        });
        const r2 = scanMarkerless(cv, buf(s2), { catalog: [], zoom: 1, kind: 'overview', table: null, pieceAreaShare: 1 });
        const sc2 = segmentationScore(r2.pieces, s2.truth);
        const t2 = new Map(sc2.matches.map((m) => [m.foundIndex, m.id]));
        const view: Vec2[] = (
          [
            [0, 0],
            [s2.width - 1, 0],
            [s2.width - 1, s2.height - 1],
            [0, s2.height - 1],
          ] as Vec2[]
        ).map((c) => applyH(r2.imgToCatalog!, c));
        const f2 = patches(s2, r2);
        const plan2 = planMerge(aside, f2, {
          projectId: 'p',
          snapId: 's2',
          pxPerMm: r2.pxPerMm ?? 4,
          now: 2,
          newId: () => `b${nid++}`,
          thumbId: (id) => id,
          view,
        });
        const at = (c: Vec2) => (u: PieceRow) => u.table.x === c[0] && u.table.y === c[1];
        if (process.env.BATCH_DUMP) {
          // Every new-batch sighting × set-aside piece: fingerprint and shape distances, and whether it's the same piece.
          const truthRow = new Map([...rowTruth].map(([id, t]) => [t, id]));
          f2.forEach((f, i) => {
            const t = t2.get(i);
            if (!t || !f.patch?.fp) return;
            const sig = shapeSignature(f.outlineMm.map((v, kk) => v - (kk % 2 ? f.centreMm[1] : f.centreMm[0])));
            for (const p of aside) {
              if (!p.patch?.fp) continue;
              const areaD = Math.abs(p.areaMm2 - f.areaMm2) / Math.max(p.areaMm2, f.areaMm2, 1);
              const fpd = fingerprintDistance(f.patch.fp, p.patch.fp, f.patch.sides, p.patch.sides).d;
              const sh = shapeDistance(sig, shapeSignature(p.outlineMm));
              if (fpd + 6 * sh > 30) continue;
              dump.push([fpd, sh, areaD, truthRow.get(t) === p.id ? 1 : 0]);
            }
          });
        }
        const c = { ret: 0, right: 0, wrong: 0, dup: 0, pend: 0, fresh: 0, freshOk: 0, freshWrong: 0, freshPend: 0 };
        f2.forEach((f, i) => {
          const t = t2.get(i);
          if (!t || f.flags.cut) return;
          const u = plan2.updates.find(at(f.centreMm));
          const a = plan2.added.find(at(f.centreMm));
          const known = [...rowTruth].find(([, tt]) => tt === t)?.[0];
          if (returning.has(t) && known) {
            T.ret++;
            c.ret++;
            if (u) u.id === known ? (T.right++, c.right++) : (T.wrong++, c.wrong++);
            else if (a?.status === 'pending') {
              T.pend++;
              c.pend++;
              if (a.maybe?.includes(known)) T.pendHas++;
            } else if (a) (T.dup++, c.dup++);
          } else if (!returning.has(t)) {
            T.fresh++;
            c.fresh++;
            if (u) (T.freshWrong++, c.freshWrong++);
            else if (a?.status === 'pending') (T.freshPend++, c.freshPend++);
            else if (a) (T.freshOk++, c.freshOk++);
          }
        });
        console.log(
          `  ${keys[k]}: returning ${c.ret}: right ${c.right}, wrong ${c.wrong}, added twice ${c.dup}, to check ${c.pend}; new ${c.fresh}: added ${c.freshOk}, merged wrongly ${c.freshWrong}, to check ${c.freshPend}`,
        );
      }
      const pc = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)} %`;
      console.log(
        `${name} new batch: returning ${T.ret}: right ${pc(T.right, T.ret)}, wrong ${pc(T.wrong, T.ret)}, added twice ${pc(T.dup, T.ret)}, to check ${pc(T.pend, T.ret)} (right one offered ${T.pendHas}); ` +
          `new ${T.fresh}: added ${pc(T.freshOk, T.fresh)}, merged wrongly ${pc(T.freshWrong, T.fresh)}, to check ${pc(T.freshPend, T.fresh)}`,
      );
      if (process.env.BATCH_DUMP) (await import('node:fs')).writeFileSync(`${process.env.BATCH_DUMP}-${name}.json`, JSON.stringify(dump));
      expect(T.ret).toBeGreaterThan(0);
    }, 3_600_000);
});
