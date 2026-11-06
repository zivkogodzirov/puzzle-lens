/**
 * "Where is this camera frame on the table?" — from the markers seen in one frame and the
 * marker map (PLAN §3.3 "Markers → table mapping"). Pure maths; runs in the tracker worker
 * for every live frame and in the reader for every photo.
 */
import type { MarkerMap, Mat3, Vec2 } from '../project/types';
import { fitHomographyGroups, invertH } from './homography';
import { nominalIntrinsics, poseFromHomography } from './pose';

export interface TableFix {
  /** Image px → table mm. */
  imgToTable: Mat3;
  tableToImg: Mat3;
  tiltDeg: number;
  heightMm: number;
  /** Table point under the image centre (mm). */
  centreMm: Vec2;
  /** Image-space direction the phone leans (unit vector), for the level bubble. */
  leanImg: Vec2;
  /** Markers used, and markers ignored because they disagree with the rest (moved?). */
  used: number[];
  dropped: number[];
  /** Corner fit error in mm (RMS) — 0 when only one marker is seen. */
  rmsMm: number;
  /** Pixels per mm at the image centre. */
  pxPerMm: number;
}

/** A marker that disagrees with the others by more than this is treated as moved. */
export const MOVED_MARKER_MM = 4;

export function locateOnTable(
  markers: Array<{ id: number; corners: number[] }>,
  map: MarkerMap,
  frame: { width: number; height: number },
  zoom = 1,
): TableFix | null {
  const byId = new Map(map.markers.map((m) => [m.id, m.cornersMm]));
  const groups = markers
    .filter((m) => byId.has(m.id) && m.corners.length === 8)
    .map((m) => ({
      key: m.id,
      src: [0, 1, 2, 3].map((k): Vec2 => [m.corners[2 * k]!, m.corners[2 * k + 1]!]),
      dst: byId.get(m.id)!,
    }));
  // Same marker twice in a frame (misread): keep the first.
  const seen = new Set<number>();
  const unique = groups.filter((g) => (seen.has(g.key) ? false : (seen.add(g.key), true)));
  if (!unique.length) return null;
  const fit = fitHomographyGroups(unique, MOVED_MARKER_MM);
  if (!fit) return null;
  const tableToImg = invertH(fit.H);
  if (!tableToImg) return null;
  const pose = poseFromHomography(tableToImg, nominalIntrinsics(frame.width, frame.height, zoom));
  if (!pose || !Number.isFinite(pose.tiltDeg) || !Number.isFinite(pose.heightMm)) return null;
  // Scale at the image centre: how far 1 mm moves in pixels.
  const c = pose.centreMm;
  const a = project(tableToImg, c);
  const b = project(tableToImg, [c[0] + 1, c[1]]);
  const d = project(tableToImg, [c[0], c[1] + 1]);
  const pxPerMm = (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(d[0] - a[0], d[1] - a[1])) / 2;
  return {
    imgToTable: fit.H,
    tableToImg,
    tiltDeg: pose.tiltDeg,
    heightMm: pose.heightMm,
    centreMm: pose.centreMm,
    leanImg: pose.leanImg,
    used: fit.used,
    dropped: fit.dropped,
    rmsMm: fit.rms,
    pxPerMm,
  };
}

function project(H: Mat3, p: Vec2): Vec2 {
  const w = H[6]! * p[0] + H[7]! * p[1] + H[8]!;
  return [(H[0]! * p[0] + H[1]! * p[1] + H[2]!) / w, (H[3]! * p[0] + H[4]! * p[1] + H[5]!) / w];
}
