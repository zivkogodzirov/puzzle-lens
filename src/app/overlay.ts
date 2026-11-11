/**
 * Outlines drawn over photos and the camera picture (M9 part 1, design review §3.1 "Overlays on
 * photos and video"). The colours are tokens (--ov-* in styles.css, OV in tokens.ts). The owner's table is cream: a pale outline alone vanishes on it, so every
 * piece outline sits on a dark halo, 0.6 black at 2.4 × the line's width (the halo is 4.9–5.4:1
 * against the owner's table, measured on two of the owner's photos).
 *
 * Line colours, against that halo over the cream table (#EDE6D8; test/unit/app-overlay.test.ts checks ≥ 3:1):
 * - found  #ede7dc (the grey #9aa7b4 before: 2.7:1)
 * - shape  #cabdff (the blue #4fb3ff before: 2.9:1)
 * - placed #57e08c (M9 part 3; #3ccf7a before)
 * - warn   #ffc94d (M9 part 3): "have a look" — faint outlines and touching pieces, told apart by their badge
 * - bad    #ff9a8f (the red #ff6b6b before): a piece not at its spot, not a piece
 *
 * M9 part 3, the outline language (design plan §3.2, decision 9) — one pattern, one meaning, everywhere
 * outlines are drawn over a picture (live view, scan camera, scan result photo, "Show my table"):
 * - solid = fine;
 * - dashed = have a look, always with a small badge saying why: "?" a faint or part outline, a "split"
 *   glyph (← | →) touching pieces, "moved?" a piece not where it was (live view);
 * - an ✕ at the centre = not a piece.
 * Confidence never changes the line: it is the label (a column·row pill for a sure spot, a small dot for
 * an unsure one). Labels are placed greedily so they never overlap (placeLabels).
 */
import type { PieceState } from '../project/progress';
import type { PieceFlags } from '../project/types';
import { OV } from './tokens';

/** The halo under every outline. */
export const HALO = OV.halo;
/** Its width, times the line's. */
export const HALO_SCALE = 2.4;

/** Outline colours by piece state, on photos and the live picture (the page's own dots use the CSS classes state-found / state-shape / state-placed). */
export const OVERLAY_STATE: Record<PieceState, string> = { found: OV.found, shape: OV.shape, placed: OV.placed };
/** Not where it was / not a piece. */
export const OVERLAY_BAD = OV.bad;
/** Have a look (a dashed outline with a badge). */
export const OVERLAY_WARN = OV.warn;

/**
 * Strokes the halo of the context's current path (canvas), for a line `width` wide drawn next; solid,
 * also under dashed lines, so the dashes stay readable on any table. The caller sets the line's own
 * style and dash afterwards. Each piece is drawn halo, fill, line in turn on one path: in WebKit
 * that costs ~20 % more than no halo, where a pass of all halos first (Path2D) cost ~70 % more.
 */
export function strokeHalo(ctx: CanvasRenderingContext2D, width: number): void {
  ctx.setLineDash([]);
  ctx.strokeStyle = HALO;
  ctx.lineWidth = width * HALO_SCALE;
  ctx.stroke();
}

// ---------------------------------------------------------------------------------------------
// Patterns and badges

/** Why an outline is dashed ("have a look"), or 'ok' (solid). */
export type OutlineMark = 'ok' | 'faint' | 'touching' | 'moved';
export type BadgeMark = Exclude<OutlineMark, 'ok'>;

/** A piece's mark from its scan flags (and, in the live view, whether it looks gone from its spot). */
export function markOf(flags: PieceFlags | null | undefined, gone = false): OutlineMark {
  if (gone) return 'moved';
  if (flags?.clump) return 'touching';
  if (flags?.weak || flags?.part) return 'faint';
  return 'ok';
}

/** The dash of a "have a look" outline (screen px). */
export const DASH = [7, 5];
/** The same for SVG (stroke-dasharray, with vector-effect non-scaling-stroke: screen px). */
export const DASH_SVG = '7 5';

/** The badge's size (screen px): a 20 px circle (the "moved?" badge a pill as tall), in a 2 px halo ring. */
export const BADGE_R = 10;
const BADGE_RING = 2;
const MOVED_TEXT = 'moved?';
const MOVED_W = 52;
/** The split glyph (touching pieces): a line with arrows pointing apart, in a 16 × 16 box. */
export const SPLIT_GLYPH = 'M8 2.5v11M5.5 5 2.5 8l3 3M10.5 5l3 3-3 3';
/** The ✕ "not a piece" marker, half its size (screen px). */
export const CROSS_R = 7;

