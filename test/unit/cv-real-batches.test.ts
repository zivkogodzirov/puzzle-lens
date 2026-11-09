/**
 * Batches (M7) on the owner's photos (test/fixtures/real, kept out of git; skipped when missing):
 * IMG_9274–9277 show the same 21 pieces from four places. Each photo is the first batch; then a
 * new batch is started (everything set aside) and another of the photos is the new table's first
 * photo. The truth for each piece comes from placing the second photo on the first by the pieces'
 * positions (as a rescan of an unchanged table does).
 *
 * By default set-aside pieces aren't matched by their picture (src/project/catalog.ts BATCH), so
 * every piece is read as new: nothing may be mixed up. BATCH_SET='{"asideCost":16}' measures the
 * picture matching instead (2026-11-09: cost 16 → 162 of 252 recognised, 0 wrong; 20 → 202, 4
 * wrong; 12 → 126, 0 wrong).
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { readPiece } from '../../src/cv/readPiece';
import { BATCH, planMerge, shapeDistance, shapeSignature } from '../../src/project/catalog';
import { fingerprintDistance } from '../../src/cv/fingerprint';
import type { PieceRow, Vec2 } from '../../src/project/types';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import { applyH, invertH, mulH } from '../../src/geo/homography';
import { getCv, type Cv } from '../helpers/cv';
import { resizeBuffer } from '../helpers/images';
import { decodeRgba, REAL_DIR } from '../helpers/realFixtures';

const NAMES = ['IMG_9274', 'IMG_9275', 'IMG_9276', 'IMG_9277'];
const HAS = NAMES.every((n) => existsSync(`${REAL_DIR}${n}.jpeg`));

async function load(cv: Cv, n: string): Promise<PixelBuffer> {
  const img = await decodeRgba(`${REAL_DIR}${n}.jpeg`);
  const s = 4032 / Math.max(img.width, img.height);
  return s >= 1 ? img : resizeBuffer(cv, img, 4, Math.round(img.width * s), Math.round(img.height * s), cv.INTER_AREA);
}

if (process.env.BATCH_SET) Object.assign(BATCH, JSON.parse(process.env.BATCH_SET));
const relOutline = (o: number[], c: Vec2) => o.map((v, i) => v - c[i % 2]!);

describe('batches on the owner’s photos (M7)', () => {
  it.skipIf(!HAS)(
    'the same 21 pieces spread again in a new batch: nothing mixed up',
    async () => {
      const cv = await getCv();
      // Each photo read once: pieces with their straightened pictures, in its own (first-photo) frame.
      const scans = new Map<string, Array<Parameters<typeof planMerge>[1][number]>>();
      const views = new Map<string, Vec2[]>();
      const imgs = new Map<string, PixelBuffer>();
      const frames = new Map<string, number[]>();
      for (const n of NAMES) {
        const img = await load(cv, n);
        imgs.set(n, img);
        const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
        frames.set(n, r.imgToCatalog!);
        const ppm = r.pxPerMm ?? 8;
        scans.set(
          n,
          r.pieces.map((p) => {
            const rp = readPiece(img, p, ppm);
            return { ...p, patch: rp ? { blob: new Blob([]), flats: rp.flats, sure: rp.sure, sides: rp.sides, sideConf: rp.sideConf, fp: rp.fp } : null };
          }),
        );
        views.set(
          n,
          (
            [
              [0, 0],
              [img.width - 1, 0],
              [img.width - 1, img.height - 1],
              [0, img.height - 1],
            ] as Vec2[]
          ).map((c) => applyH(r.imgToCatalog!, c)),
        );
      }
      const lines: string[] = [];
      const total = { n: 0, right: 0, wrongM: 0, dup: 0, pend: 0, pendHas: 0 };
      for (const a of NAMES)
        for (const b of NAMES) {
          if (a === b) continue;
          let nid = 0;
          const first = planMerge([], scans.get(a)!, { projectId: 'p', snapId: 's1', pxPerMm: 8, now: 1, newId: () => `${a}-${nid++}`, thumbId: (id) => id });
          // A new batch: everything set aside.
          const aside: PieceRow[] = first.added.map((p) => ({ ...p, status: 'aside' }));
          const second = planMerge(aside, scans.get(b)!, {
            projectId: 'p',
            snapId: 's2',
            pxPerMm: 8,
            now: 2,
            newId: () => `new-${nid++}`,
            thumbId: (id) => id,
            view: views.get(b)!,
          });
          // Truth from positions: photo b placed on batch 1's table by the pieces (as a rescan of the
          // same layout does, M5), each of b's pieces then lies on its batch-1 piece.
          const reg = scanMarkerless(cv, imgs.get(b)!, { catalog: first.added, zoom: 1, kind: 'overview', table: null });
          expect(reg.registered).toBe(true);
          const bToA = mulH(reg.imgToCatalog!, invertH(frames.get(b)!)!);
          const truthOf = (c: Vec2): string | null => {
            const q = applyH(bToA, c);
            let best: string | null = null;
            let bd = Infinity;
            for (const p of first.added) {
              const d = Math.hypot(p.table.x - q[0], p.table.y - q[1]);
              if (d < bd) [bd, best] = [d, p.id];
            }
            return bd < 6 ? best : null;
          };
          // What the new batch made of each of b's pieces.
          const byPos = (c: Vec2) => (u: PieceRow) => Math.abs(u.table.x - c[0]) < 1e-6 && Math.abs(u.table.y - c[1]) < 1e-6;
          let right = 0;
          let wrong = 0;
          let dup = 0;
          let pend = 0;
          let pendHas = 0;
          let newOk = 0;
          for (const f of scans.get(b)!) {
            if (f.flags.cut) continue;
            const t = truthOf(f.centreMm);
            const u = second.updates.find(byPos(f.centreMm));
            const ad = second.added.find(byPos(f.centreMm));
            if (u) u.id === t ? right++ : wrong++;
            else if (ad?.status === 'pending') {
              pend++;
              if (t && ad.maybe?.includes(t)) pendHas++;
            } else if (ad) t ? dup++ : newOk++;
            if (process.env.BATCH_DEBUG && ((ad && ad.status !== 'pending' && t) || (u && u.id !== t))) {
              const tp = first.added.find((p) => p.id === t)!;
              const areaD = Math.abs(tp.areaMm2 - f.areaMm2) / Math.max(tp.areaMm2, f.areaMm2);
              const dE = Math.hypot(tp.colour.meanLab[0] - f.meanLab[0], tp.colour.meanLab[1] - f.meanLab[1], tp.colour.meanLab[2] - f.meanLab[2]);
              const fpd = f.patch?.fp && tp.patch?.fp ? fingerprintDistance(f.patch.fp, tp.patch.fp, f.patch.sides, tp.patch.sides).d : NaN;
              const shapeD = shapeDistance(shapeSignature(relOutline(f.outlineMm, f.centreMm)), shapeSignature(tp.outlineMm));
              const others = first.added
                .filter((p) => p.id !== t && p.patch?.fp && f.patch?.fp)
                .map(
                  (p) =>
                    fingerprintDistance(f.patch!.fp!, p.patch!.fp!, f.patch!.sides, p.patch!.sides).d +
                    6 * shapeDistance(shapeSignature(relOutline(f.outlineMm, f.centreMm)), shapeSignature(p.outlineMm)),
                )
                .sort((x, y) => x - y);
              console.log(
                `   ${a}→${b} ${u ? 'WRONG' : 'DUP'}: area ${(areaD * 100).toFixed(0)} %, ΔE ${dE.toFixed(1)}, fp ${fpd.toFixed(1)}, shape ${shapeD.toFixed(2)} → cost ${(fpd + 6 * shapeD).toFixed(1)}; next best other ${others[0]?.toFixed(1)}`,
              );
            }
          }
          total.right += right;
          total.wrongM += wrong;
          total.dup += dup;
          total.pend += pend;
          total.pendHas += pendHas;
          total.n++;
          lines.push(
            `${a} → new batch → ${b}: ${right} recognised right, ${wrong} wrong, ${dup} added twice, ${pend} to check (right one offered for ${pendHas}), ${newOk} new things`,
          );
        }
      console.log(lines.join('\n'));
      console.log(
        `all ${total.n} orders: ${total.right} recognised right, ${total.wrongM} wrong, ${total.dup} added twice, ${total.pend} to check (right one offered for ${total.pendHas})`,
      );
      expect(total.n).toBe(12);
      expect(total.wrongM).toBe(0);
      if (!process.env.BATCH_SET) expect(total.right).toBe(0);
    },
    900_000,
  );
});
