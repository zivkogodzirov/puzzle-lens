/**
 * Runs the M1 photo and marker code on the owner's real photos in test/fixtures/real/
 * (PLAN §7 "Real set"). Skipped when the folder has no photos — always the case on GitHub,
 * because the photos never leave this Mac.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FrameAnalyser } from '../../src/cv/frameAnalyser';
import { tileStats } from '../../src/cv/photoAnalysis';
import { cvCounters } from '../../src/cv/scope';
import { getCv, type Cv } from '../helpers/cv';
import { viewRect } from '../helpers/images';
import { decodeRgba, listRealPhotos } from '../helpers/realFixtures';

const photos = listRealPhotos();

describe.skipIf(photos.length === 0)(`real photos (${photos.length} in test/fixtures/real)`, () => {
  let cv: Cv;

  beforeAll(async () => {
    cv = await getCv();
  });

  for (const photo of photos) {
    it(photo.name, async () => {
      const rgba = await decodeRgba(photo.path);
      expect(rgba.width).toBeGreaterThan(0);

      // Snap statistics, tile by tile (as the reader worker does).
      const T = 1024;
      let pixels = 0;
      let high = 0;
      let low = 0;
      let luma = 0;
      for (let y = 0; y < rgba.height; y += T) {
        for (let x = 0; x < rgba.width; x += T) {
          const s = tileStats(cv, viewRect(rgba, 4, x, y, Math.min(T, rgba.width - x), Math.min(T, rgba.height - y)));
          pixels += s.pixels;
          high += s.clippedHigh;
          low += s.clippedLow;
          luma += s.sumLuma;
        }
      }
      expect(pixels).toBe(rgba.width * rgba.height);

      // Markers, on a 1920-wide copy (a Snap is analysed at higher resolution than live frames).
      const analyser = new FrameAnalyser(cv, { analysisWidth: 1920 });
      let ids: number[];
      try {
        ids = analyser.analyseRgba(rgba, 'RGBA').markers.map((m) => m.id);
      } finally {
        analyser.dispose();
      }
      console.info(
        `[real] ${photo.name}: ${rgba.width}×${rgba.height}, mean luma ${(luma / pixels).toFixed(1)}, ` +
          `blown out ${((100 * high) / pixels).toFixed(2)} %, crushed ${((100 * low) / pixels).toFixed(2)} %, markers [${ids.join(', ')}]`,
      );
      if (photo.labels?.markers) expect(ids.slice().sort((a, b) => a - b)).toEqual(expect.arrayContaining(photo.labels.markers));
      expect(cvCounters.liveScoped).toBe(0);
    });
  }
});

it('the real-photo folder is readable (empty is fine)', () => {
  expect(Array.isArray(photos)).toBe(true);
});
