/**
 * Writes src/markers/patterns.ts: the bit patterns of ArUco DICT_4X4_50 ids 0–7, taken from the
 * project's own OpenCV build so the printed sheets can never disagree with the detector.
 *
 *   node scripts/make-marker-patterns.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import createOpenCv from '../vendor/opencv/opencv.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const COUNT = 8;
const CELLS = 6;
const PX = 10;
const cv = await createOpenCv({ print() {}, printErr() {} });
if (cv && typeof cv.then === 'function') delete cv.then;

const dict = cv.getPredefinedDictionary(cv.DICT_4X4_50);
const out = [];
for (let id = 0; id < COUNT; id++) {
  const img = new cv.Mat();
  cv.generateImageMarker(dict, id, CELLS * PX, img, 1);
  const rows = [];
  for (let r = 0; r < CELLS; r++) {
    let s = '';
    for (let c = 0; c < CELLS; c++) s += img.ucharAt(r * PX + PX / 2, c * PX + PX / 2) > 127 ? '1' : '0';
    rows.push(s);
  }
  img.delete();
  for (let i = 0; i < CELLS; i++) if (rows[0][i] !== '0' || rows[CELLS - 1][i] !== '0' || rows[i][0] !== '0' || rows[i][CELLS - 1] !== '0') throw new Error(`id ${id}: border not black`);
  out.push(rows);
}
dict.delete();
const ts = `/**
 * ArUco DICT_4X4_50 bit patterns for marker ids 0–${COUNT - 1}: 6 rows of 6 cells including the black
 * border, '1' = white. Made by scripts/make-marker-patterns.mjs from the app's own OpenCV build;
 * do not edit by hand.
 */
export const MARKER_PATTERNS: readonly (readonly string[])[] = ${JSON.stringify(out, null, 2)};
`;
writeFileSync(`${ROOT}src/markers/patterns.ts`, ts);
console.log(`Wrote src/markers/patterns.ts (${COUNT} markers)`);
