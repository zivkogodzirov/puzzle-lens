/**
 * Box placement accuracy (M4, PLAN §7) end to end on synthetic sets: render the set's overview (and
 * 2× close-ups), find pieces (marker-free scan), read shapes, straighten each piece into a patch,
 * place it on the puzzle's art (the "box picture", optionally degraded like a photo of a printed
 * lid), and compare with the true cell. Opt-in (minutes):
 *
 *   PLACE_ACCURACY=1 [PLACE_SETS=val48,val300] [PLACE_BOX=clean|photo] [PLACE_SET='{"keep0":48}'] [SEG_SET='{…}'] npx vitest run --project unit test/unit/cv-placement-accuracy.test.ts
 *
 * PLACE_GAPS=1 instead places the pieces only among "empty spots" (as for the leftover pieces of a
 * nearly finished puzzle): every piece's true cell plus PLACE_GAPS_EXTRA (default 20 %) more spots
 * whose pieces weren't scanned, one piece per spot (src/cv/openSpots.ts).
 */
import { describe, expect, it } from 'vitest';
import { buildBoxGrid, patchStats, placePiece, spotStats, PLACE, type ColourMatch } from '../../src/cv/placement';
import { COLOUR_FIT, fitColour, type ColourSample } from '../../src/cv/colourFit';
import { chooseSpots, type SpotShapes } from '../../src/cv/openSpots';
import { fitBoxCorrection, fitMatters, refitPicture } from '../../src/cv/boxFit';
import { SEG } from '../../src/cv/pieceFinder';
import { getCv } from '../helpers/cv';
import { ALL_SETS, sceneOptions } from '../synth/sets';
import { boxPicture, readSynthPieces } from '../helpers/synthPieces';

const RUN = process.env.PLACE_ACCURACY === '1';
const SETS = (process.env.PLACE_SETS ?? 'val48').split(',') as Array<keyof typeof ALL_SETS>;
const BOX = process.env.PLACE_BOX ?? 'photo';
// Tuning: PLACE_SET / SEG_SET override placement and piece-finder settings (JSON).
if (process.env.PLACE_SET) Object.assign(PLACE, JSON.parse(process.env.PLACE_SET));
if (process.env.SEG_SET) Object.assign(SEG, JSON.parse(process.env.SEG_SET));

/**
 * PLACE_BOXEXT: a box picture that shows more of the scene than the puzzle (e > 0: the puzzle fills
 * only the middle 1 − 2e of each axis, the rest continues mirrored) or less (e < 0: cropped by |e|
 * each side), as box art often does. The test still takes the box picture's own edges as the puzzle's.
 */
function misfit(pic: { data: Uint8Array; width: number; height: number; stride: number }, e: number) {
  if (!e) return pic;
  const { width: W, height: H, data } = pic;
  const out = new Uint8Array(data.length);
  const src = (v: number, n: number) => {
    let u = e > 0 ? (v / n - e) / (1 - 2 * e) : (v / n) * (1 + 2 * e) - e;
    u = Math.abs(u);
    if (u > 1) u = 2 - u;
    return Math.min(n - 1, Math.max(0, Math.floor(u * n)));
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = (src(y + 0.5, H) * W + src(x + 0.5, W)) * 4;
      out.set(data.subarray(k, k + 4), (y * W + x) * 4);
    }
  return { data: out, width: W, height: H, stride: W * 4 };
}

if (process.env.COLOUR_MODE) COLOUR_FIT.mode = process.env.COLOUR_MODE as 'affine' | 'diagonal';
if (process.env.COLOUR_RIDGE) COLOUR_FIT.ridge = Number(process.env.COLOUR_RIDGE);

