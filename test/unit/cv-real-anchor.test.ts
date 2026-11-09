/**
 * Live view without markers on the owner's real photos (test/fixtures/real, kept out of git;
 * skipped when missing, as on GitHub). IMG_9263 (landscape) is the scan photo; IMG_9264 (portrait,
 * the same 26 shiny pieces from another place, turned 90°) stands in for a live frame (960 px).
 * The truth is the piece-based registration the scan itself uses (scanMarkerless with the first
 * photo's catalog), which is accurate to about a millimetre.
 */
import { describe, expect, it } from 'vitest';
import { ANCHOR, TableAnchor, upscaleH } from '../../src/cv/anchor';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { cvCounters } from '../../src/cv/scope';
import { applyH, invertH, mulH } from '../../src/geo/homography';
import { planMerge } from '../../src/project/catalog';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';
import { getCv, type Cv } from '../helpers/cv';
import { resizeBuffer } from '../helpers/images';
import { decodeRgba, listRealPhotos } from '../helpers/realFixtures';

const photos = listRealPhotos();
const path = (n: string) => photos.find((p) => p.name.startsWith(n))?.path;
const has = Boolean(path('IMG_9263') && path('IMG_9264'));

async function load(cv: Cv, p: string): Promise<PixelBuffer> {
  const img = await decodeRgba(p);
  const s = 4032 / Math.max(img.width, img.height);
  return s >= 1 ? img : resizeBuffer(cv, img, 4, Math.round(img.width * s), Math.round(img.height * s), cv.INTER_AREA);
}

function shrink(cv: Cv, img: PixelBuffer, maxSide: number): { buf: PixelBuffer; scale: number } {
  const s = maxSide / Math.max(img.width, img.height);
  const w = Math.round(img.width * s);
  const h = Math.round(img.height * s);
  return { buf: resizeBuffer(cv, img, 4, w, h, cv.INTER_AREA), scale: img.width / w };
}

describe('live view on the owner’s photos', () => {
  it.skipIf(!has)(
    'IMG_9263 → IMG_9264 (turned 90°, another place): the table found, pieces within 2 mm',
    async () => {
      const cv = await getCv();
      const a = await load(cv, path('IMG_9263')!);
      const b = await load(cv, path('IMG_9264')!);
      const r1 = scanMarkerless(cv, a, { catalog: [], zoom: 1, kind: 'overview', table: null });
      let nid = 0;
      const plan = planMerge([], r1.pieces, { projectId: 'p', snapId: 's1', pxPerMm: r1.pxPerMm ?? 8, now: 1, newId: () => `n${nid++}`, thumbId: (id) => id });
      const catalog = plan.added;
      const r2 = scanMarkerless(cv, b, { catalog, zoom: 1, kind: 'overview', table: null });
      expect(r2.registered).toBe(true);
      const truthToImg = invertH(r2.imgToCatalog!)!;

      const ref = shrink(cv, a, ANCHOR.refMaxSide);
      const anchor = new TableAnchor(cv);
      anchor.setReferences([{ pixels: ref.buf, channels: 4, imgToTable: mulH(r1.imgToCatalog!, upscaleH(ref.scale)) }]);
      const live = shrink(cv, b, 960);
      const g = new cv.Mat(live.buf.height, live.buf.width, cv.CV_8UC4);
      g.data.set(live.buf.data);
      const gray = new cv.Mat();
      cv.cvtColor(g, gray, cv.COLOR_RGBA2GRAY);
      const t0 = performance.now();
      const fix = anchor.track(gray)!;
      const ms = performance.now() - t0;
      g.delete();
      gray.delete();
      expect(fix).not.toBeNull();
      const toFull = mulH(upscaleH(live.scale), fix.tableToImg);
      const errs = catalog.map((c) => {
        const p = applyH(toFull, [c.table.x, c.table.y]);
        const q = applyH(truthToImg, [c.table.x, c.table.y]);
        return Math.hypot(p[0] - q[0], p[1] - q[1]) / r2.pxPerMm!;
      });
      errs.sort((x, y) => x - y);
      console.log(
        `IMG_9263 → IMG_9264: ${fix.inliers}/${fix.candidates} points (${fix.quality}), ${ms.toFixed(0)} ms; ${errs.length} pieces: median ${errs[errs.length >> 1]!.toFixed(2)} mm, worst ${errs[errs.length - 1]!.toFixed(2)} mm`,
      );
      expect(fix.quality).toBe('good');
      expect(errs[errs.length - 1]!).toBeLessThan(2);
      anchor.dispose();
      expect(cvCounters.liveScoped).toBe(0);
    },
    180_000,
  );
});
