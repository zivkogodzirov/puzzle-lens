/**
 * Renders a photo of pieces lying on the owner's white glossy table, as a hand-held iPhone would
 * take it (RESEARCH §4, §6 "Update 2026-11-06").
 *
 * How: everything is drawn with @napi-rs/canvas (anti-aliased) in TABLE space, at about the
 * camera's finest px/mm over the visible area, then warped into the photo with OpenCV
 * `warpPerspective` using the app's own camera maths (src/geo/pose.ts homographyForCamera).
 * Raised things are drawn where the camera ray through them meets the table: a point at height z
 * appears at foot + (p − foot)·H/(H − z) (foot = table point under the camera), so the printed top
 * face (z = thickness) is shifted outward from the photo centre by δ ≈ t·r/H and the cardboard
 * wall between bottom and top outline shows on the side away from the image centre. This is exact
 * for a pinhole camera.
 *
 * Effects: side-light shadow (1–2 mm, soft), contact shadow, faint mirror reflection of each
 * piece and of a window in the glossy table, lamp glare = mirror image of the lamp (moves when the
 * camera moves; matte cards and pieces hide it), lighting gradient, optional hand shadow,
 * vignetting, defocus and motion blur, signal-dependent noise, white balance / exposure, JPEG.
 */
import { createCanvas, ImageData, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { applyH, invertH, mulH } from '../../src/geo/homography';
import { homographyForCamera, nominalIntrinsics } from '../../src/geo/pose';
import { MARKER_CARD_MM, MARKER_CELL_MM, MARKER_CELLS, markerCornersMm, suggestedMarkerCentres } from '../../src/markers/layout';
import { MARKER_PATTERNS } from '../../src/markers/patterns';
import { withScope } from '../../src/cv/scope';
import type { Mat3 } from '../../src/project/types';
import { getCv } from '../helpers/cv';
import { rng } from '../helpers/images';
import { hash2, valueNoise } from './art';
import { layoutPieces, type PlacedPiece } from './layout';
import { bbox, mapPoly, placePoly, rasterize } from './raster';
import type { MarkerPlacementSpec, SceneOptions, SynthPuzzle, SynthScene, TruthPiece } from './types';

const WALL_RGB: [number, number, number] = [170, 161, 144];
const BACK_RGB: [number, number, number] = [196, 192, 182];
const INK_RGB: [number, number, number] = [26, 26, 29];
/** A table point counts as "glare" where the lamp reflection adds more than this (0..1 of white). */
const GLARE_LEVEL = 0.25;
/** Fixed-point scale of the linear light buffer. */
const LIN = 64;
/** Where auto-exposure puts the white table (8-bit). */
const AE_TARGET = 214;

/**
 * Re-used drawing surfaces: native canvas memory is only returned when the GC finalises a
 * canvas, so creating three 12 MP canvases per photo let the process grow to ~3 GB.
 */
const pool = new Map<string, Canvas>();
function pooledCanvas(slot: string, w: number, h: number): Canvas {
  let c = pool.get(slot);
  if (!c) {
    c = createCanvas(w, h);
    pool.set(slot, c);
  } else if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  return c;
}

const artCanvases = new WeakMap<SynthPuzzle, Canvas>();

function artCanvas(p: SynthPuzzle): Canvas {
  let c = artCanvases.get(p);
  if (!c) {
    c = createCanvas(p.art.width, p.art.height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(p.art.rgba.buffer, p.art.rgba.byteOffset, p.art.rgba.length), p.art.width, p.art.height), 0, 0);
    artCanvases.set(p, c);
  }
  return c;
}

/** Mean RGB of the art over a piece's cell (for reflections and tests). */
export function cellMeanRgb(p: SynthPuzzle, col: number, row: number): [number, number, number] {
  const [ppx, ppy] = p.art.pxPerMm;
  const [w, h] = p.cellMm;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let j = 0; j < 9; j++)
    for (let i = 0; i < 9; i++) {
      const x = Math.min(p.art.width - 1, Math.floor((col + (i + 0.5) / 9) * w * ppx));
      const y = Math.min(p.art.height - 1, Math.floor((row + (j + 0.5) / 9) * h * ppy));
      const k = (y * p.art.width + x) * 4;
      r += p.art.rgba[k]!;
      g += p.art.rgba[k + 1]!;
      b += p.art.rgba[k + 2]!;
      n++;
    }
  return [r / n, g / n, b / n];
}

/**
 * Table (mm, y towards the viewer) → image homography for a camera above the table.
 *
 * NOTE: src/geo/pose.ts `homographyForCamera` assumes table y points AWAY from the viewer (its
 * camera has image y = −table y), so with the PLAN's table frame (y towards the viewer, like a
 * printed page) it gives a MIRRORED photo, in which ArUco finds no markers. We therefore call it
 * for the mirrored camera (y, tilt direction and yaw negated) and mirror the table back. The result
 * is a proper camera; `poseFromHomography` recovers exactly the requested height, tilt, foot point
 * and view centre from it (checked in test/unit/synth.test.ts).
 */
export function cameraHomography(
  K: ReturnType<typeof nominalIntrinsics>,
  cam: { x: number; y: number; heightMm: number; tiltDeg: number; tiltDirDeg?: number; yawDeg?: number },
): Mat3 {
  return homographyForCamera(K, cam);
}

/** Local camera scale (px per mm) of a table → image homography at table point p. */
function localScale(H: Mat3, p: [number, number]): number {
  const a = applyH(H, p);
  const bx = applyH(H, [p[0] + 1, p[1]]);
  const by = applyH(H, [p[0], p[1] + 1]);
  const det = (bx[0] - a[0]) * (by[1] - a[1]) - (bx[1] - a[1]) * (by[0] - a[0]);
  return Math.sqrt(Math.abs(det));
}

