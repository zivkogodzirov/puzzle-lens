/**
 * Which pieces join (M6, box-led; RESEARCH §11 "If not"). The go/no-go on the owner's real pieces
 * (2026-11-09: 24 true joins among the 21 pieces of IMG_9276) found shape alone at chance level (true
 * partner first 0 of 48, median rank 19 of ~36) and the colours along the seam weak (first 8 %,
 * median rank 9), so partners come from the box picture: two pieces whose likely spots are
 * neighbours probably join. Shape only rules a pair out (two knobs out, or two knobs in, or a flat
 * side, facing each other, both read clearly), and the chances shown are the placements' own.
 *
 * For piece A's side facing direction e on the box picture (0 up, 1 right, 2 down, 3 left):
 *   P(partner is B) = Σ over A's spots c of p_A(c) · q_B(c + e),
 * where q_B(n) is B's chance at spot n, shared out when the pieces' chances there add up to more
 * than one. What's left at each spot is "partner not scanned yet"; a spot off the picture is the
 * puzzle's edge, and a spot already filled is "joins the puzzle".
 */
import type { SpotChoice } from '../cv/openSpots';
import { facingSide } from './answers';
import type { PieceRow } from './types';

export const PAIRS = {
  /** Spots below this chance are left out. */
  minSpotP: 0.01,
  /** Pairs below this chance aren't suggested. */
  minPairP: 0.3,
  /** A side read at least this surely counts for the shape veto. */
  vetoConf: 0.6,
  /**
   * A 2 × 2 square only from pairs at least this likely. The loop adds little evidence in box-led
   * matching, so a square is as right as its pairs. Among empty spots, squares from pairs ≥ 50 %
   * were right 96.3 % (val300); pairs ≥ 70 % join 97–100 % of the time (real: 15 of 15 ≥ 64 %).
   * On the whole picture, squares from ≥ 50 % were right 98.7–99.5 % (val300, val48), and pairs
   * there rarely reach 70 %.
   */
  blockMinP: { whole: 0.5, open: 0.7 },
  /** Shape reads of a piece whose shape read isn't trusted count this much (as for placement). */
  unsureWeight: 0.6,
};

/** Directions on the box picture: 0 up, 1 right, 2 down, 3 left. */
export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export type Dir = 0 | 1 | 2 | 3;

/** One side of a piece, as it lies on the box picture. */
export interface SidePartners {
  /** Pieces that may join there, most likely first, each at its most likely spot (B's spot). */
  partners: Array<{ id: string; p: number; col: number; row: number }>;
  /** Its partner hasn't been scanned yet (or is out of reach of the pieces' likely spots). */
  notScanned: number;
  /** It joins a part of the puzzle already done. */
  inPuzzle: number;
  /** It's on the puzzle's edge (no partner). */
  edge: number;
  /** Where the piece goes isn't known well enough to say (its spots' chances add up to less than one). */
  unsure: number;
}

export interface PairSuggestion {
  a: string;
  b: string;
  /** B lies on A's side `dir` on the box picture (1 right, 2 down). */
  dir: 1 | 2;
  /** A's spot and turn in the most likely layout (B's spot is next to it). */
  col: number;
  row: number;
  rotA: 0 | 1 | 2 | 3;
  rotB: 0 | 1 | 2 | 3;
  /** How likely they join. */
  p: number;
  /** Their facing sides: knob out against knob in (both read clearly), or not known. */
  shape: 'fits' | 'unknown';
}

export interface BlockSuggestion {
  /** Top-left, top-right, bottom-left, bottom-right pieces. */
  ids: [string, string, string, string];
  /** Top-left piece's spot. */
  col: number;
  row: number;
  /** The weakest of its four pairs. */
  p: number;
}

