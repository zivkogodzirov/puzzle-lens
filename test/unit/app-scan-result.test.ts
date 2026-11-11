/**
 * The scan result sheet's words (M9 part 5, src/app/scanResult.ts): every kind of result M8's note could show
 * still shows, as a title and a short list of what to do. The finished puzzle's comes from Scan.tsx
 * (finishedResult, from finishedLines: what to do next first).
 */
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FinishedCheck } from '../../src/shared/apis';
import * as r from '../../src/app/scanResult';

let scan: typeof import('../../src/app/screens/Scan');

beforeAll(async () => {
  vi.stubGlobal('location', { hash: '#/' });
  vi.stubGlobal('addEventListener', () => {});
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' });
  scan = await import('../../src/app/screens/Scan');
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const counts = (o: Partial<r.PiecesCounts> = {}): r.PiecesCounts => ({
  kind: 'overview',
  count: 22,
  added: 22,
  ready: 20,
  clumps: 0,
  faint: 0,
  part: 0,
  back: 0,
  moved: 0,
  pending: 0,
  missing: 0,
  reasons: [],
  coinLines: [],
  quick: false,
  photo: true,
  ...o,
});
const texts = (x: r.ScanResult) => x.items.map((i) => i.text);

describe('pieces found or read', () => {
  it('an overview: "Found 22 pieces", what is new, ready, then what to check', () => {
    const x = r.piecesResult(counts({ added: 5, ready: 11, clumps: 2, faint: 9 }));
    expect(x).toMatchObject({ kind: 'found', ok: true, title: 'Found 22 pieces', sub: '5 new, 17 seen before', photo: true });
    expect(texts(x)).toEqual([
      '11 ready',
      '2 spots where pieces touch (dashed, arrows apart): spread them apart and take another.',
      '9 faint outlines (dashed, “?”): check they are outlined right.',
    ]);
    expect(x.items.map((i) => i.tone)).toEqual(['good', 'warn', 'warn']);
  });

  it('one of each: singular words; the coin first; quick scan last', () => {
    const x = r.piecesResult(
      counts({ count: 1, added: 1, ready: 0, clumps: 1, faint: 1, part: 1, coinLines: ['Coin found ✓ Sizes are now measured.'], quick: true }),
    );
    expect(x.title).toBe('Found 1 piece');
    expect(x.sub).toBe('1 new');
    expect(texts(x)).toEqual([
      'Coin found ✓ Sizes are now measured.',
      '1 spot where pieces touch (dashed, arrows apart): spread them apart and take another.',
      '1 faint outline (dashed, “?”): check it is outlined right.',
      '1 piece only partly outlined: its shape is not used. A close-up helps.',
      'Quick scan done. Close-ups (2×) read the shapes better, if you want them.',
    ]);
    expect(x.items[0]!.tone).toBe('good');
  });

  it('a coin that was not found or measured wrong is a warning', () => {
    const x = r.piecesResult(
      counts({ coinLines: ['No 10 denari coin found in this photo: sizes stay estimates (≈). Put it flat on the table, away from the pieces.'] }),
    );
    expect(x.items[0]).toMatchObject({ tone: 'warn', text: expect.stringMatching(/^No 10 denari coin/) });
  });

  it('a close-up: "Close-up read", and the merge lines (back, moved, to check, gone) and quality notes', () => {
    const x = r.piecesResult(
      counts({
        kind: 'detail',
        count: 14,
        added: 2,
        ready: 14,
        back: 1,
        moved: 3,
        pending: 2,
        missing: 1,
        reasons: ['Blurred: hold the phone still', 'Some glare'],
        quick: true,
      }),
    );
    expect(x).toMatchObject({ kind: 'closeup', title: 'Close-up read: 14 pieces', sub: '2 new, 12 seen before' });
    expect(texts(x)).toEqual([
      '14 ready',
      '1 piece set aside in an earlier batch is back: recognised, not counted again.',
      '2 pieces were moved: recognised, not counted again.',
      '2 pieces may be ones you moved: check them on the Pieces tab ("Pieces to check"), or take a close-up.',
      '1 piece is no longer where it was (taken away, or moved out of view).',
      'Some glare',
    ]);
  });
});

describe('photos that were not used', () => {
  it('each has its title and its lines, and nothing was added (ok: false)', () => {
    const cases: Array<[r.ScanResult, string, RegExp[]]> = [
      [r.fewResult(true), 'Hardly any pieces', [/^Hardly any pieces in this photo, so it wasn’t used\.$/, /tap the shutter button/]],
      [r.unmatchedResult(true), 'Couldn’t match this photo', [/could not be matched to the pieces found so far/, /keep about half the picture/]],
      [r.noMarkerResult(false), 'No marker in view', [/No marker in this photo/, /at least one marker card/]],
      [r.nothingResult(false), 'No pieces measured', [/No pieces could be measured/]],
      [r.blockedResult(['Blurred: hold the phone still'], true), 'Blurred photo', [/^Blurred: hold the phone still$/, /^Nothing was added from this photo\.$/]],
      [r.blockedResult(['Tilted: hold the phone flat'], true), 'Tilted photo', [/^Tilted/, /Nothing was added/]],
      [
        r.blockedResult(['Blurred: hold the phone still', 'Tilted: hold the phone flat'], true),
        'Blurred and tilted',
        [/^Blurred/, /^Tilted/, /Nothing was added/],
      ],
      [r.errorResult('Reading the photo took too long; please try again', false), 'Couldn’t read this photo', [/took too long/, /Take another/]],
    ];
    for (const [x, title, lines] of cases) {
      expect(x.title).toBe(title);
      expect(x.ok).toBe(false);
      expect(texts(x)).toHaveLength(lines.length);
      lines.forEach((re, i) => expect(texts(x)[i]).toMatch(re));
    }
  });
});

describe('a finished puzzle', () => {
  const gaps: Array<[number, number]> = [
    [23, 0],
    [24, 0],
  ];
  const fin: FinishedCheck = {
    thumb: null,
    cols: 28,
    rows: 36,
    colsExact: 28,
    rowsExact: 36,
    seamStrength: 0.4,
    gaps,
    gapSides: ['', ''],
    gapsPreview: [
      [0, 0],
      [0, 0],
    ],
    cornersPreview: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    loose: 9,
  };
  const project = { grid: { cols: 28, rows: 36, source: 'suggested' as const }, pieceCount: 1000, box: {} as never, openSpots: { gaps } as never };

  it('"Finished puzzle: 28 × 36", the count under it, then the saved spots and the loose pieces before the gaps', () => {
    const x = scan.finishedResult(fin, project);
    expect(x).toMatchObject({
      kind: 'finished',
      ok: true,
      title: 'Finished puzzle: 28 × 36',
      sub: '28 across × 36 down = 1,008 pieces, counted from the seams.',
    });
    expect(texts(x).map((t) => t.slice(0, 20))).toEqual([
      'That matches your pu',
      'Saved: your leftover',
      'About 9 loose pieces',
      '2 possible gaps (red',
      'This photo is not ad',
    ]);
    expect(x.items.map((i) => i.tone)).toEqual(['good', 'good', 'warn', 'warn', 'info']);
  });

  it('a count that is not the grid: not ok, the grid line is a warning; the spots filled since are added last', () => {
    const x = scan.finishedResult({ ...fin, cols: 27 }, { ...project, openSpots: undefined }, ['All 2 empty spots are filled now.']);
    expect(x.ok).toBe(false);
    expect(x.items[0]).toMatchObject({ tone: 'warn', text: expect.stringMatching(/^Your puzzle is set to 28 × 36/) });
    expect(x.items.at(-1)).toMatchObject({ tone: 'good', text: 'All 2 empty spots are filled now.' });
  });
});
