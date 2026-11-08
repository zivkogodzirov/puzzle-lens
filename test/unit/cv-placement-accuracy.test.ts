/**
 * Box placement accuracy (M4, PLAN §7) end to end on synthetic sets: render the set's overview (and
 * 2× close-ups), find pieces (marker-free scan), read shapes, straighten each piece into a patch,
 * place it on the puzzle's art (the "box picture", optionally degraded like a photo of a printed
 * lid), and compare with the true cell. Opt-in (minutes):
 *
 *   PLACE_ACCURACY=1 [PLACE_SETS=val48,val300] [PLACE_BOX=clean|photo] npx vitest run --project unit test/unit/cv-placement-accuracy.test.ts
 */
import { describe, expect, it } from 'vitest';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { readShape, READ_OK } from '../../src/cv/shapeRead';
import { buildBoxGrid, extractPatch, patchStats, placePiece, type PiecePatch } from '../../src/cv/placement';
import type { Vec2 } from '../../src/project/types';
import { getCv } from '../helpers/cv';
import { renderScene, segmentationScore, type SynthScene } from '../synth/index';
import type { SynthArt } from '../synth/types';
import { ALL_SETS, sceneOptions } from '../synth/sets';

const RUN = process.env.PLACE_ACCURACY === '1';
const SETS = (process.env.PLACE_SETS ?? 'val48').split(',') as Array<keyof typeof ALL_SETS>;
const BOX = process.env.PLACE_BOX ?? 'photo';
const buf = (s: SynthScene) => ({ data: s.rgba, width: s.width, height: s.height, stride: s.stride });

/** The art as a photographed box lid: slightly blurred, warmer and less saturated, a little darker. */
function boxPicture(art: SynthArt): { data: Uint8Array; width: number; height: number; stride: number } {
  const { width: W, height: H, rgba } = art;
  if (BOX === 'clean') return { data: rgba, width: W, height: H, stride: W * 4 };
  const out = new Uint8Array(rgba.length);
  const r = Math.max(1, Math.round(Math.min(W, H) / 900));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(W - 1, Math.max(0, x + dx));
          const yy = Math.min(H - 1, Math.max(0, y + dy));
          const k = (yy * W + xx) * 4;
          s0 += rgba[k]!;
          s1 += rgba[k + 1]!;
          s2 += rgba[k + 2]!;
          n++;
        }
      const R = s0 / n;
      const G = s1 / n;
      const B = s2 / n;
      const Y = 0.3 * R + 0.59 * G + 0.11 * B;
      const sat = 0.85;
      const k = (y * W + x) * 4;
      out[k] = Math.min(255, (Y + (R - Y) * sat) * 0.92 + 6);
      out[k + 1] = Math.min(255, (Y + (G - Y) * sat) * 0.9 + 2);
      out[k + 2] = Math.min(255, (Y + (B - Y) * sat) * 0.82);
      out[k + 3] = 255;
    }
  return { data: out, width: W, height: H, stride: W * 4 };
}

describe.skipIf(!RUN)('box placement accuracy (synthetic)', () => {
  for (const setName of SETS)
    it(`${setName} (${BOX} box picture)`, async () => {
      const cv = await getCv();
      const set = ALL_SETS[setName];
      const keys = [...new Set(set.items.map((i) => i.puzzleKey))].slice(0, Number(process.env.PLACE_PUZZLES ?? 99));
      const dump: Array<{ s: number[]; right: number; cells: number }> = [];
      const res = { n: 0, top1: 0, top5: 0, strong: 0, strongOk: 0, likely: 0, likelyOk: 0, several: 0, ms: 0, border: 0, borderTop1: 0 };
      for (const key of keys) {
        const items = set.items.filter((i) => i.puzzleKey === key && i.name.includes('-b0-'));
        const opts0 = sceneOptions(items[0]!);
        const pz = opts0.puzzle;
        const box = buildBoxGrid(boxPicture(pz.art), pz.cols, pz.rows);
        const pieces: Array<{ id: string; patch: PiecePatch; flats: boolean[] | null; sure: boolean }> = [];
        for (const item of items) {
          const opts = sceneOptions(item);
          const s = await renderScene({ ...opts, markers: [] });
          const zoom = item.kind === 'detail' ? 2 : 1;
          const r = scanMarkerless(cv, buf(s), { catalog: [], zoom, kind: item.kind === 'detail' ? 'detail' : 'overview', table: null, pieceAreaShare: 1 });
          const ppm = r.pxPerMm!;
          const sc = segmentationScore(r.pieces, s.truth);
          for (const m of sc.matches) {
            const f = r.pieces[m.foundIndex]!;
            const t = s.truth.pieces.find((p) => p.id === m.id)!;
            if (f.flags.cut || f.flags.clump || t.faceDown) continue;
            const rd = readShape(
              f.outlineImg.map((v) => v / ppm),
              [pz.cellMm[0] * ppm, pz.cellMm[1] * ppm].map((v) => v / ppm) as Vec2,
            );
            if (!rd) continue;
            const corners = rd.corners.map(([x, y]) => [x * ppm, y * ppm] as Vec2);
            const patch = extractPatch(buf(s), corners, f.outlineImg);
            if (!patch) continue;
            const sure = Boolean(rd.kind) && rd.quality >= READ_OK;
            pieces.push({ id: m.id, patch, flats: rd.sides.map((sd) => sd.kind === 'flat'), sure });
          }
        }
        // One-time colour match over the whole batch (RESEARCH §9.5).
        const ps = patchStats(pieces.map((p) => p.patch));
        const colour = ps ? { from: ps, to: box.stats } : null;
        for (const p of pieces) {
          const t0 = performance.now();
          const pl = placePiece(box, p.patch, { flats: p.flats, flatsSure: p.sure, colour });
          res.ms += performance.now() - t0;
          const [row, col] = p.id
            .slice(1)
            .split('c')
            .map((v) => Number(v));
          const ok = (k: number) => pl.top.slice(0, k).some((q) => q.col === col && q.row === row);
          if (process.env.PLACE_DUMP)
            dump.push({ s: pl.top.map((q) => q.score), right: pl.top.findIndex((q) => q.col === col && q.row === row), cells: pz.cols * pz.rows });
          res.n++;
          if (ok(1)) res.top1++;
          if (ok(5)) res.top5++;
          if (row === 0 || col === 0 || row === pz.rows - 1 || col === pz.cols - 1) {
            res.border++;
            if (ok(1)) res.borderTop1++;
          }
          if (pl.verdict === 'strong') {
            res.strong++;
            if (ok(1)) res.strongOk++;
          } else if (pl.verdict === 'likely') {
            res.likely++;
            if (ok(1)) res.likelyOk++;
          } else res.several++;
        }
      }
      const pc = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)} %`;
      console.log(
        `${setName} ${BOX}: ${res.n} pieces; top-1 ${pc(res.top1, res.n)}, top-5 ${pc(res.top5, res.n)}; border pieces top-1 ${pc(res.borderTop1, res.border)}; ` +
          `Strong ${pc(res.strong, res.n)} of pieces (right ${pc(res.strongOk, res.strong)}), Likely ${pc(res.likely, res.n)} (right ${pc(res.likelyOk, res.likely)}), Several ${pc(res.several, res.n)}; ${(res.ms / Math.max(1, res.n)).toFixed(0)} ms per piece`,
      );
      if (process.env.PLACE_DUMP) (await import('node:fs')).writeFileSync(`${process.env.PLACE_DUMP}-${setName}.json`, JSON.stringify(dump));
      expect(res.n).toBeGreaterThan(0);
    }, 3_600_000);
});