export interface PairInput {
  /** Each piece's spots with chances (shownPlacements). */
  shown: Map<string, SpotChoice>;
  /** The pieces (side shapes). */
  rows: PieceRow[];
  grid: { cols: number; rows: number };
  /** The empty spots of a nearly finished puzzle ("c,r"), or null for the whole picture. */
  open?: Set<string> | null;
  /** Spots whose piece is known ("c,r"): placed, or answered "Fits". */
  filled?: Set<string>;
  /** Pairs the owner said don't join: pairKey(a, b, dir). */
  not?: Set<string>;
  /**
   * Rule out pairs whose facing sides can't join (default: on the whole picture only). Among empty
   * spots the placement already weighs knob fit with the neighbours, and on the owner's real pieces
   * the turns there were sometimes misread, so the veto hid true pairs (true partner first 69 % with
   * it, 75 % without; synthetic val48: 93.0 % vs 93.5 %). On the whole picture it helps (val48
   * 90.2 % vs 88.0 %; pairs at ≥ 50 % right 98.8 % vs 97.2 %).
   */
  veto?: boolean;
  /** Show measured chances (PAIR_CALIBRATION; default) rather than the raw products. */
  calibrate?: boolean;
}

/**
 * How often pairs really join, by their computed chance (Σ p_A · p_B): [computed, measured] points,
 * straight lines between, on the whole picture and among empty spots. Measured 2026-11-09 and left
 * as computed (identity): on the synthetic sets the computed chance is too modest (val48 + val300,
 * whole picture: pairs at 70–80 % joined 99 % of the time; empty spots 30–40 % → 68 %), but on the
 * owner's real pieces it is about right or a little high (≥ 64 %: 15 of 15; 30–50 %: 3 of 7):
 * real placements are less sure than synthetic ones, and a lift fitted on synthetic puzzles would
 * show real pairs too sure (pairs then shown at ≥ 50 %: 18 of 22 right). M8 fits this from the
 * owner's "They fit" answers.
 */
export const PAIR_CALIBRATION: Record<'whole' | 'open', Array<[number, number]>> = {
  whole: [
    [0, 0],
    [1, 1],
  ],
  open: [
    [0, 0],
    [1, 1],
  ],
};

/** A pair's raw chance → how often such pairs join (PAIR_CALIBRATION). */
export function calibratePair(p: number, mode: 'whole' | 'open'): number {
  const k = PAIR_CALIBRATION[mode];
  for (let i = 1; i < k.length; i++)
    if (p <= k[i]![0]) {
      const [x0, y0] = k[i - 1]!;
      const [x1, y1] = k[i]!;
      return y0 + ((y1 - y0) * (p - x0)) / Math.max(1e-9, x1 - x0);
    }
  return k[k.length - 1]![1];
}

export interface PairModel {
  /** On the whole picture, or among the empty spots of a nearly finished puzzle. */
  mode: 'whole' | 'open';
  /** Per piece: its four sides on the box picture (0 up, 1 right, 2 down, 3 left). */
  sides: Map<string, [SidePartners, SidePartners, SidePartners, SidePartners]>;
  /** Every pair with any chance (dir 1 or 2 only: each join once), most likely first. */
  pairs: PairSuggestion[];
}

/** The same join from either piece: "a|b|dir" with dir 1 (b right of a) or 2 (b below a). */
export function pairKey(a: string, b: string, dir: Dir): string {
  if (dir === 1 || dir === 2) return `${a}|${b}|${dir}`;
  return `${b}|${a}|${dir === 3 ? 1 : 2}`;
}

const key = (c: number, r: number) => `${c},${r}`;

/** A side's kind ('t' knob out, 'b' knob in, 'f' flat, 'u') facing e, and how sure. */
function facing(piece: PieceRow | undefined, q: number, e: number): { kind: string; conf: number } | null {
  const pt = piece?.patch;
  if (!pt?.sides || !pt.sideConf) return null;
  return { kind: facingSide(pt.sides, q, e), conf: (pt.sideConf[(e - q + 4) % 4] ?? 0) * (pt.sure ? 1 : PAIRS.unsureWeight) };
}

/** Can A (turned qa) and B (turned qb) join with B on A's side e? 'no' only when both sides are read clearly. */
export function shapeCheck(a: PieceRow | undefined, qa: number, b: PieceRow | undefined, qb: number, e: number): 'fits' | 'no' | 'unknown' {
  const fa = facing(a, qa, e);
  const fb = facing(b, qb, (e + 2) % 4);
  if (!fa || !fb || fa.conf < PAIRS.vetoConf || fb.conf < PAIRS.vetoConf) return 'unknown';
  if (fa.kind === 'f' || fb.kind === 'f') return 'no';
  if ((fa.kind === 't' && fb.kind === 'b') || (fa.kind === 'b' && fb.kind === 't')) return 'fits';
  if (fa.kind === fb.kind && (fa.kind === 't' || fa.kind === 'b')) return 'no';
  return 'unknown';
}

