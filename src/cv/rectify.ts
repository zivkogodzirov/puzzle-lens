/**
 * Box picture: straighten ("rectify") a photo of the box picture from its 4 corners, and an
 * automatic first guess of those corners (PLAN §5 wizard step 2, RESEARCH §9).
 * Runs in the reader worker and in Node tests. Every OpenCV object is freed through withScope.
 *
 * The picture's true shape (width : height) is worked out from the corner geometry with the
 * whiteboard method of Zhang & He (2004): a photographed rectangle's 4 corners, with the camera's
 * centre at the image centre, determine the camera's focal length and the rectangle's aspect.
 * When the photo is taken nearly straight on, the focal length can't be recovered; a typical
 * iPhone main-camera value is used instead (the aspect then barely depends on it).
 */
import { cvGuard, type Cv } from './loadCv';
import { withScope } from './scope';
import { copyRows, type PixelBuffer } from './frameAnalyser';

export type Point = [number, number];

export interface RectifyOptions {
  /** Longest side of the result (px). */
  maxSide?: number;
  /** Size of the whole photo the corners refer to (for the camera centre), if `img` is a crop of it. */
  imageSize?: { width: number; height: number };
  /** Where `img` starts inside the whole photo (px), if it is a crop. */
  offset?: Point;
  /** Known focal length in photo px (else estimated). */
  focalPx?: number;
}

export interface RectifiedImage {
  /** RGBA pixels, width × height × 4, continuous. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Width : height of the picture, from the corner geometry. */
  aspect: number;
  /** How the aspect was found. */
  aspectMethod: AspectEstimate['method'];
}

/** The reader's answer to rectifyBox (src/shared/apis.ts). */
export interface RectifyBoxResult {
  jpeg: Blob;
  width: number;
  height: number;
  aspect: number;
  /** Full size of the photo (px, the right way up). */
  photoWidth: number;
  photoHeight: number;
  /** The corners in photo px (top-left, top-right, bottom-right, bottom-left). */
  cornersPx: Point[];
  ms: number;
}

export const RECTIFIED_MAX_SIDE = 2048;
/** iPhone main camera (26 mm equivalent): focal length ≈ 0.8 × the long side in px. */
export const DEFAULT_FOCAL_FACTOR = 0.8;

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross2 = (a: Point, b: Point): number => a[0] * b[1] - a[1] * b[0];

/** Corners as top-left, top-right, bottom-right, bottom-left (by position in the photo). */
export function orderCorners(points: Point[]): Point[] {
  if (points.length !== 4) throw new Error('Need exactly 4 corners');
  const cx = points.reduce((s, p) => s + p[0], 0) / 4;
  const cy = points.reduce((s, p) => s + p[1], 0) / 4;
  // Sort by angle around the centre (clockwise on screen, y down), then start at the top-left.
  const sorted = [...points].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let start = 0;
  for (let i = 1; i < 4; i++) if (sorted[i]![0] + sorted[i]![1] < sorted[start]![0] + sorted[start]![1]) start = i;
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]!);
}

/**
 * Checks that 4 corners (TL, TR, BR, BL) make a usable picture outline. Returns a problem in
 * words, or null. `minArea` is the smallest area allowed (same units squared).
 */
export function checkQuad(c: Point[], minArea = 0): string | null {
  if (c.length !== 4 || c.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return 'The four corners are missing.';
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const z = cross2(sub(c[(i + 1) % 4]!, c[i]!), sub(c[(i + 2) % 4]!, c[(i + 1) % 4]!));
    if (Math.abs(z) < 1e-12) return 'Three corners are in a straight line. Drag each dot to a corner of the picture.';
    const s = Math.sign(z);
    if (sign && s !== sign) return 'The outline crosses over itself. Drag each dot to its own corner of the picture.';
    sign = s;
  }
  let area = 0;
  for (let i = 0; i < 4; i++) area += cross2(c[i]!, c[(i + 1) % 4]!);
  if (Math.abs(area) / 2 <= minArea) return 'The outline is too small. Drag the dots out to the corners of the picture.';
  return null;
}

export interface AspectEstimate {
  /** Width : height. */
  aspect: number;
  focalPx: number;
  method: 'perspective' | 'default-focal' | 'given-focal';
}

/**
 * Width : height of the real rectangle whose photo has corners `c` (TL, TR, BR, BL, photo px),
 * for a photo of `w × h` px (camera centre at its middle). Zhang & He, "Whiteboard scanning and
 * image enhancement" (2004), §2.
 */
