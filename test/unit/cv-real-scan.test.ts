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
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scanMarkerless, type ScanMarkerlessResult } from '../../src/cv/scanMarkerless';
import { cvCounters } from '../../src/cv/scope';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import { getCv, type Cv } from '../helpers/cv';
import { resizeBuffer } from '../helpers/images';
import { decodeRgba, listRealPhotos, REAL_DIR } from '../helpers/realFixtures';

const photos = listRealPhotos();
const has9224 = photos.some((p) => p.name.startsWith('IMG_9224'));

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

  it.skipIf(!has9224)('IMG_9224: assembled area reported, loose pieces found (also inside the frame), no objects as pieces, right scale', async () => {
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
    // Scale at the image centre within 10 % of 3.7 px/mm.
    expect(Math.abs(r.pxPerMm! / 3.7 - 1)).toBeLessThan(0.1);
  }, 120_000);
});