/** The badge's box (screen px) when drawn with its centre at x, y. */
export function badgeBox(mark: BadgeMark, x: number, y: number): Rect {
  const r = BADGE_R + BADGE_RING;
  const hw = mark === 'moved' ? MOVED_W / 2 + BADGE_RING : r;
  return { x: x - hw, y: y - r, w: 2 * hw, h: 2 * r };
}

/** Where a piece's badge goes: its outline's top-right corner, kept on the screen. */
export function badgeAt(mark: BadgeMark, box: { x0: number; y0: number; x1: number }, w: number, h: number): [number, number] {
  const hw = (mark === 'moved' ? MOVED_W / 2 : BADGE_R) + BADGE_RING;
  const r = BADGE_R + BADGE_RING;
  return [Math.max(hw, Math.min(w - hw, box.x1)), Math.max(r, Math.min(h - r, box.y0))];
}

let split: Path2D | null = null;

/** Draws a badge (canvas, screen px) centred at x, y. */
export function drawBadge(ctx: CanvasRenderingContext2D, mark: BadgeMark, x: number, y: number): void {
  const pill = mark === 'moved';
  const hw = pill ? MOVED_W / 2 : BADGE_R;
  ctx.setLineDash([]);
  ctx.beginPath();
  if (pill) ctx.roundRect(x - hw - BADGE_RING, y - BADGE_R - BADGE_RING, 2 * (hw + BADGE_RING), 2 * (BADGE_R + BADGE_RING), BADGE_R + BADGE_RING);
  else ctx.arc(x, y, BADGE_R + BADGE_RING, 0, 2 * Math.PI);
  ctx.fillStyle = HALO;
  ctx.fill();
  ctx.beginPath();
  if (pill) ctx.roundRect(x - hw, y - BADGE_R, 2 * hw, 2 * BADGE_R, BADGE_R);
  else ctx.arc(x, y, BADGE_R, 0, 2 * Math.PI);
  ctx.fillStyle = pill ? OV.bad : OV.warn;
  ctx.fill();
  ctx.fillStyle = OV.ink;
  ctx.strokeStyle = OV.ink;
  if (mark === 'touching') {
    split ??= typeof Path2D === 'function' ? new Path2D(SPLIT_GLYPH) : null;
    if (!split) return;
    ctx.save();
    ctx.translate(x - 7, y - 7);
    ctx.scale(14 / 16, 14 / 16);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(split);
    ctx.restore();
    return;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = pill ? '600 13px -apple-system, system-ui, sans-serif' : '700 15px -apple-system, system-ui, sans-serif';
  ctx.fillText(pill ? MOVED_TEXT : '?', x, y + 0.5);
}

/** Draws the ✕ "not a piece" marker (canvas, screen px) at x, y, on its halo. */
export function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, r = CROSS_R): void {
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
  ctx.lineCap = 'round';
  strokeHalo(ctx, 3);
  ctx.strokeStyle = OV.bad;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/** The small dot of a piece whose spot isn't sure (no label), on its halo. */
export const DOT_R = 4;
/** Draws the dots (canvas): all halos in one path, then one path per colour (cheap with 300 pieces). */
export function drawDots(ctx: CanvasRenderingContext2D, dots: ReadonlyArray<{ at: readonly [number, number]; colour: string }>): void {
  if (!dots.length) return;
  ctx.beginPath();
  for (const d of dots) {
    ctx.moveTo(d.at[0] + DOT_R + 2, d.at[1]);
    ctx.arc(d.at[0], d.at[1], DOT_R + 2, 0, 2 * Math.PI);
  }
  ctx.fillStyle = HALO;
  ctx.fill();
  const byColour = new Map<string, Array<readonly [number, number]>>();
  for (const d of dots) (byColour.get(d.colour) ?? byColour.set(d.colour, []).get(d.colour)!).push(d.at);
  for (const [colour, at] of byColour) {
    ctx.beginPath();
    for (const [x, y] of at) {
      ctx.moveTo(x + DOT_R, y);
      ctx.arc(x, y, DOT_R, 0, 2 * Math.PI);
    }
    ctx.fillStyle = colour;
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------------------------
// Labels: one column·row pill per piece, never on top of each other

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The pill: 15 px semibold words, 24 px tall, 7 px either side (screen px). */
export const LABEL_FONT = '600 15px -apple-system, system-ui, sans-serif';
export const LABEL_PX = 15;
export const LABEL_H = 24;
export const LABEL_PAD = 7;
/** At most this many labels a refresh (the rest get a dot): placing stays cheap with 300 pieces. */
export const MAX_LABELS = 60;

/** Priorities (lower first): the tapped piece, the pieces to find, a square of 4, sure spots, the lines' marks. */
export const PRIO = { tapped: 0, target: 1, square: 2, sure: 3, line: 4 } as const;

export interface LabelRequest {
  /** The thing labelled (piece id, line, square). */
  key: string;
  text: string;
  /** Its centre and size (radius, screen px): the label tries the centre first, then above, below, right, left. */
  x: number;
  y: number;
  r: number;
  prio: number;
}

export interface PlacedLabel extends Rect {
  key: string;
  text: string;
}

const widths = new Map<string, number>();
let measurer: CanvasRenderingContext2D | null = null;

/** The width (screen px) of a label's words in LABEL_FONT, cached (measureText is the costly part). */
export function labelTextWidth(text: string, ctx?: CanvasRenderingContext2D | null): number {
  const hit = widths.get(text);
  if (hit !== undefined) return hit;
  let c = ctx ?? measurer;
  if (!c && typeof document !== 'undefined') c = measurer = document.createElement('canvas').getContext('2d');
  let w = text.length * 8.6;
  if (c) {
    const font = c.font;
    c.font = LABEL_FONT;
    w = c.measureText(text).width;
    c.font = font;
  }
  if (widths.size > 4000) widths.clear();
  widths.set(text, w);
  return w;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Greedy label placement (design plan §3.2): by priority (then in the given order), each label takes the
 * first of its places (centre, above, below, right, left; within one priority every label tries its centre first)
 * that is on the screen and touches no label placed before it nor a `blocked` box (badges); a label with no free place is left out (its piece gets a dot).
 * A grid of 48 px cells keeps each check to the few boxes nearby; at most `max` labels are placed.
 * `width(text)` is the words' width; `scale` turns the pill's screen px into the drawing's units (photos).
 */
export function placeLabels(
  reqs: LabelRequest[],
  width: (text: string) => number,
  bounds: { w: number; h: number },
  blocked: Rect[] = [],
  max = MAX_LABELS,
  scale = 1,
): { placed: PlacedLabel[]; left: LabelRequest[] } {
  const CELL = 48 * scale;
  const grid = new Map<number, Rect[]>();
  const keyOf = (cx: number, cy: number) => cx * 4099 + cy;
  const add = (r: Rect) => {
    for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w) / CELL); cx++)
      for (let cy = Math.floor(r.y / CELL); cy <= Math.floor((r.y + r.h) / CELL); cy++) {
        const k = keyOf(cx, cy);
        const list = grid.get(k);
        if (list) list.push(r);
        else grid.set(k, [r]);
      }
  };
  const free = (r: Rect) => {
    for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w) / CELL); cx++)
      for (let cy = Math.floor(r.y / CELL); cy <= Math.floor((r.y + r.h) / CELL); cy++) {
        const list = grid.get(keyOf(cx, cy));
        if (list) for (const o of list) if (overlaps(r, o)) return false;
      }
    return true;
  };
  for (const b of blocked) add(b);
  const order = reqs.map((r, i) => [r, i] as const).sort((a, b) => a[0].prio - b[0].prio || a[1] - b[1]);
  const placed: PlacedLabel[] = [];
  const left: LabelRequest[] = [];
  const h = LABEL_H * scale;
  const gap = 3 * scale;
  const tryAt = (q: LabelRequest, w: number, sx: number, sy: number) => {
    // Near the screen's edge the label is moved in (a piece at the edge keeps its label).
    if (w > bounds.w || h > bounds.h) return false;
    const r = { x: Math.max(0, Math.min(bounds.w - w, sx - w / 2)), y: Math.max(0, Math.min(bounds.h - h, sy - h / 2)), w, h };
    if (!free(r)) return false;
    add(r);
    placed.push({ ...r, key: q.key, text: q.text });
    return true;
  };
  // Priority by priority; within one, every label tries its own centre first, then the others try beside
  // their piece (so a label pushed aside never takes the centre of a piece whose label could sit there).
  for (let s = 0; s < order.length;) {
    let e = s;
    while (e < order.length && order[e]![0].prio === order[s]![0].prio) e++;
    const rest: Array<[LabelRequest, number]> = [];
    for (let i = s; i < e; i++) {
      const q = order[i]![0];
      const w = width(q.text) + 2 * LABEL_PAD * scale;
      if (placed.length >= max) left.push(q);
      else if (!tryAt(q, w, q.x, q.y)) rest.push([q, w]);
    }
    for (const [q, w] of rest) {
      if (placed.length >= max) {
        left.push(q);
        continue;
      }
      const off = Math.max(q.r * 0.55, h / 2 + gap);
      const ok =
        tryAt(q, w, q.x, q.y - off - h / 2) ||
        tryAt(q, w, q.x, q.y + off + h / 2) ||
        tryAt(q, w, q.x + off + w / 2, q.y) ||
        tryAt(q, w, q.x - off - w / 2, q.y);
      if (!ok) left.push(q);
    }
    s = e;
  }
  return { placed, left };
}