/** Who may join whom (see the file comment). */
export function pairModel(input: PairInput): PairModel {
  const { shown, grid } = input;
  const byId = new Map(input.rows.map((r) => [r.id, r]));
  const not = input.not ?? new Set<string>();
  const filled = input.filled ?? new Set<string>();
  const veto = input.veto ?? !input.open;
  const mode = input.open ? 'open' : 'whole';
  const cal = (p: number) => (input.calibrate === false ? p : calibratePair(p, mode));
  // Without the veto, a clash only means "not known".
  const check = (a: PieceRow | undefined, qa: number, b: PieceRow | undefined, qb: number, e: number): 'fits' | 'no' | 'unknown' => {
    const sh = shapeCheck(a, qa, b, qb, e);
    return sh === 'no' && !veto ? 'unknown' : sh;
  };
  // Who may be at each spot, with what chance and turn.
  const at = new Map<string, Array<{ id: string; p: number; rot: 0 | 1 | 2 | 3 }>>();
  const spotsOf = new Map<string, Array<{ col: number; row: number; p: number; rot: 0 | 1 | 2 | 3 }>>();
  for (const [id, ch] of shown) {
    if (!ch.fits) continue;
    const list: Array<{ col: number; row: number; p: number; rot: 0 | 1 | 2 | 3 }> = [];
    for (const t of ch.placement.top) {
      if (!(t.p >= PAIRS.minSpotP)) continue;
      list.push({ col: t.col, row: t.row, p: t.p, rot: t.rot });
      const k = key(t.col, t.row);
      const l = at.get(k) ?? [];
      l.push({ id, p: t.p, rot: t.rot });
      at.set(k, l);
    }
    spotsOf.set(id, list);
  }
  const sides = new Map<string, [SidePartners, SidePartners, SidePartners, SidePartners]>();
  // Pair chance (keyed once per join) with its most likely layout.
  const joint = new Map<string, PairSuggestion & { best: number }>();
  for (const [id, spots] of spotsOf) {
    const A = byId.get(id);
    const four = [0, 1, 2, 3].map(() => ({
      partners: new Map<string, { p: number; col: number; row: number; best: number }>(),
      notScanned: 0,
      inPuzzle: 0,
      edge: 0,
      unsure: 0,
    }));
    const mass = spots.reduce((s, t) => s + t.p, 0);
    for (const e of [0, 1, 2, 3] as const) {
      const S = four[e]!;
      S.unsure = Math.max(0, 1 - mass);
      for (const t of spots) {
        const nc = t.col + DIRS[e]![0];
        const nr = t.row + DIRS[e]![1];
        if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) {
          S.edge += t.p;
          continue;
        }
        const nk = key(nc, nr);
        if (filled.has(nk) || (input.open && !input.open.has(nk))) {
          S.inPuzzle += t.p;
          continue;
        }
        const others = (at.get(nk) ?? []).filter((o) => o.id !== id);
        const occ = others.reduce((s, o) => s + o.p, 0);
        const scale = 1 / Math.max(1, occ);
        // The pieces that may be there (not ruled out), each with its share of the spot.
        const cands = others
          .map((o) => ({ o, sh: check(A, t.rot, byId.get(o.id), o.rot, e) }))
          .filter((c) => c.sh !== 'no' && !not.has(pairKey(id, c.o.id, e)));
        let used = 0;
        for (const { o, sh } of cands) {
          const q = o.p * scale;
          const pp = t.p * q;
          used += q;
          const cur = S.partners.get(o.id);
          if (!cur) S.partners.set(o.id, { p: pp, col: nc, row: nr, best: pp });
          else {
            cur.p += pp;
            if (pp > cur.best) Object.assign(cur, { col: nc, row: nr, best: pp });
          }
          if (e === 1 || e === 2) {
            const k = pairKey(id, o.id, e);
            const cj = joint.get(k);
            if (!cj)
              joint.set(k, { a: id, b: o.id, dir: e, col: t.col, row: t.row, rotA: t.rot, rotB: o.rot, p: pp, shape: sh as 'fits' | 'unknown', best: pp });
            else {
              cj.p += pp;
              if (pp > cj.best) Object.assign(cj, { col: t.col, row: t.row, rotA: t.rot, rotB: o.rot, best: pp, shape: sh as 'fits' | 'unknown' });
            }
          }
        }
        S.notScanned += t.p * Math.max(0, 1 - used);
      }
    }
    sides.set(
      id,
      four.map((S) => {
        const partners = [...S.partners.entries()].map(([pid, v]) => ({ id: pid, p: cal(v.p), col: v.col, row: v.row })).sort((x, y) => y.p - x.p);
        // The measured chances move mass from (or to) "not scanned yet", then "not sure"; never above one in all.
        let extra = partners.reduce((t, q) => t + q.p, 0) - [...S.partners.values()].reduce((t, v) => t + v.p, 0);
        let notScanned = S.notScanned;
        let unsure = S.unsure;
        const fromNot = Math.min(notScanned, extra);
        notScanned -= fromNot;
        extra -= fromNot;
        if (extra > 0) {
          const fromUnsure = Math.min(unsure, extra);
          unsure -= fromUnsure;
          extra -= fromUnsure;
        }
        if (extra > 1e-9) {
          const sum = partners.reduce((t, q) => t + q.p, 0);
          const k = (sum - extra) / sum;
          for (const q of partners) q.p *= k;
        }
        return { partners, notScanned, inPuzzle: S.inPuzzle, edge: S.edge, unsure };
      }) as [SidePartners, SidePartners, SidePartners, SidePartners],
    );
  }
  const pairs = [...joint.values()].map(({ best: _b, ...s }) => ({ ...s, p: cal(Math.min(1, s.p)) })).sort((x, y) => y.p - x.p);
  return { mode, sides, pairs };
}

