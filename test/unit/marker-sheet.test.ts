/**
 * Printable marker sheets (src/markers/sheet.ts): geometry in millimetres, cells that match the
 * patterns, and a real check: each sheet is rendered with @napi-rs/canvas and every marker on it
 * is found by the app's own OpenCV ArucoDetector with the right id, also tilted and at low
 * resolution, like scripts/make-test-marker.mjs does for the test marker.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import { getCv, type Cv } from '../helpers/cv';
import { MARKER_CARD_MM, MARKER_CELL_MM, MARKER_PLACES, MARKER_QUIET_MM, MARKER_SIZE_MM } from '../../src/markers/layout';
import { MARKER_PATTERNS } from '../../src/markers/patterns';
import {
  cardLayout,
  markerBlackRuns,
  markerSheetsHtml,
  markerSheetSvg,
  MARKER_SHEET_PRINT_CSS,
  PAGE_MARGIN_MM,
  SHEET_COUNT,
  SHEET_H_MM,
  SHEET_W_MM,
} from '../../src/markers/sheet';

let cv: Cv;
beforeAll(async () => {
  cv = await getCv();
});

type Attrs = Record<string, string>;
function attrs(tag: string): Attrs {
  const out: Attrs = {};
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) out[m[1]!] = m[2]!;
  return out;
}

/** The <rect>s inside the marker group of the card for marker `id`. */
function markerRects(svg: string, id: number): Attrs[] {
  const g = svg.match(new RegExp(`<g data-marker-id="${id}">([\\s\\S]*?)</g></g>|<g data-marker-id="${id}">([\\s\\S]*?<g class="marker"[^>]*>[\\s\\S]*?</g>)`));
  expect(g, `card ${id}`).not.toBeNull();
  const inner = (g![1] ?? g![2])!.match(/<g class="marker"[^>]*>([\s\S]*?)<\/g>/)![1]!;
  return [...inner.matchAll(/<rect [^>]*\/>/g)].map((m) => attrs(m[0]));
}

describe('geometry (mm)', () => {
  it('two A4 sheets drawn in the printable area, sized in mm', () => {
    expect(SHEET_COUNT).toBe(2);
    expect(SHEET_W_MM).toBe(210 - 2 * PAGE_MARGIN_MM);
    expect(SHEET_H_MM).toBe(297 - 2 * PAGE_MARGIN_MM);
    for (let s = 0; s < SHEET_COUNT; s++) {
      const svg = markerSheetSvg(s);
      const root = attrs(svg.match(/<svg [^>]*>/)![0]);
      expect(root.viewBox).toBe(`0 0 ${SHEET_W_MM} ${SHEET_H_MM}`);
      expect(root.width).toBe(`${SHEET_W_MM}mm`);
      expect(root.height).toBe(`${SHEET_H_MM}mm`);
    }
    expect(MARKER_SHEET_PRINT_CSS).toMatch(/@page\s*\{\s*size:\s*A4[^}]*margin:\s*8mm/);
    expect(() => markerSheetSvg(2)).toThrow();
  });

  it('4 cards of 90 mm per sheet, with dashed cut lines, inside the page, not overlapping', () => {
    for (let s = 0; s < SHEET_COUNT; s++) {
      const svg = markerSheetSvg(s);
      const cards = [...svg.matchAll(/<rect class="card" [^>]*\/>/g)].map((m) => attrs(m[0]));
      expect(cards).toHaveLength(4);
      for (const c of cards) {
        expect(Number(c.width)).toBe(90);
        expect(Number(c.height)).toBe(90);
        expect(c['stroke-dasharray']).toBeTruthy();
        expect(Number(c.x)).toBeGreaterThanOrEqual(0);
        expect(Number(c.x) + 90).toBeLessThanOrEqual(SHEET_W_MM);
        expect(Number(c.y) + 90).toBeLessThanOrEqual(SHEET_H_MM);
      }
      const places = cardLayout(s);
      expect(places.map((p) => p.id)).toEqual([0, 1, 2, 3].map((k) => s * 4 + k));
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const a = places[i]!;
          const b = places[j]!;
          const overlap = Math.abs(a.x - b.x) < MARKER_CARD_MM && Math.abs(a.y - b.y) < MARKER_CARD_MM;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('each marker is 54 mm, centred in its card with an 18 mm quiet zone, and its cells match the pattern', () => {
    expect(MARKER_SIZE_MM).toBe(54);
    for (let s = 0; s < SHEET_COUNT; s++) {
      const svg = markerSheetSvg(s);
      for (const place of cardLayout(s)) {
        const rects = markerRects(svg, place.id);
        // Rebuild the 6 × 6 grid from the rects.
        const grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => '1'));
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const r of rects) {
          const x = Number(r.x);
          const y = Number(r.y);
          const w = Number(r.width);
          const h = Number(r.height);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + w);
          maxY = Math.max(maxY, y + h);
          const c0 = Math.round((x - place.x - MARKER_QUIET_MM) / MARKER_CELL_MM);
          const r0 = Math.round((y - place.y - MARKER_QUIET_MM) / MARKER_CELL_MM);
          expect(Math.abs((x - place.x - MARKER_QUIET_MM) / MARKER_CELL_MM - c0)).toBeLessThan(1e-6);
          for (let k = 0; k < Math.round(w / MARKER_CELL_MM); k++) grid[r0]![c0 + k] = '0';
          expect(h).toBeCloseTo(MARKER_CELL_MM, 6);
        }
        expect(grid.map((row) => row.join(''))).toEqual([...MARKER_PATTERNS[place.id]!]);
        // The black border makes the outer edge exactly 54 mm, 18 mm in from the card edge.
        expect(minX - place.x).toBeCloseTo(MARKER_QUIET_MM, 6);
        expect(minY - place.y).toBeCloseTo(MARKER_QUIET_MM, 6);
        expect(maxX - minX).toBeCloseTo(MARKER_SIZE_MM, 6);
        expect(maxY - minY).toBeCloseTo(MARKER_SIZE_MM, 6);
      }
    }
  });

  it('runs cover exactly the black cells', () => {
    for (let id = 0; id < 8; id++) {
      const black = MARKER_PATTERNS[id]!.join('').split('').filter((c) => c === '0').length;
      expect(markerBlackRuns(id).reduce((s, r) => s + r.w * r.h, 0)).toBe(black);
    }
  });

  it('has the words, a 100 mm check bar with mm ticks and a grey patch', () => {
    for (let s = 0; s < SHEET_COUNT; s++) {
      const svg = markerSheetSvg(s);
      for (const p of cardLayout(s)) {
        expect(svg).toContain(`Marker ${p.id}</tspan> · ${MARKER_PLACES[p.id]}`);
      }
      expect(svg.match(/this side away from you/g)).toHaveLength(4);
      const bar = attrs(svg.match(/<rect class="check-bar" [^>]*\/>/)![0]);
      expect(Number(bar.width)).toBe(100);
      const check = svg.match(/<g class="check">([\s\S]*?)<\/g>/)![1]!;
      const ticks = [...check.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="0.2"/g)].map((m) => Number(m[1]) + 0.1);
      expect(ticks).toHaveLength(101);
      ticks.forEach((t, i) => expect(t - Number(bar.x)).toBeCloseTo(i, 6));
      expect(svg).toMatch(/<rect class="grey-patch" [^>]*fill="#767676"/);
      expect(svg).toContain('100 %');
    }
    const html = markerSheetsHtml();
    expect(html.match(/<div class="sheet-page">/g)).toHaveLength(2);
    expect(html).toContain('@page');
  });
});