const rgbStr = (c: readonly number[], a = 1) => `rgba(${Math.round(c[0]!)},${Math.round(c[1]!)},${Math.round(c[2]!)},${a})`;

function tracePoly(ctx: SKRSContext2D, poly: number[], tx: (x: number, y: number) => [number, number]): void {
  const [x0, y0] = tx(poly[0]!, poly[1]!);
  ctx.moveTo(x0, y0);
  for (let i = 2; i < poly.length; i += 2) {
    const [x, y] = tx(poly[i]!, poly[i + 1]!);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export async function renderScene(opts: SceneOptions): Promise<SynthScene> {
  const T0 = performance.now();
  const timings: Record<string, number> = {};
  let tMark = T0;
  const lap = (name: string) => {
    const now = performance.now();
    timings[name] = now - tMark;
    tMark = now;
  };

  const puzzle = opts.puzzle;
  const cam = opts.camera;
  const [W, Hh] = cam.imageSize ?? [4032, 3024];
  const zoom = cam.zoom ?? 1;
  const t = opts.thicknessMm ?? 2.1;
  const K = nominalIntrinsics(W, Hh, zoom);
  const camPose = { x: cam.x, y: cam.y, heightMm: cam.heightMm, tiltDeg: cam.tiltDeg, tiltDirDeg: cam.tiltDirDeg ?? 0, yawDeg: cam.yawDeg ?? 0 };
  const H0 = cameraHomography(K, camPose);
  const Ht = cameraHomography(K, { ...camPose, heightMm: cam.heightMm - t });
  const H0inv = invertH(H0)!;
  const foot: [number, number] = [cam.x, cam.y];
  const kTop = cam.heightMm / (cam.heightMm - t);
  const kMirror = cam.heightMm / (cam.heightMm + t);
  const R = rng(opts.seed * 31337 + 7);

  const tableRgb = opts.table?.rgb ?? [236, 236, 232];
  const glossy = opts.table?.glossy ?? true;
  const light = opts.light ?? {};
  const dirRad = ((light.dirDeg ?? 200) * Math.PI) / 180;
  const toLight: [number, number] = [Math.cos(dirRad), Math.sin(dirRad)];
  const elev = ((light.elevationDeg ?? 50) * Math.PI) / 180;
  const ambient = light.ambient ?? 0.55;
  const gradient = light.gradient ?? 0.12;
  const shadowLen = t / Math.tan(elev);

  // ---- Layout and markers -------------------------------------------------------------------
  const layout = opts.layout ?? { areaMm: [700, 500] as [number, number] };
  const [areaW, areaH] = layout.areaMm;
  const gapFrame = MARKER_CARD_MM / 2 + 10;
  const origin = layout.originMm ?? [gapFrame, gapFrame];
  const markers: MarkerPlacementSpec[] =
    opts.markers === undefined || opts.markers === 'suggested'
      ? suggestedMarkerCentres(areaW, areaH).map((c, id) => ({ id, centreMm: c, angleDeg: 0 }))
      : opts.markers;
  const cardPolys = markers.map((m) => markerCornersMm(m.centreMm[0], m.centreMm[1], m.angleDeg, MARKER_CARD_MM).flat());

  const wanted = opts.pieceIds ? new Set(opts.pieceIds) : null;
  const pieces = wanted ? puzzle.pieces.filter((p) => wanted.has(p.id)) : puzzle.pieces;
  if (wanted && pieces.length !== wanted.size) throw new Error('renderScene: unknown piece ids');
  // An assembled block (pieces at their solved positions, all touching) and non-piece objects.
  const asm = opts.assembled ?? null;
  const asmIds = new Set(asm?.ids ?? []);
  const asmPlaced: PlacedPiece[] = [];
  if (asm) {
    const a = ((asm.angleDeg ?? 0) * Math.PI) / 180;
    const [cw0, ch0] = puzzle.cellMm;
    const byId = new Map(puzzle.pieces.map((p) => [p.id, p]));
    const at = new Map(asm.ids.map((id) => [`${byId.get(id)!.col},${byId.get(id)!.row}`, id]));
    for (const id of asm.ids) {
      const sp = byId.get(id);
      if (!sp) throw new Error(`renderScene: unknown assembled piece ${id}`);
      const u = (sp.col + 0.5) * cw0;
      const v = (sp.row + 0.5) * ch0;
      const cx = asm.originMm[0] + u * Math.cos(a) - v * Math.sin(a);
      const cy = asm.originMm[1] + u * Math.sin(a) + v * Math.cos(a);
      const touching = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
        .map(([dc, dr]) => at.get(`${sp.col + dc!},${sp.row + dr!}`))
        .filter((x): x is string => Boolean(x));
      asmPlaced.push({ id, centreMm: [cx, cy], angleDeg: asm.angleDeg ?? 0, faceDown: false, touching, outlineMm: placePoly(sp.outlineMm, cx, cy, asm.angleDeg ?? 0, false) });
    }
  }
  const objPolys = (opts.objects ?? []).map((o) => objectPolygon(o));
  const keepOut = [...cardPolys, ...objPolys.map((p) => grow(p, 6))];
  // Each assembled piece keeps out its cell grown by its knobs and the gap, so loose pieces can
  // still lie inside an assembled frame.
  for (const p of asmPlaced) {
    const [cw0, ch0] = puzzle.cellMm;
    keepOut.push(objectPolygon({ shape: 'rect', centreMm: p.centreMm, sizeMm: [cw0 + 12, ch0 + 12], angleDeg: p.angleDeg }));
  }
  const placed: PlacedPiece[] = layoutPieces({
    pieces: pieces.filter((p) => !asmIds.has(p.id)),
    originMm: origin,
    areaMm: [areaW, areaH],
    gapMm: layout.gapMm ?? 3,
    touchingShare: layout.touchingShare ?? 0.03,
    faceDownShare: layout.faceDownShare ?? 0.02,
    keepOut,
    seed: opts.seed,
  })
    .map((p) => {
      const m = opts.moves?.[p.id];
      if (!m) return p;
      const a = ((m.dAngleDeg ?? 0) * Math.PI) / 180;
      const [cx, cy] = p.centreMm;
      const outlineMm = p.outlineMm.map((v, i, o) => {
        const x = (i % 2 ? o[i - 1]! : v) - cx;
        const y = (i % 2 ? v : o[i + 1]!) - cy;
        return i % 2 ? cy + m.dyMm + x * Math.sin(a) + y * Math.cos(a) : cx + m.dxMm + x * Math.cos(a) - y * Math.sin(a);
      });
      return { ...p, centreMm: [cx + m.dxMm, cy + m.dyMm] as [number, number], angleDeg: p.angleDeg + (m.dAngleDeg ?? 0), outlineMm };
    })
    .filter((p) => !opts.hidden?.includes(p.id))
    .concat(asmPlaced);
  lap('layout');

  // ---- Table-space canvas -------------------------------------------------------------------
  const probe: Array<[number, number]> = [];
  for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) probe.push([fx * W - 0.5, fy * Hh - 0.5]);
  const probeTable = probe.map((p) => applyH(H0inv, p));
  let s = Math.max(...probeTable.map((p) => localScale(H0, p)));
  const margin = 4;
  const bx0 = Math.min(...probeTable.map((p) => p[0])) - margin;
  const by0 = Math.min(...probeTable.map((p) => p[1])) - margin;
  const bx1 = Math.max(...probeTable.map((p) => p[0])) + margin;
  const by1 = Math.max(...probeTable.map((p) => p[1])) + margin;
  const maxPx = 40e6;
  if ((bx1 - bx0) * (by1 - by0) * s * s > maxPx) s = Math.sqrt(maxPx / ((bx1 - bx0) * (by1 - by0)));
  const Cw = Math.ceil((bx1 - bx0) * s);
  const Ch = Math.ceil((by1 - by0) * s);
  const toC = (x: number, y: number): [number, number] => [(x - bx0) * s, (y - by0) * s];
  const toCTop = (x: number, y: number): [number, number] => toC(foot[0] + (x - foot[0]) * kTop, foot[1] + (y - foot[1]) * kTop);
  const toCMirror = (x: number, y: number): [number, number] => toC(foot[0] + (x - foot[0]) * kMirror, foot[1] + (y - foot[1]) * kMirror);

  const canvas = pooledCanvas('table', Cw, Ch);
  const ctx = canvas.getContext('2d');
  const maskCanvas = pooledCanvas('mask', Cw, Ch);
  const mctx = maskCanvas.getContext('2d');
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, Cw, Ch);
  mctx.fillStyle = '#fff';
  ctx.fillStyle = rgbStr(tableRgb);
  ctx.fillRect(0, 0, Cw, Ch);

  const pieceById = new Map(puzzle.pieces.map((p) => [p.id, p]));
  const visible = placed.filter((pl) => {
    const b = bbox(pl.outlineMm);
    return b.x1 > bx0 - 10 && b.x0 < bx1 + 10 && b.y1 > by0 - 10 && b.y0 < by1 + 10;
  });

  // Faint mirror image of each piece in the glossy table (shows as a thin dark sliver on the
  // side facing the photo centre).
  if (glossy) {
    for (const pl of visible) {
      const sp = pieceById.get(pl.id)!;
      const c = pl.faceDown ? BACK_RGB : cellMeanRgb(puzzle, sp.col, sp.row);
      ctx.fillStyle = rgbStr(c.map((v, i) => tableRgb[i]! * 0.93 + v * 0.07));
      ctx.beginPath();
      tracePoly(ctx, pl.outlineMm, toCMirror);
      ctx.fill();
    }
  }

  // Shadows: side light (outline swept away from the light) and a tight contact shadow.
  const BIG = Cw + Ch + 2000;
  const shadowPath = (shift: number) => {
    ctx.beginPath();
    for (const pl of visible) {
      for (const f of shift > 0 ? [0, 0.5, 1] : [0]) {
        const dx = -toLight[0] * shadowLen * f;
        const dy = -toLight[1] * shadowLen * f;
        tracePoly(ctx, pl.outlineMm, (x, y) => {
          const c = toC(x + dx, y + dy);
          return [c[0] - BIG, c[1]];
        });
      }
    }
  };
  ctx.save();
  ctx.shadowOffsetX = BIG;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = '#000';
  ctx.shadowColor = `rgba(0,0,0,${(1 - ambient) * 0.8})`;
  ctx.shadowBlur = Math.max(0.5, 2 * 0.45 * s); // σ ≈ 0.45 mm penumbra
  shadowPath(1);
  ctx.fill();
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = Math.max(0.5, 2 * 0.25 * s);
  shadowPath(0);
  ctx.fill();
  ctx.restore();

  // Marker cards: matte paper, barely different from the table; crisp printed cells.
  ctx.save();
  ctx.shadowOffsetX = BIG;
  ctx.shadowColor = 'rgba(0,0,0,0.06)';
  ctx.shadowBlur = Math.max(0.5, 2 * 0.2 * s);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  for (const poly of cardPolys)
    tracePoly(ctx, poly, (x, y) => {
      const c = toC(x, y);
      return [c[0] - BIG, c[1]];
    });
  ctx.fill();
  ctx.restore();
  // Matte paper, a hair brighter and more neutral than the table: the card edge nearly vanishes.
  ctx.fillStyle = rgbStr([Math.min(255, tableRgb[0] + 2), Math.min(255, tableRgb[1] + 2), Math.min(255, tableRgb[2] + 3)]);
  ctx.beginPath();
  for (const poly of cardPolys) tracePoly(ctx, poly, toC);
  ctx.fill();
  mctx.beginPath();
  for (const poly of cardPolys) tracePoly(mctx, poly, toC);
  mctx.fill();
  ctx.fillStyle = rgbStr(INK_RGB);
  ctx.beginPath();
  for (const m of markers) {
    const pattern = MARKER_PATTERNS[m.id];
    if (!pattern) throw new Error(`renderScene: no pattern for marker id ${m.id}`);
    const a = (m.angleDeg * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const half = (MARKER_CELLS * MARKER_CELL_MM) / 2;
    const tx = (u: number, v: number) => toC(m.centreMm[0] + (u - half) * ca - (v - half) * sa, m.centreMm[1] + (u - half) * sa + (v - half) * ca);
    for (let row = 0; row < MARKER_CELLS; row++)
      for (let col = 0; col < MARKER_CELLS; col++) {
        if (pattern[row]![col] === '1') continue;
        const u0 = col * MARKER_CELL_MM;
        const v0 = row * MARKER_CELL_MM;
        // Slightly overlapping cells so neighbouring black cells merge without seams.
        const e = 0.02;
        tracePoly(ctx, [u0 - e, v0 - e, u0 + MARKER_CELL_MM + e, v0 - e, u0 + MARKER_CELL_MM + e, v0 + MARKER_CELL_MM + e, u0 - e, v0 + MARKER_CELL_MM + e], tx);
      }
  }
  ctx.fill();

  // Objects: a soft contact shadow, then the object itself (matte: no glare on it).
  if (objPolys.length) {
    ctx.save();
    ctx.shadowOffsetX = BIG;
    ctx.shadowColor = `rgba(0,0,0,${(1 - ambient) * 0.6})`;
    ctx.shadowBlur = Math.max(0.5, 2 * 2 * s);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    for (const poly of objPolys)
      tracePoly(ctx, poly, (x, y) => {
        const c = toC(x - toLight[0] * 6, y - toLight[1] * 6);
        return [c[0] - BIG, c[1]];
      });
    ctx.fill();
    ctx.restore();
    (opts.objects ?? []).forEach((o, i) => {
      ctx.fillStyle = rgbStr(o.rgb);
      ctx.beginPath();
      tracePoly(ctx, objPolys[i]!, toC);
      ctx.fill();
      mctx.beginPath();
      tracePoly(mctx, objPolys[i]!, toC);
      mctx.fill();
    });
  }

  // Cardboard walls (all walls before any top: a top face is never hidden by a wall).
  const shades = [0.6, 0.72, 0.86, 1];
  for (const pl of visible) {
    const P = pl.outlineMm;
    const n = P.length / 2;
    const buckets: number[][] = [[], [], [], []];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = P[2 * i]!;
      const ay = P[2 * i + 1]!;
      const bxp = P[2 * j]!;
      const byp = P[2 * j + 1]!;
      // Outward normal of a clockwise (on screen) outline.
      let nx = byp - ay;
      let ny = -(bxp - ax);
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const mx = (ax + bxp) / 2 - foot[0];
      const my = (ay + byp) / 2 - foot[1];
      if (nx * mx + ny * my <= 0) continue; // faces the camera foot: hidden under the top face
      const lit = Math.max(0, nx * toLight[0] + ny * toLight[1]);
      const b = Math.min(3, Math.floor(lit * 3.999));
      buckets[b]!.push(i);
    }
    for (const target of [ctx, mctx]) {
      const isMask = target === mctx;
      if (!isMask) target.fillStyle = rgbStr(WALL_RGB.map((v) => v * 0.78));
      target.beginPath();
      tracePoly(target, P, toC);
      target.fill();
      for (let b = 0; b < 4; b++) {
        const list = buckets[b]!;
        if (!list.length) continue;
        if (!isMask) target.fillStyle = rgbStr(WALL_RGB.map((v) => v * (ambient * 0.8 + (1 - ambient * 0.8) * shades[b]!)));
        target.beginPath();
        for (const i of list) {
          const j = (i + 1) % n;
          const a0 = toC(P[2 * i]!, P[2 * i + 1]!);
          const a1 = toC(P[2 * j]!, P[2 * j + 1]!);
          const t1 = toCTop(P[2 * j]!, P[2 * j + 1]!);
          const t0 = toCTop(P[2 * i]!, P[2 * i + 1]!);
          // Same winding for every quad so the non-zero fill is a clean union.
          const area = (a1[0] - a0[0]) * (t1[1] - a0[1]) - (a1[1] - a0[1]) * (t1[0] - a0[0]) + (t1[0] - a0[0]) * (t0[1] - a0[1]) - (t1[1] - a0[1]) * (t0[0] - a0[0]);
          const q = area >= 0 ? [a0, a1, t1, t0] : [a0, t0, t1, a1];
          target.moveTo(q[0]![0], q[0]![1]);
          for (let k = 1; k < 4; k++) target.lineTo(q[k]![0], q[k]![1]);
          target.closePath();
        }
        target.fill();
      }
    }
  }

  // Printed top faces (or the cardboard back for face-down pieces).
  const art = artCanvas(puzzle);
  const [ppx, ppy] = puzzle.art.pxPerMm;
  const [cw, chh] = puzzle.cellMm;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const pl of visible) {
    const sp = pieceById.get(pl.id)!;
    mctx.beginPath();
    tracePoly(mctx, pl.outlineMm, toCTop);
    mctx.fill();
    ctx.save();
    ctx.beginPath();
    tracePoly(ctx, pl.outlineMm, toCTop);
    const cutLine = () => {
      // Die-cut edge: a faint darker line ~0.25 mm wide just inside the top face.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      tracePoly(ctx, pl.outlineMm, toCTop);
      ctx.lineWidth = 2 * 0.25 * s * kTop;
      ctx.strokeStyle = pl.faceDown ? 'rgba(60,50,40,0.12)' : 'rgba(45,35,25,0.2)';
      ctx.stroke();
    };
    if (pl.faceDown) {
      ctx.fillStyle = rgbStr(BACK_RGB);
      ctx.fill();
      ctx.clip();
      cutLine();
      ctx.restore();
      continue;
    }
    ctx.clip();
    const th = (pl.angleDeg * Math.PI) / 180;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const sk = s * kTop;
    const ccx = (sp.col + 0.5) * cw;
    const ccy = (sp.row + 0.5) * chh;
    // art px → puzzle mm → piece-local → table → apparent (top face) → canvas.
    const ox = foot[0] + kTop * (pl.centreMm[0] + (-ccx * c + ccy * sn) - foot[0]);
    const oy = foot[1] + kTop * (pl.centreMm[1] + (-ccx * sn - ccy * c) - foot[1]);
    ctx.setTransform((sk * c) / ppx, (sk * sn) / ppx, (-sk * sn) / ppy, (sk * c) / ppy, (ox - bx0) * s, (oy - by0) * s);
    const lb = bbox(sp.outlineMm);
    const sx0 = Math.max(0, Math.floor((lb.x0 + ccx) * ppx) - 3);
    const sy0 = Math.max(0, Math.floor((lb.y0 + ccy) * ppy) - 3);
    const sx1 = Math.min(puzzle.art.width, Math.ceil((lb.x1 + ccx) * ppx) + 3);
    const sy1 = Math.min(puzzle.art.height, Math.ceil((lb.y1 + ccy) * ppy) + 3);
    ctx.drawImage(art, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0, sy0, sx1 - sx0, sy1 - sy0);
    cutLine();
    ctx.restore();
  }
  lap('draw');

  // ---- Lighting field and glare (coarse grid, bilinear) ------------------------------------
  const areaC: [number, number] = [origin[0] + areaW / 2, origin[1] + areaH / 2];
  const H = cam.heightMm;
  const glare = light.glare ?? null;
  const glareSpot = glare
    ? (() => {
        const [lx, ly, lz] = glare.lampMm;
        const f = H / (H + lz);
        return { x: cam.x + (lx - cam.x) * f, y: cam.y + (ly - cam.y) * f, r: (glare.radiusMm ?? 60) * f };
      })()
    : null;
  // Window reflection: a broad soft bright patch, mirror image of a window on the light side.
  const win = (() => {
    const wx = areaC[0] + toLight[0] * 1500;
    const wy = areaC[1] + toLight[1] * 1500;
    const wz = 1100;
    const f = H / (H + wz);
    return { x: cam.x + (wx - cam.x) * f, y: cam.y + (wy - cam.y) * f, r: 320 * f };
  })();
  const hand = opts.handShadow
    ? {
        x: cam.x - toLight[0] * (90 + R() * 80) + (R() - 0.5) * 80,
        y: cam.y - toLight[1] * (90 + R() * 80) + 60 + (R() - 0.5) * 60,
        sx: 110 + R() * 90,
        sy: 140 + R() * 90,
        k: 0.3 + R() * 0.15,
      }
    : null;
  const directAt = (x: number, y: number) => {
    let d = 1 + (gradient * ((x - areaC[0]) * toLight[0] + (y - areaC[1]) * toLight[1])) / 400;
    if (hand) {
      const ex = (x - hand.x) / hand.sx;
      const ey = (y - hand.y) / hand.sy;
      d *= 1 - hand.k * Math.exp(-(ex * ex + ey * ey) * 1.2);
    }
    return Math.max(0.05, d);
  };
  const fieldNorm = 1 / (ambient + (1 - ambient) * directAt(areaC[0], areaC[1]));
  const fieldAt = (x: number, y: number) => (ambient + (1 - ambient) * directAt(x, y)) * fieldNorm;
  const lampAt = (x: number, y: number) => {
    if (!glareSpot) return 0;
    const d = Math.hypot(x - glareSpot.x, y - glareSpot.y);
    return 1.4 * (1 - smoothstep(0.65 * glareSpot.r, glareSpot.r, d)) + 0.35 * Math.exp(-(d * d) / (2 * (1.3 * glareSpot.r) ** 2));
  };
  const windowAt = (x: number, y: number) => {
    if (!glossy) return 0;
    const d2 = ((x - win.x) ** 2 + (y - win.y) ** 2) / (win.r * win.r);
    return 0.035 * Math.exp(-d2);
  };

  const img = ctx.getImageData(0, 0, Cw, Ch).data;
  const mask = mctx.getImageData(0, 0, Cw, Ch).data;
  // Linear light, 16-bit fixed point (× LIN): nothing is clipped before the sensor step, so glare
  // keeps its headroom and exposure / white balance work like a real camera.
  const G = 8;
  const gw = Math.ceil(Cw / G) + 2;
  const gh = Math.ceil(Ch / G) + 2;
  const fGrid = new Float32Array(gw * gh);
  const lGrid = new Float32Array(gw * gh);
  const wGrid = new Float32Array(gw * gh);
  // Table texture: slow brightness / colour variation (fixed to the table, same in every photo).
  const tGrid = new Float32Array(gw * gh * 3);
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      const x = bx0 + (i * G) / s;
      const y = by0 + (j * G) / s;
      const k = j * gw + i;
      fGrid[k] = fieldAt(x, y);
      lGrid[k] = lampAt(x, y) * 255;
      wGrid[k] = windowAt(x, y) * 255;
      const slow = (valueNoise(x / 140, y / 140, 4242) - 0.5) * 0.03 + (valueNoise(x / 35, y / 35, 4243) - 0.5) * 0.012;
      const hue = (valueNoise(x / 200, y / 200, 4244) - 0.5) * 0.016;
      tGrid[3 * k] = slow + hue;
      tGrid[3 * k + 1] = slow;
      tGrid[3 * k + 2] = slow - hue;
    }
  const lit = new Uint16Array(Cw * Ch * 4);
  for (let y = 0; y < Ch; y++) {
    const gy = (y + 0.5) / G;
    const j0 = Math.floor(gy);
    const fy = gy - j0;
    const ty = Math.floor((by0 + (y + 0.5) / s) * 4);
    for (let x = 0; x < Cw; x++) {
      const gx = (x + 0.5) / G;
      const i0 = Math.floor(gx);
      const fx = gx - i0;
      const k00 = j0 * gw + i0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const bil = (a: Float32Array) => a[k00]! * w00 + a[k00 + 1]! * w10 + a[k00 + gw]! * w01 + a[k00 + gw + 1]! * w11;
      const f = bil(fGrid);
      const p = (y * Cw + x) * 4;
      const m = mask[p]! / 255;
      const spec = 1 - 0.9 * m; // matte cards and pieces: only a faint sheen
      const gl = bil(lGrid) * spec;
      const gwin = bil(wGrid) * spec;
      const tw = 1 - m;
      let tr = 1;
      let tg = 1;
      let tb = 1;
      if (tw > 0) {
        const k3 = 3 * k00;
        const fine = (hash2(Math.floor((bx0 + (x + 0.5) / s) * 4), ty, 4245) - 0.5) * 0.012;
        tr = 1 + tw * (tGrid[k3]! + fine);
        tg = 1 + tw * (tGrid[k3 + 1]! + fine);
        tb = 1 + tw * (tGrid[k3 + 2]! + fine);
      }
      // Lamp: warm; window: cool sky light.
      lit[p] = Math.min(65535, (img[p]! * f * tr + gl + gwin * 0.9) * LIN);
      lit[p + 1] = Math.min(65535, (img[p + 1]! * f * tg + gl * 0.97 + gwin * 0.97) * LIN);
      lit[p + 2] = Math.min(65535, (img[p + 2]! * f * tb + gl * 0.9 + gwin * 1.1) * LIN);
      lit[p + 3] = 255 * LIN;
    }
  }
  lap('light');

  // ---- Warp into the photo, optics ---------------------------------------------------------
  const cv = await getCv();
  const Tcanvas: Mat3 = [1 / s, 0, bx0 + 0.5 / s, 0, 1 / s, by0 + 0.5 / s, 0, 0, 1];
  const M = mulH(H0, Tcanvas);
  const blurPx = opts.blurPx ?? 0.6;
  const motion = opts.motionBlurPx ?? 0;
  const photo = withScope((sc) => {
    const src = sc.keep(new cv.Mat(Ch, Cw, cv.CV_16UC4));
    src.data16U.set(lit);
    const dst = sc.keep(new cv.Mat());
    const Mm = sc.keep(cv.matFromArray(3, 3, cv.CV_64F, M));
    cv.warpPerspective(src, dst, Mm, new cv.Size(W, Hh), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    src.delete(); // free early (big); the scope's later delete is a no-op
    let cur = dst;
    if (blurPx > 0) {
      const b = sc.keep(new cv.Mat());
      cv.GaussianBlur(cur, b, new cv.Size(0, 0), blurPx, blurPx, cv.BORDER_REPLICATE);
      cur = b;
    }
    if (motion > 0.5) {
      const ang = R() * Math.PI;
      const size = 2 * Math.ceil(motion / 2) + 1;
      const kern = new Float32Array(size * size);
      const steps = Math.ceil(motion * 4);
      for (let i = 0; i <= steps; i++) {
        const u = (i / steps - 0.5) * motion;
        const px = (size - 1) / 2 + u * Math.cos(ang);
        const py = (size - 1) / 2 + u * Math.sin(ang);
        const x0 = Math.floor(px);
        const y0 = Math.floor(py);
        const fx = px - x0;
        const fy = py - y0;
        const add = (xx: number, yy: number, w: number) => {
          if (xx >= 0 && yy >= 0 && xx < size && yy < size) kern[yy * size + xx]! += w;
        };
        add(x0, y0, (1 - fx) * (1 - fy));
        add(x0 + 1, y0, fx * (1 - fy));
        add(x0, y0 + 1, (1 - fx) * fy);
        add(x0 + 1, y0 + 1, fx * fy);
      }
      const sum = kern.reduce((a, v) => a + v, 0);
      for (let i = 0; i < kern.length; i++) kern[i]! /= sum;
      const km = sc.keep(cv.matFromArray(size, size, cv.CV_32F, Array.from(kern)));
      const b = sc.keep(new cv.Mat());
      cv.filter2D(cur, b, -1, km, new cv.Point(-1, -1), 0, cv.BORDER_REPLICATE);
      cur = b;
    }
    return new Uint16Array(cur.data16U);
  });
  lap('warp');

  // ---- Sensor and ISP: vignetting, exposure, white balance, noise --------------------------
  const cxI = (W - 1) / 2;
  const cyI = (Hh - 1) / 2;
  const r2max = cxI * cxI + cyI * cyI;
  const vignette = (x: number, y: number) => 1 - (0.16 * ((x - cxI) * (x - cxI) + (y - cyI) * (y - cyI))) / r2max;
  // Auto-exposure, like an iPhone metering a mostly white scene: the brightest large area (the
  // 70th luminance percentile, i.e. the table) lands at AE_TARGET; glare can still clip.
  const hist = new Uint32Array(4096);
  let nHist = 0;
  for (let y = 2; y < Hh; y += 6)
    for (let x = 2; x < W; x += 6) {
      const p = (y * W + x) * 4;
      const l = ((0.3 * photo[p]! + 0.59 * photo[p + 1]! + 0.11 * photo[p + 2]!) / LIN) * vignette(x, y);
      hist[Math.min(4095, Math.floor(l * 4))]!++;
      nHist++;
    }
  let acc = 0;
  let p70 = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i]!;
    if (acc >= 0.7 * nHist) {
      p70 = (i + 0.5) / 4;
      break;
    }
  }
  const aeGain = Math.min(2.5, Math.max(0.4, AE_TARGET / Math.max(1, p70)));
  // Exposure and white balance are small deviations from auto-exposure; white balance never lifts
  // a channel (gains are normalised to max 1).
  const ev = aeGain * Math.pow(2, opts.exposure ?? 0);
  const wbRaw = opts.whiteBalanceShift ?? [1, 1, 1];
  const wbMax = Math.max(...wbRaw);
  const wb = wbRaw.map((v) => v / wbMax) as [number, number, number];
  const noise = opts.noise ?? 1;
  const gauss = new Float32Array(1 << 16);
  {
    const nr = rng(opts.seed * 977 + 13);
    for (let i = 0; i < gauss.length; i += 2) {
      const u1 = nr() || 1e-9;
      const u2 = nr();
      const m = Math.sqrt(-2 * Math.log(u1));
      gauss[i] = m * Math.cos(2 * Math.PI * u2);
      gauss[i + 1] = m * Math.sin(2 * Math.PI * u2);
    }
  }
  let lcg = (opts.seed * 2654435761) >>> 0;
  const out = new Uint8ClampedArray(W * Hh * 4);
  const kLin = 1 / LIN;
  for (let y = 0; y < Hh; y++) {
    const dy2 = (y - cyI) * (y - cyI);
    for (let x = 0; x < W; x++) {
      const v = (1 - (0.16 * ((x - cxI) * (x - cxI) + dy2)) / r2max) * ev * kLin;
      const p = (y * W + x) * 4;
      const r = photo[p]! * v * wb[0];
      const g = photo[p + 1]! * v * wb[1];
      const b = photo[p + 2]! * v * wb[2];
      if (noise > 0) {
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        const sd = noise * Math.sqrt(0.6 + 0.012 * Math.max(0, lum));
        lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
        const nl = gauss[lcg >>> 16]! * sd;
        lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
        const nc = gauss[lcg >>> 16]! * sd * 0.35;
        out[p] = r + nl + nc;
        out[p + 1] = g + nl;
        out[p + 2] = b + nl - nc;
      } else {
        out[p] = r;
        out[p + 1] = g;
        out[p + 2] = b;
      }
      out[p + 3] = 255;
    }
  }
  lap('sensor');

  // ---- JPEG round trip ---------------------------------------------------------------------
  const photoCanvas = pooledCanvas('photo', W, Hh);
  const pctx = photoCanvas.getContext('2d');
  pctx.putImageData(new ImageData(out, W, Hh), 0, 0);
  const jpeg = photoCanvas.encodeSync('jpeg', opts.jpegQuality ?? 92);
  const decoded = await loadImage(jpeg);
  pctx.drawImage(decoded, 0, 0);
  const rgba = new Uint8Array(pctx.getImageData(0, 0, W, Hh).data.buffer);
  lap('jpeg');

  // ---- Ground truth ------------------------------------------------------------------------
  const cardImg = cardPolys.map((p) => mapPoly(H0, p));
  const cardBoxes = cardImg.map(bbox);
  const HtInv = invertH(Ht)!;
  const truthPieces: TruthPiece[] = [];
  for (const pl of placed) {
    const outlineImg = mapPoly(Ht, pl.outlineMm);
    const bottomImg = mapPoly(H0, pl.outlineMm);
    const silhouetteImg = silhouette(cv, bottomImg, outlineImg);
    // Visible share and glare share, sampled on a ~0.5 px grid (coarser for big pieces).
    const b = bbox(outlineImg);
    const cell = Math.max(0.5, Math.max(b.x1 - b.x0, b.y1 - b.y0) / 120);
    const gwp = Math.ceil((b.x1 - b.x0) / cell) + 1;
    const ghp = Math.ceil((b.y1 - b.y0) / cell) + 1;
    const m = rasterize(outlineImg, b.x0, b.y0, cell, gwp, ghp);
    const nearCard = cardBoxes.some((cb) => cb.x1 > b.x0 && cb.x0 < b.x1 && cb.y1 > b.y0 && cb.y0 < b.y1);
    const inside = b.x0 >= -0.5 && b.y0 >= -0.5 && b.x1 <= W - 0.5 && b.y1 <= Hh - 0.5;
    let total = 0;
    let vis = 0;
    let gl = 0;
    for (let j = 0; j < ghp; j++)
      for (let i = 0; i < gwp; i++) {
        if (!m[j * gwp + i]) continue;
        total++;
        const x = b.x0 + (i + 0.5) * cell;
        const y = b.y0 + (j + 0.5) * cell;
        let ok = inside || (x >= -0.5 && y >= -0.5 && x <= W - 0.5 && y <= Hh - 0.5);
        if (ok && nearCard) ok = !cardImg.some((cp) => pointIn(cp, x, y));
        if (ok) vis++;
        if (glareSpot) {
          const tp = applyH(HtInv, [x, y]);
          if (lampAt(tp[0], tp[1]) > GLARE_LEVEL) gl++;
        }
      }
    truthPieces.push({
      id: pl.id,
      centreMm: pl.centreMm,
      angleDeg: pl.angleDeg,
      faceDown: pl.faceDown,
      touching: pl.touching,
      outlineMm: pl.outlineMm,
      outlineImg,
      silhouetteImg,
      visibleShare: total ? vis / total : 0,
      glareShare: total ? gl / total : 0,
    });
  }
  let glareMaskShare = 0;
  if (glareSpot) {
    let n = 0;
    let hits = 0;
    for (let y = 0; y < Hh; y += 4)
      for (let x = 0; x < W; x += 4) {
        n++;
        const tp = applyH(H0inv, [x, y]);
        if (lampAt(tp[0], tp[1]) <= GLARE_LEVEL) continue;
        const cx = Math.floor((tp[0] - bx0) * s);
        const cy = Math.floor((tp[1] - by0) * s);
        if (cx >= 0 && cy >= 0 && cx < Cw && cy < Ch && mask[(cy * Cw + cx) * 4]! < 128) hits++;
      }
    glareMaskShare = hits / n;
  }
  lap('truth');
  timings.total = performance.now() - T0;

  return {
    width: W,
    height: Hh,
    rgba,
    stride: W * 4,
    jpeg,
    tableToImg: H0,
    truth: {
      pieces: truthPieces,
      markers: markers.map((mk) => ({ id: mk.id, cornersImg: mapPoly(H0, markerCornersMm(mk.centreMm[0], mk.centreMm[1], mk.angleDeg).flat()) })),
      glareMaskShare,
      topToImg: Ht,
      pxPerMm: localScale(H0, applyH(H0inv, [(W - 1) / 2, (Hh - 1) / 2])),
      thicknessMm: t,
    },
    timings,
    aeGain,
  };
}

