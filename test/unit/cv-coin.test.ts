/** The coin for true size (src/cv/coin.ts) on simulated tables with pieces. */
import { beforeAll, describe, expect, it } from 'vitest';
import { getCv, counters, type Cv } from '../helpers/cv';
import { generatePuzzle, renderScene } from '../synth/index';
import { findCoin, MK_COINS } from '../../src/cv/coin';
import { gaussianBlur } from '../helpers/images';
import { withCoin } from '../helpers/coinImage';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeRgba, REAL_DIR } from '../helpers/realFixtures';

let cv: Cv;
beforeAll(async () => {
  cv = await getCv();
});

describe('coin for true size', () => {
  it('lists the Macedonian coins with their diameters', () => {
    expect(MK_COINS.map((c) => c.label)).toEqual(['1 denar', '2 denari', '5 denari', '10 denari', '50 denari']);
    expect(MK_COINS.find((c) => c.id === 'mk-5')!.diameterMm).toBe(27.5);
  });

  for (const [metal, coin, heightMm] of [
    ['brass', 'mk-1', 700],
    ['silver', 'mk-5', 650],
    ['brass', 'mk-10', 600],
  ] as const) {
    it(`measures a ${metal} ${coin} within 1.5 % at ${heightMm / 10} cm`, async () => {
      const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 3 });
      const scene = await renderScene({ puzzle, seed: 13, markers: [], layout: { areaMm: [600, 450], originMm: [100, 80] }, camera: { x: 400, y: 305, heightMm, tiltDeg: 1, imageSize: [4032, 3024] } });
      const ppm = scene.truth.pxPerMm;
      const d = MK_COINS.find((c) => c.id === coin)!.diameterMm;
      // Put it near a corner of the picture, on the table.
      let img = withCoin({ data: scene.rgba, width: scene.width, height: scene.height, stride: scene.width * 4 }, [300, 2700], d * ppm, metal);
      img = gaussianBlur(cv, img, 4, 0.8);
      const before = counters().liveScoped;
      // The estimated scale may be ~20 % off.
      const found = findCoin(cv, img, { pxPerMm: ppm * 0.8 });
      expect(counters().liveScoped).toBe(before);
      expect(found).not.toBeNull();
      expect(Math.hypot(found!.centre[0] - 300, found!.centre[1] - 2700)).toBeLessThan(3);
      expect(Math.abs(found!.diameterPx / (d * ppm) - 1), `ratio ${found!.diameterPx / (d * ppm)}`).toBeLessThan(0.015);
    }, 60_000);
  }

  it('finds a shiny brass coin as bright as the table, next to a grey stain (owner photo 2026-11-07)', async () => {
    const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 3 });
    const scene = await renderScene({ puzzle, seed: 13, markers: [], layout: { areaMm: [600, 450], originMm: [100, 80] }, camera: { x: 400, y: 305, heightMm: 700, tiltDeg: 1, imageSize: [4032, 3024] } });
    const ppm = scene.truth.pxPerMm;
    const d = MK_COINS.find((c) => c.id === 'mk-2')!.diameterMm;
    let img = withCoin({ data: scene.rgba, width: scene.width, height: scene.height, stride: scene.width * 4 }, [400, 2600], d * ppm, 'shiny-brass', { stain: true });
    img = gaussianBlur(cv, img, 4, 0.8);
    const found = findCoin(cv, img, { pxPerMm: ppm * 0.8 });
    expect(found).not.toBeNull();
    expect(Math.hypot(found!.centre[0] - 400, found!.centre[1] - 2600)).toBeLessThan(4);
    expect(Math.abs(found!.diameterPx / (d * ppm) - 1), `ratio ${found!.diameterPx / (d * ppm)}`).toBeLessThan(0.03);
  }, 60_000);

  it.skipIf(!existsSync(join(REAL_DIR, 'coin-shot-9262.jpeg')))('finds the owner\'s 2-denar coin in the app screenshot (brass on a cream table, next to a damp mark)', async () => {
    const img = await decodeRgba(join(REAL_DIR, 'coin-shot-9262.jpeg'));
    const found = findCoin(cv, img, { pxPerMm: 3.2 });
    expect(found).not.toBeNull();
    expect(Math.hypot(found!.centre[0] - 676, found!.centre[1] - 1228)).toBeLessThan(6);
  }, 60_000);

  it('finds nothing on a table with only pieces', async () => {
    const puzzle = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 4 });
    const scene = await renderScene({ puzzle, seed: 14, markers: [], layout: { areaMm: [600, 450], originMm: [100, 80] }, camera: { x: 400, y: 305, heightMm: 680, tiltDeg: 1, imageSize: [4032, 3024] } });
    expect(findCoin(cv, { data: scene.rgba, width: scene.width, height: scene.height, stride: scene.width * 4 }, { pxPerMm: scene.truth.pxPerMm })).toBeNull();
  }, 60_000);
});