/** The pairs worth suggesting (chance at least PAIRS.minPairP), most likely first. */
export function pairSuggestions(model: PairModel, minP = PAIRS.minPairP): PairSuggestion[] {
  return model.pairs.filter((s) => s.p >= minP);
}

/**
 * Closed 2 × 2 squares: four likely pairs (each at least `minP`, PAIRS.blockMinP for the model's
 * mode) that agree on the four pieces' spots ("confirmed ✓", RESEARCH §11.5).
 */
export function blockSuggestions(pairs: PairSuggestion[], minP: number): BlockSuggestion[] {
  const likely = pairs.filter((s) => s.p >= minP);
  const right = new Map<string, PairSuggestion>();
  const down = new Map<string, PairSuggestion>();
  for (const s of likely) (s.dir === 1 ? right : down).set(`${s.a}@${s.col},${s.row}`, s);
  const out: BlockSuggestion[] = [];
  for (const top of likely) {
    if (top.dir !== 1) continue;
    const leftDown = down.get(`${top.a}@${top.col},${top.row}`);
    const rightDown = down.get(`${top.b}@${top.col + 1},${top.row}`);
    if (!leftDown || !rightDown) continue;
    const bottom = right.get(`${leftDown.b}@${top.col},${top.row + 1}`);
    if (!bottom || bottom.b !== rightDown.b) continue;
    out.push({ ids: [top.a, top.b, leftDown.b, rightDown.b], col: top.col, row: top.row, p: Math.min(top.p, leftDown.p, rightDown.p, bottom.p) });
  }
  return out.sort((x, y) => y.p - x.p);
}

/** Pairs that are part of a closed 2 × 2 square (pairKey). */
export function confirmedPairs(blocks: BlockSuggestion[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    const [tl, tr, bl, br] = b.ids;
    out.add(pairKey(tl, tr, 1));
    out.add(pairKey(bl, br, 1));
    out.add(pairKey(tl, bl, 2));
    out.add(pairKey(tr, br, 2));
  }
  return out;
}

/**
 * How crowded the choices are (RESEARCH §11.6): per side with any candidate, the number of
 * candidates at least half as likely as the best; the mean over sides (1 = clear-cut).
 */
export function pairHealth(model: PairModel): { sides: number; mean: number } {
  let n = 0;
  let sum = 0;
  for (const four of model.sides.values())
    for (const s of four) {
      if (!s.partners.length) continue;
      const best = s.partners[0]!.p;
      n++;
      sum += s.partners.filter((q) => q.p >= best / 2).length;
    }
  return { sides: n, mean: n ? sum / n : 0 };
}
