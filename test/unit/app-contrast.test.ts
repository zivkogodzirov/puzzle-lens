/**
 * Colour contrast of the app's tokens (M9 part 1, design plan §3.8 rule 1), in BOTH themes: every text colour
 * on every page background >= 4.5:1 (WCAG 2), every meaningful line or dot >= 3:1. The values are read from
 * src/app/styles.css itself (the dark `:root` block and the `prefers-color-scheme: light` block), so a changed
 * colour is checked here before it reaches the iPhone.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATE_COLOUR } from '../../src/project/progress';

const css = readFileSync(resolve(__dirname, '../../src/app/styles.css'), 'utf8');

function block(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]!] = m[2]!.toLowerCase();
  return out;
}

/** The dark tokens (the first `:root`), and the light ones (dark, then the light block's overrides). */
function themes(): { dark: Record<string, string>; light: Record<string, string> } {
  const darkSrc = /:root\s*\{([\s\S]*?)\n\}/.exec(css)![1]!;
  const lightSrc = /@media \(prefers-color-scheme: light\)\s*\{\s*:root\s*\{([\s\S]*?)\}\s*\}/.exec(css)![1]!;
  const dark = block(darkSrc);
  return { dark, light: { ...dark, ...block(lightSrc) } };
}

function lin(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const PAGE = ['bg', 'panel', 'panel-2'];
/** Text: [colour, the backgrounds it is written on]. */
const TEXT: Array<[string, string[]]> = [
  ['text', PAGE],
  ['muted', PAGE],
  ['accent', PAGE], // links, "More"
  ['good-ink', PAGE],
  ['warn-ink', PAGE],
  ['bad-ink', PAGE], // "Delete" buttons (on panel-2)
  ['kind-corner', PAGE],
  ['kind-edge', PAGE],
  ['on-accent', ['accent']],
  ['on-good', ['good']],
  ['on-warn', ['warn']],
  ['on-bad', ['bad']],
  ['banner-update-text', ['banner-update-bg']],
  ['paper-ink', ['paper']],
];
/** Lines and dots that carry meaning: [colour, what is around them]. */
const GRAPHIC: Array<[string, string[]]> = [
  ['accent', PAGE], // focus ring, pressed buttons
  ['good', PAGE], // progress bar, done dots
  ['good-ink', PAGE], // ✓ Fits outline, notices
  ['warn-ink', PAGE],
  ['bad-ink', PAGE],
  ['state-found', PAGE],
  ['state-shape', PAGE],
  ['state-placed', PAGE],
  ['kind-corner', PAGE],
  ['kind-edge', PAGE],
  ['flag-clump', PAGE],
  ['flag-weak', PAGE],
  ['selected-line', PAGE],
];

describe('colour tokens pass contrast in both themes', () => {
  const t = themes();
  for (const theme of ['dark', 'light'] as const) {
    const P = t[theme];
    it(`${theme}: every token used here is defined`, () => {
      const names = new Set([...TEXT, ...GRAPHIC].flatMap(([fg, bgs]) => [fg, ...bgs]));
      for (const n of names) expect(P[n], `--${n}`).toMatch(/^#/);
    });
    for (const [fg, bgs] of TEXT)
      for (const bg of bgs)
        it(`${theme}: text --${fg} on --${bg} >= 4.5`, () => {
          expect(contrast(P[fg]!, P[bg]!), `${P[fg]} on ${P[bg]}`).toBeGreaterThanOrEqual(4.5);
        });
    for (const [fg, bgs] of GRAPHIC)
      for (const bg of bgs)
        it(`${theme}: graphic --${fg} on --${bg} >= 3`, () => {
          expect(contrast(P[fg]!, P[bg]!), `${P[fg]} on ${P[bg]}`).toBeGreaterThanOrEqual(3);
        });
    it(`${theme}: the three piece states look different (shape read is not the accent blue)`, () => {
      const s = [P['state-found'], P['state-shape'], P['state-placed']];
      expect(new Set(s).size).toBe(3);
      expect(P['state-shape']).not.toBe(P.accent);
    });
  }
  it('on photos and the live camera (dark around them): the three state colours differ, shape read is not the accent', () => {
    expect(new Set(Object.values(STATE_COLOUR)).size).toBe(3);
    expect(STATE_COLOUR.shape).not.toBe(t.dark['cam-accent']);
    // Against the dark legend box and the black around the photo: >= 3.
    for (const c of Object.values(STATE_COLOUR)) expect(contrast(c, '#101418')).toBeGreaterThanOrEqual(3);
  });
  it('no raw hex colour in styles.css outside the token blocks', () => {
    const body = css.replace(/:root\s*\{[\s\S]*?\n\}/, '').replace(/@media \(prefers-color-scheme: light\)\s*\{\s*:root\s*\{[\s\S]*?\}\s*\}/, '');
    expect(body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });
});
