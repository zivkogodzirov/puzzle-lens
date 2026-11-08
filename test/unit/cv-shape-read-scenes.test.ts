/**
 * Shape reading on outlines the app traced itself from rendered photos (val48: hand-held overview
 * at 1× and the set's 2× close-ups, marker-free scan). Each found piece is matched to the truth;
 * its read is compared with the truth's sides as a cyclic sequence (the read doesn't know which
 * side is "top"; a face-down piece's mirror image counts too).
 *
 * Opt-in like the other set runs (a few minutes):
 *   SHAPE_SCENES=1 npx vitest run --project unit test/unit/cv-shape-read-scenes.test.ts
 */
import { describe, expect, it } from 'vitest';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { readShape, READ_OK } from '../../src/cv/shapeRead';
import { getCv } from '../helpers/cv';
import { renderScene, segmentationScore, type SynthScene } from '../synth/index';
import { sceneOptions, val48 } from '../synth/sets';

const RUN = process.env.SHAPE_SCENES === '1';
const PUZZLES = Number(process.env.SHAPE_PUZZLES ?? 6);
const buf = (s: SynthScene) => ({ data: s.rgba, width: s.width, height: s.height, stride: s.stride });

function cyclicMatch(read: string[], truth: string[]): boolean {
  for (const seq of [truth, [...truth].reverse()]) for (let r = 0; r < 4; r++) if (read.every((k, i) => k === seq[(i + r) % 4])) return true;
  return false;
}
const typeOf = (sides: readonly string[]) => {
  const f = sides.filter((s) => s === 'flat').length;
  return f === 0 ? 'interior' : f === 1 ? 'edge' : 'corner';
};

describe.skipIf(!RUN)('shape reading on traced outlines (val48)', () => {
  it('overview and 2× close-ups: sides and piece types', async () => {
    const cv = await getCv();
    const dump: unknown[] = [];
    const keys = [...new Set(val48.items.map((i) => i.puzzleKey))].slice(0, PUZZLES);
    const stats = {
      overview: { n: 0, read: 0, trusted: 0, seqOk: 0, typeOk: 0, trustedTypeOk: 0, borderWrong: 0 },
      detail: { n: 0, read: 0, trusted: 0, seqOk: 0, typeOk: 0, trustedTypeOk: 0, borderWrong: 0 },
    };
    for (const key of keys) {
      const items = val48.items.filter((i) => i.puzzleKey === key && i.name.includes('-b0-'));
      for (const item of items) {
        const opts = sceneOptions(item);
        const s = await renderScene({ ...opts, markers: [] });
        const zoom = item.kind === 'detail' ? 2 : 1;
        const r = scanMarkerless(cv, buf(s), { catalog: [], zoom, kind: item.kind === 'detail' ? 'detail' : 'overview', table: null, pieceAreaShare: 1 });
        const sc = segmentationScore(r.pieces, s.truth);
        const st = stats[item.kind === 'detail' ? 'detail' : 'overview'];
        for (const m of sc.matches) {
          const f = r.pieces[m.foundIndex]!;
          if (f.flags.clump || f.flags.cut) continue;
          const truthPiece = opts.puzzle.pieces.find((p) => p.id === m.id)!;
          st.n++;
          const read = readShape(f.outlineMm, opts.puzzle.cellMm);
          if (!read) continue;
          st.read++;
          const ok = cyclicMatch(
            read.sides.map((x) => x.kind),
            truthPiece.sides,
          );
          if (ok) st.seqOk++;
          if (process.env.SHAPE_DUMP)
            dump.push({
              kind: item.kind,
              truth: truthPiece.sides,
              read: read.sides.map((x) => [
                x.kind,
                +x.outMm.toFixed(2),
                +x.inMm.toFixed(2),
                +x.lengthMm.toFixed(1),
                +x.outMidMm.toFixed(2),
                +x.inMidMm.toFixed(2),
              ]),
              q: +read.quality.toFixed(3),
              fit: +read.fit.toFixed(3),
              minConf: Math.min(...read.sides.map((x) => x.conf)),
              ok: read.kind === typeOf(truthPiece.sides),
              seqOk: ok,
              o: f.outlineMm,
            });
          if (read.kind === typeOf(truthPiece.sides)) st.typeOk++;
          if (read.quality >= READ_OK) {
            st.trusted++;
            if (read.kind === typeOf(truthPiece.sides)) st.trustedTypeOk++;
            if ((read.kind === 'interior') !== (typeOf(truthPiece.sides) === 'interior')) st.borderWrong++;
          }
        }
      }
    }
    if (process.env.SHAPE_DUMP) (await import('node:fs')).writeFileSync(process.env.SHAPE_DUMP, JSON.stringify(dump));
    for (const [k, v] of Object.entries(stats))
      console.log(
        `${k}: ${v.n} clean pieces; read ${v.read}; all 4 sides right ${v.seqOk} (${((100 * v.seqOk) / v.n).toFixed(1)} %); type right ${v.typeOk} (${((100 * v.typeOk) / v.n).toFixed(1)} %); trusted ${v.trusted} (${((100 * v.trusted) / v.n).toFixed(1)} %), of which type right ${((100 * v.trustedTypeOk) / Math.max(1, v.trusted)).toFixed(1)} %, border group wrong ${v.borderWrong}`,
      );
    expect.soft(stats.overview.typeOk / stats.overview.n, 'overview piece type').toBeGreaterThanOrEqual(0.9);
    expect.soft(stats.overview.trustedTypeOk / Math.max(1, stats.overview.trusted), 'overview trusted type').toBeGreaterThanOrEqual(0.96);
    expect.soft(stats.detail.typeOk / Math.max(1, stats.detail.n), 'close-up piece type').toBeGreaterThanOrEqual(0.9);
  }, 1_200_000);
});