/** Draws placed labels (canvas): white words on the camera material (0.66), a pill. */
export function drawLabels(ctx: CanvasRenderingContext2D, labels: PlacedLabel[]): void {
  if (!labels.length) return;
  ctx.setLineDash([]);
  ctx.fillStyle = OV.labelBg;
  ctx.beginPath();
  for (const l of labels) ctx.roundRect(l.x, l.y, l.w, l.h, l.h / 2);
  ctx.fill();
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = OV.labelText;
  for (const l of labels) ctx.fillText(l.text, l.x + l.w / 2, l.y + l.h / 2 + 0.5);
}

// ---------------------------------------------------------------------------------------------
// Squares of 4

/**
 * Squares of 4 among the lines between pieces that join: 4 pieces joined round in a ring by 4 confirmed lines
 * (a closed 2 × 2 square: A–B, B–D, D–C, C–A). Squares that share a piece with one found before are left as
 * lines. Each comes back as its 4 pieces in order round the square, and the indexes of its lines (drawn as one
 * quad instead). Only the confirmed lines are looked at (a few dozen at most), so this is cheap.
 */
export function squaresOf(lines: ReadonlyArray<{ a: string; b: string; confirmed: boolean }>): Array<{ ids: string[]; lines: number[] }> {
  const adj = new Map<string, Map<string, number>>();
  const link = (p: string, q: string, i: number) => (adj.get(p) ?? adj.set(p, new Map()).get(p)!).set(q, i);
  lines.forEach((l, i) => {
    if (!l.confirmed || l.a === l.b) return;
    link(l.a, l.b, i);
    link(l.b, l.a, i);
  });
  const used = new Set<string>();
  const out: Array<{ ids: string[]; lines: number[] }> = [];
  lines.forEach((l, i) => {
    if (!l.confirmed || used.has(l.a) || used.has(l.b)) return;
    const [a, b] = [l.a, l.b];
    for (const [c, ac] of adj.get(a) ?? []) {
      if (c === b || used.has(c)) continue;
      for (const [d, bd] of adj.get(b) ?? []) {
        if (d === a || d === c || used.has(d)) continue;
        const cd = adj.get(c)?.get(d);
        if (cd === undefined) continue;
        for (const id of [a, b, c, d]) used.add(id);
        out.push({ ids: [a, b, d, c], lines: [i, bd, cd, ac] });
        return;
      }
    }
  });
  return out;
}

