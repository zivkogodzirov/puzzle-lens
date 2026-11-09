/**
 * The "What to test" box (owner's request 2026-11-09): docs/TEST-NOW.md is built into the app and
 * read by a tiny Markdown reader (src/app/markdown.ts).
 */
import { describe, expect, it } from 'vitest';
import { parseMd, type MdItem } from '../../src/app/markdown';
import { testText, textKey } from '../../src/app/testText';

describe('what to test', () => {
  it('headings, paragraphs, numbered and bulleted lists, nested items and continuation lines', () => {
    const b = parseMd(
      [
        '# Title',
        '',
        'Some **text**',
        'on two lines.',
        '',
        '## Part',
        '1. One',
        '2. Two',
        '   - sub a',
        '   - sub b',
        '3. Three',
        '   goes on',
        '',
        '- a bullet',
        'After.',
      ].join('\n'),
    );
    expect(b.map((x) => x.kind)).toEqual(['h', 'p', 'h', 'ol', 'ul', 'p']);
    expect(b[1]).toEqual({ kind: 'p', text: 'Some **text** on two lines.' });
    const ol = b[3] as { kind: 'ol'; items: MdItem[] };
    expect(ol.items.map((i) => i.text)).toEqual(['One', 'Two', 'Three goes on']);
    expect(ol.items[1]!.sub).toEqual({ kind: 'ul', items: ['sub a', 'sub b'], start: 1 });
  });

  it('a numbered list keeps its first number', () => {
    const b = parseMd('4. Four\n5. Five');
    expect(b[0]).toMatchObject({ kind: 'ol', start: 4 });
  });

  it('the steps built into the app: a title, numbered steps, and the version filled in', () => {
    const text = testText('0.1.0+abc1234');
    expect(text).not.toContain('{version}');
    expect(text).toContain('0.1.0+abc1234');
    const b = parseMd(text);
    expect(b[0]).toMatchObject({ kind: 'h', level: 1 });
    const steps = b.filter((x) => x.kind === 'ol').reduce((n, x) => n + (x.kind === 'ol' ? x.items.length : 0), 0);
    expect(steps).toBeGreaterThanOrEqual(5);
  });

  it('new steps get a new fingerprint (fresh tick boxes)', () => {
    expect(textKey('a')).not.toBe(textKey('b'));
    expect(textKey(testText('x'))).toBe(textKey(testText('x')));
  });
});