/** Outline (table mm, flat) of a scene object. */
function objectPolygon(o: { shape: 'rect' | 'disc'; centreMm: [number, number]; sizeMm: [number, number]; angleDeg?: number }): number[] {
  const a = ((o.angleDeg ?? 0) * Math.PI) / 180;
  const out: number[] = [];
  if (o.shape === 'disc') {
    for (let k = 0; k < 64; k++) {
      const t = (k / 64) * 2 * Math.PI;
      out.push(o.centreMm[0] + (o.sizeMm[0] / 2) * Math.cos(t), o.centreMm[1] + (o.sizeMm[1] / 2) * Math.sin(t));
    }
    return out;
  }
  const hw = o.sizeMm[0] / 2;
  const hh = o.sizeMm[1] / 2;
  for (const [u, v] of [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ] as const)
    out.push(o.centreMm[0] + u * Math.cos(a) - v * Math.sin(a), o.centreMm[1] + u * Math.sin(a) + v * Math.cos(a));
  return out;
}

/** A polygon pushed out from its centroid by d mm (enough for keep-out zones of convex shapes). */
function grow(poly: number[], d: number): number[] {
  let cx = 0;
  let cy = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    cx += poly[2 * i]!;
    cy += poly[2 * i + 1]!;
  }
  cx /= n;
  cy /= n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = poly[2 * i]! - cx;
    const y = poly[2 * i + 1]! - cy;
    const l = Math.hypot(x, y) || 1;
    out.push(cx + x * (1 + d / l), cy + y * (1 + d / l));
  }
  return out;
}