export function estimateAspect(c: Point[], w: number, h: number, focalPx?: number): AspectEstimate {
  const u0 = w / 2;
  const v0 = h / 2;
  const hom = (p: Point): [number, number, number] => [p[0] - u0, p[1] - v0, 1];
  // Zhang & He number the corners m1 = TL, m2 = TR, m3 = BL, m4 = BR.
  const m1 = hom(c[0]!);
  const m2 = hom(c[1]!);
  const m4 = hom(c[2]!);
  const m3 = hom(c[3]!);
  const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = m2.map((v, i) => k2 * v - m1[i]!);
  const n3 = m3.map((v, i) => k3 * v - m1[i]!);
  const ratio = (f: number) => Math.sqrt((n2[0]! ** 2 + n2[1]! ** 2 + f * f * n2[2]! ** 2) / (n3[0]! ** 2 + n3[1]! ** 2 + f * f * n3[2]! ** 2));
  const long = Math.max(w, h);
  if (focalPx && focalPx > 0) return { aspect: ratio(focalPx), focalPx, method: 'given-focal' };
  const f2 = -(n2[0]! * n3[0]! + n2[1]! * n3[1]!) / (n2[2]! * n3[2]!);
  // The focal length can only be measured when BOTH pairs of sides visibly converge (each side
  // pair's perspective term, relative to the photo size, above ~3 %); then a believable phone
  // value (0.5–2 × the long side) is accepted.
  const persp2 = (Math.abs(n2[2]!) * long) / Math.hypot(n2[0]!, n2[1]!);
  const persp3 = (Math.abs(n3[2]!) * long) / Math.hypot(n3[0]!, n3[1]!);
  if (persp2 > 0.03 && persp3 > 0.03 && Number.isFinite(f2) && f2 > 0) {
    const f = Math.sqrt(f2);
    if (f > 0.5 * long && f < 2 * long) {
      const a = ratio(f);
      if (Number.isFinite(a) && a > 0) return { aspect: a, focalPx: f, method: 'perspective' };
    }
  }
  const f = DEFAULT_FOCAL_FACTOR * long;
  const a = ratio(f);
  if (Number.isFinite(a) && a > 0) return { aspect: a, focalPx: f, method: 'default-focal' };
  // Last resort: mean side lengths.
  return { aspect: (dist(c[0]!, c[1]!) + dist(c[3]!, c[2]!)) / (dist(c[0]!, c[3]!) + dist(c[1]!, c[2]!)), focalPx: f, method: 'default-focal' };
}

/** Output size: the given aspect, about as many pixels as the photo has across the picture, at most `maxSide`. */
export function rectifiedSize(c: Point[], aspect: number, maxSide = RECTIFIED_MAX_SIDE): { width: number; height: number } {
  const seen = Math.max(dist(c[0]!, c[1]!), dist(c[3]!, c[2]!), dist(c[0]!, c[3]!), dist(c[1]!, c[2]!));
  const long = Math.max(16, Math.min(maxSide, Math.round(seen)));
  return aspect >= 1
    ? { width: long, height: Math.max(1, Math.round(long / aspect)) }
    : { width: Math.max(1, Math.round(long * aspect)), height: long };
}

/**
 * Straightens the picture inside `corners` (TL, TR, BR, BL; px of the whole photo). `img` is the
 * photo or a crop of it (see options.offset / imageSize). Returns continuous RGBA pixels.
 */
export function rectifyQuad(cv: Cv, img: PixelBuffer, order: 'RGBA' | 'BGRA', corners: Point[], opts: RectifyOptions = {}): RectifiedImage {
  const problem = checkQuad(corners, 16);
  if (problem) throw new Error(problem);
  const size = opts.imageSize ?? { width: img.width, height: img.height };
  const est = estimateAspect(corners, size.width, size.height, opts.focalPx);
  const out = rectifiedSize(corners, est.aspect, opts.maxSide ?? RECTIFIED_MAX_SIDE);
  const [ox, oy] = opts.offset ?? [0, 0];
  return cvGuard(cv, () =>
    withScope((s) => {
      const src = s.keep(new cv.Mat(img.height, img.width, cv.CV_8UC4));
      copyRows(src, img, 4);
      const from = s.keep(cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap(([x, y]) => [x - ox, y - oy])));
      const W = out.width;
      const H = out.height;
      const to = s.keep(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]));
      const M = s.keep(cv.getPerspectiveTransform(from, to));
      const warped = s.keep(new cv.Mat());
      cv.warpPerspective(src, warped, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar(255, 255, 255, 255));
      let rgba = warped;
      if (order === 'BGRA') {
        rgba = s.keep(new cv.Mat());
        cv.cvtColor(warped, rgba, cv.COLOR_BGRA2RGBA);
      }
      // Fully opaque, copied out of WebAssembly memory.
      const data = new Uint8ClampedArray(rgba.data as Uint8Array);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      return { data, width: W, height: H, aspect: est.aspect, aspectMethod: est.method };
    }),
  );
}

