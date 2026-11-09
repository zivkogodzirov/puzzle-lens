import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { readPiece } from '../../src/cv/readPiece';
import { applyH, invertH } from '../../src/geo/homography';
import { planMerge } from '../../src/project/catalog';
import type { PieceRow, Vec2 } from '../../src/project/types';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import { getCv, type Cv } from '../helpers/cv';
import { resizeBuffer } from '../helpers/images';
import { decodeRgba, REAL_DIR } from '../helpers/realFixtures';
async function load(cv: Cv, n: string): Promise<PixelBuffer> {
  const img = await decodeRgba(`${REAL_DIR}${n}.jpeg`);
  const s = 4032 / Math.max(img.width, img.height);
  return s >= 1 ? img : resizeBuffer(cv, img, 4, Math.round(img.width * s), Math.round(img.height * s), cv.INTER_AREA);
}
const withPatches = (img: PixelBuffer, r: ReturnType<typeof scanMarkerless>) =>
  r.pieces.map((p) => {
    const rp = readPiece(img, p, r.pxPerMm ?? 8);
    return { ...p, patch: rp ? { blob: new Blob([]), flats: rp.flats, sure: rp.sure, sides: rp.sides, sideConf: rp.sideConf, fp: rp.fp } : null };
  });
const HAS = ['IMG_9274', 'IMG_9275', 'IMG_9276', 'IMG_9277'].every((n) => existsSync(`${REAL_DIR}${n}.jpeg`));

