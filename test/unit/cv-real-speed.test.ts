/**
 * Where a scan spends its time on the owner's photos (M8 part 3; test/fixtures/real, kept out of
 * git; opt-in, SPEED=1). The same steps the photo helper runs for a marker-free photo: decode is
 * left out (the browser does it), then finding pieces, reading each piece (shape, straightened
 * picture, fingerprint) and the finished-puzzle check. Times per step go to the output.
 *
 *   SPEED=1 [SPEED_PHOTOS=IMG_9127,IMG_9276] npx vitest run --project unit test/unit/cv-real-speed.test.ts
 */
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { readPiece } from '../../src/cv/readPiece';
import { puzzleQuad, readAssembledGrid } from '../../src/cv/assembledGrid';
import { getCv } from '../helpers/cv';
import { wasmBytes } from '../../src/cv/loadCv';
import { decodeRgba, REAL_DIR } from '../helpers/realFixtures';

const RUN = process.env.SPEED === '1';
const PHOTOS = (process.env.SPEED_PHOTOS ?? 'IMG_9127,IMG_9276,IMG_9280,IMG_9272,IMG_9263').split(',').filter((n) => existsSync(`${REAL_DIR}${n}.jpeg`));

it.skipIf(!RUN || !PHOTOS.length)(
  'scan time per step on the owner’s photos',
  async () => {
    const cv = await getCv();
    const lines: string[] = [];
    for (const n of PHOTOS) {
      const img = await decodeRgba(`${REAL_DIR}${n}.jpeg`);
      const heap0 = wasmBytes(cv);
      const t0 = performance.now();
      const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
      const t1 = performance.now();
      let read = 0;
      for (const p of r.pieces) if (readPiece(img, p, r.pxPerMm ?? 4)) read++;
      const t2 = performance.now();
      const big = r.regions.filter((g) => g.kind === 'assembled').sort((a, b) => b.areaMm2 - a.areaMm2)[0];
      if (big) {
        const q = puzzleQuad(cv, img, big.outlineImg);
        if (q) readAssembledGrid(cv, img, q, { pieceCount: 1000, grid: { cols: 28, rows: 36 } });
      }
      const t3 = performance.now();
      // A second photo at the same height: detection starts at the first one's scale.
      const h0 = performance.now();
      const rh = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null, ppmHint: r.pxPerMm });
      const hintMs = performance.now() - h0;
      const steps = Object.entries(r.timings)
        .filter(([k, v]) => k.startsWith('find.') && v > 30)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k.slice(5)} ${(v / 1000).toFixed(2)}`)
        .join(', ');
      lines.push(
        `${n} (${img.width}×${img.height}, ${((img.width * img.height) / 1e6).toFixed(1)} MP, ${(r.pxPerMm ?? 0).toFixed(1)} px/mm, scale step ${((r.timings.scale ?? 0) / 1000).toFixed(1)} s): ${r.pieces.length} pieces; find ${((t1 - t0) / 1000).toFixed(1)} s [${steps}], read ${read} pieces ${((t2 - t1) / 1000).toFixed(1)} s, finished check ${((t3 - t2) / 1000).toFixed(1)} s; total ${((t3 - t0) / 1000).toFixed(1)} s; next photo at the same height: find ${(hintMs / 1000).toFixed(1)} s (${rh.pieces.length} pieces); OpenCV memory ${Math.round(heap0 / 2 ** 20)} → ${Math.round(wasmBytes(cv) / 2 ** 20)} MB`,
      );
    }
    console.log(lines.join('\n'));
    if ((globalThis as any).__texProf)
      console.log('texture:', JSON.stringify(Object.fromEntries(Object.entries((globalThis as any).__texProf).map(([k, v]) => [k, Math.round(v as number)]))));
    expect(lines.length).toBe(PHOTOS.length);
  },
  1_800_000,
);