/** "17·9" → [17, 9] (a spot label, column·row counted from 1), or null. */
export function parseSpot(label: string | null | undefined): [number, number] | null {
  const m = label ? /^(\d+)·(\d+)$/.exec(label) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** One label for a square of 4 from its pieces' spot labels: "17–18 · 7–8"; null if a spot isn't known. */
export function squareLabel(labels: Array<string | null | undefined>): string | null {
  const spots = labels.map(parseSpot);
  if (spots.some((s) => !s)) return null;
  const cs = spots.map((s) => s![0]);
  const rs = spots.map((s) => s![1]);
  const span = (v: number[]) => {
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  };
  return `${span(cs)} · ${span(rs)}`;
}

// ---------------------------------------------------------------------------------------------
// Names for VoiceOver and the "Pieces in view" list (design plan §3.8 rule 9)

/** "Edge piece, maybe column 17 row 8, check outline". `sure` false adds "maybe". */
export function pieceName(
  p: { flags?: PieceFlags | null; patch?: { flats: boolean[]; sure: boolean } | null },
  label: string | null,
  sure: boolean,
  gone = false,
): string {
  const flats = p.patch && p.patch.sure && !p.flags?.part ? p.patch.flats.filter(Boolean).length : -1;
  const kind = flats >= 2 ? 'Corner piece' : flats === 1 ? 'Edge piece' : flats === 0 ? 'Inside piece' : 'Piece';
  const spot = parseSpot(label);
  const where = spot ? `${sure ? '' : 'maybe '}column ${spot[0]} row ${spot[1]}` : 'spot not known yet';
  const mark = markOf(p.flags, gone);
  const why = mark === 'moved' ? 'not where it was' : mark === 'touching' ? 'touching another piece' : mark === 'faint' ? 'check outline' : '';
  return [kind, where, why].filter(Boolean).join(', ');
}
