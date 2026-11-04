/**
 * Makes the M1 test marker: ArUco DICT_4X4_50, id 0 (RESEARCH §5).
 *
 *   node scripts/make-test-marker.mjs
 *
 * 1. Asks the project's own OpenCV build for the marker's bit pattern (so the drawing can never
 *    disagree with the detector the app uses).
 * 2. Writes public/test-marker.svg: 6 × 6 cells (black border included) as crisp <rect>s inside a
 *    white quiet zone of 2 cells, scaled by its viewBox. Its nominal print size is 90 mm
 *    (9 mm cells: a 54 mm marker with an 18 mm quiet zone, like the M2 marker sheets).
 * 3. Writes public/test-markers.html: a plain page that shows the marker on white and prints it
 *    at that size.
 * 4. Checks the result: renders the SVG file to bitmaps with @napi-rs/canvas (several sizes,
 *    rotated, on grey) and runs OpenCV's ArucoDetector on them. Every render must give id 0,
 *    otherwise the script fails.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import createOpenCv from '../vendor/opencv/opencv.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SVG_PATH = `${ROOT}public/test-marker.svg`;
const HTML_PATH = `${ROOT}public/test-markers.html`;

const MARKER_ID = 0;
const CELLS = 6; // 4 × 4 data bits + 1-cell black border on each side
const SAMPLE_CELL_PX = 10;
const QUIET_CELLS = 2; // white margin around the marker, in cells (≥ 1.5 required)
const CELL_MM = 9;

const cv = await createOpenCv({ print() {}, printErr() {} });
// Some Emscripten versions make the module "thenable"; awaiting it again would loop forever.
if (cv && typeof cv.then === 'function') delete cv.then;

// Small scope helper for this script: everything created is deleted at the end.
function withScope(fn) {
  const items = [];
  const keep = (o) => (items.push(o), o);
  try {
    return fn(keep);
  } finally {
    for (let i = items.length - 1; i >= 0; i--) items[i].delete();
  }
}

// ---------- 1. Bit pattern from OpenCV ----------
/** bits[row][col]: true = white cell. */
const bits = withScope((keep) => {
  const dict = keep(cv.getPredefinedDictionary(cv.DICT_4X4_50));
  const img = keep(new cv.Mat());
  cv.generateImageMarker(dict, MARKER_ID, CELLS * SAMPLE_CELL_PX, img, 1);
  if (img.rows !== CELLS * SAMPLE_CELL_PX || img.cols !== CELLS * SAMPLE_CELL_PX) {
    throw new Error(`Unexpected marker image size ${img.cols}×${img.rows}`);
  }
  const rows = [];
  for (let r = 0; r < CELLS; r++) {
    const row = [];
    for (let c = 0; c < CELLS; c++) {
      const v = img.ucharAt(r * SAMPLE_CELL_PX + SAMPLE_CELL_PX / 2, c * SAMPLE_CELL_PX + SAMPLE_CELL_PX / 2);
      row.push(v > 127);
    }
    rows.push(row);
  }
  return rows;
});

for (let i = 0; i < CELLS; i++) {
  if (bits[0][i] || bits[CELLS - 1][i] || bits[i][0] || bits[i][CELLS - 1]) throw new Error('Marker border is not all black');
}
console.log(`DICT_4X4_50 id ${MARKER_ID} (1 = white):`);
for (const row of bits) console.log('  ' + row.map((b) => (b ? '1' : '0')).join(''));

// ---------- 2. SVG ----------
const total = CELLS + 2 * QUIET_CELLS;
const rects = [];
for (let r = 0; r < CELLS; r++) {
  // Merge horizontal runs of black cells into one rect each (fewer seams when scaled).
  let c = 0;
  while (c < CELLS) {
    if (bits[r][c]) {
      c++;
      continue;
    }
    const start = c;
    while (c < CELLS && !bits[r][c]) c++;
    rects.push(`<rect x="${QUIET_CELLS + start}" y="${QUIET_CELLS + r}" width="${c - start}" height="1"/>`);
  }
}
const sizeMm = total * CELL_MM;
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Puzzle Lens test marker: ArUco DICT_4X4_50, id ${MARKER_ID}. Made by scripts/make-test-marker.mjs; do not edit by hand.
     ${CELLS}x${CELLS} cells including the black border, with a ${QUIET_CELLS}-cell white quiet zone. Prints at ${sizeMm} mm (${CELL_MM} mm cells). -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges">
