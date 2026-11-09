/**
 * The functions each worker offers to the main thread (called through Comlink).
 * Declared here, not in the worker files, so the main thread never imports worker code.
 */
import type { ColourMatch, Placement } from '../cv/placement';
import type { CvBenchResult, PhotoStats, TrackerFrameResult, TrackerStatus, TwoXResult, WorkerInitInfo, WorkerMemory } from './types';
import type { MarkerMap } from '../project/types';
import type { RectifyBoxResult } from '../cv/rectify';
import type { TableSetupResult } from '../cv/tableSetup';
import type { ScanPhotoResult } from '../cv/scanPhoto';
import type { PieceRowLike, ScanMarkerlessResult } from '../cv/scanMarkerless';
import type { CoinFound } from '../cv/coin';
import type { TableModel } from '../project/types';
import type { CaptureKind } from '../scan/autoCapture';

export type TableSetupReply = TableSetupResult & { table: TableModel | null; width: number; height: number; ms: number };

export interface ScanOptions {
  map: MarkerMap;
  table: TableModel | null;
  zoom: number;
  kind: CaptureKind;
  pieceAreaMm2?: number;
}

export interface FreeScanOptions {
  catalog: PieceRowLike[];
  pitchMm: number;
  zoom: number;
  kind: CaptureKind;
  table: TableModel | null;
  /** Look for a coin (for true size) in this photo. */
  findCoin?: boolean;
  /** The box's piece count and the chosen grid: for the finished-puzzle check. */
  pieceCount?: number;
  grid?: { cols: number; rows: number } | null;
}

/** A piece straightened for box placement: RGBA PATCH_SIZE², and which sides read as flat (patch top, right, bottom, left). */
export interface PatchForCatalog {
  rgba: Uint8Array;
  flats: boolean[];
  /** The shape read behind the corners and flats is trusted. */
  sure: boolean;
  /** Each side's shape ('t' knob out, 'b' knob in, 'f' flat, 'u' not sure) and how sure (0–1). */
  sides: string;
  sideConf: number[];
}

/** The empty spots of a nearly finished puzzle as found in a photo of it (see Project.openSpots). */
export interface OpenSpotsInput {
  cols: number;
  rows: number;
  gaps: Array<[number, number]>;
  /** Each gap's sides (top, right, bottom, left in the photo), when read. */
  gapSides?: string[];
  thumb: Blob;
}

/** A piece to place on the box picture. */
export interface PieceToPlace {
  id: string;
  rgba: Uint8Array;
  flats: boolean[];
  sure: boolean;
}

/** A finished (or nearly finished) puzzle seen in an overview: its rows × columns and gaps. */
export interface FinishedCheck {
  /** The puzzle straightened small (SPOT_THUMB_CELL px per cell, JPEG), when it has gaps: kept to turn them to match the box picture. */
  thumb: Blob | null;
  cols: number;
  rows: number;
  colsExact: number;
  rowsExact: number;
  /** How clearly the seams repeat (below SEAM_OK the count isn't trusted). */
  seamStrength: number;
  /** Missing-piece spots (column, row from the top-left, 0-based) and their centres in preview px. */
  gaps: Array<[number, number]>;
  /** Each gap's sides as read from the hole's outline (AssembledGrid.gapSides). */
  gapSides: string[];
  gapsPreview: Array<[number, number]>;
  /** The puzzle's 4 corners in preview px. */
  cornersPreview: Array<[number, number]>;
}

export type FreeScanReply = ScanMarkerlessResult & {
  /** The coin, if one was asked for and found: its size in the catalog's current mm. */
  coin: (CoinFound & { diameterCatalogMm: number }) | null;
  /** Set when most of the photo is one assembled area (a finished puzzle). */
  finished: FinishedCheck | null;
  /** Per piece (same order as pieces): its straightened patch for box placement (M4), or null. */
  patches: Array<PatchForCatalog | null>;
  reasons: string[];
  sharpness: number;
  clippedShare: number;
  thumbs: Array<Blob | null>;
  preview: Blob;
  previewSize: { width: number; height: number };
  /** Each piece's outline in preview pixels (every other point). */
  outlinesPreview: number[][];
  /** Assembled parts and other objects (not pieces), in preview pixels. */
  regionsPreview: Array<{ kind: 'assembled' | 'object'; points: number[] }>;
  width: number;
  height: number;
  ms: number;
  decodeMs: number;
};

export type ScanReply = ScanPhotoResult & { thumbs: Array<Blob | null>; preview: Blob; width: number; height: number; ms: number; decodeMs: number };

