/**
 * Shape reading (M3) on the owner's real photos (skipped when absent). Outlines are scaled by the
 * 2-denar coin (23.5 mm) as the app does, and read with The Kiss's cell (17.8 × 19.4 mm).
 *
 * IMG_9263 / IMG_9264: 26 brown pieces from the picture's middle; every one has a knob or a hole on
 * all four sides (checked by eye), so no piece may be called a corner or an edge.
 * IMG_9276 (2026-11-08): 21 pieces, pale and dark, some glossy under a lamp; one clear corner (the
 * square one right of the middle). Four single pieces with long knobs at both ends used to be
 * flagged as touching pieces.
 */
import { describe, expect, it } from 'vitest';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { findCoin } from '../../src/cv/coin';
import { readShape, READ_OK } from '../../src/cv/shapeRead';
import { getCv } from '../helpers/cv';
import { resizeBuffer } from '../helpers/images';
import { decodeRgba, listRealPhotos } from '../helpers/realFixtures';

const photos = listRealPhotos();
const has = (n: string) => photos.some((p) => p.name.startsWith(n));

async function groups(name: string) {
  const cv = await getCv();
  let img = await decodeRgba(photos.find((p) => p.name.startsWith(name))!.path);
  const s = 4032 / Math.max(img.width, img.height);
  if (s < 1) img = resizeBuffer(cv, img, 4, Math.round(img.width * s), Math.round(img.height * s), cv.INTER_AREA);
  const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
  const coin = findCoin(cv, img, { pxPerMm: r.pxPerMm! });
  const k = coin ? r.pxPerMm! / (coin.diameterPx / 23.5) : 1;
  const out = { corner: 0, edge: 0, interior: 0, unsure: 0, clumps: 0 };
  for (const p of r.pieces) {
    if (p.flags.cut) continue;
    if (p.flags.clump) {
      out.clumps++;
      continue;
    }
    const rd = readShape(
      p.outlineMm.map((v) => v * k),
      [17.8, 19.4],
    );
    out[rd?.kind && rd.quality >= READ_OK ? rd.kind : 'unsure']++;
  }
  return out;
}

describe.skipIf(photos.length === 0)('real photos: shape reading', () => {
  for (const name of ['IMG_9263', 'IMG_9264'])
    it.skipIf(!has(name))(
      `${name}: 26 inside pieces read as inside, none as border`,
      async () => {
        const g = await groups(name);
        expect(g.corner + g.edge, JSON.stringify(g)).toBe(0);
        expect(g.interior, JSON.stringify(g)).toBeGreaterThanOrEqual(21);
        expect(g.unsure, JSON.stringify(g)).toBeLessThanOrEqual(2);
      },
      300_000,
    );

  it.skipIf(!has('IMG_9276'))(
    'IMG_9276: the corner found, single pieces not "touching", few not sure',
    async () => {
      const g = await groups('IMG_9276');
      expect(g.corner, JSON.stringify(g)).toBeGreaterThanOrEqual(1);
      expect(g.clumps, JSON.stringify(g)).toBe(0);
      expect(g.unsure, JSON.stringify(g)).toBeLessThanOrEqual(4);
      expect(g.interior + g.edge + g.corner, JSON.stringify(g)).toBeGreaterThanOrEqual(17);
    },
    300_000,
  );
});
