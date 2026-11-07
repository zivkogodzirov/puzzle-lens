/** Test helper: draws a coin (brass or silver, shaded, with relief, a highlight and a contact shadow) onto a photo. */
import { createCanvas } from '@napi-rs/canvas';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';

/**
 * `shiny-brass`: a polished brass coin under a lamp, about as bright as a white/cream table (the
 * owner's 2-denar photo), found by its colour; `stain` adds a grey patch touching it (a damp mark,
 * a shadow) that merges with it in a brightness mask.
 */
export function withCoin(img: PixelBuffer, at: [number, number], diameterPx: number, metal: 'brass' | 'silver' | 'shiny-brass', opts: { stain?: boolean } = {}): PixelBuffer {
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.data.subarray(0, img.width * img.height * 4));
  ctx.putImageData(id, 0, 0);
  const r = diameterPx / 2;
  const g = ctx.createRadialGradient(at[0] - r * 0.3, at[1] - r * 0.3, r * 0.1, at[0], at[1], r);
  if (opts.stain) {
    ctx.fillStyle = 'rgba(90,90,90,0.22)';
    ctx.beginPath();
    ctx.ellipse(at[0] + diameterPx * 1.1, at[1] + diameterPx * 0.2, diameterPx * 1.0, diameterPx * 0.6, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (metal === 'shiny-brass') {
    g.addColorStop(0, '#fff2b8');
    g.addColorStop(0.7, '#ecd27e');
    g.addColorStop(1, '#c9a54a');
  } else if (metal === 'brass') {
    g.addColorStop(0, '#e8d48a');
    g.addColorStop(0.7, '#b8973e');
    g.addColorStop(1, '#8a6d25');
  } else {
    g.addColorStop(0, '#f2f2f2');
    g.addColorStop(0.7, '#a9a9ad');
    g.addColorStop(1, '#6e6e74');
  }
  // A soft contact shadow, then the coin.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.arc(at[0] + 2, at[1] + 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(at[0], at[1], r, 0, Math.PI * 2);
  ctx.fill();
  // Relief: a few darker rings and a bright highlight (the inside is never uniform).
  ctx.strokeStyle = 'rgba(60,40,10,0.5)';
  ctx.lineWidth = Math.max(1, r * 0.04);
  for (const q of [0.85, 0.55]) {
    ctx.beginPath();
    ctx.arc(at[0], at[1], r * q, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(at[0] - r * 0.3, at[1] - r * 0.35, r * 0.25, r * 0.12, -0.6, 0, Math.PI * 2);
  ctx.fill();
  const out = ctx.getImageData(0, 0, img.width, img.height).data;
  return { data: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), width: img.width, height: img.height, stride: img.width * 4 };
}

