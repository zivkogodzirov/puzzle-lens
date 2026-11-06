/**
 * Where the phone is above the table, from the table → image homography (PLAN §2 "Phone"):
 * tilt from straight down, height above the table, and which table point is under the camera.
 * Used by the level-and-height gauge and the photo quality gate.
 *
 * Model: a pinhole camera with focal length f (pixels) and the optical centre in the middle of the
 * image. For the table plane z = 0, H ∝ K [r1 r2 t].
 */
import type { Mat3, Vec2 } from '../project/types';

export interface Intrinsics {
  /** Focal length in pixels. */
  f: number;
  cx: number;
  cy: number;
}

/**
 * The nominal focal length for an iPhone main camera: 24 mm (35 mm-equivalent, Pro models) or
 * 26 mm (others), measured on the diagonal. `zoom` 2 is the 2× crop. Height readings scale with
 * any error here (~5 %), which is fine for guidance; the quality gate's tilt doesn't depend on it
 * much.
 */
export function nominalIntrinsics(width: number, height: number, zoom = 1, equivMm = 24): Intrinsics {
  // From the long side, assuming the 4:3 sensor: a 16:9 live format is a crop of it, so its own
  // diagonal would give a focal length ~8 % short.
  const diagPx = Math.max(width, height) * 1.25;
  const f = (diagPx * equivMm * zoom) / Math.hypot(36, 24);
  return { f, cx: (width - 1) / 2, cy: (height - 1) / 2 };
}

export interface CameraPose {
  /** Angle between the camera's viewing direction and straight down (degrees). */
  tiltDeg: number;
  /** Distance from the camera to the table plane (mm). */
  heightMm: number;
  /** The table point straight below the camera (mm). */
  footMm: Vec2;
  /** Table point at the image centre (mm). */
  centreMm: Vec2;
  /** Which way the phone leans, as an image-space unit vector of the steepest table slope (for the gauge's bubble). */
  leanImg: Vec2;
}

function cross(a: number[], b: number[]): number[] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}
const norm = (a: number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);

/** Camera pose from the table(mm) → image(px) homography. Null if H is unusable. */
export function poseFromHomography(tableToImg: Mat3, K: Intrinsics): CameraPose | null {
  const H = tableToImg;
  // K⁻¹ H columns.
  const col = (c: number) => [(H[c]! - K.cx * H[6 + c]!) / K.f, (H[3 + c]! - K.cy * H[6 + c]!) / K.f, H[6 + c]!];
  const h1 = col(0);
  const h2 = col(1);
  const h3 = col(2);
  const n1 = norm(h1);
  const n2 = norm(h2);
  if (!(n1 > 0 && n2 > 0)) return null;
  let lambda = 2 / (n1 + n2);
  // The table must be in front of the camera (t_z > 0).
  if (h3[2]! * lambda < 0) lambda = -lambda;
  const r1 = h1.map((v) => v * lambda);
  const r2 = h2.map((v) => v * lambda);
  const t = h3.map((v) => v * lambda);
  // Re-orthogonalise r1, r2 (noise), then r3 = table normal in camera coordinates.
  const r3raw = cross(r1, r2);
  const r3 = r3raw.map((v) => v / norm(r3raw));
  // Camera centre in table coordinates: C = −Rᵀ t.
  const R = [r1, r2, r3];
  const C = [0, 1, 2].map((i) => -(R[i]![0]! * t[0]! + R[i]![1]! * t[1]! + R[i]![2]! * t[2]!));
  const heightMm = Math.abs(C[2]!);
  const tiltDeg = (Math.acos(Math.min(1, Math.abs(r3[2]!))) * 180) / Math.PI;
  const inv = invert3(H);
  const centreMm: Vec2 = inv ? project(inv, [K.cx, K.cy]) : [C[0]!, C[1]!];
  // The table normal's direction in the image tells which way the phone leans.
  const lx = r3[0]!;
  const ly = r3[1]!;
  const ln = Math.hypot(lx, ly);
  return {
    tiltDeg,
    heightMm,
    footMm: [C[0]!, C[1]!],
    centreMm,
    leanImg: ln > 1e-9 ? [lx / ln, ly / ln] : [0, 0],
  };
}

function project(H: number[], p: Vec2): Vec2 {
  const w = H[6]! * p[0] + H[7]! * p[1] + H[8]!;
  return [(H[0]! * p[0] + H[1]! * p[1] + H[2]!) / w, (H[3]! * p[0] + H[4]! * p[1] + H[5]!) / w];
}

function invert3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}

/**
 * The table → image homography a camera at `pose` would see. Used by tests and the synthetic
 * generator: camera at (x, y, height) above the table, tilted by `tiltDeg` towards `tiltDirDeg`
 * (0 = towards +x), turned by `yawDeg` about the vertical.
 */
export function homographyForCamera(
  K: Intrinsics,
  cam: { x: number; y: number; heightMm: number; tiltDeg: number; tiltDirDeg?: number; yawDeg?: number },
): Mat3 {
  const yaw = ((cam.yawDeg ?? 0) * Math.PI) / 180;
  const tilt = (cam.tiltDeg * Math.PI) / 180;
  const dir = ((cam.tiltDirDeg ?? 0) * Math.PI) / 180;
  // The table frame is "image-like" (x right, y towards the viewer, as the markers are printed),
  // which makes its third axis point INTO the table. Looking straight down, the camera's axes are
  // then simply the table's: camera x = table x, camera y = table y, camera z = down.
  // Then yaw about the vertical, then tilt about the horizontal axis perpendicular to `dir`.
  const Rz = (a: number) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  const axis = [-Math.sin(dir), Math.cos(dir), 0];
  const Raxis = rodrigues(axis, tilt);
  const down = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // Camera-to-table rotation: Rct = Raxis · Rz(yaw) · down; table-to-camera R = Rctᵀ.
  const Rct = mul3(Raxis, mul3(Rz(yaw), down));
  const R = transpose3(Rct);
  // Above the table = negative z in this frame.
  const C = [cam.x, cam.y, -cam.heightMm];
  const t = [0, 1, 2].map((i) => -(R[i * 3]! * C[0]! + R[i * 3 + 1]! * C[1]! + R[i * 3 + 2]! * C[2]!));
  // H = K [r1 r2 t]
  const M = [R[0]!, R[1]!, t[0]!, R[3]!, R[4]!, t[1]!, R[6]!, R[7]!, t[2]!];
  const Kmat = [K.f, 0, K.cx, 0, K.f, K.cy, 0, 0, 1];
  const H = mul3(Kmat, M);
  return H.map((v) => v / H[8]!);
}

function rodrigues(axis: number[], angle: number): number[] {
  const [x, y, z] = axis as [number, number, number];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}

function mul3(A: number[], B: number[]): number[] {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3]! * B[c]! + A[r * 3 + 1]! * B[3 + c]! + A[r * 3 + 2]! * B[6 + c]!;
  return o;
}

function transpose3(A: number[]): number[] {
  return [A[0]!, A[3]!, A[6]!, A[1]!, A[4]!, A[7]!, A[2]!, A[5]!, A[8]!];
}
