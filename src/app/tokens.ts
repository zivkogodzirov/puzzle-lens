/**
 * Colour tokens for code (M9 part 2, design plan §3.1: "no hex value outside the token file; the canvas
 * reads the tokens"). styles.css is the one source of every colour; this module is how TypeScript gets them.
 *
 * - `OV`: colours drawn on photos and the camera picture (canvas, SVG). They are the same in both themes, so
 *   they are plain constants here (no style lookup per frame in the live view): each one is the CSS token
 *   `--ov-<kebab-case name>` (OV.scanLine = --ov-scan-line), and test/unit/app-tokens.test.ts fails if a
 *   value here differs from styles.css.
 * - `PAPER`: printed pages built as stand-alone documents (marker sheets, tray labels), which have no
 *   stylesheet of their own; each one is `--paper-<kebab-case name>` in styles.css, checked the same way.
 * - `cssVar(name)`: any token's current value, for code that must follow light and dark mode (e.g. a canvas
 *   drawn with page colours). Cached; the cache is emptied when the iPhone switches light/dark.
 * - In inline styles, write `var(--token)` instead (it follows the theme by itself).
 *
 * This file (and styles.css) are the only places in src/app allowed raw colours (test/unit/app-tokens.test.ts).
 */

/** On photos and the camera picture (both themes). Every outline sits on `halo` (see overlay.ts). */
export const OV = {
  /** Under every outline: 0.6 black, 2.4 × the line's width (overlay.ts HALO_SCALE). */
  halo: 'rgba(0, 0, 0, 0.6)',
  /** A piece's state: found / shape read / spot known (the page's own dots use --state-*). */
  found: '#ede7dc',
  shape: '#cabdff',
  placed: '#3ccf7a',
  /** Not where it was, not a piece. */
  bad: '#ff9a8f',
  /** Fill this spot: the best piece (green) and the others (yellow); scan flags. */
  good: '#3ccf7a',
  weak: '#ffd84a',
  clump: '#ff9f2e',
  /** The camera's scan outlines of an ordinary piece. */
  scanLine: 'rgba(225, 230, 235, 0.9)',
  /** The live view's lines between pieces that join: unsure (white, dashed) and confirmed (green). */
  join: '#ffffff',
  joinOk: '#3ccf7a',
  joinHalo: 'rgba(0, 0, 0, 0.55)',
  /** Behind the live view's labels. */
  labelBg: 'rgba(0, 0, 0, 0.7)',
  /** Printed markers found by the camera. */
  marker: '#3ccf7a',
  /** "Show my table", lit mode: the dim over the photo (with fill-opacity 0.6) and its SVG mask (white shows, black hides). */
  dim: '#000',
  maskShow: '#fff',
  maskHide: '#000',
  /** A fill that can't be seen but still takes taps (SVG). */
  hit: 'rgba(0,0,0,0.001)',
} as const;

/** Printed pages (white paper in both themes), for stand-alone documents without the app's stylesheet. */
export const PAPER = {
  bg: '#fff',
  /** The markers' squares, the check bar, borders. */
  black: '#000',
  /** Headings, the sheet's title (the same as --paper-ink). */
  ink: '#111',
  text: '#222',
  text2: '#333',
  text3: '#444',
  muted: '#555',
  /** Cut lines. */
  cut: '#999',
  /** The marker card's dashed edge. */
  cardEdge: '#8a8a8a',
  /** Behind a thumbnail on a label. */
  thumb: '#eee',
  /** Around the pages on screen (not printed). */
  desk: '#ddd',
  /** The pages' shadow on screen. */
  shadow: 'rgba(0,0,0,.25)',
  /** The marker sheet's mid-grey patch (sRGB about 18 % grey), which helps the app judge colour. */
  greyPatch: '#767676',
} as const;

export type OvToken = keyof typeof OV;
export type PaperToken = keyof typeof PAPER;

/** `scanLine` → `scan-line` (the CSS token's name after its prefix). */
export function kebab(name: string): string {
  return name.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`);
}

const cache = new Map<string, string>();
let watching = false;

/**
 * The current value of a CSS custom property (`cssVar('--accent')`), trimmed; '' if it is not set or there is
 * no page (a worker). Cached until the iPhone switches between light and dark.
 */
export function cssVar(name: string): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return '';
  if (!watching && typeof matchMedia === 'function') {
    watching = true;
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => cache.clear());
  }
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (v) cache.set(name, v);
  return v;
}

/** Empties cssVar's cache (tests; or after the stylesheet changes). */
export function clearCssVarCache(): void {
  cache.clear();
}
