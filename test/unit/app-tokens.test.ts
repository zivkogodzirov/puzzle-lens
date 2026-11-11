/**
 * Colours live in one place (M9 part 2, design plan §3.1 "no hex value outside the token file; the canvas
 * reads the tokens"): src/app/styles.css's token blocks. Code gets them from src/app/tokens.ts, whose
 * constant tables (for the live view's per-frame drawing and for stand-alone printed pages) must equal the
 * CSS tokens; and no other source file may hold a raw colour.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearCssVarCache, cssVar, kebab, OV, PAPER } from '../../src/app/tokens';

const ROOT = resolve(__dirname, '../..');
const css = readFileSync(join(ROOT, 'src/app/styles.css'), 'utf8');

/** The first `:root` block's tokens (the theme-independent ones live there), name → value. */
function rootTokens(): Map<string, string> {
  const src = /:root\s*\{([\s\S]*?)\n\}/.exec(css)![1]!.replace(/\/\*[\s\S]*?\*\//g, '');
  return new Map([...src.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

/** One spelling per colour: lower case, #rgb → #rrggbb, no spaces, ".25" → "0.25". */
function norm(v: string): string {
  let s = v.toLowerCase().replace(/\s+/g, '');
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${[...s.slice(1)].map((c) => c + c).join('')}`;
  return s.replace(/([(,])\./g, '$10.');
}

describe('tokens.ts equals the CSS tokens', () => {
  const t = rootTokens();
  for (const [table, prefix] of [
    [OV, 'ov'],
    [PAPER, 'paper'],
  ] as const) {
    for (const [k, v] of Object.entries(table)) {
      const name = `${prefix}-${kebab(k)}`;
      it(`${prefix.toUpperCase()}.${k} = --${name}`, () => {
        expect(t.has(name), `--${name} is missing from styles.css`).toBe(true);
        expect(norm(v)).toBe(norm(t.get(name)!));
      });
    }
  }
  it('kebab: scanLine → scan-line, text2 → text-2', () => {
    expect(kebab('scanLine')).toBe('scan-line');
    expect(kebab('text2')).toBe('text-2');
    expect(kebab('halo')).toBe('halo');
  });
});

describe('cssVar reads a token once and again after a light/dark switch', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, getComputedStyle: g.getComputedStyle, matchMedia: g.matchMedia };
  afterEach(() => {
    Object.assign(g, saved);
    clearCssVarCache();
  });
  it('caches, and empties the cache on a prefers-color-scheme change', () => {
    let value = '#4fb3ff';
    let reads = 0;
    let onChange: (() => void) | null = null;
    g.document = { documentElement: {} };
    g.getComputedStyle = () => ({ getPropertyValue: () => (reads++, ` ${value} `) });
    g.matchMedia = () => ({ addEventListener: (_: string, cb: () => void) => (onChange = cb) });
    clearCssVarCache();
    expect(cssVar('--accent')).toBe('#4fb3ff');
    expect(cssVar('--accent')).toBe('#4fb3ff');
    expect(reads).toBe(1);
    value = '#0a5ec4';
    onChange!();
    expect(cssVar('--accent')).toBe('#0a5ec4');
    expect(reads).toBe(2);
  });
  it('without a page (a worker, a test): empty, no error', () => {
    g.document = undefined;
    expect(cssVar('--accent')).toBe('');
  });
});

/**
 * Files allowed a raw colour, and why. Everything else in src/ uses tokens (CSS var(--…) in inline styles,
 * OV / PAPER / cssVar from src/app/tokens.ts in canvas, SVG and printed pages).
 */
const ALLOWED: Record<string, string> = {
  'src/app/tokens.ts': 'the token module: the code-side copy of the CSS tokens, checked equal above',
  'src/cv/colourGroups.ts':
    "inkOn(): black or white letters for a tray's own measured colour (data computed from the pieces, like the tray's hex; tested in cv-colour-groups.test.ts)",
  'src/project/groups.ts': "the Group type of inkOn()'s result ('#000' | '#fff')",
  'src/device/noise.ts': "the Device check's synthetic test pictures (camera noise test patterns), never shown as part of the app",
  'src/workers/probe.worker.ts': "the Device check's worker probe: a red square drawn off-screen to see if OffscreenCanvas works, never shown",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.d\.ts$/.test(n) ? [p] : [];
  });
}

/** The code without its comments (block, JSX and line comments; not "//" inside a URL). */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\w])\/\/.*$/gm, '$1');
}

const NAMED = 'white|black|red|green|blue|yellow|orange|grey|gray|purple|pink|magenta|cyan|lime|silver|gold|navy|teal|maroon';
const RAW = [
  /(?<![\w&/])#[0-9a-fA-F]{3,8}\b(?![\w/-])/g, // #fff, #3ccf7a ("#/puzzle" and "url(#lit)" are not colours)
  /\b(?:rgba?|hsla?)\(/g, // rgb( rgba( hsl( hsla(
  new RegExp(`(?:color|background|fill|stroke|strokeStyle|fillStyle|shadowColor|borderColor|outlineColor)\\s*[:=]\\s*\\{?\\s*['"\`](?:${NAMED})['"\`]`, 'gi'),
];

describe('no raw colours in src/**/*.ts(x) outside the token module', () => {
  const all = files(join(ROOT, 'src'));
  it('finds the source files', () => expect(all.length).toBeGreaterThan(50));
  it('each allowed file exists and still needs its exception', () => {
    for (const f of Object.keys(ALLOWED)) {
      const src = code(readFileSync(join(ROOT, f), 'utf8'));
      expect(
        RAW.some((r) => new RegExp(r.source, r.flags).test(src)),
        `${f} has no raw colour any more: take it off the list`,
      ).toBe(true);
    }
  });
  it('none anywhere else', () => {
    const found: string[] = [];
    for (const f of all) {
      const rel = relative(ROOT, f).split('\\').join('/');
      if (ALLOWED[rel]) continue;
      const lines = code(readFileSync(f, 'utf8')).split('\n');
      lines.forEach((l, i) => {
        for (const r of RAW) for (const m of l.matchAll(new RegExp(r.source, r.flags))) found.push(`${rel}:${i + 1}: ${m[0]}`);
      });
    }
    expect(found, 'use a token: var(--…) in styles, OV / PAPER / cssVar() from src/app/tokens.ts in code').toEqual([]);
  });
});
