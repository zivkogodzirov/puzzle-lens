/**
 * Re-identification over rescans (M5 part 3, PLAN §7 "Re-identification"), opt-in, several minutes:
 *
 *   REID_ACCURACY=1 [REID_SETS=val48,val300] npx vitest run --project unit test/unit/cv-reid-accuracy.test.ts
 *
 * Per puzzle (first batch, marker-free): an overview, then 5 rescans. Before each rescan, 20 % of
 * the pieces are moved by hand (30–90 mm, turned up to 180°), 10 % are taken away (and put back at
 * the next rescan). The rescans vary the camera: moved off-centre, turned, tilted up to 12°, 1× and
 * 2×, and the light (exposure ±0.4 EV, the lamp from another side). Each photo is scanned
 * (registration onto the catalog) and merged with planMerge, as the app does.
 *
 * Every catalog row is traced to the truth piece it was created from. Reported (PLAN targets):
 * - duplicates: truth pieces with more than one row (any status), target 0;
 * - wrong merges: a row updated by a sighting of another piece, target ≤ 0.5 % of updates;
 * - pieces on the table at the end that the catalog shows at a wrong place (> 6 mm, or "missing").
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { applyH } from '../../src/geo/homography';
import { planMerge, shapeSignature, shapeDistance } from '../../src/project/catalog';
import { fingerprintDistance } from '../../src/cv/fingerprint';
import { readPiece } from '../../src/cv/readPiece';
import type { Mat3, PieceRow, Vec2 } from '../../src/project/types';
import { getCv, type Cv } from '../helpers/cv';
import { centroid, renderScene, segmentationScore, type SceneOptions, type SynthScene } from '../synth/index';
import { ALL_SETS, sceneOptions } from '../synth/sets';

const RUN = process.env.REID_ACCURACY === '1';
const SETS = (process.env.REID_SETS ?? 'val48,val300').split(',').map((s) => s.trim()) as Array<keyof typeof ALL_SETS>;
const RESCANS = 5;
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

/** Least-squares similarity src → dst. */
function fitSim(src: Vec2[], dst: Vec2[]): Mat3 {
  const n = src.length;
  let [sx, sy, dx, dy] = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    sx += src[i]![0];
    sy += src[i]![1];
    dx += dst[i]![0];
    dy += dst[i]![1];
  }
  [sx, sy, dx, dy] = [sx / n, sy / n, dx / n, dy / n];
  let [a, b, q] = [0, 0, 0];
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

