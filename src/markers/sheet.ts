/**
 * The two printable A4 marker sheets (PLAN §2, RESEARCH §5). Pure functions returning SVG / HTML
 * text, so the same drawing is shown in the app, shared as a file, and checked by the tests
 * (test/unit/marker-sheet.test.ts renders it and finds every marker with OpenCV).
 *
 * Each sheet: 4 cards of 90 mm (a 54 mm marker of 9 mm cells in an 18 mm white quiet zone) with
 * dashed cut lines; on each card its number, its place in words and an arrow "this side away from
 * you"; a 100 mm check bar with mm ticks; a mid-grey patch; short instructions.
 *
 * Everything is drawn in millimetres (viewBox units = mm) inside the printable area of an A4 page
 * with an 8 mm margin, and the page CSS asks for A4 with that margin, so it prints at 100 %.
 * Marker cells are crisp <rect>s from MARKER_PATTERNS, exactly like scripts/make-test-marker.mjs.
 */
import {
  CHECK_BAR_MM,
  MARKER_CARD_MM,
  MARKER_CELL_MM,
  MARKER_CELLS,
  MARKER_COUNT,
  MARKER_PLACES,
  MARKER_QUIET_MM,
  MARKERS_PER_SHEET,
} from './layout';
import { MARKER_PATTERNS } from './patterns';
import { PAPER } from '../app/tokens';

export const SHEET_COUNT = MARKER_COUNT / MARKERS_PER_SHEET; // 2
export const PAGE_W_MM = 210;
export const PAGE_H_MM = 297;
export const PAGE_MARGIN_MM = 8;
/** The drawing's size: the printable area inside the margins. */
export const SHEET_W_MM = PAGE_W_MM - 2 * PAGE_MARGIN_MM; // 194
export const SHEET_H_MM = PAGE_H_MM - 2 * PAGE_MARGIN_MM; // 281
const CARD_GAP_MM = 6;
const CARDS_LEFT_MM = (SHEET_W_MM - 2 * MARKER_CARD_MM - CARD_GAP_MM) / 2; // 4
const CARDS_TOP_MM = 12;
/** sRGB ≈ 18 % grey. */
export const GREY_PATCH: string = PAPER.greyPatch;
const FONT = "Helvetica, Arial, 'Liberation Sans', sans-serif";

export interface CardPlace {
  id: number;
  /** Top-left of the card (mm, in the sheet drawing). */
  x: number;
  y: number;
}

/** Where the 4 cards of sheet `sheet` (0 or 1) are, in the sheet drawing (mm). */
export function cardLayout(sheet: number): CardPlace[] {
  const out: CardPlace[] = [];
  for (let k = 0; k < MARKERS_PER_SHEET; k++) {
    out.push({
      id: sheet * MARKERS_PER_SHEET + k,
      x: CARDS_LEFT_MM + (k % 2) * (MARKER_CARD_MM + CARD_GAP_MM),
      y: CARDS_TOP_MM + Math.floor(k / 2) * (MARKER_CARD_MM + CARD_GAP_MM),
    });
  }
  return out;
}

