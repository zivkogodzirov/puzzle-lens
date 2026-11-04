/**
 * The owner's real photos in test/fixtures/real/ (kept out of git, see that folder's README).
 * Tests that use them must skip cleanly when the folder is empty (always the case on GitHub).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PixelBuffer } from '../../src/cv/frameAnalyser';

export const REAL_DIR = fileURLToPath(new URL('../fixtures/real/', import.meta.url));

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

export interface RealPhoto {
  name: string;
  path: string;
  /** Optional hand-made labels from `<photo name>.json` next to the photo. */
  labels: RealLabels | null;
}

export interface RealLabels {
  /** ArUco DICT_4X4_50 marker ids clearly visible in the photo. */
  markers?: number[];
  /** Free-text note, e.g. "box photo, 1x, daylight". */
  note?: string;
}

export function listRealPhotos(): RealPhoto[] {
  if (!existsSync(REAL_DIR)) return [];
  return readdirSync(REAL_DIR)
    .filter((f) => IMAGE_EXT.test(f))
    .sort()
    .map((name) => {
      const path = join(REAL_DIR, name);
      const labelPath = `${path}.json`;
      const labels = existsSync(labelPath) ? (JSON.parse(readFileSync(labelPath, 'utf8')) as RealLabels) : null;
      return { name, path, labels };
    });
}

/** Decodes a JPEG/PNG/WebP to RGBA with @napi-rs/canvas (dev dependency; tests only). */
export async function decodeRgba(path: string): Promise<PixelBuffer> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(readFileSync(path));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: img.width, height: img.height, stride: img.width * 4 };
}
