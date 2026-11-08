/**
 * IMG_9272 (owner, 2026-11-08): the finished Ravensburger "The Kiss" (1000 pieces, 50 × 70 cm) on
 * the cream table, photographed from above at 1×, every seam visible. Kept out of git like the
 * other real photos (test/fixtures/real); skipped when absent.
 *
 * Ground truth it gives: the picture outline, its true shape (500 : 700) and the grid (28 × 36),
 * checked here with the app's own outline finder and straightening. The seam count is measured on
 * the straightened picture: thin dark lines projected on each axis, period by autocorrelation.
 */
import { describe, expect, it } from 'vitest';
import { findBoxQuad, rectifyQuad, type Point } from '../../src/cv/rectify';
import { scanMarkerless } from '../../src/cv/scanMarkerless';
import { getCv } from '../helpers/cv';
import { resizeBuffer } from '../helpers/images';
import { decodeRgba, listRealPhotos } from '../helpers/realFixtures';

const photo = listRealPhotos().find((p) => p.name.startsWith('IMG_9272'));

/** Strongest repeat length (px) of a profile within [lo, hi]. */
function period(p: Float64Array, lo: number, hi: number): number {
  const n = p.length;
  const mean = p.reduce((a, b) => a + b, 0) / n;
  let best = -Infinity;
  let at = lo;
  for (let l = lo; l <= hi; l++) {
    let s = 0;
    for (let i = 0; i + l < n; i++) s += (p[i]! - mean) * (p[i + l]! - mean);
    s /= n - l;
    if (s > best) [best, at] = [s, l];
  }
  return at;
}

function polyArea(o: ArrayLike<number>): number {
  let a = 0;
  for (let i = 0, n = o.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += o[i]! * o[j + 1]! - o[j]! * o[i + 1]!;
  }
  return a / 2;
}

function insideQuad(q: Point[], x: number, y: number): boolean {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i]!;
    const [bx, by] = q[(i + 1) % 4]!;
    const c = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    if (s && c && c !== s) return false;
    if (c) s = c;
  }
  return true;
}

describe.skipIf(!photo)('real photo: the finished puzzle', () => {
  it('IMG_9272: outline found, true 50 × 70 shape, seams show 28 × 36 pieces, scanned as one assembled area', async () => {
    const cv = await getCv();
    let img = await decodeRgba(photo!.path);
    const k = 4032 / Math.max(img.width, img.height);
    if (k < 1) img = resizeBuffer(cv, img, 4, Math.round(img.width * k), Math.round(img.height * k), cv.INTER_AREA);
    const q = findBoxQuad(cv, img, 'RGBA');
    expect(q).not.toBeNull();
    const corners = q!.map(([x, y]) => [x * img.width, y * img.height] as Point);
    const rect = rectifyQuad(cv, img, 'RGBA', corners, { maxSide: 4032 });
    expect(Math.abs(rect.aspect / (500 / 700) - 1), `${rect.aspect}`).toBeLessThan(0.02);

    const { width: W, height: H, data } = rect;
    const g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
    const R = 3;
    const m = Math.round(0.03 * Math.min(W, H));
    const px = new Float64Array(W);
    const py = new Float64Array(H);
    for (let y = m; y < H - m; y++)
      for (let x = m; x < W - m; x++) {
        const v = g[y * W + x]!;
        px[x] = px[x]! + Math.max(0, Math.min(g[y * W + x - R]!, g[y * W + x + R]!) - v);
        py[y] = py[y]! + Math.max(0, Math.min(g[(y - R) * W + x]!, g[(y + R) * W + x]!) - v);
      }
    const cols = W / period(px, Math.round(W / 40), Math.round(W / 20));
    const rows = H / period(py, Math.round(H / 50), Math.round(H / 25));
    expect(Math.abs(cols - 28), `cols ${cols}`).toBeLessThan(0.5);
    expect(Math.abs(rows - 36), `rows ${rows}`).toBeLessThan(0.5);

    // The scan sees the whole finished puzzle as one assembled area, with no loose pieces on it.
    // (Before 2026-11-08 the part where the puzzle nearly touches the photo's edge was taken as off
    // the table: ~70 % found, and 3 bits listed as pieces.)
    const r = scanMarkerless(cv, img, { catalog: [], zoom: 1, kind: 'overview', table: null });
    const quadArea = Math.abs(polyArea(corners.flat()));
    const assembled = r.regions.filter((g) => g.kind === 'assembled');
    const covered = assembled.reduce((a, g) => a + Math.abs(polyArea(g.outlineImg)), 0);
    expect(covered / quadArea, 'share of the puzzle seen as assembled').toBeGreaterThan(0.95);
    expect(covered / quadArea).toBeLessThan(1.05);
    const inside = r.pieces.filter((p) => insideQuad(corners, p.bboxImg[0]! + p.bboxImg[2]! / 2, p.bboxImg[1]! + p.bboxImg[3]! / 2));
    expect(inside.length, 'loose pieces reported on the puzzle').toBe(0);
  }, 300_000);
});
