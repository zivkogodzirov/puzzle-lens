/**
 * Writes a few preview JPEGs (whole photos plus 1:1 crops) so a human can look at the generator.
 *
 *   node test/synth/run-preview.mjs [outDir]
 *
 * (Runs this file through Vite's module runner; no extra tools needed.) Default output folder:
 * test/synth/out/ (git-ignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { generatePuzzle, renderScene, type SceneOptions, type SynthScene } from './index';
import { bbox } from './raster';

const outDir = process.env.SYNTH_PREVIEW_DIR || join(process.cwd(), 'test/synth/out');
mkdirSync(outDir, { recursive: true });

function crop(scene: SynthScene, cx: number, cy: number, w: number, h: number, name: string): void {
  const x0 = Math.max(0, Math.min(scene.width - w, Math.round(cx - w / 2)));
  const y0 = Math.max(0, Math.min(scene.height - h, Math.round(cy - h / 2)));
  const c = createCanvas(w, h);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(scene.rgba.subarray(((y0 + y) * scene.width + x0) * 4, ((y0 + y) * scene.width + x0 + w) * 4), y * w * 4);
  c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  writeFileSync(join(outDir, name), c.encodeSync('jpeg', 95));
}

function palestVisible(scene: SynthScene, puzzle: ReturnType<typeof generatePuzzle>): { x: number; y: number } {
  let best = { x: scene.width / 2, y: scene.height / 2, lum: -1 };
  for (const p of scene.truth.pieces) {
    if (p.visibleShare < 1 || p.faceDown) continue;
    const sp = puzzle.pieces.find((q) => q.id === p.id)!;
    const [ppx, ppy] = puzzle.art.pxPerMm;
    const x = Math.floor((sp.col + 0.5) * puzzle.cellMm[0] * ppx);
    const y = Math.floor((sp.row + 0.5) * puzzle.cellMm[1] * ppy);
    const k = (y * puzzle.art.width + x) * 4;
    const lum = puzzle.art.rgba[k]! + puzzle.art.rgba[k + 1]! + puzzle.art.rgba[k + 2]!;
    if (lum > best.lum) {
      const b = bbox(p.outlineImg);
      best = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, lum };
    }
  }
  return best;
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const p300 = generatePuzzle({ cols: 15, rows: 20, cellMm: [17.8, 19.4], seed: 11 });
  console.log(`puzzle 300: ${(performance.now() - t0).toFixed(0)} ms, art ${p300.art.width}×${p300.art.height}`);
  writeFileSync(join(outDir, 'art-300.jpg'), (() => {
    const c = createCanvas(p300.art.width, p300.art.height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(p300.art.rgba), p300.art.width, p300.art.height), 0, 0);
    return c.encodeSync('jpeg', 90);
  })());

  const base: Omit<SceneOptions, 'camera'> = {
    puzzle: p300,
    seed: 5,
    layout: { areaMm: [700, 500], touchingShare: 0.03, faceDownShare: 0.02 },
    light: { dirDeg: 200, glare: { lampMm: [300, 900, 1400] } },
    handShadow: true,
  };
  const shots: Array<{ name: string; opts: SceneOptions }> = [
    { name: 'overview-1x', opts: { ...base, camera: { x: 405, y: 305, heightMm: 700, tiltDeg: 2, tiltDirDeg: 60, zoom: 1 } } },
    { name: 'detail-2x', opts: { ...base, camera: { x: 300, y: 240, heightMm: 620, tiltDeg: 8, tiltDirDeg: 200, zoom: 2 } } },
  ];
  for (const s of shots) {
    const scene = await renderScene(s.opts);
    const tm = Object.entries(scene.timings).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ');
    console.log(`${s.name}: ${scene.width}×${scene.height}, ${scene.truth.pieces.length} pieces, glare ${(scene.truth.glareMaskShare * 100).toFixed(2)} % — ${tm}`);
    writeFileSync(join(outDir, `${s.name}.jpg`), scene.jpeg);
    const pale = palestVisible(scene, p300);
    crop(scene, pale.x, pale.y, 900, 700, `${s.name}-crop-pale.jpg`);
    const m = scene.truth.markers.find((mk) => mk.cornersImg.every((v, i) => v > 0 && v < (i % 2 ? scene.height : scene.width)));
    if (m) crop(scene, (m.cornersImg[0]! + m.cornersImg[4]!) / 2, (m.cornersImg[1]! + m.cornersImg[5]!) / 2, 900, 700, `${s.name}-crop-marker.jpg`);
    const touch = scene.truth.pieces.find((p) => p.touching.length && p.visibleShare === 1);
    if (touch) {
      const b = bbox(touch.outlineImg);
      crop(scene, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 900, 700, `${s.name}-crop-touching.jpg`);
    }
  }

  const p48 = generatePuzzle({ cols: 8, rows: 6, cellMm: [17.8, 19.4], seed: 3, cut: 'uniform' });
  const small = await renderScene({
    puzzle: p48,
    seed: 2,
    layout: { areaMm: [700, 500] },
    camera: { x: 405, y: 305, heightMm: 620, tiltDeg: 2, imageSize: [1008, 756] },
  });
  writeFileSync(join(outDir, 'small-48-1008.jpg'), small.jpeg);
  console.log(`small: ${small.timings.total!.toFixed(0)} ms; written to ${outDir}`);
}

await main();