/** The starting outline when nothing better is known: 12 % in from each edge (normalised 0–1). */
export function defaultCorners(): Point[] {
  return [
    [0.12, 0.12],
    [0.88, 0.12],
    [0.88, 0.88],
    [0.12, 0.88],
  ];
}

/**
 * A first guess of the box picture's corners (normalised 0–1, TL, TR, BR, BL), or null if no clear
 * 4-sided outline covering at least 15 % of the photo is found. The owner always checks and drags.
 * Looks for the biggest 4-cornered outline among strong edges, on a copy at most 640 px across.
 */
export function findBoxQuad(cv: Cv, img: PixelBuffer, order: 'RGBA' | 'BGRA'): Point[] | null {
  return cvGuard(cv, () =>
    withScope((s) => {
      const src = s.keep(new cv.Mat(img.height, img.width, cv.CV_8UC4));
      copyRows(src, img, 4);
      const gray = s.keep(new cv.Mat());
      cv.cvtColor(src, gray, order === 'RGBA' ? cv.COLOR_RGBA2GRAY : cv.COLOR_BGRA2GRAY);
      const scale = Math.min(1, 640 / Math.max(img.width, img.height));
      let small = gray;
      if (scale < 1) {
        small = s.keep(new cv.Mat());
        cv.resize(gray, small, new cv.Size(Math.round(img.width * scale), Math.round(img.height * scale)), 0, 0, cv.INTER_AREA);
      }
      const W = small.cols as number;
      const H = small.rows as number;
      const blur = s.keep(new cv.Mat());
      cv.GaussianBlur(small, blur, new cv.Size(5, 5), 0);
      const edges = s.keep(new cv.Mat());
      cv.Canny(blur, edges, 40, 120);
      const kernel = s.keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
      const contours = s.keep(new cv.MatVector());
      const hierarchy = s.keep(new cv.Mat());
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      let best: Point[] | null = null;
      let bestArea = 0.15 * W * H;
      const n = contours.size() as number;
      for (let i = 0; i < n; i++) {
        const contour = s.keep(contours.get(i));
        const hull = s.keep(new cv.Mat());
        cv.convexHull(contour, hull, false, true);
        const area = cv.contourArea(hull) as number;
        if (area <= bestArea) continue;
        const peri = cv.arcLength(hull, true) as number;
        let quad: Point[] | null = null;
        for (const eps of [0.02, 0.03, 0.05, 0.08]) {
          const approx = s.keep(new cv.Mat());
          cv.approxPolyDP(hull, approx, eps * peri, true);
          if (approx.rows === 4) {
            const d = approx.data32S as Int32Array;
            quad = [0, 1, 2, 3].map((k) => [d[2 * k]!, d[2 * k + 1]!] as Point);
            break;
          }
        }
        if (!quad) {
          // Fall back to the tightest rotated rectangle around the outline.
          const rect = cv.minAreaRect(hull);
          const pts = cv.RotatedRect.points(rect) as Array<{ x: number; y: number }>;
          quad = pts.map((p) => [p.x, p.y] as Point);
        }
        const ordered = orderCorners(quad);
        if (checkQuad(ordered)) continue;
        best = ordered;
        bestArea = area;
      }
      if (!best) return null;
      return best.map(([x, y]) => [Math.min(1, Math.max(0, (x + 0.5) / W)), Math.min(1, Math.max(0, (y + 0.5) / H))] as Point);
    }),
  );
}

/** Decodes a photo (the right way up) so its long side is at most `maxSide` px. Worker or page; not Node. */
export async function decodeAtMost(blob: Blob, size: { width: number; height: number } | null, maxSide: number): Promise<ImageBitmap> {
  if (!size) {
    const probe = await createImageBitmap(blob);
    if (Math.max(probe.width, probe.height) <= maxSide) return probe;
    size = { width: probe.width, height: probe.height };
    probe.close();
  }
  const s = Math.min(1, maxSide / Math.max(size.width, size.height));
  if (s >= 1) return createImageBitmap(blob);
  return createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(size.width * s)), resizeHeight: Math.max(1, Math.round(size.height * s)), resizeQuality: 'high' });
}