describe.skipIf(!RUN)('re-identification over rescans', () => {
  let cv: Cv;
  beforeAll(async () => {
    cv = await getCv();
  });

  for (const name of SETS) {
    it(
      name,
      async () => {
        const set = ALL_SETS[name];
        const keys = [...new Set(set.items.map((i) => i.puzzleKey))];
        let dups = 0;
        let rows = 0;
        let updates = 0;
        let wrong = 0;
        let pieces = 0;
        let lost = 0;
        let photos = 0;
        let registered = 0;
        let movedTotal = 0;
        let settled = 0;
        let pendingEnd = 0;
        let pendingRight = 0;
        const lines: string[] = [];
        for (let k = 0; k < keys.length; k++) {
          const ov = set.items.find((i) => i.puzzleKey === keys[k] && i.name.includes('-b0-') && i.kind === 'overview')!;
          const base: SceneOptions = { ...sceneOptions(ov), markers: [] };
          const all = base.pieceIds ?? base.puzzle.pieces.map((p) => p.id);
          const R = rng(1000 + k);
          const moves: NonNullable<SceneOptions['moves']> = {};
          let away = new Set<string>();
          let catalog: PieceRow[] = [];
          let nid = 0;
          const rowTruth = new Map<string, string>();
          let S: Mat3 | null = null;
          let last: SynthScene | null = null;
          for (let shot = 0; shot <= RESCANS; shot++) {
            if (shot > 0) {
              // The owner's hands: pieces taken away come back; 20 % move; 10 % are taken away.
              const back = away;
              away = new Set();
              for (const id of all) {
                if (back.has(id)) continue;
                const r = R();
                if (r < 0.2) {
                  const m = moves[id] ?? { dxMm: 0, dyMm: 0, dAngleDeg: 0 };
                  const ang = R() * 2 * Math.PI;
                  const dist = 30 + 60 * R();
                  moves[id] = { dxMm: m.dxMm + dist * Math.cos(ang), dyMm: m.dyMm + dist * Math.sin(ang), dAngleDeg: (m.dAngleDeg ?? 0) + (R() - 0.5) * 360 };
                  movedTotal++;
                } else if (r < 0.3) away.add(id);
              }
            }
            const zoom2 = shot === 3 || shot === 5;
            const cam: Partial<SceneOptions['camera']> =
              shot === 0
                ? {}
                : {
                    x: base.camera.x + (R() - 0.5) * (zoom2 ? 120 : 80),
                    y: base.camera.y + (R() - 0.5) * (zoom2 ? 120 : 80),
                    yawDeg: (base.camera.yawDeg ?? 0) + (R() - 0.5) * 120,
                    tiltDeg: 12 * R(),
                    tiltDirDeg: 360 * R(),
                    heightMm: base.camera.heightMm * (0.9 + 0.25 * R()),
                    zoom: zoom2 ? 2 : 1,
                  };
            const s = await renderScene({
              ...base,
              hidden: [...away],
              moves: { ...moves },
              camera: { ...base.camera, ...cam },
              exposure: shot === 0 ? 0 : (R() - 0.5) * 0.8,
              light: { ...base.light, dirDeg: shot === 0 ? base.light?.dirDeg : 360 * R() },
            });
            photos++;
            const r = scanMarkerless(cv, buf(s), { catalog, zoom: zoom2 ? 2 : 1, kind: zoom2 ? 'detail' : 'overview', table: null, pieceAreaShare: 1 });
            if (!r.registered) continue;
            registered++;
            const sc = segmentationScore(r.pieces, s.truth);
            const truthOf = new Map(sc.matches.map((m) => [m.foundIndex, m.id]));
            if (shot === 0) {
              const pairs = sc.matches.map((m) => [r.pieces[m.foundIndex]!.centreMm, centroid(s.truth.pieces.find((p) => p.id === m.id)!.outlineMm)] as const);
              S = fitSim(
                pairs.map((p) => p[0]),
                pairs.map((p) => p[1]),
              );
            }
            const view: Vec2[] = (
              [
                [0, 0],
                [s.width - 1, 0],
                [s.width - 1, s.height - 1],
                [0, s.height - 1],
              ] as Vec2[]
            ).map((c) => applyH(r.imgToCatalog!, c));
            // As the app's scan: each clean piece straightened, with its sides and fingerprint.
            const withPatches = r.pieces.map((p) => {
              const rp = readPiece(buf(s), p, r.pxPerMm ?? 4);
              return { ...p, patch: rp ? { blob: new Blob([]), flats: rp.flats, sure: rp.sure, sides: rp.sides, sideConf: rp.sideConf, fp: rp.fp } : null };
            });
            const plan = planMerge(catalog, withPatches, {
              projectId: 'p',
              snapId: `s${shot}`,
              pxPerMm: r.pxPerMm ?? 4,
              now: shot + 1,
              newId: () => `n${nid++}`,
              thumbId: (id) => id,
              view,
            });
            // Which sighting each row came from: the found piece at its new centre.
            const sightingAt = (row: PieceRow): number =>
              r.pieces.findIndex((f) => Math.abs(f.centreMm[0] - row.table.x) < 1e-6 && Math.abs(f.centreMm[1] - row.table.y) < 1e-6);
            for (const a of plan.added) {
              const t = truthOf.get(sightingAt(a));
              if (t) rowTruth.set(a.id, t);
              const orig = t ? catalog.find((c) => rowTruth.get(c.id) === t) : undefined;
              if (orig && process.env.REID_WHY) {
                const f = withPatches[sightingAt(a)]!;
                const inView = (() => {
                  let c = false;
                  for (let i2 = 0, j2 = view.length - 1; i2 < view.length; j2 = i2++) {
                    const [xi, yi] = view[i2]!;
                    const [xj, yj] = view[j2]!;
                    if (yi > orig.table.y !== yj > orig.table.y && orig.table.x < ((xj - xi) * (orig.table.y - yi)) / (yj - yi) + xi) c = !c;
                  }
                  return c;
                })();
                const fpd = f.patch?.fp && orig.patch?.fp ? fingerprintDistance(f.patch.fp, orig.patch.fp, f.patch.sides, orig.patch.sides).d : NaN;
                const shp = shapeDistance(shapeSignature(a.outlineMm), shapeSignature(orig.outlineMm));
                const area = Math.abs(orig.areaMm2 - a.areaMm2) / Math.max(orig.areaMm2, a.areaMm2);
                const moved = Math.hypot(orig.table.x - a.table.x, orig.table.y - a.table.y);
                // The true piece's cost against this sighting, and the best other piece's.
                const sig = shapeSignature(a.outlineMm);
                const costOf = (c: PieceRow) =>
                  f.patch?.fp && c.patch?.fp
                    ? fingerprintDistance(f.patch.fp, c.patch.fp, f.patch.sides, c.patch.sides).d + 6 * shapeDistance(sig, shapeSignature(c.outlineMm))
                    : Infinity;
                const own = costOf(orig);
                let other = Infinity;
                for (const c of catalog) if (c.id !== orig.id && rowTruth.get(c.id) !== t) other = Math.min(other, costOf(c));
                const cls =
                  own > 30 ? 'too costly' : own < other ? (other < 1.35 * own + 2 ? 'best, but margin' : 'best (blocked elsewhere?)') : 'not the best';
                lines.push(`  WHY ${cls} own ${own.toFixed(1)} other ${other.toFixed(1)}`);
                lines.push(
                  `  DUP ${keys[k]} shot ${shot} ${t}: orig ${orig.status} ${inView ? 'in view' : 'out of view'} moved ${moved.toFixed(0)} mm; fp ${orig.patch?.fp ? 'yes' : 'NO'}/${f.patch?.fp ? 'yes' : 'NO'} d ${fpd.toFixed(1)} shape ${shp.toFixed(2)} area ${(area * 100).toFixed(0)} % flags ${
                    Object.keys(f.flags)
                      .filter((x) => (f.flags as Record<string, unknown>)[x])
                      .join('+') || '-'
                  }`,
                );
              }
            }
            for (const u of plan.updates) {
              if (u.status !== 'table' || u.table.lastSeen !== shot + 1) continue;
              const i = sightingAt(u);
              if (i < 0) continue;
              const t = truthOf.get(i);
              const mine = rowTruth.get(u.id);
              updates++;
              if (process.env.REID_SPOT) {
                const before = catalog.find((c) => c.id === u.id);
                const f = withPatches[i]!;
                if (before && Math.hypot(before.table.x - u.table.x, before.table.y - u.table.y) < 15 && before.patch?.fp && f.patch?.fp) {
                  const d = fingerprintDistance(f.patch.fp, before.patch.fp, f.patch.sides, before.patch.sides).d;
                  const sh = shapeDistance(shapeSignature(before.outlineMm), shapeSignature(f.outlineMm.map((v, kk) => v - (kk % 2 ? f.centreMm[1] : f.centreMm[0]))));
                  lines.push(`  SPOT ${t && mine && t !== mine ? 'WRONG' : 'right'} fp ${d.toFixed(1)} shape ${sh.toFixed(2)}`);
                }
              }
              if (t && mine && t !== mine) {
                wrong++;
                const before = catalog.find((c) => c.id === u.id);
                const jump = before ? Math.hypot(before.table.x - u.table.x, before.table.y - u.table.y) : -1;
                lines.push(`  WM ${jump > 15 ? 'as moved' : 'same spot'} jump ${jump.toFixed(0)} mm`);
                lines.push(`  wrong merge ${keys[k]} shot ${shot}: row ${u.id} (${mine}) took a sighting of ${t}`);
              }
            }
            for (const m of plan.merged) {
              const a = rowTruth.get(m.from);
              const b = rowTruth.get(m.into);
              settled++;
              if (a && b && a !== b) {
                wrong++;
                lines.push(`  wrong settle ${keys[k]} shot ${shot}: pending ${m.from} (${a}) merged into ${m.into} (${b})`);
              }
            }
            const upd = new Map(plan.updates.map((u) => [u.id, u]));
            const gone = new Set(plan.removed);
            catalog = catalog
              .filter((c) => !gone.has(c.id))
              .map((c) => upd.get(c.id) ?? c)
              .concat(plan.added);
            last = s;
          }
          // Duplicates: truth pieces with more than one row.
          const per = new Map<string, number>();
          for (const c of catalog) {
            if (c.status === 'pending') {
              pendingEnd++;
              // Settled right by the owner when its true piece is among those it may be.
              if (c.maybe?.some((id) => rowTruth.get(id) === rowTruth.get(c.id))) pendingRight++;
              continue;
            }
            const t = rowTruth.get(c.id);
            if (t) per.set(t, (per.get(t) ?? 0) + 1);
          }
          const d = [...per.entries()].filter(([, v]) => v > 1);
          dups += d.length;
          rows += catalog.length;
          // Pieces on the table in the last photo: their row at the right place, on the table.
          if (S && last) {
            for (const t of last.truth.pieces) {
              if (t.visibleShare < 0.99 || t.faceDown) continue;
              pieces++;
              const tc = centroid(t.outlineMm);
              const mine = catalog.filter((c) => rowTruth.get(c.id) === t.id && c.status === 'table');
              const ok = mine.some((c) => {
                const p = applyH(S!, [c.table.x, c.table.y]);
                return Math.hypot(p[0] - tc[0], p[1] - tc[1]) < 6;
              });
              if (!ok) lost++;
            }
          }
          lines.push(
            `  ${keys[k]}: ${catalog.length} rows for ${all.length} pieces, duplicates ${d.length}${d.length ? ` (${d.map(([t, v]) => `${t}×${v}`).join(', ')})` : ''}, ` +
              `missing ${catalog.filter((c) => c.status === 'missing').length}`,
          );
          if (k === 0 && name === SETS[0] && last) {
            const out = '/private/tmp/claude-501/-Users-zivkogodzirov-Downloads-puzzle-solver-ios/05876976-61fb-4285-9668-5e483433ae5e/scratchpad/reid/';
            mkdirSync(out, { recursive: true });
            writeFileSync(`${out}${keys[k]}-last.jpg`, last.jpeg);
          }
        }
        console.log(
          `\n${name}: re-identification over ${RESCANS} rescans (${keys.length} puzzles, ${photos} photos, ${registered} registered, ${movedTotal} moves)\n` +
            `  duplicates          ${dups} (rows ${rows}; not counting rows waiting to be checked)\n` +
            `  to check at the end ${pendingEnd} (the true piece among those offered: ${pendingRight}); settled by later scans ${settled}\n` +
            `  wrong merges        ${wrong} of ${updates} updates (${((100 * wrong) / Math.max(1, updates)).toFixed(2)} %)\n` +
            `  last photo          ${pieces - lost} of ${pieces} pieces on the table at the right place in the catalog\n` +
            lines.join('\n'),
        );
        expect.soft(dups, 'duplicates').toBe(0);
        expect.soft(wrong / Math.max(1, updates), 'wrong merges').toBeLessThanOrEqual(0.005);
      },
      3_600_000,
    );
  }
});