export interface TrackerApi {
  init(): Promise<WorkerInitInfo>;
  /** Takes ownership of a cloned camera track (transferred) and reads its frames until detach(). */
  attachTrack(track: MediaStreamTrack, onResult: (r: TrackerFrameResult) => void): Promise<{ ok: boolean; error?: string }>;
  /** Fallback path: one frame sent as an ImageBitmap (transferred). */
  processBitmap(bitmap: ImageBitmap, timestampUs: number): Promise<TrackerFrameResult | null>;
  /** Stops reading the attached track; resolves once the loop has finished and stopped the track. */
  detach(): Promise<void>;
  setRate(fps: number): void;
  /** The current puzzle's marker map (null = none) and camera zoom, so frames get a table position and tilt. */
  setTableMap(map: MarkerMap | null, zoom: number): void;
  /** Measure the pieces in every frame (for the marker-free gauge). */
  setPieceStats(on: boolean): void;
  /** Longest gap between camera frames inside [startAbs, endAbs] (ms since epoch). */
  maxFrameGap(startAbs: number, endAbs: number): number;
  status(): TrackerStatus;
  recentFrames(): Blob[];
}

export interface ReaderApi {
  init(): Promise<WorkerInitInfo>;
  analysePhoto(blob: Blob): Promise<PhotoStats>;
  /** A Snap taken as the full-size live picture (transferred): stats + preview + full JPEG. */
  analyseFrame(bitmap: ImageBitmap): Promise<{ stats: PhotoStats; preview: Blob; jpeg: Blob }>;
  twoX(oneXBlob: Blob, twoXBlob: Blob): Promise<TwoXResult>;
  /** The 2× test on two full-size live pictures (transferred). */
  twoXFrames(one: ImageBitmap, two: ImageBitmap): Promise<TwoXResult>;
  bench(): Promise<CvBenchResult>;
  /** A small JPEG of the photo. Pass the photo's size when known, so it isn't decoded at full size just to measure it. */
  preview(blob: Blob, maxSide: number, size?: { width: number; height: number }): Promise<Blob>;
  memory(): WorkerMemory;
  /** Wizard step 5: the empty-table photo → marker map. */
  setupTable(photo: Blob, opts: { printScale: number; snapId: string }): Promise<TableSetupReply>;
  /** One scan photo → quality, table position, pieces (with thumbnails) and a preview. */
  scanPhoto(photo: Blob, opts: ScanOptions): Promise<ScanReply>;
  /** Marker-free scan photo → pieces placed by matching them to the catalog, thumbnails, preview with outlines. */
  scanFree(photo: Blob, opts: FreeScanOptions): Promise<FreeScanReply>;
  /**
   * Straightens the box picture: `corners` are the picture's top-left, top-right, bottom-right and
   * bottom-left corners as fractions (0–1) of the photo's width and height (the right way up).
   * Returns a JPEG at most `maxSide` px long (default 2048) with the picture's true shape.
   */
  rectifyBox(photo: Blob, corners: Array<[number, number]>, maxSide?: number): Promise<RectifyBoxResult>;
  /** A first guess of the box picture's corners (fractions 0–1, TL, TR, BR, BL), or null. */
  suggestBoxCorners(photo: Blob): Promise<Array<[number, number]> | null>;
  /**
   * Box placement (M4): where each piece goes on the straightened box picture (`box`, cached in the
   * helper under `boxKey`). `colour`: the one-time colour match to use; when null and there are
   * enough pieces, it is measured from these pieces and returned (store it and pass it next time).
   * `open`: only the empty spots of a nearly finished puzzle are candidates (each piece is scored at
   * every one of them); they are turned to match the box picture and returned.
   */
  placePieces(
    box: Blob,
    boxKey: string,
    grid: { cols: number; rows: number },
    pieces: PieceToPlace[],
    colour: ColourMatch | null,
    open?: OpenSpotsInput | null,
  ): Promise<PlaceReply>;
}

export interface PlaceReply {
  results: Array<{ id: string; placement: Placement }>;
  colour: ColourMatch | null;
  /**
   * The empty spots used, in box-picture columns and rows, the quarter turns from the photo to the
   * box picture and how alike they looked (best and next best turn). No cells (turn −1) when the
   * photo's grid fits the box's in no turn. Null when no empty spots were given.
   */
  open: { cells: Array<[number, number]>; sides?: string[]; turn: number; fit: number; runnerUp: number } | null;
  ms: number;
}

export interface ReportFileInput {
  name: string;
  blob?: Blob;
  text?: string;
  /** Store without compression (JPEG/PNG). Defaults to true for blobs. */
  stored?: boolean;
}

export interface ReportWorkerApi {
  build(files: ReportFileInput[]): Promise<Blob>;
}
