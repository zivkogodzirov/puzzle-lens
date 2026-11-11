/**
 * The icon set (M9 part 2, design plan §3.6): every name renders an inline SVG (Lucide, stroke 2,
 * currentColor), hidden from VoiceOver unless it has a label.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { Icon, ICON_NAMES, type IconName } from '../../src/app/ui/icons';

/** The set, in order. A new icon: add it here too (and to the emoji table in icons.tsx if it replaces one). */
const NAMES = [
  'camera',
  'scan-eye',
  'image',
  'puzzle',
  'target',
  'link',
  'inbox',
  'flask-conical',
  'check',
  'x',
  'chevron-left',
  'chevron-right',
  'chevron-down',
  'more-horizontal',
  'undo',
  'trash',
  'settings',
  'help-circle',
  'home',
  'plus',
  'download',
  'share',
  'refresh',
  'rotate',
  'alert-triangle',
  'info',
  'eye',
  'map',
  'trending-up',
  'bar-chart',
  'printer',
  'box',
  'lock',
  'stethoscope',
  'send',
  'compass',
  'flashlight',
  'hourglass',
  'save',
  'party-popper',
  'circle',
  'activity',
];

type Props = Record<string, unknown> & { children?: VNode | VNode[] };
const render = (name: IconName, extra: Record<string, unknown> = {}) => Icon({ name, ...extra }) as unknown as VNode<Props>;
const kids = (v: VNode<Props>) => [v.props.children ?? []].flat() as VNode<Record<string, string>>[];

describe('Icon', () => {
  it('has exactly the listed icons', () => {
    expect(ICON_NAMES).toEqual(NAMES);
  });
  for (const name of ICON_NAMES) {
    it(`${name}: an SVG of Lucide shapes, stroke 2, currentColor, 24 px, hidden from VoiceOver`, () => {
      const v = render(name);
      expect(v.type).toBe('svg');
      expect(v.props).toMatchObject({
        viewBox: '0 0 24 24',
        width: 24,
        height: 24,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'aria-hidden': 'true',
        class: 'icon',
        'data-icon': name,
      });
      expect(v.props.role).toBeUndefined();
      const shapes = kids(v);
      expect(shapes.length).toBeGreaterThan(0);
      for (const s of shapes) {
        expect(['path', 'circle', 'rect', 'polyline', 'polygon', 'line', 'ellipse']).toContain(s.type);
        // No colour of its own: the icon takes the text's colour.
        expect(s.props.fill).toBeUndefined();
        expect(s.props.stroke).toBeUndefined();
        if (s.type === 'path') expect(s.props.d).toMatch(/^[Mm][\d .,\-A-Za-z]+$/);
      }
    });
  }
  it('with a label: role=img and aria-label, not hidden; size and class pass through', () => {
    const v = render('x', { label: 'Close', size: 20, class: 'btn-icon' });
    expect(v.props).toMatchObject({ role: 'img', 'aria-label': 'Close', width: 20, height: 20, class: 'icon btn-icon' });
    expect(v.props['aria-hidden']).toBeUndefined();
  });
  it('the set stays small (design plan §3.6: under 15 KB for about 30 icons)', () => {
    const src = readFileSync(resolve(__dirname, '../../src/app/ui/icons.tsx'), 'utf8');
    const table = src.slice(src.indexOf('const ICONS'), src.indexOf('satisfies Record'));
    expect(table.length).toBeLessThan(15_000);
  });
});
