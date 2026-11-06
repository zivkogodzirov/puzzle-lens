/**
 * Puzzle data (PLAN §4), stored in IndexedDB (src/db/db.ts, schema version 2).
 * Shared by the screens and the workers: keep it free of DOM-only APIs.
 *
 * Coordinate conventions (PLAN §3.2):
 * - "img" = pixels of one photo (x right, y down, pixel centres at .5 like OpenCV).
 * - "table" = millimetres on the table, fixed by the marker map: origin at marker 0's centre,
 *   x along marker 0's top edge, y towards its bottom edge.
 * - Homographies are 3 × 3, row-major, 9 numbers, and always named by direction (e.g. imgToTable).
 */

export type Vec2 = [number, number];
/** 3 × 3 homography, row-major. */
export type Mat3 = number[];

export interface MarkerPlacement {
  id: number;
  /** The 4 corners of the black square in table mm (OpenCV order). */
  cornersMm: Vec2[];
}

export interface MarkerMap {
  dictionary: 'DICT_4X4_50';
  /** Printed marker size the map assumes (mm, after the owner's ruler check). */
  markerSizeMm: number;
  /** Printer scale from the ruler check (1 = printed at 100 %). */
  printScale: number;
  markers: MarkerPlacement[];
  /** How well the map photo agreed with square markers (RMS, mm). */
  rmsMm: number;
  createdAt: number;
  /** The snap it was measured from. */
  snapId: string;
}

export interface Grid {
  cols: number;
  rows: number;
  source: 'suggested' | 'manual';
}

export interface BoxPicture {
  /** blobs table ids. */
  photoBlobId: string;
  rectifiedBlobId: string;
  /** Corners in the photo (px), top-left, top-right, bottom-right, bottom-left. */
  corners: Vec2[];
  photoWidth: number;
  photoHeight: number;
  /** Size of the rectified picture (px). */
  width: number;
  height: number;
}

/** What the empty table looks like (learned from one photo; RESEARCH §6). */
export interface TableModel {
  /** Mean and covariance (3 × 3 row-major) of the table in CIE Lab (L 0–100). */
  meanLab: [number, number, number];
  covLab: number[];
  /** Coarse brightness map over the table (table mm grid), for the lighting field. */
  map: { originMm: Vec2; cellMm: number; cols: number; rows: number; L: number[] } | null;
  /** Glare seen in the empty-table photo (share of the sorting area). */
  glareShare: number;
  snapId: string;
  createdAt: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Piece count printed on the box. */
  pieceCount: number;
  grid: Grid | null;
  box: BoxPicture | null;
  markerMap: MarkerMap | null;
  tableModel: TableModel | null;
  /** Measured piece pitch (median cell size in mm) and how many pieces it came from. */
  piecePitch: { wMm: number; hMm: number; n: number } | null;
  /** Wizard progress: the next step to show (0–6; 6 = done). */
  setupStep: number;
  /**
   * How photos are placed on the table: 'pieces' (no printing: the pieces themselves are the
   * reference; default) or 'markers' (printed marker cards). Missing = 'pieces'.
   */
  tracking?: 'pieces' | 'markers';
}

export type PieceStatus = 'table' | 'tray' | 'placed' | 'missing' | 'pending';

export interface PieceFlags {
  /** Probably two or more touching pieces ("spread these apart"). */
  clump?: boolean;
  /** Partly outside the photo or under a marker card. */
  cut?: boolean;
  /** Glare covered part of it in every photo so far. */
  glare?: boolean;
  /** Pale piece with a weak outline: shown with a "check" mark. */
  weak?: boolean;
}

export interface PieceRow {
  id: string;
  projectId: string;
  createdAt: number;
  updatedAt: number;
  status: PieceStatus;
  /** Centre on the table (mm), outline angle (deg), last seen (ms), photo it was last seen in. */
  table: { x: number; y: number; angleDeg: number; lastSeen: number; snapId: string };
  /** Outline in table mm, flat [x0, y0, x1, y1, …], relative to the centre. */
  outlineMm: number[];
  areaMm2: number;
  /** Size of the piece's bounding box along its own axes (mm). */
  sizeMm: Vec2;
  /** Mean colour (Lab) of the printed face and a coarse 8-bin hue histogram. */
  colour: { meanLab: [number, number, number]; hueHist: number[] };
  /** blobs id of the thumbnail JPEG. */
  thumbBlobId: string | null;
  /** How many photos have seen it. */
  seen: number;
  /** Pixels per mm of the best photo so far (overview ≈ 5, close-up ≈ 10). */
  bestPxPerMm: number;
  flags: PieceFlags;
}

export type SnapKind = 'overview' | 'detail' | 'empty-table' | 'marker-map' | 'box';

export interface PhotoQuality {
  ok: boolean;
  /** Plain-English reasons when not ok (e.g. "Blurred: hold still"). */
  reasons: string[];
  sharpness: number;
  clippedShare: number;
  /** Share of the sorting area under glare. */
  glareShare: number;
  tiltDeg: number | null;
  heightMm: number | null;
  markersSeen: number;
}

export interface SnapRow {
  id: string;
  projectId: string;
  kind: SnapKind;
  ts: number;
  width: number;
  height: number;
  zoom: number;
  /** Photo pixels → table mm, when markers were found. */
  imgToTable: Mat3 | null;
  quality: PhotoQuality | null;
  /** blobs id of the photo itself (kept for box / marker-map / empty-table; overview kept until replaced). */
  blobId: string | null;
  pieceIds: string[];
}