<title>Puzzle Lens test marker #${MARKER_ID}</title>
<rect width="${total}" height="${total}" fill="#fff"/>
<g fill="#000">
${rects.join('\n')}
</g>
</svg>
`;
writeFileSync(SVG_PATH, svg);
console.log(`Wrote ${SVG_PATH} (${rects.length} rects, ${svg.length} bytes)`);

// ---------- 3. Printable / displayable page ----------
const html = `<!doctype html>
<!-- Made by scripts/make-test-marker.mjs; do not edit by hand. -->
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light" />
<title>Puzzle Lens test marker #${MARKER_ID}</title>
<style>
  html, body { margin: 0; height: 100%; background: #fff; color: #222; font: 16px/1.4 -apple-system, system-ui, sans-serif; }
  main { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 16px; box-sizing: border-box; }
  img { width: min(86vw, 74vh); height: auto; display: block; }
  p { margin: 0; text-align: center; max-width: 34em; }
  @media print {
    @page { size: A4; margin: 20mm; }
    main { min-height: 0; justify-content: flex-start; }
    img { width: ${sizeMm}mm; height: ${sizeMm}mm; }
  }
</style>
</head>
<body>
<main>
  <img src="test-marker.svg" alt="Puzzle Lens test marker number ${MARKER_ID}" />
  <p><strong>Puzzle Lens test marker #${MARKER_ID}.</strong> Point your iPhone at it in Live camera: a green square labelled #${MARKER_ID} should appear on it.</p>
  <p>To print: choose "Actual Size" or 100% (not "Fit to page"). The black square should measure ${CELLS * CELL_MM} mm across.</p>
</main>
</body>
</html>
`;
writeFileSync(HTML_PATH, html);
console.log(`Wrote ${HTML_PATH}`);

// ---------- 4. Verify: render the SVG file and detect it ----------
const svgImage = await loadImage(readFileSync(SVG_PATH));

/** Draws the marker into a canvas; returns RGBA pixels. */
function render({ size, canvasSize, angleDeg = 0, background = '#fff' }) {
  const canvas = createCanvas(canvasSize, canvasSize);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvasSize, canvasSize);
  ctx.translate(canvasSize / 2, canvasSize / 2);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.drawImage(svgImage, -size / 2, -size / 2, size, size);
  return ctx.getImageData(0, 0, canvasSize, canvasSize);
}

function detect(imageData) {
  return withScope((keep) => {
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
    const found = [];
    for (let i = 0; i < corners.size(); i++) found.push(ids.data32S[i]);
    return found;
  });
}

/** Checks a straight render pixel by pixel against the bit pattern (cell centres). */
function checkCells(imageData, size) {
  const cell = size / total;
  for (let r = 0; r < total; r++) {
    for (let c = 0; c < total; c++) {
      const inMarker = r >= QUIET_CELLS && r < QUIET_CELLS + CELLS && c >= QUIET_CELLS && c < QUIET_CELLS + CELLS;
      const white = inMarker ? bits[r - QUIET_CELLS][c - QUIET_CELLS] : true;
      const x = Math.floor((c + 0.5) * cell);
      const y = Math.floor((r + 0.5) * cell);
      const v = imageData.data[(y * imageData.width + x) * 4];
      if (white ? v < 200 : v > 55) throw new Error(`Cell (${r}, ${c}) has value ${v}; expected ${white ? 'white' : 'black'}`);
    }
  }
}

const cases = [
  { name: 'straight, 1000 px', size: 1000, canvasSize: 1000 },
  { name: 'straight, 100 px (6 px per cell)', size: 100, canvasSize: 100 },
  { name: 'straight, 400 px', size: 400, canvasSize: 400 },
  { name: 'rotated 90°, 300 px on grey', size: 300, canvasSize: 500, angleDeg: 90, background: '#777' },
  { name: 'rotated 33°, 240 px on dark grey', size: 240, canvasSize: 480, angleDeg: 33, background: '#333' },
];
let failures = 0;
for (const k of cases) {
  const img = render(k);
  if (k.size === k.canvasSize && !k.angleDeg) checkCells(img, k.size);
  const ids = detect(img);
  const ok = ids.length === 1 && ids[0] === MARKER_ID;
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${k.name}: detected id(s) [${ids.join(', ')}]`);
}
if (failures) {
  console.error(`${failures} check(s) failed: the test marker is not detected as id ${MARKER_ID}.`);
  process.exit(1);
}
console.log(`All ${cases.length} renders of test-marker.svg detected as id ${MARKER_ID}.`);
