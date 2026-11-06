/**
 * Grid suggestion (RESEARCH §10): how many pieces across and down, from the piece count on the
 * box and the shape of the box picture. Pure functions, no DOM.
 *
 * Method:
 * 1. Every (cols, rows) whose product is within −2 % … +6 % of the box count, with a cell aspect
 *    (piece width : piece height) of at most 1.35 either way.
 * 2. Ranked by a score (lower = better) made of
 *    - the count error (makers cut a few more or fewer pieces than the box says), and
 *    - how well cols / rows fits the picture's width / height (cells are rarely exactly square,
 *      so this is a soft cue), minus
 *    - a bonus for a layout a maker is known to use for that count (RESEARCH §10: Ravensburger
 *      1000 = 36 × 28 = 1008), so it wins over near-ties like 37 × 27 = 999.
 * 3. The screen offers the top 3, plus manual entry.
 */

export interface GridOption {
  cols: number;
  rows: number;
  /** cols × rows. */
  count: number;
  /** (count − box count) / box count. */
  countError: number;
  /** Piece width : height implied by the picture shape (1 when the picture shape is unknown). */
  cellAspect: number;
  /** |ln((cols / rows) / picture aspect)|; 0 when the picture shape is unknown. */
  aspectError: number;
  /** A maker is known to cut this layout for this count. */
  known: string | null;
  /** Lower is better. */
  score: number;
}

export interface KnownLayout {
  count: number;
  /** Long side × short side (pieces). */
  long: number;
  short: number;
  maker: string;
}

/** Layouts with a source (RESEARCH §10). Orientation-free: 36 × 28 also matches 28 × 36. */
export const KNOWN_LAYOUTS: readonly KnownLayout[] = [{ count: 1000, long: 36, short: 28, maker: 'Ravensburger' }];

export const COUNT_WINDOW = { below: 0.02, above: 0.06 } as const;
export const MAX_CELL_ASPECT = 1.35;
/** Score scales: 2 % count error and 8 % picture-shape error each cost 1 (squared). */
const COUNT_SCALE = 0.02;
const ASPECT_SCALE = 0.08;
/** Bonus for a known layout, given only when its shape fits the picture within this much (ln). */
const KNOWN_BONUS = 2;
const KNOWN_MAX_ASPECT_ERROR = 0.15;
/** Without a picture shape: allowed range of the long : short ratio. */
const NO_PICTURE_MAX_RATIO = 1.8;

function knownFor(count: number, cols: number, rows: number): KnownLayout | null {
  const long = Math.max(cols, rows);
  const short = Math.min(cols, rows);
  return KNOWN_LAYOUTS.find((k) => k.count === count && k.long === long && k.short === short) ?? null;
}

function candidates(
  pieceCount: number,
  pictureAspect: number | null,
  below: number,
  above: number,
  maxCellAspect: number,
): GridOption[] {
  const lo = Math.max(1, Math.ceil(pieceCount * (1 - below) - 1e-9));
  const hi = Math.floor(pieceCount * (1 + above) + 1e-9);
  const out: GridOption[] = [];
  for (let cols = 1; cols <= hi; cols++) {
    const rMin = Math.max(1, Math.ceil(lo / cols));
    const rMax = Math.floor(hi / cols);
    for (let rows = rMin; rows <= rMax; rows++) {
      const count = cols * rows;
      if (count < lo || count > hi) continue;
      let cellAspect = 1;
      let aspectError = 0;
      if (pictureAspect) {
        cellAspect = (pictureAspect * rows) / cols;
        if (Math.max(cellAspect, 1 / cellAspect) > maxCellAspect + 1e-9) continue;
        aspectError = Math.abs(Math.log(cols / rows / pictureAspect));
      } else {
        // Unknown picture shape: assume a landscape picture of ordinary proportions.
        if (cols < rows || cols / rows > NO_PICTURE_MAX_RATIO) continue;
      }
      const countError = (count - pieceCount) / pieceCount;
      const k = knownFor(pieceCount, cols, rows);
      const knownApplies = k !== null && (!pictureAspect || aspectError <= KNOWN_MAX_ASPECT_ERROR);
      const score = (countError / COUNT_SCALE) ** 2 + (pictureAspect ? (aspectError / ASPECT_SCALE) ** 2 : 0) - (knownApplies ? KNOWN_BONUS : 0);
      out.push({ cols, rows, count, countError, cellAspect, aspectError, known: knownApplies ? k!.maker : null, score });
    }
  }
  out.sort((a, b) => a.score - b.score || Math.abs(a.countError) - Math.abs(b.countError) || a.cols - b.cols);
  return out;
}

/**
 * All grids that fit, best first. `pictureAspect` = width / height of the (rectified) box picture,
 * or null if unknown. If nothing fits the normal limits (very small or unusual counts), the limits
 * are widened once (−10 % … +15 %, cell aspect ≤ 2) so there is always something to offer.
 */
export function suggestGrids(pieceCount: number, pictureAspect: number | null): GridOption[] {
  if (!Number.isFinite(pieceCount) || pieceCount < 2) return [];
  const aspect = pictureAspect && Number.isFinite(pictureAspect) && pictureAspect > 0 ? pictureAspect : null;
  const n = Math.round(pieceCount);
  const normal = candidates(n, aspect, COUNT_WINDOW.below, COUNT_WINDOW.above, MAX_CELL_ASPECT);
  if (normal.length) return normal;
  return candidates(n, aspect, 0.1, 0.15, 2);
}

/** The best `n` (default 3) for the screen. */
export function topGrids(pieceCount: number, pictureAspect: number | null, n = 3): GridOption[] {
  return suggestGrids(pieceCount, pictureAspect).slice(0, n);
}

/** Plain-English description, e.g. "28 across × 36 down = 1008 pieces". */
export function describeGrid(g: { cols: number; rows: number }): string {
  return `${g.cols} across × ${g.rows} down = ${g.cols * g.rows} pieces`;
}

/** Checks a grid typed in by hand; returns a problem in words, or null if fine. */
export function checkManualGrid(cols: number, rows: number, pieceCount: number): string | null {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) return 'Please type whole numbers of 2 or more for both.';
  if (cols > 200 || rows > 200) return 'That is more than 200 pieces in a line: please check the numbers.';
  const count = cols * rows;
  if (pieceCount > 0 && Math.abs(count - pieceCount) / pieceCount > 0.25) {
    return `${cols} × ${rows} = ${count} pieces, which is far from the ${pieceCount} on the box: please check the numbers.`;
  }
  return null;
}
