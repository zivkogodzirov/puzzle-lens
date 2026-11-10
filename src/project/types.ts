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
  /**
   * Does the box picture show exactly the puzzle (the owner's answer, M4)? 'exact'; 'frame' (it had
   * a frame or white border: the corners were put inside it); 'differs' (the box shows a little
   * more or less than the puzzle); 'unsure'. Absent: not asked yet.
   */
  border?: 'exact' | 'frame' | 'differs' | 'unsure';
  /** The owner said "Not now" to a box-to-grid correction for this box picture (asked again after a new one). */
  fitDismissed?: boolean;
  /** Box-to-grid corrections applied to this box photo so far. */
  fitted?: number;
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
  /** The coin put next to the pieces for true size (src/cv/coin.ts MK_COINS id), or null. */
  coin?: string | null;
  /** Where sizes in mm come from: a measured coin, printed markers, or the typical-piece estimate. */
  scaleSource?: 'coin' | 'markers' | 'estimate';
  /**
   * The empty spots of the nearly finished puzzle, from the last photo of it with gaps (M4): the
   * leftover pieces are placed only there. Null when none (or the owner chose the whole picture).
   */
  openSpots?: OpenSpots | null;
  /** Sorting into trays by colour (M4): how many groups, and their colours once a tray is filled. */
  trays?: TraySetup | null;
  /** Fits / Doesn't fit answers (M5 part 2), oldest first (src/project/answers.ts). */
  answers?: SpotAnswer[];
  /** Pairs the owner joined, or said don't join (M6), oldest first (src/project/answers.ts). */
  pairAnswers?: PairAnswer[];
  /**
   * The batch on the table now (M7, src/project/batches.ts): its number (from 1) and when it was
   * started. Photos taken before `startedAt` belong to earlier batches (another table layout).
   * Missing = batch 1, started with the puzzle.
   */
  batch?: { n: number; startedAt: number } | null;
  /**
   * The last backup taken off the phone (M7 part 3: shared or downloaded), with how much there was
   * then; and "Not now" on the reminder (until when). src/project/backupReminder.ts.
   */
  lastBackup?: { at: number; pieces: number; answers: number } | null;
  /** When a photo of the puzzle showed it complete, no empty spots (M7 part 4). Cleared by a photo with empty spots. */
  finishedAt?: number | null;
  backupSnoozedUntil?: number | null;
}

/**
 * One answer about two pieces (M6): the owner tried B on A's right (dir 1) or below it (dir 2), as
 * on the box picture.
 */
export interface PairAnswer {
  a: string;
  b: string;
  dir: 1 | 2;
  fits: boolean;
  at: number;
  /** What the app said then: the pair's chance, and whether a closed 2 × 2 square confirmed it. */
  p: number;
  confirmed: boolean;
  /** Where the answer was given. */
  from: 'matches' | 'piece' | 'live';
  /** Taken back (a mistake): left out everywhere. */
  undone?: boolean;
}

export type Verdict = 'strong' | 'likely' | 'several';

/** One answer: the owner tried a piece in a spot (box-picture column and row, 0-based). */
export interface SpotAnswer {
  pieceId: string;
  col: number;
  row: number;
  /** How the piece sat there (quarter turns, as in the placement). */
  rot: 0 | 1 | 2 | 3;
  fits: boolean;
  at: number;
  /** The grid it is for ("28x36"); answers for another grid are ignored. */
  grid: string;
  /** What the app said for the piece then: its verdict, this spot's chance, and the spot's rank (0 = first choice, −1 = not listed). */
  verdict: Verdict;
  p: number;
  rank: number;
  /** Where the answer was given. */
  from: 'piece' | 'fill' | 'live';
  /** Among empty spots, or on the whole picture. */
  mode: 'open' | 'whole';
  /** Taken back (a mistake): left out everywhere. */
  undone?: boolean;
}

/** Trays by colour: one colour group per tray (src/cv/colourGroups.ts). */
export interface TraySetup {
  /** How many groups (2–12). */
  count: number;
  /**
   * The groups' colours (Lab, letter order), fixed when the first pieces go into a tray so the letters
   * never move while trays are being filled. Used only while some piece is in a tray.
   */
  colours: Array<[number, number, number]> | null;
}

/** The empty spots seen in a photo of the nearly finished puzzle. */
export interface OpenSpots {
  /** Columns × rows as counted in the photo (it may show the puzzle turned compared with the box picture). */
  cols: number;
  rows: number;
  /** The empty spots: column, row from the photo's top-left (0-based). */
  gaps: Array<[number, number]>;
  /** Each spot's sides as read from the hole's outline (top, right, bottom, left in the photo; see AssembledGrid.gapSides). */
  gapSides?: string[];
  /** blobs id of the puzzle straightened small (to turn the spots to match the box picture). */
  thumbBlobId: string;
  /** When the photo was read (placements are redone when this changes). */
  ts: number;
}

/**
 * Where a piece is: on the table, in a tray, in the puzzle, no longer seen at its spot (missing),
 * to check (pending, M5 part 3), or set aside when a new batch was started (M7: back in the box,
 * recognised by its picture when it comes back).
 */
export type PieceStatus = 'table' | 'tray' | 'placed' | 'missing' | 'pending' | 'aside';

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
  /**
   * The piece straightened for box placement (M4): blob id of its raw RGBA patch (PATCH_SIZE²),
   * which sides read as flat (patch top, right, bottom, left), whether that read is trusted, and
   * when it was taken (placements are redone when this changes). Absent on pieces scanned before M4.
   */
  patch?: PiecePatchInfo | null;
  /** With status 'tray': the tray's letter (A–L). */
  tray?: string | null;
  /** With status 'pending' (M5 part 3): known pieces this sighting may be (it may have been moved). */
  maybe?: string[] | null;
  /** With status 'placed' (M5 part 2): where it went in, and where it came from (to take it out again). */
  placedAt?: {
    /** Its spot (column, row from 0), or −1, −1 when the owner put it in somewhere the app didn't know (M7 part 4). */
    col: number;
    row: number;
    rot: 0 | 1 | 2 | 3;
    at: number;
    from: 'table' | 'tray';
    tray: string | null;
    /** How it was marked: ✓ Fits on a spot (default), "It's in the puzzle" without a spot, or a new puzzle photo showing its spot filled (M7 part 4). */
    by?: 'answer' | 'tap' | 'photo';
  } | null;
}

export interface PiecePatchInfo {
  blobId: string;
  flats: boolean[];
  sure: boolean;
  ts: number;
  /**
   * Each side's shape (patch top, right, bottom, left): 't' knob out, 'b' knob in, 'f' flat, 'u'
   * not sure; and how sure (0–1). Absent on pieces scanned before M4 part 3.
   */
  sides?: string;
  sideConf?: number[];
  /**
   * The table's colour (sRGB 0–255) right around the piece in the photo the patch came from: the
   * lamp's light there, used to even out colours for trays. Absent on pieces scanned before M4 part 4b.
   */
  light?: [number, number, number];
  /** Its printed picture as a small colour grid, for re-identification (M5 part 3, src/cv/fingerprint.ts). */
  fp?: number[];
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
