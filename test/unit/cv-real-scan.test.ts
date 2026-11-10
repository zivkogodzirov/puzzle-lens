/**
 * Marker-free scan of the owner's real photos (test/fixtures/real, kept out of git; skipped when
 * the folder is empty, as on GitHub). Photos are reduced to 4032 px on the long side as the app
 * does. Overlays (cyan = piece, orange = clump, yellow = weak, magenta = cut, green = assembled
 * area, red = object) are written to test/fixtures/real/out/ (also ignored by git).
 *
 * IMG_9224 (overview, 1×, hand-held, noticeably tilted: the far end of the table is ~15 % smaller):
 * a partly assembled 1000-piece puzzle (frame + about half the picture) on a white table, with
 * ~95 loose pieces (counted by eye on 1:1 crops: ~20 above the frame, ~8 left of it, and inside the
 * frame ~6 + ~5 isolated, ~20 beige in the lower-left group, ~30 dark ones in the right-hand group,
 * ~6 lower right — many of them touching each other), a box lid holding pieces, headphones, a
 * remote and a coaster, with the floor and the photographer's shadow at the bottom.
 * Expected scale: the frame (498 mm wide) spans 1533 px at its top edge and 1773 px at mid height,
 * the frame's area gives 3.47 px/mm on average; 3.7 px/mm is the owner's figure at the lower part.
 *
 * IMG_9246 (pieces in the puzzle box's grey, grainy tray, phone held close): ~45 golden pieces
 * spread out and ~75 brown ones in a dense pile, many touching. Expected scale ~7 px/mm: the tray's
 * inside (1743 × 2320 px) is then 243 × 324 mm, the owner's "a little bigger than A4" box.
 * IMG_9245 (~25 brown pieces in a brown cardboard box lid, phone held close): brown on brown, the
 * hardest case; pieces differ from the cardboard only by being darker. Expected scale ~6–7 px/mm
 * (the pieces look the same size as in IMG_9246).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scanMarkerless, type ScanMarkerlessResult } from '../../src/cv/scanMarkerless';
import { findCoin } from '../../src/cv/coin';
import { cvCounters } from '../../src/cv/scope';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import { getCv, type Cv } from '../helpers/cv';
import { resizeBuffer } from '../helpers/images';
import { decodeRgba, listRealPhotos, REAL_DIR } from '../helpers/realFixtures';

const photos = listRealPhotos();
const has9224 = photos.some((p) => p.name.startsWith('IMG_9224'));
const has = (n: string) => photos.some((p) => p.name.startsWith(n));

async function load(cv: Cv, path: string): Promise<PixelBuffer> {
  let img = await decodeRgba(path);
  const s = 4032 / Math.max(img.width, img.height);
  if (s < 1) img = resizeBuffer(cv, img, 4, Math.round(img.width * s), Math.round(img.height * s), cv.INTER_AREA);
  return img;
}

async function overlay(img: PixelBuffer, r: ScanMarkerlessResult, file: string): Promise<void> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const k = 1600 / Math.max(img.width, img.height);
  const full = createCanvas(img.width, img.height);
  const fctx = full.getContext('2d');
  const id = fctx.createImageData(img.width, img.height);
  for (let y = 0; y < img.height; y++) id.data.set(img.data.subarray(y * img.stride, y * img.stride + img.width * 4), y * img.width * 4);
  fctx.putImageData(id, 0, 0);
  const c = createCanvas(Math.round(img.width * k), Math.round(img.height * k));
  const ctx = c.getContext('2d');
  ctx.drawImage(full, 0, 0, c.width, c.height);
  const draw = (o: number[], col: string, wdt: number) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = wdt;
    ctx.beginPath();
    for (let i = 0; i < o.length; i += 2) ctx.lineTo(o[i]! * k, o[i + 1]! * k);
    ctx.closePath();
    ctx.stroke();
  };
  for (const g of r.regions) draw(g.outlineImg, g.kind === 'assembled' ? '#00ff00' : '#ff0000', 3);
  for (const p of r.pieces) draw(p.outlineImg, p.flags.clump ? '#ff8800' : p.flags.weak ? '#ffee00' : p.flags.cut ? '#ff00ff' : '#00e0ff', 2);
  mkdirSync(join(REAL_DIR, 'out'), { recursive: true });
  writeFileSync(join(REAL_DIR, 'out', file), c.encodeSync('jpeg', 85));
}

const centre = (p: { bboxImg: number[] }) => [p.bboxImg[0]! + p.bboxImg[2]! / 2, p.bboxImg[1]! + p.bboxImg[3]! / 2] as const;
const inBox = (p: { bboxImg: number[] }, b: number[]) => {
  const [x, y] = centre(p);
  return x > b[0]! && x < b[2]! && y > b[1]! && y < b[3]!;
};

describe.skipIf(photos.length === 0)('real photos, marker-free scan', () => {
  afterAll(() => {
    expect(cvCounters.liveScoped).toBe(0);
  });

  it('every photo: no leaked OpenCV objects, sane output', async () => {
    const cv = await getCv();
    const lines: string[] = [];
    for (const ph of photos) {
      const img = await load(cv, ph.path);
      const t0 = performance.now();
      const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
      const ms = performance.now() - t0;
      await overlay(img, r, `${ph.name.replace(/\.\w+$/, '')}-found.jpg`);
      lines.push(
        `${ph.name}: ${img.width}×${img.height} pieces ${r.pieces.length} (clump ${r.pieces.filter((p) => p.flags.clump).length}, weak ${r.pieces.filter((p) => p.flags.weak).length}, cut ${r.pieces.filter((p) => p.flags.cut).length}), ` +
          `regions ${r.regions.map((g) => `${g.kind} ${Math.round(g.areaMm2 / 100) / 100} dm²`).join(', ')}, ${r.pxPerMm?.toFixed(2)} px/mm, ${Math.round(ms)} ms`,
      );
      expect(cvCounters.liveScoped).toBe(0);
      for (const p of r.pieces) expect(Number.isFinite(p.areaMm2)).toBe(true);
    }
    console.log(lines.join('\n'));
  }, 300_000);

  it.skipIf(!has9224)(
    'IMG_9224: assembled area reported, loose pieces found (also inside the frame), no objects as pieces, right scale',
    async () => {
      const cv = await getCv();
      const img = await load(cv, photos.find((p) => p.name.startsWith('IMG_9224'))!.path);
      expect([img.width, img.height]).toEqual([2268, 4032]);
      const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
      // The assembled puzzle is reported as a region, not as pieces (the whole puzzle is 3476 cm²;
      // the region excludes the table showing through the frame).
      const assembled = r.regions.filter((g) => g.kind === 'assembled');
      expect(Math.max(...assembled.map((g) => g.areaMm2))).toBeGreaterThan(150_000);
      // Loose pieces: ~95 by eye, many touching. At least 55 found, at least 30 of them single.
      expect(r.pieces.length).toBeGreaterThanOrEqual(55);
      expect(r.pieces.filter((p) => !p.flags.clump).length).toBeGreaterThanOrEqual(30);
      // The dark loose pieces lying inside the assembled frame (image box of the frame) are found.
      const frame = [230, 980, 2210, 3360];
      expect(r.pieces.filter((p) => inBox(p, frame) && p.meanLab[0] < 40).length).toBeGreaterThanOrEqual(15);
      // Nothing reported as a piece on the headphones, the remote or the coaster (image boxes).
      for (const b of [
        [970, 113, 1462, 617],
        [227, 239, 706, 517],
        [693, 252, 970, 466],
      ])
        expect(r.pieces.filter((p) => inBox(p, b))).toHaveLength(0);
      // Nothing on the floor below the table's near edge.
      expect(Math.max(...r.pieces.map((p) => centre(p)[1]))).toBeLessThan(3620);
      // Scale at the image centre: the frame's area gives 3.47 px/mm on average and the photo's
      // scale varies ~15 % from top to bottom, so only a range is known (3.1–4.0). (Since the
      // lit-side fix of 2026-11-07 the estimate is 3.15; it was 3.46. On the two photos with a coin,
      // IMG_9263/9264, the same estimate is within 1.5 % of the coin.)
      expect(r.pxPerMm!).toBeGreaterThan(3.1);
      expect(r.pxPerMm!).toBeLessThan(4.0);
    },
    120_000,
  );

  // Image boxes of the tray / lid insides (photo px at 2268 × 4032).
  const inTray = (b: number[]) => (p: { bboxImg: number[] }) => inBox(p, b);
  const single = (p: { flags: { clump?: boolean; weak?: boolean; cut?: boolean } }) => !p.flags.clump && !p.flags.weak && !p.flags.cut;

  it.skipIf(!has('IMG_9246'))(
    'IMG_9246: pieces in a grey grainy tray, phone close: right scale, most spread pieces found',
    async () => {
      const cv = await getCv();
      const img = await load(cv, photos.find((p) => p.name.startsWith('IMG_9246'))!.path);
      const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
      expect(Math.abs(r.pxPerMm! / 7 - 1), `${r.pxPerMm}`).toBeLessThan(0.15);
      const tray = r.pieces.filter(inTray([274, 1037, 2017, 3357]));
      expect(tray.length).toBeGreaterThanOrEqual(35);
      expect(tray.filter(single).length).toBeGreaterThanOrEqual(18);
      // Hardly anything reported as pieces off the tray (clothes, bedding).
      expect(r.pieces.length - tray.length).toBeLessThanOrEqual(8);
    },
    120_000,
  );

  it.skipIf(!has('IMG_9245'))(
    'IMG_9245: brown pieces in a brown cardboard lid, phone close: scale near right, some pieces found',
    async () => {
      const cv = await getCv();
      const img = await load(cv, photos.find((p) => p.name.startsWith('IMG_9245'))!.path);
      const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
      expect(r.pxPerMm!).toBeGreaterThan(5.2);
      expect(r.pxPerMm!).toBeLessThan(8);
      const lid = r.pieces.filter(inTray([346, 1268, 2017, 3458]));
      expect(lid.length).toBeGreaterThanOrEqual(10);
      expect(lid.filter(single).length).toBeGreaterThanOrEqual(6);
    },
    120_000,
  );

  // IMG_9263 (landscape) and IMG_9264 (portrait): the owner's 26 brown pieces spread on the cream
  // table with a 2-denar coin (23.5 mm), under a lamp that makes the glossy pieces shine on one
  // side. The coin gives the true scale: 199 px → 8.46 px/mm (9263), 220 px → 9.36 px/mm (9264).
  for (const [name, coinPpm, minSingles] of [
    ['IMG_9263', 8.46, 18],
    ['IMG_9264', 9.36, 20],
  ] as const) {
    it.skipIf(!has(name))(
      `${name}: 26 shiny pieces with a 2-denar coin: pieces found whole, scale within 4 % of the coin's`,
      async () => {
        const cv = await getCv();
        const img = await load(cv, photos.find((p) => p.name.startsWith(name))!.path);
        const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
        expect(Math.abs(r.pxPerMm! / coinPpm - 1), `${r.pxPerMm}`).toBeLessThan(0.04);
        const coin = findCoin(cv, img, { pxPerMm: r.pxPerMm! });
        expect(coin).not.toBeNull();
        expect(Math.abs(coin!.diameterPx / coinPpm / 23.5 - 1)).toBeLessThan(0.03);
        expect(r.pieces.filter(single).length, 'clean single pieces').toBeGreaterThanOrEqual(minSingles);
      },
      120_000,
    );
  }

  // IMG_9274–9277 (owner, 2026-11-09): the same 21 pieces and a 2-denar coin from four places.
  // IMG_9277 is taken about 3× closer than the app expects: whole pieces looked like "objects" and
  // fragments measured 3.7 px/mm, so the photo couldn't be matched to the others. The scale-robust
  // pre-pass now steps in when blobs far outnumber clean pieces.
  for (const [name, minSingles] of [
    ['IMG_9274', 12],
    ['IMG_9275', 19],
    ['IMG_9276', 12],
    ['IMG_9277', 19],
  ] as const) {
    it.skipIf(!has(name))(
      `${name}: 21 pieces with a 2-denar coin: scale within 7 % of the coin's, pieces found whole`,
      async () => {
        const cv = await getCv();
        const img = await load(cv, photos.find((p) => p.name.startsWith(name))!.path);
        const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
        const coin = findCoin(cv, img, { pxPerMm: r.pxPerMm! });
        expect(coin).not.toBeNull();
        const coinPpm = coin!.diameterPx / 23.5;
        expect(Math.abs(r.pxPerMm! / coinPpm - 1), `${r.pxPerMm} vs coin ${coinPpm}`).toBeLessThan(0.07);
        expect(r.pieces.filter(single).length, 'clean single pieces').toBeGreaterThanOrEqual(minSingles);
      },
      120_000,
    );
  }

  // shot-9267: the owner's photo cut out of an app screenshot (1244 × 1652, so ~4.6 px/mm here and
  // ~12 px/mm in the 4032 px original): 23 brown pieces and the 2-denar coin on the cream table in
  // low sunlight, phone held ~3× closer than usual. The first scale guess saw no piece-sized blobs
  // and the pieces were all taken for objects (2026-11-08); the closer restarts fix that.
  it.skipIf(!has('shot-9267'))(
    'shot-9267: phone held very close: pieces found at the right size, coin found',
    async () => {
      const cv = await getCv();
      const img = await load(cv, photos.find((p) => p.name.startsWith('shot-9267'))!.path);
      const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
      const coin = findCoin(cv, img, { pxPerMm: r.pxPerMm! });
      expect(coin).not.toBeNull();
      const coinPpm = coin!.diameterPx / 23.5;
      expect(Math.abs(coinPpm / 4.6 - 1)).toBeLessThan(0.05);
      expect(Math.abs(r.pxPerMm! / coinPpm - 1), `${r.pxPerMm}`).toBeLessThan(0.2);
      expect(r.pieces.filter(single).length, 'clean single pieces').toBeGreaterThanOrEqual(16);
    },
    120_000,
  );

  // IMG_9127 (owner, 2026-11-10): ~95 pieces in two groups on the cream table. Pale white-dress
  // pieces came out only in part (at the app's 4032 px: one at 0.15 of a piece, others at 0.73–0.77,
  // too close to whole pieces to tell by size: the cream table looks like the white print). The
  // clearly cut-short one is marked `part` (and `weak`) so its shape isn't trusted. IMG_9245: two
  // piece backs on brown cardboard, 0.48 and 0.52. Whole pieces are never marked (IMG_9224, tilted,
  // has whole pieces down to 0.68 at full size, 0.73 at the app's).
  it.skipIf(!has('IMG_9127'))(
    'IMG_9127 and the others: outlines found only in part are marked, whole pieces never',
    async () => {
      const cv = await getCv();
      for (const [name, want] of [
        ['IMG_9127', 1],
        ['IMG_9245', 2],
        ['IMG_9224', 0],
        ['IMG_9263', 0],
        ['IMG_9264', 0],
        ['IMG_9274', 0],
        ['IMG_9275', 0],
        ['IMG_9276', 0],
        ['IMG_9277', 0],
      ] as const) {
        if (!has(name)) continue;
        const img = await load(cv, photos.find((p) => p.name.startsWith(name))!.path);
        const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
        const part = r.pieces.filter((p) => p.flags.part);
        expect(part.length, name).toBe(want);
        expect(part.every((p) => p.flags.weak)).toBe(true);
      }
    },
    600_000,
  );
});
