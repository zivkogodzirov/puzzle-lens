/**
 * One piece per spot (M4, "leftover pieces into the empty spots"): given every piece's score at every
 * open spot, choose the pairing with the best total score, where a piece may stay unpaired (it isn't
 * from these spots, or isn't a piece at all) and a spot may stay empty (its piece wasn't scanned).
 *
 * - `bestAssignment`: the Hungarian method (Kuhn–Munkres, shortest augmenting paths with
 *   potentials), written from the textbook description, on a square matrix padded with "unpaired"
 *   options. A pairing is worth (score − minScore); staying unpaired is worth 0.
 * - `pairChances`: how sure each pairing is once every piece and every spot is used at most once:
 *   Sinkhorn balancing of exp(score / T), with the same "unpaired" options (worth minScore).
 */

/** Hungarian method on a square cost matrix (minimise). Returns, per row, its column. */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const INF = Number.POSITIVE_INFINITY;
  // 1-based, as in the classic formulation; p[j] = row matched to column j (0 = none).
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(INF);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else minv[j] = minv[j]! - delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const rowToCol = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) rowToCol[p[j]! - 1] = j - 1;
  return rowToCol;
}

/**
 * The pairing of pieces (rows of `score`) with spots (columns) with the best total of
 * (score − minScore); pieces and spots may stay unpaired (worth 0). Scores that aren't finite can't
 * be paired. Returns, per piece, its spot index or −1.
 */
export function bestAssignment(score: number[][], minScore: number): number[] {
  const P = score.length;
  const S = P ? score[0]!.length : 0;
  if (!P || !S) return score.map(() => -1);
  const n = P + S;
  const BIG = 1e9;
  // Rows: P pieces, then S "spot stays empty"; columns: S spots, then P "piece unpaired".
  const cost: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n);
    for (let j = 0; j < n; j++) {
      if (i < P && j < S) {
        const s = score[i]![j]!;
        row[j] = Number.isFinite(s) ? -(s - minScore) : BIG;
      } else if (i < P) row[j] = j - S === i ? 0 : BIG;
      else if (j < S) row[j] = j === i - P ? 0 : BIG;
      else row[j] = 0;
    }
    cost.push(row);
  }
  const r2c = hungarian(cost);
  return r2c.slice(0, P).map((j, i) => (j >= 0 && j < S && Number.isFinite(score[i]![j]!) && score[i]![j]! > minScore ? j : -1));
}

/**
 * Per piece × spot, the probability of that pairing when each piece goes to at most one spot and
 * each spot takes at most one piece (Sinkhorn balancing). A piece's "unpaired" option, and a spot's
 * "empty" option, count like a pairing scoring minScore. T: temperature (score units).
 */
export function pairChances(score: number[][], minScore: number, T: number, iters = 300): number[][] {
  const P = score.length;
  const S = P ? score[0]!.length : 0;
  if (!P || !S) return score.map(() => []);
  let max = minScore;
  for (const row of score) for (const s of row) if (Number.isFinite(s) && s > max) max = s;
  const e = (s: number) => (Number.isFinite(s) ? Math.exp((s - max) / T) : 0);
  // (P + 1) × (S + 1): the last column is "piece unpaired", the last row "spot empty" (margins P and
  // S: they take whatever the pieces and spots don't, and each other's rest).
  const K: number[][] = score.map((row) => [...row.map(e), e(minScore)]);
  K.push(new Array<number>(S + 1).fill(e(minScore)));
  const rowM = [...new Array<number>(P).fill(1), S];
  const colM = [...new Array<number>(S).fill(1), P];
  const a = new Float64Array(P + 1).fill(1);
  const b = new Float64Array(S + 1).fill(1);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i <= P; i++) {
      let s = 0;
      for (let j = 0; j <= S; j++) s += K[i]![j]! * b[j]!;
      a[i] = s > 0 ? rowM[i]! / s : 0;
    }
    for (let j = 0; j <= S; j++) {
      let s = 0;
      for (let i = 0; i <= P; i++) s += K[i]![j]! * a[i]!;
      b[j] = s > 0 ? colM[j]! / s : 0;
    }
  }
  return score.map((row, i) => row.map((_, j) => a[i]! * K[i]![j]! * b[j]!));
}
