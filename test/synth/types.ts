/**
 * Types for the synthetic puzzle generator (test/synth). See README.md in this folder.
 *
 * Coordinates:
 * - piece-local mm: origin at the piece's cell centre, x right, y down (as printed).
 * - puzzle mm: origin at the puzzle's top-left corner (as printed).
 * - table mm: origin at marker 0's centre, x right, y towards the viewer (PLAN §3.2).
 * - img px: OpenCV convention, pixel centres at integers (the left edge of column 0 is x = −0.5).
 */
import type { Mat3 } from '../../src/project/types';

export type SideType = 'flat' | 'tab' | 'blank';
export type CutStyle = 'classic' | 'uniform';

/** Procedural art, or your own RGBA picture (stretched over the whole puzzle). */
export type ArtSpec =
  | {
      kind: 'procedural-kiss-like';
      /** Art seed (default: the puzzle seed). Validation and test sets use different art seeds. */
      seed?: number;
      /** Art resolution (default: as fine as fits in ~12 MP, at most 8 px/mm). */
      pxPerMm?: number;
    }
  | { kind: 'rgba'; width: number; height: number; rgba: Uint8Array | Uint8ClampedArray };

export interface GeneratePuzzleOptions {
  cols: number;
  rows: number;
  /** Cell size [width, height] in mm. */
  cellMm: [number, number];
  seed: number;
  cut?: CutStyle;
  art?: ArtSpec;
}

export interface SynthArt {
  width: number;
  height: number;
  /** Tightly packed RGBA, width × height × 4. */
  rgba: Uint8Array;
  /** Art pixels per puzzle mm (x and y). */
  pxPerMm: [number, number];
}

export interface SynthPiece {
  /** "r{row}c{col}", e.g. "r0c3". */
  id: string;
  col: number;
  row: number;
  /** top, right, bottom, left. */
  sides: [SideType, SideType, SideType, SideType];
  /** Flat x,y polygon of the top face in piece-local mm (clockwise on screen, ≥ 200 points, no repeat of the first point). */
  outlineMm: number[];
  /** The 4 piece corners in piece-local mm: top-left, top-right, bottom-right, bottom-left. */
  cornersMm: number[];
  /** Index into outlineMm (point index, not number index) of each corner. */
  cornerIdx: [number, number, number, number];
}

export interface SynthPuzzle {
  cols: number;
  rows: number;
  cellMm: [number, number];
  seed: number;
  cut: CutStyle;
  art: SynthArt;
  pieces: SynthPiece[];
}

export interface SceneLayout {
  /** Sorting area [width, height] in mm (default [700, 500]). */
  areaMm: [number, number];
  /** Top-left of the sorting area in table mm (default: inside the suggested marker frame). */
  originMm?: [number, number];
  /** Smallest gap between pieces that aren't a deliberate touching pair (default 3 mm). */
  gapMm?: number;
  /** Share of pieces placed touching another piece (default 0.03). */
  touchingShare?: number;
  /** Share of pieces lying face down (default 0.02). */
  faceDownShare?: number;
}

export interface MarkerPlacementSpec {
  id: number;
  centreMm: [number, number];
  angleDeg: number;
}

export interface SceneCamera {
  /** Camera position above the table (table mm). */
  x: number;
  y: number;
  heightMm: number;
  tiltDeg: number;
  tiltDirDeg?: number;
  yawDeg?: number;
  zoom?: 1 | 2;
  /** Default [4032, 3024]. */
  imageSize?: [number, number];
}

export interface SceneLight {
  /** Azimuth the side light comes FROM, table degrees (0 = from +x, 90 = from +y). Default 200. */
  dirDeg?: number;
  /** Elevation of the side light (default 50°): shadow length = thickness / tan(elevation). */
  elevationDeg?: number;
  /** A lamp that reflects in the glossy table, [x, y, z] in table mm; null = no glare (default). */
  glare?: { lampMm: [number, number, number]; radiusMm?: number } | null;
  /** Brightness change across the view along the light direction (default 0.12 = ±12 %). */
  gradient?: number;
  /** Share of light that is ambient (soft, no shadow), default 0.55. */
  ambient?: number;
}

export interface SceneOptions {
  puzzle: SynthPuzzle;
  /** Pieces on the table (default: all). */
  pieceIds?: string[];
  seed: number;
  layout?: SceneLayout;
  /** 'suggested' (default) = suggestedMarkerCentres for the layout's area, all at 0°. */
  markers?: 'suggested' | MarkerPlacementSpec[];
  table?: { rgb?: [number, number, number]; glossy?: boolean };
  camera: SceneCamera;
  light?: SceneLight;
  /** A soft shadow of the phone/hand/head on part of the view (default false). */
  handShadow?: boolean;
  /** Defocus blur sigma in px (default 0.6). */
  blurPx?: number;
  /** Motion blur length in px (default 0). */
  motionBlurPx?: number;
  /** Sensor noise scale (default 1; 0 = none). */
  noise?: number;
  /** Default 92. */
  jpegQuality?: number;
  /** Per-channel gain, e.g. [1.05, 1, 0.92], normalised so the largest is 1 (default [1, 1, 1]). */
  whiteBalanceShift?: [number, number, number];
  /** Exposure change in EV stops on top of auto-exposure (default 0; +1 = twice as bright). */
  exposure?: number;
  /** Piece thickness in mm (default 2.1). */
  thicknessMm?: number;
}

export interface TruthPiece {
  id: string;
  /** Where the cell centre (piece-local origin) lies on the table. */
  centreMm: [number, number];
  /** Rotation of the piece on the table (degrees, clockwise on screen). */
  angleDeg: number;
  faceDown: boolean;
  /** Ids of pieces this one touches (deliberate pairs). */
  touching: string[];
  /** The piece's outline on the table (mm); for a face-down piece, the mirrored shape actually lying there. */
  outlineMm: number[];
  /** The TOP FACE as seen in the image (px). */
  outlineImg: number[];
  /** Top face ∪ visible cardboard wall in the image (px). */
  silhouetteImg: number[];
  /** Share of the top face inside the image and not under a marker card (0..1). */
  visibleShare: number;
  /** Share of the top face lying in a glare zone of the table (0..1). */
  glareShare: number;
}

export interface SceneTruth {
  pieces: TruthPiece[];
  markers: Array<{ id: number; cornersImg: number[] }>;
  /** Share of image pixels with visible table glare. */
  glareMaskShare: number;
  /** Homography for the plane of the piece tops (z = thickness): table mm → img px. */
  topToImg: Mat3;
  /** Camera px per table mm at the image centre. */
  pxPerMm: number;
  thicknessMm: number;
}

export interface SynthScene {
  width: number;
  height: number;
  /** RGBA after the JPEG round trip (what the app would decode). Stride = width × 4. */
  rgba: Uint8Array;
  stride: number;
  jpeg: Buffer;
  /** Table (z = 0) mm → image px. */
  tableToImg: Mat3;
  truth: SceneTruth;
  /** Render timings (ms). */
  timings: Record<string, number>;
  /** Gain chosen by the simulated auto-exposure (before `exposure`). */
  aeGain: number;
}