describe('re-identification on the owner’s photos (M5 part 3)', () => {
  it.skipIf(!HAS)(
    'IMG_9276 with 3 real pieces moved (one shifted, one upside down, one turned a quarter): all 3 recognised, none missing',
    async () => {
      const cv = await getCv();
      const a = await load(cv, 'IMG_9276');
      const r0 = scanMarkerless(cv, a, { catalog: [], zoom: 1, kind: 'overview', table: null });
      let nid = 0;
      const cat: PieceRow[] = planMerge([], withPatches(a, r0), {
        projectId: 'p',
        snapId: 's0',
        pxPerMm: r0.pxPerMm ?? 8,
        now: 1,
        newId: () => `n${nid++}`,
        thumbId: (id) => id,
      }).added;
      const toPx = invertH(r0.imgToCatalog!)!;
      // Pick 3 clean pieces; move each by (dx, dy) px with a turn.
      const W = a.width;
      const H = a.height;
      const out = new Uint8Array(a.data);
      const table = [a.data[50 * a.stride + 50 * 4]!, a.data[50 * a.stride + 50 * 4 + 1]!, a.data[50 * a.stride + 50 * 4 + 2]!];
      const picks = r0.pieces
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => !p.flags.clump && !p.flags.cut && !p.flags.weak)
        .slice(2, 5);
      const plans: Array<{ dx: number; dy: number; turn: 0 | 1 | 2 }> = [
        { dx: 0, dy: -650, turn: 0 },
        { dx: 0, dy: 900, turn: 2 },
        { dx: -700, dy: 0, turn: 1 },
      ];
      const movedIds: string[] = [];
      // Clear table: no found blob's box (with a margin) overlaps.
      const regionBox = (o: number[]): [number, number, number, number] => {
        const xs = o.filter((_, i2) => i2 % 2 === 0);
        const ys = o.filter((_, i2) => i2 % 2 === 1);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
      };
      const boxes = [...r0.pieces.map((p) => p.bboxImg), ...r0.regions.map((g) => regionBox(g.outlineImg))];
      const clear = (x0: number, y0: number, x1: number, y1: number) =>
        x0 > 40 &&
        y0 > 40 &&
        x1 < W - 40 &&
        y1 < H - 40 &&
        boxes.every(([bx, by, bw, bh]) => x1 + 30 < bx || x0 - 30 > bx + bw || y1 + 30 < by || y0 - 30 > by + bh);
      const used: Array<[number, number, number, number]> = [];
      picks.forEach(({ p }, k) => {
        const [x, y, w, h] = p.bboxImg.map(Math.round) as [number, number, number, number];
        const m = 10;
        const x0 = Math.max(0, x - m),
          y0 = Math.max(0, y - m),
          x1 = Math.min(W, x + w + m),
          y1 = Math.min(H, y + h + m);
        const bw = x1 - x0,
          bh = y1 - y0;
        // The table's colour right around it: median of the border pixels.
        const border: number[][] = [];
        for (let xx = x0; xx < x1; xx++) for (const yy of [y0, y1 - 1]) border.push([...a.data.subarray(yy * a.stride + xx * 4, yy * a.stride + xx * 4 + 3)]);
        for (let yy = y0; yy < y1; yy++) for (const xx of [x0, x1 - 1]) border.push([...a.data.subarray(yy * a.stride + xx * 4, yy * a.stride + xx * 4 + 3)]);
        const med = [0, 1, 2].map((c) => border.map((v) => v[c]!).sort((q, r2) => q - r2)[border.length >> 1]!);
        // The piece itself: inside its outline only (so no box of old table travels with it).
        const inside = (X: number, Y: number) => {
          const o = p.outlineImg;
          let c = false;
          for (let i2 = 0, j2 = o.length - 2; i2 < o.length; j2 = i2, i2 += 2) {
            if (o[i2 + 1]! > Y !== o[j2 + 1]! > Y && X < ((o[j2]! - o[i2]!) * (Y - o[i2 + 1]!)) / (o[j2 + 1]! - o[i2 + 1]!) + o[i2]!) c = !c;
          }
          return c;
        };
        const pix: Array<[number, number, number[]]> = [];
        for (let yy = y0; yy < y1; yy++)
          for (let xx = x0; xx < x1; xx++)
            if (inside(xx + 0.5, yy + 0.5))
              pix.push([xx - (x0 + x1) / 2, yy - (y0 + y1) / 2, [...a.data.subarray(yy * a.stride + xx * 4, yy * a.stride + xx * 4 + 4)]]);
        // Fill its old place with the table's colour (slightly grown, to cover the shadow).
        for (let yy = y0; yy < y1; yy++)
          for (let xx = x0; xx < x1; xx++)
            if (inside(xx + 0.5, yy + 0.5) || inside(xx + 6, yy + 0.5) || inside(xx - 6, yy + 0.5) || inside(xx + 0.5, yy + 6) || inside(xx + 0.5, yy - 6))
              out.set([med[0]!, med[1]!, med[2]!, 255], (yy * W + xx) * 4);
        // A clear patch of table for it.
        const turn = plans[k]!.turn;
        let spot: [number, number] | null = null;
        for (let ty = 200; ty < H - 200 && !spot; ty += 60)
          for (let tx = 200; tx < W - 200 && !spot; tx += 60) {
            const r = Math.max(bw, bh) / 2 + 20;
            if (
              clear(tx - r, ty - r, tx + r, ty + r) &&
              used.every(([ux0, uy0, ux1, uy1]) => tx + r < ux0 || tx - r > ux1 || ty + r < uy0 || ty - r > uy1) &&
              Math.hypot(tx - (x0 + x1) / 2, ty - (y0 + y1) / 2) > 500
            ) {
              spot = [tx, ty];
              used.push([tx - r, ty - r, tx + r, ty + r]);
            }
          }
        if (!spot) throw new Error('no clear spot');
        for (const [dx0, dy0, px] of pix) {
          let tx = dx0,
            ty = dy0;
          if (turn === 1) [tx, ty] = [-ty, tx];
          if (turn === 2) [tx, ty] = [-tx, -ty];
          const X = Math.round(spot[0] + tx),
            Y = Math.round(spot[1] + ty);
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          out.set(px, (Y * W + X) * 4);
        }
        const c = cat.reduce((b2, q) =>
          Math.hypot(q.table.x - p.centreMm[0], q.table.y - p.centreMm[1]) < Math.hypot(b2.table.x - p.centreMm[0], b2.table.y - p.centreMm[1]) ? q : b2,
        );
        movedIds.push(c.id);
      });
      const b: PixelBuffer = { data: out, width: W, height: H, stride: W * 4 };
      const dir = `${REAL_DIR}out/`;
      mkdirSync(dir, { recursive: true });
      const { createCanvas } = await import('@napi-rs/canvas');
      const cnv = createCanvas(W, H);
      const id = cnv.getContext('2d').createImageData(W, H);
      id.data.set(out);
      cnv.getContext('2d').putImageData(id, 0, 0);
      writeFileSync(dir + 'IMG_9276-moved.jpg', cnv.toBuffer('image/jpeg', 80));
      const r1 = scanMarkerless(cv, b, { catalog: cat, zoom: 1, kind: 'overview', table: null });
      console.log(`registered ${r1.registered}`);
      const view: Vec2[] = (
        [
          [0, 0],
          [W - 1, 0],
          [W - 1, H - 1],
          [0, H - 1],
        ] as Vec2[]
      ).map((c) => applyH(r1.imgToCatalog!, c));
      const plan = planMerge(cat, withPatches(b, r1), {
        projectId: 'p',
        snapId: 's1',
        pxPerMm: r1.pxPerMm ?? 8,
        now: 2,
        newId: () => `n${nid++}`,
        thumbId: (id2) => id2,
        view,
      });
      const movedRows = plan.updates.filter((u) => movedIds.includes(u.id) && u.status === 'table' && u.table.lastSeen === 2);
      expect(r1.registered).toBe(true);
      const recognised = movedRows.filter((u) => {
        const o = cat.find((c) => c.id === u.id)!;
        return Math.hypot(o.table.x - u.table.x, o.table.y - u.table.y) > 20;
      }).length;
      expect(recognised).toBe(3);
      expect(plan.missing).toBe(0);
      console.log(
        `moved recognised ${plan.moved} (the 3 moved rows updated at a new place: ${
          movedRows.filter((u) => {
            const o = cat.find((c) => c.id === u.id)!;
            return Math.hypot(o.table.x - u.table.x, o.table.y - u.table.y) > 20;
          }).length
        }/3); added ${plan.added.length} (${plan.added.map((x) => `${x.status}${x.maybe ? ' maybe ' + x.maybe.map((m) => (movedIds.includes(m) ? 'MOVED' : 'other')).join('/') : ''}`).join(', ')}); missing ${plan.missing}`,
      );
      void toPx;
    },
    900000,
  );

  it.skipIf(!HAS)(
    'rescans of the same 21 pieces from four places, in three orders: no piece added twice',
    async () => {
      const cv = await getCv();
      const imgs = new Map<string, PixelBuffer>();
      for (const n of ['IMG_9274', 'IMG_9275', 'IMG_9276', 'IMG_9277']) imgs.set(n, await load(cv, n));
      for (const order of [
        ['IMG_9276', 'IMG_9274', 'IMG_9275', 'IMG_9277'],
        ['IMG_9277', 'IMG_9275', 'IMG_9274', 'IMG_9276'],
        ['IMG_9275', 'IMG_9277', 'IMG_9276', 'IMG_9274'],
      ]) {
        let catalog: PieceRow[] = [];
        let nid = 0;
        for (const [k, n] of order.entries()) {
          const img = imgs.get(n)!;
          const r = scanMarkerless(cv, img, { catalog, zoom: 1, kind: 'overview', table: null });
          expect(r.registered, n).toBe(true);
          const view: Vec2[] = (
            [
              [0, 0],
              [img.width - 1, 0],
              [img.width - 1, img.height - 1],
              [0, img.height - 1],
            ] as Vec2[]
          ).map((c) => applyH(r.imgToCatalog!, c));
          const plan = planMerge(catalog, withPatches(img, r), {
            projectId: 'p',
            snapId: `s${k}`,
            pxPerMm: r.pxPerMm ?? 8,
            now: k + 1,
            newId: () => `n${nid++}`,
            thumbId: (id) => id,
            view,
          });
          if (k > 0) {
            // Nothing new near a known piece (new things far from all pieces are the coin or marks on the table).
            for (const a of plan.added)
              expect(Math.min(...catalog.map((c) => Math.hypot(c.table.x - a.table.x, c.table.y - a.table.y))), `${order.join('→')}: ${n}`).toBeGreaterThan(15);
            expect(plan.pending + plan.missing + plan.moved, `${n}: nothing moved`).toBe(0);
          }
          const upd = new Map(plan.updates.map((u) => [u.id, u]));
          catalog = catalog.map((c) => upd.get(c.id) ?? c).concat(plan.added);
        }
      }
    },
    1800000,
  );
});
