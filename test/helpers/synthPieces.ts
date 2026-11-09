/**
 * Synthetic puzzles read the way the app reads photos (shared by the placement and pair accuracy
 * tests): the box picture as a photographed lid, and each scene's pieces found (marker-free scan),
 * their shapes read and straightened into patches. No ground-truth outlines are fed in.
 */
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { readShape, READ_OK } from '../../src/cv/shapeRead';
import { extractPatch, type PiecePatch } from '../../src/cv/placement';
import type { Vec2 } from '../../src/project/types';
import type { Cv } from '../../src/cv/loadCv';
import { renderScene, segmentationScore, type SynthScene } from '../synth/index';
import type { SynthArt, SynthPuzzle } from '../synth/types';
import { sceneOptions, type SynthSetItem } from '../synth/sets';

const buf = (s: SynthScene) => ({ data: s.rgba, width: s.width, height: s.height, stride: s.stride });

export interface SynthPiece {
  /** The true piece id ("r{row}c{col}"). */
  id: string;
  patch: PiecePatch;
  flats: boolean[] | null;
  sure: boolean;
  /** Side kinds in patch order ('t', 'b', 'f', 'u') and how sure (already weighted for an unsure read). */
  sides: string;
  conf: number[];
  /** Side read sureness as the app stores it (sideConf). */
  rawConf: number[];
}

/** The true cell [col, row] of a synthetic piece id ("r{row}c{col}"). */
export const cellOf = (id: string) => id.slice(1).split('c').map(Number).reverse() as [number, number];

/** The art as a photographed box lid: slightly blurred, warmer and less saturated, a little darker. */
export function boxPicture(art: SynthArt, BOX = 'photo'): { data: Uint8Array; width: number; height: number; stride: number } {
  const { width: W, height: H, rgba } = art;
  if (BOX === 'clean') return { data: rgba, width: W, height: H, stride: W * 4 };
  const out = new Uint8Array(rgba.length);
  const r = Math.max(1, Math.round(Math.min(W, H) / 900));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(W - 1, Math.max(0, x + dx));
          const yy = Math.min(H - 1, Math.max(0, y + dy));
          const k = (yy * W + xx) * 4;
          s0 += rgba[k]!;
          s1 += rgba[k + 1]!;
          s2 += rgba[k + 2]!;
          n++;
        }
      const R = s0 / n;
      const G = s1 / n;
      const B = s2 / n;
      const Y = 0.3 * R + 0.59 * G + 0.11 * B;
      const sat = 0.85;
      const k = (y * W + x) * 4;
      out[k] = Math.min(255, (Y + (R - Y) * sat) * 0.92 + 6);
      out[k + 1] = Math.min(255, (Y + (G - Y) * sat) * 0.9 + 2);
      out[k + 2] = Math.min(255, (Y + (B - Y) * sat) * 0.82);
      out[k + 3] = 255;
    }
  return { data: out, width: W, height: H, stride: W * 4 };
}

/** Every piece found in the given scenes (a piece seen twice appears twice, in scene order). */
export async function readSynthPieces(cv: Cv, items: SynthSetItem[], pz: SynthPuzzle): Promise<SynthPiece[]> {
  const pieces: SynthPiece[] = [];
  for (const item of items) {
    const opts = sceneOptions(item);
    const s = await renderScene({ ...opts, markers: [] });
    const zoom = item.kind === 'detail' ? 2 : 1;
    const r = scanMarkerless(cv, buf(s), { catalog: [], zoom, kind: item.kind === 'detail' ? 'detail' : 'overview', table: null, pieceAreaShare: 1 });
    const ppm = r.pxPerMm!;
    const sc = segmentationScore(r.pieces, s.truth);
    for (const m of sc.matches) {
      const f = r.pieces[m.foundIndex]!;
      const t = s.truth.pieces.find((p) => p.id === m.id)!;
      if (f.flags.cut || f.flags.clump || t.faceDown) continue;
      const rd = readShape(
        f.outlineImg.map((v) => v / ppm),
        [pz.cellMm[0] * ppm, pz.cellMm[1] * ppm].map((v) => v / ppm) as Vec2,
      );
      if (!rd) continue;
      const corners = rd.corners.map(([x, y]) => [x * ppm, y * ppm] as Vec2);
      const patch = extractPatch(buf(s), corners, f.outlineImg);
      if (!patch) continue;
      const sure = Boolean(rd.kind) && rd.quality >= READ_OK;
      pieces.push({
        id: m.id,
        patch,
        flats: rd.sides.map((sd) => sd.kind === 'flat'),
        sure,
        sides: rd.sides.map((sd) => (sd.kind === 'unsure' ? 'u' : sd.kind[0])).join(''),
        conf: rd.sides.map((sd) => sd.conf * (sure ? 1 : 0.6)),
        rawConf: rd.sides.map((sd) => sd.conf),
      });
    }
  }
  return pieces;
}