export interface CellRect {
  /** In cells, inside the 6 × 6 marker (black border included). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The black cells of marker `id` as horizontal runs (fewer seams when scaled). */
export function markerBlackRuns(id: number): CellRect[] {
  const rows = MARKER_PATTERNS[id];
  if (!rows) throw new Error(`No pattern for marker ${id}`);
  const out: CellRect[] = [];
  for (let r = 0; r < MARKER_CELLS; r++) {
    const row = rows[r]!;
    let c = 0;
    while (c < MARKER_CELLS) {
      if (row[c] === '1') {
        c++;
        continue;
      }
      const start = c;
      while (c < MARKER_CELLS && row[c] === '0') c++;
      out.push({ x: start, y: r, w: c - start, h: 1 });
    }
  }
  return out;
}

const n = (v: number) => String(Math.round(v * 1000) / 1000);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function upArrow(cx: number, top: number, size: number): string {
  return `<polygon points="${n(cx)},${n(top)} ${n(cx + size / 2)},${n(top + size)} ${n(cx - size / 2)},${n(top + size)}" fill="${PAPER.muted}"/>`;
}

/** One 90 mm card (cut line, marker, words), top-left at (x, y) mm. */
export function cardSvg(place: CardPlace): string {
  const { id, x, y } = place;
  const mx = x + MARKER_QUIET_MM;
  const my = y + MARKER_QUIET_MM;
  const cell = MARKER_CELL_MM;
  const cells = markerBlackRuns(id)
    .map((r) => `<rect x="${n(mx + r.x * cell)}" y="${n(my + r.y * cell)}" width="${n(r.w * cell)}" height="${n(r.h * cell)}"/>`)
    .join('');
  const cx = x + MARKER_CARD_MM / 2;
  const place_ = MARKER_PLACES[id] ?? '';
  // Words stay within 4.5 mm of the card edge, leaving ≥ 13 mm of plain white around the marker.
  return [
    `<g data-marker-id="${id}">`,
    `<rect class="card" x="${n(x)}" y="${n(y)}" width="${MARKER_CARD_MM}" height="${MARKER_CARD_MM}" fill="${PAPER.bg}" stroke="${PAPER.cardEdge}" stroke-width="0.3" stroke-dasharray="2.5 1.5"/>`,
    upArrow(x + 10, y + 1.3, 3),
    upArrow(x + MARKER_CARD_MM - 10, y + 1.3, 3),
    `<text x="${n(cx)}" y="${n(y + 4)}" font-size="3" text-anchor="middle" fill="${PAPER.muted}">this side away from you</text>`,
    `<g class="marker" fill="${PAPER.black}" shape-rendering="crispEdges">${cells}</g>`,
    `<text x="${n(cx)}" y="${n(y + MARKER_CARD_MM - 1.5)}" font-size="3.4" text-anchor="middle" fill="${PAPER.text3}"><tspan font-weight="bold">Marker ${id}</tspan> · ${esc(place_)}</text>`,
    `</g>`,
  ].join('');
}

/** The 100 mm check bar with mm ticks and cm numbers; left end at (x, y) mm. */
export function checkBarSvg(x: number, y: number): string {
  const parts: string[] = [];
  parts.push(`<text x="${n(x)}" y="${n(y - 2)}" font-size="3.4" fill="${PAPER.text}"><tspan font-weight="bold">Check bar:</tspan> it must measure exactly ${CHECK_BAR_MM} mm (10 cm)</text>`);
  parts.push(`<rect class="check-bar" x="${n(x)}" y="${n(y)}" width="${CHECK_BAR_MM}" height="3" fill="${PAPER.black}"/>`);
  for (let mm = 0; mm <= CHECK_BAR_MM; mm++) {
    const len = mm % 10 === 0 ? 5 : mm % 5 === 0 ? 3.5 : 2;
    parts.push(`<rect x="${n(x + mm - 0.1)}" y="${n(y + 3)}" width="0.2" height="${n(len)}" fill="${PAPER.black}"/>`);
    if (mm % 10 === 0) parts.push(`<text x="${n(x + mm)}" y="${n(y + 11.5)}" font-size="3" text-anchor="middle" fill="${PAPER.text}">${mm / 10}</text>`);
  }
  parts.push(`<text x="${n(x + CHECK_BAR_MM + 3)}" y="${n(y + 11.5)}" font-size="3" fill="${PAPER.text}">cm</text>`);
  return `<g class="check">${parts.join('')}</g>`;
}

/** One A4 sheet (0 or 1) as an SVG document, sized in mm. */
export function markerSheetSvg(sheet: number): string {
  if (!Number.isInteger(sheet) || sheet < 0 || sheet >= SHEET_COUNT) throw new Error(`There are only ${SHEET_COUNT} sheets`);
  const cards = cardLayout(sheet);
  const first = cards[0]!.id;
  const last = cards[cards.length - 1]!.id;
  const below = CARDS_TOP_MM + 2 * MARKER_CARD_MM + CARD_GAP_MM; // 198
  const patchX = 132;
  const patchY = below + 9;
  const lines = [
    '1. Print both sheets at 100 % ("Actual size"), not "Fit to page". Plain white paper is fine.',
    '2. Measure the check bar with a ruler and tell the app what you measured.',
    '3. Cut out the 8 cards along the dashed lines.',
    '4. Put each card on the table at the place written on it, the arrow pointing away from you.',
    '5. Keep the cards flat and leave them in place between sessions if you can.',
  ];
  const body = [
    `<rect width="${SHEET_W_MM}" height="${SHEET_H_MM}" fill="${PAPER.bg}"/>`,
    `<text x="${n(CARDS_LEFT_MM)}" y="7" font-size="4.6" font-weight="bold" fill="${PAPER.ink}">Puzzle Lens markers · sheet ${sheet + 1} of ${SHEET_COUNT} (markers ${first}–${last})</text>`,
    ...cards.map(cardSvg),
    checkBarSvg(CARDS_LEFT_MM, below + 13),
    `<rect class="grey-patch" x="${patchX}" y="${n(patchY)}" width="58" height="20" fill="${GREY_PATCH}"/>`,
    `<text x="${patchX}" y="${n(patchY + 25)}" font-size="3" fill="${PAPER.text}">Grey patch: helps the app judge colour</text>`,
    ...lines.map((t, i) => `<text x="${n(CARDS_LEFT_MM)}" y="${n(below + 42 + i * 6.5)}" font-size="3.6" fill="${PAPER.text}">${esc(t)}</text>`),
  ].join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="marker-sheet" data-sheet="${sheet}" viewBox="0 0 ${SHEET_W_MM} ${SHEET_H_MM}" width="${SHEET_W_MM}mm" height="${SHEET_H_MM}mm" font-family="${FONT}">
<title>Puzzle Lens marker sheet ${sheet + 1} of ${SHEET_COUNT}</title>
${body}
</svg>`;
}

/** Print rules: A4, 8 mm margins, nothing scaled; each sheet on its own page. */
export const MARKER_SHEET_PRINT_CSS = `
@page { size: A4 portrait; margin: ${PAGE_MARGIN_MM}mm; }
@media print {
  html, body { background: ${PAPER.bg} !important; margin: 0 !important; padding: 0 !important; }
  .sheet-page { width: ${SHEET_W_MM}mm; height: ${SHEET_H_MM}mm; margin: 0; padding: 0; overflow: hidden; break-after: page; page-break-after: always; box-shadow: none !important; border: 0 !important; }
  .sheet-page:last-of-type { break-after: auto; page-break-after: auto; }
  .sheet-page svg { width: ${SHEET_W_MM}mm !important; height: ${SHEET_H_MM}mm !important; display: block; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

/** A complete web page with both sheets, for sending to a Mac or another device to print. */
export function markerSheetsHtml(): string {
  const pages = Array.from({ length: SHEET_COUNT }, (_, i) => `<div class="sheet-page">${markerSheetSvg(i)}</div>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>Puzzle Lens marker sheets</title>
<style>
  html, body { margin: 0; background: ${PAPER.desk}; color: ${PAPER.text}; font: 16px/1.4 -apple-system, system-ui, sans-serif; }
  .help { max-width: 40em; margin: 16px auto; padding: 0 16px; }
  .sheet-page { background: ${PAPER.bg}; width: min(96vw, ${SHEET_W_MM}mm); margin: 12px auto; box-shadow: 0 2px 10px ${PAPER.shadow}; }
  .sheet-page svg { width: 100%; height: auto; display: block; }
  @media print { .help { display: none; } }
${MARKER_SHEET_PRINT_CSS}
</style>
</head>
<body>
<div class="help">
  <p><strong>Puzzle Lens marker sheets.</strong> Print this page (File › Print, or ⌘P). In the print settings choose <strong>Scale: 100 %</strong> or <strong>Actual size</strong> (not "Fit to page"), paper <strong>A4</strong>. Two pages come out.</p>
</div>
${pages}
</body>
</html>
`;
}
