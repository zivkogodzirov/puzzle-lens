/**
 * Makes the app icons: a jigsaw piece inside a magnifying-lens ring, on the app's dark
 * background (#101418) with the accent blue (#4fb3ff). Original artwork, drawn from code.
 *
 *   npm run icons      (node scripts/make-icons.mjs)
 *
 * Writes into public/icons/:
 *   icon-192.png, icon-512.png   manifest "any" icons: rounded square, transparent corners
 *   icon-maskable-512.png        manifest "maskable" icon: full-bleed background, artwork kept
 *                                inside the central 80 % safe circle (checked below)
 *   apple-touch-icon.png         180 × 180, fully opaque (iOS adds its own rounded corners)
 *   favicon.svg                  the same artwork as a vector
 *
 * The script checks its own output: the maskable icon has nothing but background outside the
 * safe circle, and the apple-touch-icon has no transparent pixel.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCanvas, Path2D } from '@napi-rs/canvas';

const OUT = fileURLToPath(new URL('../public/icons/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const BG = '#101418';
const BG_RGB = [0x10, 0x14, 0x18];
const ACCENT = '#4fb3ff';
const PIECE = '#eef2f6';

// ---------- Geometry (unit square: 0..1, y down) ----------
const LENS = { cx: 0.43, cy: 0.43, r: 0.25, stroke: 0.068 };
const HANDLE = { width: 0.1, end: 0.8 }; // runs at 45° from the ring to (end, end)
const HANDLE_START = LENS.r + LENS.stroke / 2 - 0.01; // slightly overlaps the ring
const D45 = Math.SQRT1_2;

/**
 * A classic jigsaw piece in a 100 × 100 body box: tabs on top and right, blanks on bottom and
 * left. One edge profile (edge-local u along the side, v < 0 = outwards) is reused for all four.
 */
const PROFILE = [
  // [command, ...points as (u, v)]
  ['L', [36, 0]],
  ['C', [42, 0], [44, -3], [42, -8]],
  ['C', [32, -14], [36, -27], [50, -27]],
  ['C', [64, -27], [68, -14], [58, -8]],
  ['C', [56, -3], [58, 0], [64, 0]],
  ['L', [100, 0]],
];
const SIDES = [
  { map: (u, v) => [u, v], out: 1 }, // top, left → right, tab
  { map: (u, v) => [100 - v, u], out: 1 }, // right, top → bottom, tab
  { map: (u, v) => [100 - u, 100 - v], out: -1 }, // bottom, right → left, blank
  { map: (u, v) => [v, 100 - u], out: -1 }, // left, bottom → top, blank
];
function piecePath() {
  const f = (n) => +n.toFixed(2);
  let d = 'M0 0';
  for (const side of SIDES) {
    for (const [cmd, ...pts] of PROFILE) {
      d += ' ' + cmd + pts.map(([u, v]) => side.map(u, v * side.out).map(f).join(' ')).join(' ');
    }
  }
  return d + 'Z';
}
const PIECE_D = piecePath();
// Centre of the piece's smallest enclosing circle (worked out by hand: tabs pull it up/right)
// and the size it should have inside the lens glass.
const PIECE_CENTER = [52, 48];
const PIECE_RADIUS_UNITS = 75.1; // measured: 75.04 about (52, 48)
const PIECE_RADIUS = 0.172; // in icon units; the glass is r - stroke/2 = 0.216
const PIECE_SCALE = PIECE_RADIUS / PIECE_RADIUS_UNITS;
const PIECE_ROTATE_DEG = -8;

/** Furthest any ink reaches from the icon centre (0.5, 0.5), at scale 1. */
function artReach() {
  const lensFar = Math.hypot(LENS.cx - 0.5, LENS.cy - 0.5) + LENS.r + LENS.stroke / 2;
  const handleFar = Math.hypot(HANDLE.end - 0.5, HANDLE.end - 0.5) + HANDLE.width / 2;
  return Math.max(lensFar, handleFar);
}

// ---------- Canvas drawing ----------
/**
 * Draws the artwork into a size × size canvas, scaled by `scale` about the centre.
 * shape: 'square' (full bleed) or 'rounded' (rounded square with transparent corners).
 */