function pointIn(poly: number[], x: number, y: number): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = poly[2 * i + 1]!;
    const yj = poly[2 * j + 1]!;
    if (yi > y !== yj > y && x < ((poly[2 * j]! - poly[2 * i]!) * (y - yi)) / (yj - yi) + poly[2 * i]!) inside = !inside;
  }
  return inside;
}

/**
 * Top face ∪ visible wall in the image: rasterises bottom outline, top outline and the side
 * quads at 4× resolution and traces the outer contour (OpenCV findContours).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function silhouette(cv: any, bottom: number[], top: number[]): number[] {
  const SS = 4;
  const b1 = bbox(bottom);
  const b2 = bbox(top);
  const x0 = Math.floor(Math.min(b1.x0, b2.x0)) - 2;
  const y0 = Math.floor(Math.min(b1.y0, b2.y0)) - 2;
  const w = (Math.ceil(Math.max(b1.x1, b2.x1)) + 2 - x0) * SS;
  const h = (Math.ceil(Math.max(b1.y1, b2.y1)) + 2 - y0) * SS;
  const ox = x0;
  const oy = y0;
  return withScope((sc) => {
    const m = sc.keep(new cv.Mat(h, w, cv.CV_8UC1, new cv.Scalar(0)));
    const toPts = (poly: number[]) => {
      const arr: number[] = [];
      // Mask pixel q has its centre at image x = ox − 0.5 + (q + 0.5) / SS.
      for (let i = 0; i < poly.length; i += 2) arr.push(Math.round((poly[i]! - ox + 0.5) * SS - 0.5), Math.round((poly[i + 1]! - oy + 0.5) * SS - 0.5));
      return arr;
    };
    const fill = (polys: number[][]) => {
      const vec = sc.keep(new cv.MatVector());
      for (const p of polys) {
        const mat = sc.keep(cv.matFromArray(p.length / 2, 1, cv.CV_32SC2, p));
        vec.push_back(mat);
      }
      cv.fillPoly(m, vec, new cv.Scalar(255));
    };
    const bp = toPts(bottom);
    const tp = toPts(top);
    fill([bp]);
    fill([tp]);
    const n = bp.length / 2;
    const quads: number[][] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      quads.push([bp[2 * i]!, bp[2 * i + 1]!, bp[2 * j]!, bp[2 * j + 1]!, tp[2 * j]!, tp[2 * j + 1]!, tp[2 * i]!, tp[2 * i + 1]!]);
    }
    // fillPoly with many small polygons at once (each is convex or nearly).
    for (let k = 0; k < quads.length; k += 256) fill(quads.slice(k, k + 256));
    const contours = sc.keep(new cv.MatVector());
    const hier = sc.keep(new cv.Mat());
    cv.findContours(m, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
    let best: number[] = [];
    let bestN = 0;
    const nc = contours.size() as number;
    for (let i = 0; i < nc; i++) {
      const c = sc.keep(contours.get(i));
      if (c.rows > bestN) {
        bestN = c.rows;
        const d: Int32Array = c.data32S;
        best = [];
        // Contour points are the centres of the outermost inside mask pixels.
        for (let k = 0; k < d.length; k += 2) best.push(ox - 0.5 + (d[k]! + 0.5) / SS, oy - 0.5 + (d[k + 1]! + 0.5) / SS);
      }
    }
    return best;
  });
}
