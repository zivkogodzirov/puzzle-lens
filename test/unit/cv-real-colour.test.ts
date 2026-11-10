/**
 * The learned colour transform (M8 part 1) on the owner's real pieces (test/fixtures/real, kept
 * out of git; skipped when missing): the 19 real pieces of IMG_9276 whose true spots are known
 * (test/helpers/realKiss.ts), placed on the WHOLE box picture (as for a fresh puzzle).
 *
 * - now: the one-time per-channel colour match (the pieces' Lab mean and spread → the picture's);
 * - learned: for each piece, the transform fitted from the OTHER pieces' known spots only (as the
 *   app would after the owner's "Fits" answers), so no piece is placed with its own answer.
 */
import { expect, it } from 'vitest';
import { patchStats, placePiece } from '../../src/cv/placement';
import { COLOUR_FIT, fitColour, type ColourSample } from '../../src/cv/colourFit';
import { getCv } from '../helpers/cv';
import { ALIKE, HAS_KISS, loadKiss, TRUTH } from '../helpers/realKiss';

if (process.env.COLOUR_MODE) COLOUR_FIT.mode = process.env.COLOUR_MODE as 'affine' | 'diagonal';
if (process.env.COLOUR_RIDGE) COLOUR_FIT.ridge = Number(process.env.COLOUR_RIDGE);

it.skipIf(!HAS_KISS)(
  'learned colour transform: whole-picture placement of the real pieces, each with a transform from the others',
  async () => {
    const cv = await getCv();
    const kiss = await loadKiss(cv);
    const { box } = kiss;
    const truth = kiss.pieces.filter((p) => TRUTH[p.k]);
    const ok = (k: number, col: number, row: number) => {
      const alt = ALIKE.find((g) => g.includes(k));
      return (alt ?? [k]).some((kk) => TRUTH[kk]![0] === col && TRUTH[kk]![1] === row);
    };
    // Each piece's turn at its true spot (the picture's best there).
    const rotOf = new Map(
      truth.map((p) => {
        const [c, r] = TRUTH[p.k]!;
        const sc = placePiece(box, p.patch, { flats: p.flats, flatsSure: p.sure, only: (cc, rr) => cc === c && rr === r, full: true }).top[0]?.rotScores ?? [
          0, 0, 0, 0,
        ];
        return [p.k, sc.indexOf(Math.max(...sc)) as 0 | 1 | 2 | 3];
      }),
    );
    const stats = patchStats(kiss.pieces.map((p) => p.patch))!;
    if (process.env.COLOUR_DEBUG)
      for (const p of truth.slice(0, 4)) {
        const S = p.patch.size;
        let on = 0;
        for (let y = 12; y < 44; y++) for (let x = 12; x < 44; x++) if (p.patch.rgba[(y * S + x) * 4 + 3]) on++;
        console.log(`  patch #${p.k}: size ${S}, core coverage ${((on / 1024) * 100).toFixed(0)} %`);
      }
    const now = { from: stats, to: box.stats };
    const res = { now: [0, 0], learned: [0, 0] };
    let useful = 0;
    const lines: string[] = [];
    for (const p of truth) {
      const a = placePiece(box, p.patch, { flats: p.flats, flatsSure: p.sure, colour: now });
      const samples: ColourSample[] = truth
        .filter((q) => q.k !== p.k)
        .map((q) => ({ patch: q.patch, col: TRUTH[q.k]![0], row: TRUTH[q.k]![1], rot: rotOf.get(q.k)! }));
      const fit = fitColour(box, samples, 12, now);
      if (fit?.useful) useful++;
      const b = fit?.useful ? placePiece(box, p.patch, { flats: p.flats, flatsSure: p.sure, colour: { ...now, affine: fit.affine } }) : a;
      const rank = (pl: typeof a) => pl.top.findIndex((t) => ok(p.k, t.col, t.row));
      const ra = rank(a);
      const rb = rank(b);
      if (ra === 0) res.now[0]!++;
      if (ra >= 0) res.now[1]!++;
      if (rb === 0) res.learned[0]!++;
      if (rb >= 0) res.learned[1]!++;
      lines.push(
        `  #${p.k}: now ${ra < 0 ? '—' : ra + 1}, learned ${rb < 0 ? '—' : rb + 1}${fit ? ` (held-out ΔE ${fit.heldOutBase.toFixed(1)} → ${fit.heldOut.toFixed(1)}${fit.useful ? '' : ', not used'})` : ''}`,
      );
    }
    if (process.env.COLOUR_DEBUG) console.log(lines.join('\n'));
    console.log(
      `whole picture, ${truth.length} real pieces: first ${res.now[0]} → ${res.learned[0]} with the learned transform; top 5 ${res.now[1]} → ${res.learned[1]} (used for ${useful} of ${truth.length})`,
    );
    expect(truth.length).toBeGreaterThan(15);
    // As measured 2026-11-10 (no worse): with the learned colours, at least 4 of the real pieces first.
    expect(res.learned[0]).toBeGreaterThanOrEqual(4);
    expect(res.learned[0]).toBeGreaterThan(res.now[0]!);
  },
  900_000,
);