function drawIcon(size, { scale = 1, shape = 'square' } = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = BG;
  if (shape === 'rounded') {
    const rr = size * 0.2;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, rr);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, size, size);
  }

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(size * scale, size * scale);
  ctx.translate(-0.5, -0.5);

  // Lens glass: a faint blue tint.
  ctx.beginPath();
  ctx.arc(LENS.cx, LENS.cy, LENS.r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(79, 179, 255, 0.14)';
  ctx.fill();

  // Handle (drawn first so the ring sits on top of its join).
  ctx.beginPath();
  ctx.moveTo(LENS.cx + HANDLE_START * D45, LENS.cy + HANDLE_START * D45);
  ctx.lineTo(HANDLE.end, HANDLE.end);
  ctx.lineCap = 'round';
  ctx.lineWidth = HANDLE.width;
  ctx.strokeStyle = ACCENT;
  ctx.stroke();

  // Jigsaw piece in the glass.
  ctx.save();
  ctx.translate(LENS.cx, LENS.cy);
  ctx.rotate((PIECE_ROTATE_DEG * Math.PI) / 180);
  ctx.scale(PIECE_SCALE, PIECE_SCALE);
  ctx.translate(-PIECE_CENTER[0], -PIECE_CENTER[1]);
  ctx.fillStyle = PIECE;
  ctx.fill(new Path2D(PIECE_D));
  ctx.restore();

  // Ring.
  ctx.beginPath();
  ctx.arc(LENS.cx, LENS.cy, LENS.r, 0, Math.PI * 2);
  ctx.lineWidth = LENS.stroke;
  ctx.strokeStyle = ACCENT;
  ctx.stroke();

  // Small highlight on the glass, top left.
  ctx.beginPath();
  ctx.arc(LENS.cx, LENS.cy, LENS.r - LENS.stroke / 2 - 0.028, Math.PI * 1.06, Math.PI * 1.32);
  ctx.lineWidth = 0.022;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.stroke();

  ctx.restore();
  return canvas;
}

function save(name, canvas) {
  writeFileSync(OUT + name, canvas.toBuffer('image/png'));
  console.log(`Wrote public/icons/${name} (${canvas.width}×${canvas.height})`);
}

// ---------- Checks ----------
/** Every pixel outside the central safe circle (radius 40 % of the size) must be plain background. */
function checkMaskable(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const safeR = 0.4 * w;
  let bad = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= safeR) continue;
      const i = (y * w + x) * 4;
      if (px[i + 3] !== 255 || Math.abs(px[i] - BG_RGB[0]) > 2 || Math.abs(px[i + 1] - BG_RGB[1]) > 2 || Math.abs(px[i + 2] - BG_RGB[2]) > 2) bad++;
    }
  }
  if (bad) throw new Error(`Maskable icon: ${bad} pixels of artwork outside the 80% safe zone`);
}

function checkOpaque(canvas, name) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) throw new Error(`${name}: has transparent pixels`);
}

// ---------- Output ----------
const reach = artReach();
// "any" and Apple icons: the artwork fills most of the square, with a margin.
const MAIN_SCALE = Math.min(1, 0.43 / reach);
// Maskable: everything inside a circle of radius 0.38 (the safe zone is 0.40).
const MASKABLE_SCALE = Math.min(1, 0.38 / reach);

save('icon-192.png', drawIcon(192, { scale: MAIN_SCALE, shape: 'rounded' }));
save('icon-512.png', drawIcon(512, { scale: MAIN_SCALE, shape: 'rounded' }));

const maskable = drawIcon(512, { scale: MASKABLE_SCALE, shape: 'square' });
checkMaskable(maskable);
save('icon-maskable-512.png', maskable);

const apple = drawIcon(180, { scale: MAIN_SCALE, shape: 'square' });
checkOpaque(apple, 'apple-touch-icon');
save('apple-touch-icon.png', apple);

// ---------- favicon.svg (same artwork as a vector) ----------
const n = (x) => +x.toFixed(4);
const hx = n(LENS.cx + HANDLE_START * D45);
const s = MAIN_SCALE;
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><!-- Made by scripts/make-icons.mjs; do not edit by hand. -->
<rect width="1" height="1" rx="0.2" fill="${BG}"/>
<g transform="translate(0.5 0.5) scale(${n(s)}) translate(-0.5 -0.5)">
<circle cx="${LENS.cx}" cy="${LENS.cy}" r="${LENS.r}" fill="${ACCENT}" fill-opacity="0.14"/>
<path d="M${hx} ${hx}L${HANDLE.end} ${HANDLE.end}" stroke="${ACCENT}" stroke-width="${HANDLE.width}" stroke-linecap="round"/>
<path transform="translate(${LENS.cx} ${LENS.cy}) rotate(${PIECE_ROTATE_DEG}) scale(${n(PIECE_SCALE)}) translate(${-PIECE_CENTER[0]} ${-PIECE_CENTER[1]})" fill="${PIECE}" d="${PIECE_D}"/>
<circle cx="${LENS.cx}" cy="${LENS.cy}" r="${LENS.r}" fill="none" stroke="${ACCENT}" stroke-width="${LENS.stroke}"/>
</g>
</svg>
`;
writeFileSync(OUT + 'favicon.svg', favicon);
console.log('Wrote public/icons/favicon.svg');
console.log(`Artwork reach ${reach.toFixed(3)}; scale ${MAIN_SCALE.toFixed(3)} (any/apple), ${MASKABLE_SCALE.toFixed(3)} (maskable). Checks passed.`);