describe.skipIf(!RUN)('box placement accuracy (synthetic)', () => {
  for (const setName of SETS)
    it(`${setName} (${BOX} box picture)`, async () => {
      const cv = await getCv();
      const set = ALL_SETS[setName];
      const keys = [...new Set(set.items.map((i) => i.puzzleKey))].slice(0, Number(process.env.PLACE_PUZZLES ?? 99));
      const dump: Array<{ s: number[]; right: number; cells: number }> = [];
      const gapDump: Array<{ cells: Array<[number, number]>; pieces: Array<{ truth: number; scores: Array<number | null> }> }> = [];
      const res = { n: 0, top1: 0, top5: 0, strong: 0, strongOk: 0, likely: 0, likelyOk: 0, several: 0, ms: 0, border: 0, borderTop1: 0 };
      for (const key of keys) {
        const items = set.items.filter((i) => i.puzzleKey === key && i.name.includes('-b0-'));
        const opts0 = sceneOptions(items[0]!);
        const pz = opts0.puzzle;
        const ext = Number(process.env.PLACE_BOXEXT ?? 0);
        let pic = misfit(boxPicture(pz.art, BOX), ext);
        let box = buildBoxGrid(pic, pz.cols, pz.rows);
        const pieces = await readSynthPieces(cv, items, pz);
        if (process.env.PLACE_GAPS === '1') {
          // One entry per piece (as in the app's catalog: a piece seen in an overview and a close-up
          // is one piece; the close-up's patch, which comes later, is kept).
          const byId = new Map(pieces.map((p) => [p.id, p]));
          pieces.length = 0;
          pieces.push(...byId.values());
          // Empty spots: the pieces' own cells plus some whose pieces weren't scanned.
          const cellOf = (id: string) => id.slice(1).split('c').map(Number).reverse() as [number, number];
          let seed = 7 + keys.indexOf(key);
          const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
          let cells: Array<[number, number]>;
          if (process.env.PLACE_GAPS_MODE === 'clusters') {
            // Like the owner's test: two small groups of holes (5 × 2 and 4 × 3) in an otherwise
            // finished puzzle; the scanned pieces from them (any not scanned leave an empty spot).
            cells = [];
            const inC = new Set<string>();
            for (const [w, h] of [
              [5, 2],
              [4, 3],
            ] as const)
              for (let tries = 0; tries < 50; tries++) {
                const c0 = Math.floor(rnd() * (pz.cols - w + 1));
                const r0 = Math.floor(rnd() * (pz.rows - h + 1));
                const block: Array<[number, number]> = [];
                for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) block.push([c, r]);
                if (block.some(([c, r]) => inC.has(`${c},${r}`))) continue;
                for (const [c, r] of block) (inC.add(`${c},${r}`), cells.push([c, r]));
                break;
              }
            const keep = pieces.filter((p) => inC.has(cellOf(p.id).join(',')));
            pieces.length = 0;
            pieces.push(...keep);
          } else {
            cells = pieces.map((p) => cellOf(p.id));
            const has = new Set(cells.map(([c, r]) => `${c},${r}`));
            const extra = Math.round(cells.length * Number(process.env.PLACE_GAPS_EXTRA ?? 0.2));
            for (let k = 0; k < extra * 20 && cells.length < pieces.length + extra; k++) {
              const c = Math.floor(rnd() * pz.cols);
              const r = Math.floor(rnd() * pz.rows);
              if (!has.has(`${c},${r}`)) (has.add(`${c},${r}`), cells.push([c, r]));
            }
          }
          const have = new Set(cells.map(([c, r]) => `${c},${r}`));
          if (!pieces.length) continue;
          const only = (c: number, r: number) => have.has(`${c},${r}`);
          const st = patchStats(pieces.map((p) => p.patch));
          const colour = st ? { from: st, to: spotStats(box, cells)! } : null;
          const t0 = performance.now();
          const placed = pieces.map((p) => ({
            id: p.id,
            placement: placePiece(box, p.patch, { flats: p.flats, flatsSure: p.sure, colour, only, full: true }),
          }));
          res.ms += performance.now() - t0;
          // PLACE_KNOBS=1: knob fit too, with each spot's sides as the photo of the holes would show
          // them (the missing piece's true side where the neighbour is in place).
          let shapes: SpotShapes | null = null;
          if (process.env.PLACE_KNOBS === '1') {
            const truthSides = new Map(pz.pieces.map((q) => [`${q.col},${q.row}`, q.sides]));
            const spots = cells.map(([c, r]) =>
              [0, 1, 2, 3]
                .map((e) => {
                  const nc = c + [0, 1, 0, -1][e]!;
                  const nr = r + [-1, 0, 1, 0][e]!;
                  if (nc < 0 || nr < 0 || nc >= pz.cols || nr >= pz.rows) return 'f';
                  if (have.has(`${nc},${nr}`)) return 'o';
                  return truthSides.get(`${c},${r}`)![e]![0];
                })
                .join(''),
            );
            shapes = { pieces: new Map(pieces.map((p) => [p.id, { sides: p.sides, conf: p.conf }])), spots };
          }
          const chosen = chooseSpots(placed, cells, shapes);
          if (process.env.PLACE_DUMP)
            gapDump.push({
              cells,
              pieces: pieces.map((p, i) => {
                const [col, row] = cellOf(p.id);
                const t = placed[i]!.placement.top;
                return {
                  truth: cells.findIndex(([c, r]) => c === col && r === row),
                  scores: cells.map(([c, r]) => t.find((x) => x.col === c && x.row === r)?.score ?? null),
                };
              }),
            });
          for (const p of pieces) {
            const [col, row] = cellOf(p.id);
            const ch = chosen.get(p.id)!;
            const top0 = placed.find((q) => q.id === p.id)!.placement.top[0];
            const ok1 = ch.fits && ch.placement.top[0]!.col === col && ch.placement.top[0]!.row === row;
            if (process.env.PLACE_DUMP) dump.push({ s: [ch.placement.top[0]?.p ?? 0], right: ok1 ? 0 : -1, cells: cells.length });
            res.n++;
            if (ok1) res.top1++;
            if (top0 && top0.col === col && top0.row === row) res.top5++;
            if (!ch.fits) res.border++;
            if (ch.placement.verdict === 'strong') (res.strong++, ok1 && res.strongOk++);
            else if (ch.placement.verdict === 'likely') (res.likely++, ok1 && res.likelyOk++);
            else res.several++;
          }
          continue;
        }
        // One-time colour match over the whole batch (RESEARCH §9.5).
        const ps = patchStats(pieces.map((p) => p.patch));
        // PLACE_BOXFIT=1: box-to-grid correction from the confident placements (up to 3 rounds), as the app offers it.
        if (process.env.PLACE_BOXFIT === '1')
          for (let round = 0; round < 3; round++) {
            const c0 = ps ? { from: ps, to: box.stats } : null;
            const samples = pieces
              .map((p) => placePiece(box, p.patch, { flats: p.flats, flatsSure: p.sure, colour: c0 }))
              .filter((pl) => pl.verdict === 'strong')
              .map((pl) => ({ col: pl.top[0]!.col, row: pl.top[0]!.row, ox: pl.top[0]!.ox ?? 0, oy: pl.top[0]!.oy ?? 0 }));
            const fit = fitBoxCorrection(samples, pz.cols, pz.rows);
            console.log(
              `  ${key} round ${round}: ${samples.length} strong; ` +
                (fit
                  ? `fit x a ${fit.x.a.toFixed(4)} b ${fit.x.b.toFixed(3)} (n ${fit.x.n}), y a ${fit.y.a.toFixed(4)} b ${fit.y.b.toFixed(3)} (n ${fit.y.n}), edge shift ${fit.edgeShift.toFixed(3)}; true a ${(1 - 2 * ext).toFixed(4)} b x ${(ext * pz.cols).toFixed(3)} y ${(ext * pz.rows).toFixed(3)}`
                  : 'no fit'),
            );
            if (!fitMatters(fit)) break;
            pic = refitPicture(pic, pz.cols, pz.rows, fit!);
            box = buildBoxGrid(pic, pz.cols, pz.rows);
          }
        let colour: ColourMatch | null = ps ? { from: ps, to: box.stats } : null;
        // PLACE_LEARN=N (M8): the owner confirms N pieces (the first N placed right with a Strong
        // verdict, as "✓ Fits" would); the colour transform learned from them places the others.
        // Reported on the other pieces only, before and after.
        const learnN = Number(process.env.PLACE_LEARN ?? 0);
        let confirmed = new Set<string>();
        if (learnN > 0) {
          const samples: ColourSample[] = [];
          for (const p of pieces) {
            if (samples.length >= learnN) break;
            const pl = placePiece(box, p.patch, { flats: p.flats, flatsSure: p.sure, colour });
            const [row, col] = p.id.slice(1).split('c').map(Number) as [number, number];
            const t = pl.top[0];
            if (pl.verdict === 'strong' && t && t.col === col && t.row === row) {
              samples.push({ patch: p.patch, col, row, rot: t.rot });
              confirmed.add(p.id);
            }
          }
          const fit = fitColour(box, samples, 12, colour);
          console.log(
            `  ${key}: learned from ${samples.length} confirmed pieces: ${fit ? `held-out ΔE ${fit.heldOutBase.toFixed(1)} → ${fit.heldOut.toFixed(1)}${fit.useful ? '' : ' (not used)'}` : 'no fit'}`,
          );
          if (fit && (fit.useful || process.env.PLACE_LEARN_USE === 'always') && process.env.PLACE_LEARN_USE !== '0')
            colour = { ...colour!, affine: fit.affine };
        }
        for (const p of pieces) {
          if (confirmed.has(p.id)) continue;
          const t0 = performance.now();
          const pl = placePiece(box, p.patch, { flats: p.flats, flatsSure: p.sure, colour });
          res.ms += performance.now() - t0;
          const [row, col] = p.id
            .slice(1)
            .split('c')
            .map((v) => Number(v));
          const ok = (k: number) => pl.top.slice(0, k).some((q) => q.col === col && q.row === row);
          if (process.env.PLACE_DUMP)
            dump.push({ s: pl.top.map((q) => q.score), right: pl.top.findIndex((q) => q.col === col && q.row === row), cells: pz.cols * pz.rows });
          res.n++;
          if (ok(1)) res.top1++;
          if (ok(5)) res.top5++;
          if (row === 0 || col === 0 || row === pz.rows - 1 || col === pz.cols - 1) {
            res.border++;
            if (ok(1)) res.borderTop1++;
          }
          if (pl.verdict === 'strong') {
            res.strong++;
            if (ok(1)) res.strongOk++;
          } else if (pl.verdict === 'likely') {
            res.likely++;
            if (ok(1)) res.likelyOk++;
          } else res.several++;
        }
      }
      const pc = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)} %`;
      if (process.env.PLACE_GAPS === '1')
        console.log(
          `${setName} ${BOX} EMPTY SPOTS: ${res.n} pieces; right spot (one per spot) ${pc(res.top1, res.n)}, best spot alone ${pc(res.top5, res.n)}, left unpaired ${pc(res.border, res.n)}; ` +
            `Strong ${pc(res.strong, res.n)} (right ${pc(res.strongOk, res.strong)}), Likely ${pc(res.likely, res.n)} (right ${pc(res.likelyOk, res.likely)}), Several ${pc(res.several, res.n)}; ${(res.ms / Math.max(1, res.n)).toFixed(0)} ms per piece`,
        );
      else
        console.log(
          `${setName} ${BOX}: ${res.n} pieces; top-1 ${pc(res.top1, res.n)}, top-5 ${pc(res.top5, res.n)}; border pieces top-1 ${pc(res.borderTop1, res.border)}; ` +
            `Strong ${pc(res.strong, res.n)} of pieces (right ${pc(res.strongOk, res.strong)}), Likely ${pc(res.likely, res.n)} (right ${pc(res.likelyOk, res.likely)}), Several ${pc(res.several, res.n)}; ${(res.ms / Math.max(1, res.n)).toFixed(0)} ms per piece`,
        );
      if (process.env.PLACE_DUMP)
        (await import('node:fs')).writeFileSync(`${process.env.PLACE_DUMP}-${setName}.json`, JSON.stringify(gapDump.length ? gapDump : dump));
      expect(res.n).toBeGreaterThan(0);
    }, 3_600_000);
});
