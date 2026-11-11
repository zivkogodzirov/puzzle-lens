/**
 * Shared words for the screens (M9 part 1, design plan §3.7): counts with the right singular or
 * plural ("1 piece found", not "1 pieces found"), and errors as a plain sentence with a next step,
 * never the browser's or a library's own text (that still goes into the Activity log).
 */

/** "1 piece", "0 pieces", "12 pieces"; `many` defaults to `one` + "s". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The answer words (M9 part 3, design plan decision 7): the same everywhere a piece is tried in a spot
 * (the piece card, Fill a spot, the live view) — "They fit" for a pair or a square of 4.
 */
export const ANSWER = { fits: 'It fits', not: 'Not there', groupFits: 'They fit' } as const;

/**
 * How sure the app is, in words (decision 7): "strong" / "likely" / "several" from the placement.
 * Percentages show only in Tester mode, after these words.
 */
export const CONFIDENCE_WORDS = { strong: 'Very likely', likely: 'Maybe', several: 'Several places look alike' } as const;

export const UNREADABLE_PHOTO = 'This photo couldn’t be read. Take it again, or choose a different photo.';

/** Shown for an error whose own text is technical (the text itself is in the Activity log). */
export const UNEXPECTED_ERROR = 'Something unexpected went wrong. Please try again. If it keeps happening, close Puzzle Lens and open it again.';

export const OUT_OF_MEMORY = 'Your iPhone ran out of memory for this. Close other apps you aren’t using, then try again.';

/** Error kinds whose text the app writes itself, for the owner. */
const OWN_ERRORS = new Set(['Error', 'MarkerMapError']);

/** Signs of a programmer's or the browser's text rather than the app's own sentences. */
const TECHNICAL = [
  // camelCase names (createImageBitmap, getUserMedia), error kinds (TypeError), IndexedDB words
  /\b(?!iPhone|iPad|iOS)[a-z]+[A-Z][A-Za-z]*\b|\b\w+Error\b|\bDOMException\b|\bIDB\w*|\bNaN\b/,
  /\bundefined\b|\bnull\b|\[object|is not a function|is not an object|is not defined|cannot read propert|failed to execute|unexpected token|maximum call stack|\bat \S+:\d+|https?:\/\/|\bwasm\b|\babort\(|\bstd::|\bcv::|\bassert/i,
];

/** Words for an error, for the screen (callers log the error itself, with its technical text). */
export function errorWords(err: unknown): string {
  const e = err as { message?: string; name?: string } | null;
  const m = (e?.message || String(err)).trim();
  if (e?.name === 'QuotaExceededError' || /quota/i.test(m)) return 'Your iPhone is out of storage space for Puzzle Lens. Free some space and try again.';
  // The browser's own words for a photo it can't decode (review 2026-11-10), e.g. WebKit's "Cannot
  // decode the data in the argument to createImageBitmap" or Chrome's "The source image could not be decoded."
  if (
    e?.name === 'EncodingError' ||
    /createImageBitmap|could not be decoded|cannot be decoded|cannot decode|can't decode|unable to decode|unsupported image/i.test(m)
  )
    return UNREADABLE_PHOTO;
  if (/out of memory|memory access out of bounds|allocation failed|bad_alloc/i.test(m)) return OUT_OF_MEMORY;
  // A backup's own words are always for the owner (they may name a file inside it).
  if (e?.name === 'BackupError' && m) return m;
  // The app's own sentences are kept (they say what to do); anything else is replaced.
  const own = typeof err === 'string' || (e?.name !== undefined && OWN_ERRORS.has(e.name));
  if (!own || !m || TECHNICAL.some((r) => r.test(m))) return UNEXPECTED_ERROR;
  return m;
}