/** Renders a sheet at `pxPerMm`, optionally rotated, on a background; returns RGBA pixels. */
function render(img: Image, pxPerMm: number, angleDeg = 0, background = '#fff') {
  const w = Math.round(SHEET_W_MM * pxPerMm);
  const h = Math.round(SHEET_H_MM * pxPerMm);
  const size = Math.ceil(Math.hypot(w, h));
  const canvas = angleDeg ? createCanvas(size, size) : createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function detect(imageData: { data: Uint8ClampedArray; width: number; height: number }): Array<{ id: number; cx: number; cy: number; side: number }> {
  const items: Array<{ delete(): void }> = [];
  const keep = <T extends { delete(): void }>(o: T) => (items.push(o), o);
  try {
    const rgba = keep(cv.matFromImageData(imageData));
    const gray = keep(new cv.Mat());
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    const dict = keep(cv.getPredefinedDictionary(cv.DICT_4X4_50));
    const params = keep(new cv.aruco_DetectorParameters());
    const refine = keep(new cv.aruco_RefineParameters(10, 3, true));
    const detector = keep(new cv.aruco_ArucoDetector(dict, params, refine));
    const corners = keep(new cv.MatVector());
    const ids = keep(new cv.Mat());
    const rejected = keep(new cv.MatVector());
    detector.detectMarkers(gray, corners, ids, rejected);
    const out = [];
    for (let i = 0; i < corners.size(); i++) {
      const c = keep(corners.get(i));
      const d = c.data32F as Float32Array;
      const cx = (d[0]! + d[2]! + d[4]! + d[6]!) / 4;
      const cy = (d[1]! + d[3]! + d[5]! + d[7]!) / 4;
      out.push({ id: ids.data32S[i] as number, cx, cy, side: Math.hypot(d[2]! - d[0]!, d[3]! - d[1]!) });
    }
    return out.sort((a, b) => a.id - b.id);
  } finally {
    for (let i = items.length - 1; i >= 0; i--) items[i]!.delete();
  }
}

describe('rendered sheets are detected by OpenCV', () => {
  for (let s = 0; s < SHEET_COUNT; s++) {
    it(`sheet ${s + 1}: every marker found with the right id, in the right place, at 54 mm`, async () => {
      const img = await loadImage(Buffer.from(markerSheetSvg(s)));
      const pxPerMm = 4;
      const found = detect(render(img, pxPerMm));
      const places = cardLayout(s);
      expect(found.map((f) => f.id)).toEqual(places.map((p) => p.id));
      for (const f of found) {
        const p = places.find((q) => q.id === f.id)!;
        expect(f.cx / pxPerMm).toBeCloseTo(p.x + MARKER_CARD_MM / 2, 0);
        expect(f.cy / pxPerMm).toBeCloseTo(p.y + MARKER_CARD_MM / 2, 0);
        expect(Math.abs(f.side / pxPerMm - MARKER_SIZE_MM)).toBeLessThan(1);
      }
    });
  }

  it('also when small (1.2 px per mm) and when turned on a grey table', async () => {
    for (let s = 0; s < SHEET_COUNT; s++) {
      const img = await loadImage(Buffer.from(markerSheetSvg(s)));
      const ids = cardLayout(s).map((p) => p.id);
      expect(detect(render(img, 1.2)).map((f) => f.id)).toEqual(ids);
      expect(detect(render(img, 2.5, 33, '#777')).map((f) => f.id)).toEqual(ids);
      expect(detect(render(img, 3, 90, '#ddd')).map((f) => f.id)).toEqual(ids);
    }
  });
});
