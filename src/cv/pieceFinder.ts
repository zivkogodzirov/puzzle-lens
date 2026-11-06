/**
 * Piece finding (segmentation) for overview and close-up photos on the owner's white glossy table
 * (PLAN §3.3 "Segmentation", RESEARCH §6 and its "Update 2026-11-06": no mat, hand-held phone).
 *
 * Method, in order:
 *  1. Shrink the photo (exact area average, plain JS) to ~3 px/mm for detection, keeping the
 *     darkest photo pixel under each small pixel too (thin cut edges and contact shadows survive).
 *     The 12 MP photo itself never enters OpenCV's WebAssembly memory.
 *  2. Lighting field: the table's colour at every point, fitted on table pixels of THIS photo
 *     (tableModel.ts estimateField; gradient, vignetting, hand/phone shadow, white balance). The
 *     empty-table model, when there is one, only steers which colour is "the table".
 *  3. Shadow-aware distance (Horprasert 1999): per pixel the brightness ratio α = I·E / E·E against
 *     the field E and the colour distortion |I − αE| / (α|E|). Classes: strong / weak piece
 *     (coloured, or darker than any shadow), shadow-like (the table's colour, darker), pale (a
 *     little brighter than the table, or consistently a little off its colour, over ~1 mm), glare
 *     (well above the field and colourless, or blown out where the table is not), table.
 *  4. Hysteresis: weak/pale pixels are kept when connected to strong ones (or a piece-sized blob).
 *  5. Grey print: shadow-like pixels farther than 3.5 mm from the table and 1.5 mm from coloured
 *     print can't be a cast shadow (those are thin bands next to pieces): they are print.
 *  6. Pale pieces: the cut edge, contact shadow, side shadow and visible wall form a dark ring on
 *     the white table; enclosed regions are added when they look like print (pale pixels) or
 *     border at most one piece (a table island between pieces borders several).
 *  7. Morphology, hole filling, marker-card masking (cards known from the map + homography).
 *  8. Blobs: fragments of one piece (a near-white band splits its print) are joined when the
 *     union is still piece-sized; per-piece closing and hole filling. Size gate in mm² relative
 *     to the expected piece area (median of this photo, prior 345 mm² = a Ravensburger 1000 cell).
 *     Flags: `cut` (image edge or marker card), `glare` (glare next to or inside), `clump` (too
 *     big, or big and not solid: "spread these apart"), `weak` (little strong contrast).
 *  9. Outline at full resolution (traceOutline): sub-pixel edge where the pixel is half-way
 *     between the local piece colour and the local background colour (unbiased for any contrast;
 *     falls back to the small mask for pale-on-white). The blob is the printed top face plus the
 *     cardboard wall the camera sees on the side facing the photo centre (RESEARCH §4); the wall's
 *     direction and width come from the camera pose (marker homography + 2.1 mm thickness), so it
 *     is removed by eroding along that direction only.
 * 10. Table coordinates through the TOP-plane homography (table plane raised by the piece
 *     thickness), so centres don't drift outward with parallax.
 *
 * Accuracy, speed and memory on the synthetic sets: see test/unit/cv-piece-accuracy.test.ts and
 * the M2 report. Every OpenCV object is created in a scope and freed (cvCounters.liveScoped
 * returns to 0); the entry point runs under cvGuard.
 */
import { cvGuard, type Cv } from './loadCv';
import { withScope, type CvScope } from './scope';
import type { PixelBuffer } from './frameAnalyser';
import {
  DETECT_PX_PER_MM,
  GLARE_GAIN,
  cardPolygonsMm,
  estimateField,
  fieldRow,
  fillPolygons,
  rgbToLab,
  shrinkRgb,
  sortingAreaMm,
  tableChroma,
  tableToSmall,
  type LightField,
  type SmallRgb,
} from './tableModel';
import { applyH, invertH, mulH } from '../geo/homography';
import { nominalIntrinsics, poseFromHomography } from '../geo/pose';
import type { Mat3, MarkerMap, PieceFlags, TableModel, Vec2 } from '../project/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mat = any;

export interface FoundPiece {
  /** Top-face outline in photo px (flat x, y; OpenCV pixel convention). */
  outlineImg: number[];
  /** Same outline in table mm (absolute, piece-top plane mapped down onto the table). */
  outlineMm: number[];
  centreMm: Vec2;
  /** Angle of the outline's minimum-area rectangle, −45…45° (clockwise on screen). */
  angleDeg: number;
  areaMm2: number;
  /** Size of that rectangle along its own axes [along angleDeg, across] (mm). */
  sizeMm: Vec2;
  /** Mean colour of the printed face (CIE Lab), white-balanced against the table (table = neutral L≈96). */
  meanLab: [number, number, number];
  /** 8-bin hue histogram (Lab hue, weighted by chroma), sums to 1 (all 0 for a grey piece). */
  hueHist: number[];
  /** Bounding box of outlineImg [x, y, w, h] (photo px). */
  bboxImg: [number, number, number, number];
  flags: PieceFlags;
  /** Confidence 0–1 (contrast and shape plausibility). */
  score: number;
}

/** Glare mask at detection resolution: pixel (x, y) ↔ photo ((x + 0.5)·factor − 0.5, …). */
export interface GlareMask {
  width: number;
  height: number;
  factor: number;
  /** 1 = glare. */
  data: Uint8Array;
}

/** A blob much bigger than a piece (an assembled area, or a non-piece object), or a piece-sized blob whose shape is not a piece's. */
export interface FoundRegion {
  kind: 'assembled' | 'object';
  /** OUTER outline in photo px (traced at detection resolution, flat x, y); holes (table seen inside an assembled frame) are not represented. */
  outlineImg: number[];
  /** Same outline in table mm. */
  outlineMm: number[];
  /** Area inside the outer outline (mm²). */
  areaMm2: number;
}

export interface FindResult {
  pieces: FoundPiece[];
  /** Assembled areas and objects on the table (not pieces; never counted as pieces). */
  regions: FoundRegion[];
  /** Share of the visible sorting area (or, without a map, of the table) under glare. */
  glareShare: number;
  glareMaskImg?: GlareMask;
  timings: Record<string, number>;
}

export interface FindOptions {
  imgToTable: Mat3;
  tableToImg: Mat3;
  /** Marker map, or null without printed markers (no card masking; the whole visible table is the sorting area). */
  map: MarkerMap | null;
  table: TableModel | null;
  /** Photo px per table mm near the image centre. */
  pxPerMm: number;
  /** Camera zoom (1 or 2) for the parallax model; guessed from pxPerMm when absent. */
  zoom?: number;
  /** Piece thickness (default 2.1 mm, Ravensburger). */
  thicknessMm?: number;
  /** Expected piece area (mm²) when the photo has too few pieces to measure it (default 345). */
  pieceAreaMm2?: number;
  /** Return the glare mask (default true). */
  withGlareMask?: boolean;
  /** Tests/tuning only: filled with intermediate images (class map, masks, field). */
  debug?: Record<string, unknown>;
}

/** A Ravensburger 1000 cell (17.8 × 19.4 mm): knobs in and out cancel, so ≈ the piece area. */
export const DEFAULT_PIECE_AREA_MM2 = 345;
export const PIECE_THICKNESS_MM = 2.1;

// Pixel classes.
const TABLE = 0;
const SHADOW = 1;
const WEAK = 2;
const STRONG = 3;
const GLARE = 4;
/** A little brighter than the table (near-white print): weak piece evidence. */
const PALE = 5;

/** Thresholds (tuned on val48/val300 only). */
export const SEG = {
  /** Holes bigger than this (× expected piece area) stay open (table seen inside an assembled area). */
  maxHole: 1.5,
  /** Blobs bigger than this (× expected area) are an assembled area or an object, not pieces. */
  regionArea: 4,
  /** …and an assembled area when at least this big (smaller ones are objects: a remote, a coaster). */
  assembledArea: 12,
  /** …and printed: the interquartile range of its brightness (8-bit luma) above this. */
  assembledMinIqr: 20,
  /** Table region: the biggest connected table-like area (and what lies on it); off below this share of the image. */
  tableMinShare: 0.15,
  tableMinAlpha: 0.85,
  /** Closing across pieces when finding the table (mm). */
  tableCloseMm: 30,
  /** No pale cue within this distance (mm) of the table's edge. */
  tableEdgeMm: 30,
  /** Shape gate for a single piece: solidity above this, or a box this elongated, is an object. */
  objectSolidity: 0.94,
  objectAspect: 1.9,
  /** Median membership gradient across the outline (1/mm) below which a blob has no real edge. */
  minEdgeSharp: 0.3,
  /** Weak blobs scoring below this and within this ΔE of the table's white are dropped. */
  minWeakScore: 0.3,
  /** A weak clump with less than this share of strong pixels is an object. */
  weakClumpStrong: 0.1,
  tableLikeDeltaE: 6,
  /** Peeling loose pieces off regions: opening radius (× √expected area) and piece-part size range. */
  peelRadius: 0.22,
  peelPartMin: 0.3,
  peelPartMax: 1.8,
  /** Width of the pre-pass copy for estimatePxPerMm (px). */
  scaleWidth: 1000,
  /** Blobs used for the scale: solidity range and largest box aspect of a single piece. */
  scaleSolidity: [0.62, 0.95] as [number, number],
  scaleAspect: 1.6,
  /** Detection resolution (small image px per mm). */
  detectPxPerMm: DETECT_PX_PER_MM,
  /** …but never more than this many small-image pixels (speed: the phone budget). */
  detectMaxPixels: 6e6,
  /** α below this: a piece whatever its colour (darker than any side shadow). */
  darkStrong: 0.3,
  darkWeak: 0.38,
  /** Darker than this and coloured at all: strong (shadows are colourless). */
  darkColoured: 0.6,
  /** A weak-only blob at least this big (× expected piece area) is kept without strong pixels. */
  weakBlob: 0.25,
  /** Colour distortion (relative to brightness) for strong / weak piece pixels. */
  chromaStrong: 0.09,
  chromaWeak: 0.04,
  /** Darkening (1 − α) that counts as shadow-like ring material, at least. */
  shadowMin: 0.035,
  /** Thin dark line (darkest photo pixel under a small pixel) that counts as ring material, at least. */
  edgeMin: 0.05,
  /** Brighter than the table by this much (3 × 3 mean) = pale print. */
  paleMin: 0.012,
  paleSigmas: 3.5,
  /** Off the table's colour by this much (3 × 3 mean), or this many × the table's own 95th percentile. */
  paleChromaMin: 0.009,
  paleChromaTimes: 3,
  paleChromaVotes: 6,
  /** The "brighter than the table" cue needs headroom: off when the table is this bright (8-bit luma). */
  paleMaxTableY: 238,
  /** Pale areas bigger than this (× expected area) are not print. */
  paleMaxArea: 1.6,
  /** Explain shadow-like runs by the light direction (explainShadows). */
  shadowRuns: true,
  shadowPenumbraMm: 1.0,
  haloSlackMm: 0.2,
  haloRule: false,
  islandRule: true,
  /** …only for runs no longer than a piece (longer ones are the field being off, e.g. near glare). */
  islandMaxMm: 30,
  /** A shadow-like run between two bits of print up to this × the shadow length is shadow (a gap). */
  gapShadowFactor: 1.0,
  /** Grey print: shadow-like pixels farther than this from the table (mm)… */
  greyCoreMm: 3.5,
  /** …and from coloured print (mm) are print, not shadow. 0 disables. */
  greyFgMm: 1.5,
  /** Grey-print patches bigger than this (× expected area) are a soft shadow, not print. */
  greyMaxArea: 2.5,
  /** 8-bit luma counted as blown out, and the headroom the table needs for that to mean glare. */
  clipY: 250,
  glareHeadroom: 4,
  /** Glare regions survive an opening of this radius (mm) and are at least this big (mm²). */
  glareOpenMm: 0.7,
  glareMinMm2: 25,
  /** No "brighter than the table" cue within this distance (mm) of glare. */
  glareRimMm: 8,
  /** Blob size gate relative to the expected piece area. */
  minArea: 0.35,
  clumpArea: 1.6,
  clumpSolidArea: 1.25,
  clumpSolidity: 0.78,
  /** Longer than this × √(expected area) is not one piece (a piece with knobs is ≤ ~1.5×). */
  clumpLength: 1.7,
  /** Closing (px, small image) applied to the piece ∪ shadow ring before looking for pale interiors. */
  ringClose: 5,
  /** Largest pale interior accepted, relative to the expected piece area. */
  maxInterior: 1.3,
  /** An enclosed region is pale print if this share of it is pale… */
  interiorPale: 0.2,
  /** …or if it borders at most one piece and is at least this big (× expected area). */
  interiorMin: 0.3,
  /** Fragments closer than this (mm) are joined when the union is at most `fragmentUnion` × the expected area. */
  fragmentGapMm: 3,
  fragmentMax: 0.85,
  fragmentUnion: 1.4,
  /** Blobs bigger than `neckSplitArea` × expected are opened with a `neckMm` disc and split when
   * that leaves ≥ 2 parts of at least `neckPartMin` × expected. */
  neckSplitArea: 1.4,
  neckMm: 1.0,
  neckPartMin: 0.4,
  /** Per-piece closing radius (mm): fills near-white inlets narrower than ~2× this. */
  closeMm: 1.3,
  /** …but what it adds is dropped when more than this share of it is plain table (a blank's hollow). */
  addedTableMax: 0.3,
  /** Full-resolution refinement: half-width of the undecided band and the colour averaging σ (mm). */
  refineBandMm: 0.4,
  refineSigmaMm: 0.7,
  /** Membership level of the edge (½ = half-way between piece and background colour). */
  memberLevel: 0.5,
};

export function findPieces(cv: Cv, rgba: PixelBuffer, opts: FindOptions): FindResult {
  return cvGuard(cv, () => withScope((sc) => run(cv, sc, rgba, opts)));
}

interface Geometry {
  tableToImg: Mat3;
  imgToTable: Mat3;
  topToImg: Mat3;
  imgToTop: Mat3;
  /** Photo-px displacement from a table point's image to its raised (top-face) image. */
  wallShift(pImg: Vec2): Vec2;
}

function geometry(W: number, H: number, opts: FindOptions): Geometry {
  const t = opts.thicknessMm ?? PIECE_THICKNESS_MM;
  const zoom = opts.zoom ?? (opts.pxPerMm * (4032 / Math.max(W, H)) > 7 ? 2 : 1);
  const pose = poseFromHomography(opts.tableToImg, nominalIntrinsics(W, H, zoom));
  let topToImg = opts.tableToImg;
  if (pose && pose.heightMm > 5 * t) {
    const k = pose.heightMm / (pose.heightMm - t);
    const [fx, fy] = pose.footMm;
    topToImg = mulH(opts.tableToImg, [k, 0, fx * (1 - k), 0, k, fy * (1 - k), 0, 0, 1]);
  }
  const imgToTop = invertH(topToImg) ?? opts.imgToTable;
  return {
    tableToImg: opts.tableToImg,
    imgToTable: opts.imgToTable,
    topToImg,
    imgToTop,
    wallShift(p) {
      const X = applyH(opts.imgToTable, p);
      const a = applyH(opts.tableToImg, X);
      const b = applyH(topToImg, X);
      return [b[0] - a[0], b[1] - a[1]];
    },
  };
}

function run(cv: Cv, sc: CvScope, rgba: PixelBuffer, opts: FindOptions): FindResult {
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (k: string) => {
    const now = performance.now();
    timings[k] = (timings[k] ?? 0) + now - t0;
    t0 = now;
  };
  const T0 = t0;
  const W = rgba.width;
  const H = rgba.height;
  const geo = geometry(W, H, opts);

  // 1. Shrink.
  const factor = Math.max(1, opts.pxPerMm / SEG.detectPxPerMm, Math.sqrt((W * H) / SEG.detectMaxPixels));
  const img = shrinkRgb(rgba, factor);
  const { width: w, height: h } = img;
  const sppm = opts.pxPerMm / factor;
  lap('shrink');

  // Marker cards: ignored for the field (small margin) and a wider zone for the `cut` flag.
  const cardIgnore = new Uint8Array(w * h);
  if (opts.map) fillPolygons(cardIgnore, w, h, cardPolygonsMm(opts.map, 2).map((p) => tableToSmall(p, geo.tableToImg, factor)));
  const cardZone = new Uint8Array(w * h);
  if (opts.map) fillPolygons(cardZone, w, h, cardPolygonsMm(opts.map, 4).map((p) => tableToSmall(p, geo.tableToImg, factor)));

  // 2. Lighting field.
  const field = estimateField(img, { pxPerMm: sppm, ignore: cardIgnore, chromaPrior: opts.table ? tableChroma(opts.table) : null });
  lap('field');

  // 3. Classify.
  const alpha = new Float32Array(w * h);
  const cls = classify(img, field, cardIgnore, sppm, alpha);
  // Only look for pieces on the table: everything off the largest table-like area (floor, the
  // table's dark edge, things beyond it) counts like a marker card (ignored; touching = cut).
  const onTable = tableRegion(cv, cls, alpha, w, h, sppm);
  if (onTable) {
    for (let p = 0; p < w * h; p++) if (!onTable[p]) cardZone[p] = 1;
    // Near the table's edge the lighting field is least reliable (it mixes in the floor), so the
    // faint "pale" cues there are not trusted.
    const off = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) off[p] = onTable[p] ? 0 : 1;
    const nearEdge = dilateBox(off, 1, w, h, Math.round(SEG.tableEdgeMm * sppm));
    for (let p = 0; p < w * h; p++) if (nearEdge[p] && cls[p] === PALE) cls[p] = TABLE;
  }
  if (opts.debug) opts.debug.onTable = onTable;
  const shadow = SEG.shadowRuns ? explainShadows(cls, w, h, sppm, cardIgnore) : null;
  if (opts.debug) opts.debug.shadow = shadow && { dir: shadow.dir, lengthMm: shadow.lengthMm, haloMm: shadow.haloMm };
  lap('classify');
  if (opts.debug) Object.assign(opts.debug, { img, field, cls, factor });

  // 4–6. Masks.
  const prior = opts.pieceAreaMm2 ?? DEFAULT_PIECE_AREA_MM2;
  const pieceMask = buildMask(cv, cls, cardZone, w, h, prior * sppm * sppm, sppm, shadow?.explained ?? null);
  lap('masks');
  if (opts.debug) opts.debug.pieceMask = pieceMask;

  // Glare mask (cleaned) and share.
  const glare = withScope((s2) => glareMask(cv, s2, cls, pieceMask, w, h, sppm));
  const area = new Uint8Array(w * h);
  if (opts.map) fillPolygons(area, w, h, [tableToSmall(sortingAreaMm(opts.map), geo.tableToImg, factor)]);
  let areaN = 0;
  let glareN = 0;
  for (let p = 0; p < w * h; p++) {
    if (!area[p] || cardIgnore[p]) continue;
    areaN++;
    if (glare[p]) glareN++;
  }
  if (areaN < 0.05 * w * h) {
    // The photo hardly shows the sorting area (or no usable map): use the whole visible table.
    areaN = 0;
    glareN = 0;
    for (let p = 0; p < w * h; p++) {
      if (cardIgnore[p]) continue;
      areaN++;
      if (glare[p]) glareN++;
    }
  }
  lap('glare');

  // 7–9. Blobs → pieces.
  const prof = { outline: 0, colour: 0, flags: 0 };
  const { pieces, regions } = withScope((s2) => blobsToPieces(cv, s2, { prof, rgba, img, field, cls, pieceMask, cardZone, glare, geo, factor, sppm, prior, W, H }));
  lap('pieces');
  for (const [k, v] of Object.entries(prof)) timings[`pieces.${k}`] = v;
  timings.total = performance.now() - T0;

  const out: FindResult = { pieces, regions, glareShare: areaN ? glareN / areaN : 0, timings };
  if (opts.withGlareMask !== false) out.glareMaskImg = { width: w, height: h, factor, data: glare };
  return out;
}

// ---- Classification ------------------------------------------------------------------------------

function classify(img: SmallRgb, field: LightField, ignore: Uint8Array, sppm: number, alphaOut?: Float32Array): Uint8Array {
  const { width: w, height: h, rgb, minY, factor } = img;
  const n = w * h;
  const cls = new Uint8Array(n);
  const alpha = new Float32Array(n);
  const chroma = new Float32Array(n);
  const eYs = new Float32Array(n);
  const row = new Float32Array(w * 3);
  const sig = field.noise;
  const shadowLevel = 1 - Math.max(SEG.shadowMin, 3.5 * sig);
  // The darkest of ~factor² photo pixels: its noise is ~factor × the small image's, and biased low.
  const sigPix = sig * Math.max(1, factor);
  const edgeLevel = 1 - Math.max(SEG.edgeMin, (2 + 1.2 * Math.log2(1 + factor * factor)) * sigPix);
  for (let y = 0; y < h; y++) {
    fieldRow(field, y, w, row);
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (ignore[p]) continue;
      const k = p * 3;
      const R = rgb[k]!;
      const G = rgb[k + 1]!;
      const B = rgb[k + 2]!;
      const eR = row[x * 3]!;
      const eG = row[x * 3 + 1]!;
      const eB = row[x * 3 + 2]!;
      const ee = eR * eR + eG * eG + eB * eB;
      const a = (R * eR + G * eG + B * eB) / ee;
      alpha[p] = a;
      if (alphaOut) alphaOut[p] = a;
      const dr = R - a * eR;
      const dg = G - a * eG;
      const db = B - a * eB;
      const c = Math.sqrt((dr * dr + dg * dg + db * db) / ee) / Math.max(a, 0.15);
      chroma[p] = c;
      const Y = (R + 2 * G + B) * 0.25;
      const eY = (eR + 2 * eG + eB) * 0.25;
      eYs[p] = eY;
      // Glare: clearly brighter than the table, or blown out where the table itself is not.
      if ((a > GLARE_GAIN || (Y >= SEG.clipY && eY < SEG.clipY - SEG.glareHeadroom)) && c < 0.06) {
        cls[p] = GLARE;
        continue;
      }
      const cNoise = (1.5 * sig) / Math.sqrt(Math.max(a, 0.15));
      const cWeak = Math.max(SEG.chromaWeak, 4 * cNoise);
      if (a < SEG.darkStrong || c > Math.max(SEG.chromaStrong, 8 * cNoise) || (a < SEG.darkColoured && c > cWeak)) cls[p] = STRONG;
      else if (a < SEG.darkWeak || c > cWeak) cls[p] = WEAK;
      else if (a < shadowLevel || minY[p]! < edgeLevel * eY) cls[p] = SHADOW;
    }
  }
  // Colour noise of the table itself (its 95th percentile over table-like pixels): real glossy
  // tables mirror coloured things, so the pale-colour cue adapts to what this photo shows.
  const hist = new Uint32Array(500);
  let hn = 0;
  for (let p = 0; p < n; p += 3) {
    if (ignore[p] || cls[p] !== TABLE) continue;
    hist[Math.min(499, Math.floor(chroma[p]! * 5000))]!++;
    hn++;
  }
  let cTable = 0.005;
  for (let i = 0, acc = 0; i < 500 && hn > 100; i++) {
    acc += hist[i]!;
    if (acc >= 0.95 * hn) {
      cTable = (i + 1) / 5000;
      break;
    }
  }
  // Pale print: a little brighter than the table, or a little off its colour, consistently over
  // ~1 mm (3 × 3 mean).
  const paleLevel = 1 + Math.max(SEG.paleMin, SEG.paleSigmas * sig);
  const paleChroma = Math.max(SEG.paleChromaMin, SEG.paleChromaTimes * cTable);
  // The colour test needs most of the 3 × 3 neighbourhood off-colour, so colour bleeding from a neighbouring piece
  // (blur, JPEG chroma subsampling) can't turn the table next to it into "pale print". Shadow-dark
  // pixels are never tested: real shadows are not exactly the table's colour (ambient light is
  // bluer than direct light; the synthetic glare/window sheen whitens them).
  // Near glare the table is brighter than the field by a varying amount (the reflection's soft
  // rim): no "brighter than the table" cue there.
  const nearGlare = dilateBox(cls, GLARE, w, h, Math.round(SEG.glareRimMm * sppm));
  const pale = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const k = cls[p];
      if (k !== TABLE || ignore[p]) continue;
      let s = 0;
      let nc = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          s += alpha[p + j * w + i]!;
          if (chroma[p + j * w + i]! > paleChroma) nc++;
        }
      if ((s / 9 > paleLevel && eYs[p]! < SEG.paleMaxTableY && !nearGlare[p]) || nc >= SEG.paleChromaVotes) pale[p] = 1;
    }
  for (let p = 0; p < n; p++) if (pale[p]) cls[p] = PALE;
  return cls;
}

/**
 * Shadow-like pixels that a cast shadow can't explain are print (pale-grey / blue-grey print is
 * "the table's colour, only darker", exactly like a shadow).
 *
 * 1. The light direction: around strong print, which side has shadow-like pixels, and how far
 *    (side-light shadows are 1–3 mm long and point away from the light; the contact shadow and
 *    halo are a thin ring on every side).
 * 2. Along lines in that direction, each run of shadow-like pixels is compared with what a shadow
 *    could be: running from print to table it can be at most the shadow length (+ penumbra), and
 *    from table to print at most the halo. (Print to print is left alone: a blank's hollow is
 *    shadowed from three sides.)
 *    The part of a run beyond that — on the print side — is print and becomes PALE.
 */
function explainShadows(cls: Uint8Array, w: number, h: number, sppm: number, ignore: Uint8Array): { dir: Vec2; lengthMm: number; haloMm: number; explained: Uint8Array } | null {
  const isFg = (k: number) => k === STRONG || k === WEAK;
  // 1. Direction and length.
  const samples: number[] = [];
  const normals: number[] = [];
  for (let y = 1; y < h - 1; y += 2)
    for (let x = 1; x < w - 1; x += 1) {
      const p = y * w + x;
      if (cls[p] !== STRONG) continue;
      if (isFg(cls[p - 1]!) && isFg(cls[p + 1]!) && isFg(cls[p - w]!) && isFg(cls[p + w]!)) continue;
      // Outward normal of the print edge (away from the print pixels around).
      let nx = 0;
      let ny = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
          if (isFg(cls[yy * w + xx]!)) {
            nx -= dx;
            ny -= dy;
          }
        }
      const nl = Math.hypot(nx, ny);
      if (nl < 2) continue;
      samples.push(p);
      normals.push(nx / nl, ny / nl);
    }
  if (samples.length < 200) return null;
  const step = Math.max(1, Math.floor(samples.length / 6000));
  const Ls: number[] = [];
  for (let mm = 0.3; mm <= 4.5; mm += 0.5) Ls.push(mm);
  const expect = (theta: number): number => {
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    let len = 0;
    for (const mm of Ls) {
      const dx = Math.round(c * mm * sppm);
      const dy = Math.round(sn * mm * sppm);
      let sh = 0;
      let tot = 0;
      for (let i = 0; i < samples.length; i += step) {
        // Only edges facing this way (their own shadow side), not into the piece.
        if (normals[2 * i]! * c + normals[2 * i + 1]! * sn < 0.7) continue;
        const p = samples[i]!;
        const x = (p % w) + dx;
        const y = Math.floor(p / w) + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const k = cls[y * w + x]!;
        if (isFg(k) || ignore[y * w + x]) continue;
        tot++;
        if (k === SHADOW) sh++;
      }
      if (tot) len += (sh / tot) * 0.5;
    }
    return len;
  };
  let best = 0;
  let bestL = -1;
  const n = 24;
  const lens: number[] = [];
  for (let i = 0; i < n; i++) {
    const L = expect((i / n) * 2 * Math.PI);
    lens.push(L);
    if (L > bestL) {
      bestL = L;
      best = i;
    }
  }
  const theta = (best / n) * 2 * Math.PI;
  const halo = Math.min(...lens);
  const lengthMm = bestL;
  const dir: Vec2 = [Math.cos(theta), Math.sin(theta)];
  const maxShadow = (lengthMm + SEG.shadowPenumbraMm) * sppm;
  const maxHalo = (halo + SEG.haloSlackMm) * sppm;

  // 2. Runs along lines parallel to dir (DDA: one pixel per step on the major axis).
  const major = Math.abs(dir[0]) >= Math.abs(dir[1]) ? 0 : 1;
  const sMaj = Math.sign(dir[major]!) || 1;
  const slope = dir[1 - major]! / Math.abs(dir[major]!);
  const stepLen = Math.hypot(1, slope);
  const nMaj = major === 0 ? w : h;
  const nMin = major === 0 ? h : w;
  const span = Math.ceil(Math.abs(slope) * nMaj) + 1;
  const toPale: number[] = [];
  const explained = new Uint8Array(w * h);
  const line: number[] = [];
  const kind = (q: number) => (q < 0 || ignore[q] ? TABLE : cls[q] === GLARE ? TABLE : cls[q]!);
  for (let m0 = -span; m0 < nMin + span; m0++) {
    line.length = 0;
    for (let t = 0; t < nMaj; t++) {
      const a = sMaj > 0 ? t : nMaj - 1 - t;
      const b = Math.round(m0 + slope * t);
      if (b < 0 || b >= nMin) {
        if (line.length) line.push(-1);
        continue;
      }
      line.push(major === 0 ? b * w + a : a * w + b);
    }
    // Scan runs of SHADOW along the line.
    let i = 0;
    while (i < line.length) {
      if (line[i]! < 0 || kind(line[i]!) !== SHADOW) {
        i++;
        continue;
      }
      let j = i;
      while (j < line.length && line[j]! >= 0 && kind(line[j]!) === SHADOW) j++;
      const before = i > 0 && line[i - 1]! >= 0 ? kind(line[i - 1]!) : TABLE;
      const after = j < line.length && line[j]! >= 0 ? kind(line[j]!) : TABLE;
      const L = (j - i) * stepLen;
      const fgB = isFg(before) || before === PALE;
      const fgA = isFg(after) || after === PALE;
      if (fgB && !fgA) {
        // print → shadow → table: the part beyond the shadow length, next to the print, is print.
        const extra = Math.floor((L - maxShadow) / stepLen);
        for (let k = 0; k < extra; k++) toPale.push(line[i + k]!);
        for (let k = Math.max(0, extra); k < j - i; k++) explained[line[i + k]!] = 1;
      } else if (!fgB && fgA && SEG.haloRule) {
        const extra = Math.floor((L - maxHalo) / stepLen);
        for (let k = 0; k < extra; k++) toPale.push(line[j - 1 - k]!);
      } else if (fgB && fgA) {
        // Between print and print: a shadowed blank (the hollow of a piece) or a pale band in the
        // print look alike here; left to the ring / fragment logic. Short runs are shadow
        // (a gap between pieces, a blank in shade) and must not be taken as grey print.
        if (L <= maxShadow * SEG.gapShadowFactor) for (let k = i; k < j; k++) explained[line[k]!] = 1;
      } else if (SEG.islandRule && L <= SEG.islandMaxMm * sppm) {
        // table → shadow → table: a pale-grey piece and its own shadow. The middle is print.
        const a0 = Math.ceil(maxHalo / stepLen);
        const a1 = j - i - Math.ceil(maxShadow / stepLen);
        for (let k = a0; k < a1; k++) toPale.push(line[i + k]!);
      }
      i = j;
    }
  }
  for (const q of toPale) cls[q] = PALE;
  return { dir, lengthMm, haloMm: halo, explained };
}

/** 1 where a pixel of class `k` lies within a (2r+1)² box (separable running max). */
function dilateBox(cls: Uint8Array, k: number, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    for (let x = 0; x < w; x++) {
      if (cls[y * w + x] === k) last = x;
      if (x - last <= r) tmp[y * w + x] = 1;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (cls[y * w + x] === k) last = x;
      if (last - x <= r) tmp[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= r) out[y * w + x] = 1;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

/**
 * The table: the largest connected table-like area (table, shadow, pale, glare classes) plus
 * everything it encloses (pieces, assembled areas, objects lying on it). Null when no area
 * covers at least `tableMinShare` of the photo (then the whole photo is searched).
 */
function tableRegion(cv: Cv, cls: Uint8Array, alpha: Float32Array, w: number, h: number, sppm: number): Uint8Array | null {
  return withScope((sc) => {
    // Coarse grid (~2 mm cells): a cell is table when ≥ 30 % of it looks like table.
    const B = Math.max(1, Math.round(2 * sppm));
    const cw = Math.ceil(w / B);
    const ch = Math.ceil(h / B);
    const cnt = new Uint16Array(cw * ch);
    const tot = new Uint16Array(cw * ch);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const g = Math.floor(y / B) * cw + Math.floor(x / B);
        tot[g]!++;
        const k = cls[p];
        // Table-coloured and nearly as bright (piece shadows are enclosed anyway; a grey rug or
        // the floor beyond the table edge is darker).
        if (k === TABLE || k === PALE || k === GLARE || (k === SHADOW && alpha[p]! > SEG.tableMinAlpha)) cnt[g]!++;
      }
    const t = new Uint8Array(cw * ch);
    for (let g = 0; g < cw * ch; g++) t[g] = cnt[g]! >= 0.3 * tot[g]! ? 255 : 0;
    // Close across pieces lying on the table (≤ ~30 mm), so the gaps between pieces stay one table.
    const m = toMat(cv, sc, t, cw, ch);
    const r = Math.max(1, Math.round(SEG.tableCloseMm / 2));
    const k = sc.keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * r + 1, 2 * r + 1)));
    cv.morphologyEx(m, m, cv.MORPH_CLOSE, k, new cv.Point(-1, -1), 1, cv.BORDER_REPLICATE);
    const l = sc.keep(new cv.Mat());
    const st = sc.keep(new cv.Mat());
    const ce = sc.keep(new cv.Mat());
    const n: number = cv.connectedComponentsWithStats(m, l, st, ce, 4, cv.CV_32S);
    const s: Int32Array = st.data32S.slice();
    let best = 0;
    for (let i = 1; i < n; i++) if (!best || s[i * 5 + 4]! > s[best * 5 + 4]!) best = i;
    if (!best || s[best * 5 + 4]! < SEG.tableMinShare * cw * ch) return null;
    const lab: Int32Array = l.data32S.slice();
    const only = new Uint8Array(cw * ch);
    for (let g = 0; g < cw * ch; g++) only[g] = lab[g] === best ? 255 : 0;
    const filled = fillHoles(cv, sc, toMat(cv, sc, only, cw, ch));
    const f: Uint8Array = filled.data.slice();
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = f[Math.floor(y / B) * cw + Math.floor(x / B)]!;
    return out;
  });
}

// ---- Masks ----------------------------------------------------------------------------------------

function toMat(cv: Cv, sc: CvScope, data: Uint8Array, w: number, h: number): Mat {
  const m = sc.keep(new cv.Mat(h, w, cv.CV_8UC1));
  m.data.set(data);
  return m;
}

/** Fills holes: everything inside an outer contour becomes 255. */
function fillHoles(cv: Cv, sc: CvScope, src: Mat): Mat {
  const contours = sc.keep(new cv.MatVector());
  const hier = sc.keep(new cv.Mat());
  cv.findContours(src, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const dst = sc.keep(cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC1));
  cv.drawContours(dst, contours, -1, new cv.Scalar(255), -1, cv.LINE_8);
  return dst;
}

/**
 * Fills only holes no bigger than `maxArea` px: the table seen through a gap in an assembled area
 * (or inside a ring of loose pieces) is table, not piece.
 */
function fillHolesMax(cv: Cv, sc: CvScope, src: Mat, maxArea: number): Mat {
  const inv = sc.keep(new cv.Mat());
  cv.bitwise_not(src, inv);
  const l = sc.keep(new cv.Mat());
  const st = sc.keep(new cv.Mat());
  const ce = sc.keep(new cv.Mat());
  const n: number = cv.connectedComponentsWithStats(inv, l, st, ce, 4, cv.CV_32S);
  const s: Int32Array = st.data32S.slice();
  const lab: Int32Array = l.data32S.slice();
  const w = src.cols;
  const h = src.rows;
  const fill = new Uint8Array(n);
  for (let i = 1; i < n; i++) {
    const x = s[i * 5]!;
    const y = s[i * 5 + 1]!;
    const touches = x === 0 || y === 0 || x + s[i * 5 + 2]! >= w || y + s[i * 5 + 3]! >= h;
    fill[i] = !touches && s[i * 5 + 4]! <= maxArea ? 1 : 0;
  }
  const out = sc.keep(new cv.Mat(h, w, cv.CV_8UC1));
  const d: Uint8Array = src.data.slice();
  for (let p = 0; p < w * h; p++) if (fill[lab[p]!]) d[p] = 255;
  out.data.set(d);
  return out;
}

/**
 * Piece mask on the small image. Each step runs in its own scope so the big label / distance
 * images are freed before the next step allocates (keeps the WebAssembly heap small).
 */
function buildMask(cv: Cv, cls: Uint8Array, cardZone: Uint8Array, w: number, h: number, priorPx: number, sppm: number, explained: Uint8Array | null): Uint8Array {
  const n = w * h;
  // Pale print never covers more than a piece: bigger "pale" areas are the field being off
  // (over-exposure, a reflection), not pieces.
  withScope((sc) => {
    const pm = new Uint8Array(n);
    for (let p = 0; p < n; p++) pm[p] = cls[p] === PALE ? 255 : 0;
    const pmMat = toMat(cv, sc, pm, w, h);
    const pl = sc.keep(new cv.Mat());
    const pst = sc.keep(new cv.Mat());
    const pce = sc.keep(new cv.Mat());
    const np: number = cv.connectedComponentsWithStats(pmMat, pl, pst, pce, 8, cv.CV_32S);
    const ps: Int32Array = pst.data32S.slice();
    const plab: Int32Array = pl.data32S.slice();
    const big = new Uint8Array(np);
    for (let i = 1; i < np; i++) big[i] = ps[i * 5 + 4]! > SEG.paleMaxArea * priorPx ? 1 : 0;
    for (let p = 0; p < n; p++) if (big[plab[p]!]) cls[p] = TABLE;
  });
  // Hysteresis: weak/strong components that contain a strong pixel.
  const fg = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (cls[p] === WEAK || cls[p] === STRONG || cls[p] === PALE) fg[p] = 255;
  withScope((sc) => {
    const fgMat = toMat(cv, sc, fg, w, h);
    const labels = sc.keep(new cv.Mat());
    const nl: number = cv.connectedComponents(fgMat, labels, 8, cv.CV_32S);
    const lab: Int32Array = labels.data32S.slice();
    const hasStrong = new Uint8Array(nl);
    const size = new Float64Array(nl);
    for (let p = 0; p < n; p++) {
      if (cls[p] === STRONG) hasStrong[lab[p]!] = 1;
      size[lab[p]!]!++;
    }
    for (let i = 1; i < nl; i++) if (size[i]! >= SEG.weakBlob * priorPx) hasStrong[i] = 1;
    for (let p = 0; p < n; p++) fg[p] = lab[p]! > 0 && hasStrong[lab[p]!] ? 255 : 0;
  });

  // Grey print: pale-grey/blue-grey print is "the table's colour, only darker", like a shadow. But
  // cast shadows are thin bands (≤ ~3.5 mm) next to pieces; shadow-like pixels far from both the
  // table and any coloured print are print. Their region is grown back over shadow-like pixels
  // by the same distance (the refinement later puts the edge between print and shadow).
  if (SEG.greyCoreMm > 0) withScope((sc) => {
    const notTable = new Uint8Array(n);
    for (let p = 0; p < n; p++) notTable[p] = cls[p] === TABLE || cls[p] === GLARE ? 0 : 255;
    const ntMat = toMat(cv, sc, notTable, w, h);
    const dT = sc.keep(new cv.Mat());
    cv.distanceTransform(ntMat, dT, cv.DIST_L2, 3);
    const notFg = new Uint8Array(n);
    for (let p = 0; p < n; p++) notFg[p] = fg[p] ? 0 : 255;
    const nfMat = toMat(cv, sc, notFg, w, h);
    const dF = sc.keep(new cv.Mat());
    cv.distanceTransform(nfMat, dF, cv.DIST_L2, 3);
    const dt: Float32Array = dT.data32F.slice();
    const df: Float32Array = dF.data32F.slice();
    const tCore = SEG.greyCoreMm * sppm;
    const fCore = SEG.greyFgMm * sppm;
    const grow = new Uint8Array(n);
    let any = false;
    for (let p = 0; p < n; p++) {
      if (cls[p] !== SHADOW && cls[p] !== PALE) continue;
      grow[p] = 255; // where the core may grow
      if (cls[p] === SHADOW && dt[p]! > tCore && df[p]! > fCore && !(explained && explained[p])) {
        notTable[p] = 254; // core marker (reuses the buffer)
        any = true;
      }
    }
    if (any) {
      const core = new Uint8Array(n);
      for (let p = 0; p < n; p++) core[p] = notTable[p] === 254 ? 255 : 0;
      const coreMat = toMat(cv, sc, core, w, h);
      const growMat = toMat(cv, sc, grow, w, h);
      const k3 = sc.keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
      const steps = Math.ceil(tCore);
      for (let i = 0; i < steps; i++) {
        cv.dilate(coreMat, coreMat, k3);
        cv.bitwise_and(coreMat, growMat, coreMat);
      }
      // Grey print of loose pieces comes in piece-sized patches; a large patch is the soft shadow
      // of a person or the phone, not print.
      const gl = sc.keep(new cv.Mat());
      const gs = sc.keep(new cv.Mat());
      const gc = sc.keep(new cv.Mat());
      const ng: number = cv.connectedComponentsWithStats(coreMat, gl, gs, gc, 8, cv.CV_32S);
      const gst: Int32Array = gs.data32S.slice();
      const glab: Int32Array = gl.data32S.slice();
      const ok = new Uint8Array(ng);
      for (let i = 1; i < ng; i++) ok[i] = gst[i * 5 + 4]! <= SEG.greyMaxArea * priorPx ? 1 : 0;
      for (let p = 0; p < n; p++) if (ok[glab[p]!]) fg[p] = 255;
    }
  });

  // Pale pieces: holes of (piece ∪ shadow-like ring).
  const cand = withScope((sc) => {
    const ring = new Uint8Array(n);
    for (let p = 0; p < n; p++) ring[p] = fg[p] || cls[p] === SHADOW ? 255 : 0;
    const ringMat = toMat(cv, sc, ring, w, h);
    // Close small breaks in the ring (the lit side of a piece has only a faint contact shadow).
    const kr = sc.keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(SEG.ringClose, SEG.ringClose)));
    cv.morphologyEx(ringMat, ringMat, cv.MORPH_CLOSE, kr);
    const ringC: Uint8Array = ringMat.data.slice();
    for (let p = 0; p < n; p++) ring[p] = ringC[p]!;
    const ringFilled = fillHoles(cv, sc, ringMat);
    const rf: Uint8Array = ringFilled.data.slice();
    const inner = new Uint8Array(n);
    for (let p = 0; p < n; p++) inner[p] = rf[p] && !ring[p] && !cardZone[p] ? 255 : 0;
    const innerMat = toMat(cv, sc, inner, w, h);
    const il = sc.keep(new cv.Mat());
    const stats = sc.keep(new cv.Mat());
    const cents = sc.keep(new cv.Mat());
    const ni: number = cv.connectedComponentsWithStats(innerMat, il, stats, cents, 8, cv.CV_32S);
    const st: Int32Array = stats.data32S.slice();
    const ild: Int32Array = il.data32S.slice();
    // Which interiors are pale print, and which are just table enclosed by pieces and shadows (a
    // dense layout makes many)? Print: a fair share of it is pale (a little brighter or off-colour),
    // or it borders at most one piece and is piece-shaped. A table island borders several pieces.
    const fgl = sc.keep(new cv.Mat());
    const fgst = sc.keep(new cv.Mat());
    const fgce = sc.keep(new cv.Mat());
    cv.connectedComponentsWithStats(toMat(cv, sc, fg, w, h), fgl, fgst, fgce, 8, cv.CV_32S);
    const fgLab: Int32Array = fgl.data32S.slice();
    const fgArea: Int32Array = fgst.data32S.slice();
    const paleN = new Float64Array(ni);
    const touch: Array<Set<number>> = Array.from({ length: ni }, () => new Set<number>());
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const i = ild[p]!;
        if (!i) continue;
        if (cls[p] === PALE) paleN[i]!++;
        for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const l = fgLab[yy * w + xx]!;
            if (l) touch[i]!.add(l);
          }
        }
      }
    const keep = new Uint8Array(ni);
    for (let i = 1; i < ni; i++) {
      const a = st[i * 5 + 4]!;
      if (a > SEG.maxInterior * priorPx) continue;
      const paleShare = paleN[i]! / a;
      // Small holes are filled later anyway when a piece surrounds them.
      // Bordering several bits of print that together with it make one piece: a pale band
      // between them (a piece whose print is partly near-white), not a gap between pieces. (One
      // bit only would also take in the shadowed hollow of a blank.)
      let union = a;
      for (const l of touch[i]!) union += fgArea[l * 5 + 4]!;
      if (paleShare >= SEG.interiorPale || (touch[i]!.size <= 1 && a >= SEG.interiorMin * priorPx) || (touch[i]!.size >= 2 && union <= SEG.fragmentUnion * priorPx)) keep[i] = 1;
    }
    const cand = new Uint8Array(n);
    for (let p = 0; p < n; p++) cand[p] = (fg[p] || keep[ild[p]!]) && !cardZone[p] ? 255 : 0;
    return cand;
  });

  // Morphology: close small gaps, fill holes, open away thin bridges / specks.
  return withScope((sc) => {
    const candMat = toMat(cv, sc, cand, w, h);
    const k3 = sc.keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)));
    const closed = sc.keep(new cv.Mat());
    cv.morphologyEx(candMat, closed, cv.MORPH_CLOSE, k3);
    const filled = fillHolesMax(cv, sc, closed, SEG.maxHole * priorPx);
    const opened = sc.keep(new cv.Mat());
    cv.morphologyEx(filled, opened, cv.MORPH_OPEN, k3);
    return new Uint8Array(opened.data);
  });
}

/** Glare regions: bright colourless pixels on the TABLE (not inside a piece: white print is not glare), broad spots only. */
function glareMask(cv: Cv, sc: CvScope, cls: Uint8Array, pieceMask: Uint8Array, w: number, h: number, sppm: number): Uint8Array {
  const n = w * h;
  const g = new Uint8Array(n);
  for (let p = 0; p < n; p++) g[p] = cls[p] === GLARE && !pieceMask[p] ? 255 : 0;
  const m = toMat(cv, sc, g, w, h);
  // A lamp's reflection is a broad spot; specks and slivers (white print at a piece's edge) are not.
  const kr = Math.max(1, Math.round(SEG.glareOpenMm * sppm));
  const k = sc.keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * kr + 1, 2 * kr + 1)));
  const o = sc.keep(new cv.Mat());
  cv.morphologyEx(m, o, cv.MORPH_OPEN, k);
  const labels = sc.keep(new cv.Mat());
  const stats = sc.keep(new cv.Mat());
  const cents = sc.keep(new cv.Mat());
  const nl: number = cv.connectedComponentsWithStats(o, labels, stats, cents, 8, cv.CV_32S);
  const st: Int32Array = stats.data32S.slice();
  const minA = SEG.glareMinMm2 * sppm * sppm;
  const keep = new Uint8Array(nl);
  for (let i = 1; i < nl; i++) keep[i] = st[i * 5 + 4]! >= minA ? 1 : 0;
  const lab: Int32Array = labels.data32S.slice();
  const out = new Uint8Array(n);
  for (let p = 0; p < n; p++) out[p] = keep[lab[p]!] ? 1 : 0;
  return out;
}

// ---- Blobs → pieces ---------------------------------------------------------------------------------

interface BlobCtx {
  /** Time spent per sub-step (ms), reported in FindResult.timings as "pieces.*". */
  prof: { outline: number; colour: number; flags: number };
  rgba: PixelBuffer;
  img: SmallRgb;
  field: LightField;
  cls: Uint8Array;
  pieceMask: Uint8Array;
  cardZone: Uint8Array;
  glare: Uint8Array;
  geo: Geometry;
  factor: number;
  sppm: number;
  prior: number;
  W: number;
  H: number;
}

/**
 * Loose pieces touching an assembled area or an object (blobs > `regionArea` × a piece) are cut
 * off: an opening with a disc of ~¼ piece side separates them (interlocked pieces stay joined
 * along whole edges), piece-sized parts (0.3–1.8 × expected) get labels of their own, and every
 * other pixel of the blob goes to its nearest part (breadth-first), so the assembled area keeps
 * its outline.
 */
function peelRegions(cv: Cv, cc: { nl: number; st: Int32Array; lab: Int32Array }, w: number, h: number, expAt: (x: number, y: number) => number): { nl: number; st: Int32Array; lab: Int32Array } {
  const lab = cc.lab;
  const st: number[] = Array.from(cc.st);
  let nl = cc.nl;
  for (let i = 1; i < cc.nl; i++) {
    const x0 = st[i * 5]!;
    const y0 = st[i * 5 + 1]!;
    const bw = st[i * 5 + 2]!;
    const bh = st[i * 5 + 3]!;
    const expPx = expAt(x0 + bw / 2, y0 + bh / 2);
    if (st[i * 5 + 4]! <= SEG.regionArea * expPx) continue;
    const r = Math.max(1, Math.round(SEG.peelRadius * Math.sqrt(expPx)));
    const roi = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (lab[(y0 + y) * w + x0 + x] === i) roi[y * bw + x] = 255;
    const parts = withScope((sc) => {
      const m = toMat(cv, sc, roi, bw, bh);
      const k = sc.keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * r + 1, 2 * r + 1)));
      const o = sc.keep(new cv.Mat());
      cv.morphologyEx(m, o, cv.MORPH_OPEN, k);
      const l = sc.keep(new cv.Mat());
      const pst = sc.keep(new cv.Mat());
      const pce = sc.keep(new cv.Mat());
      const n: number = cv.connectedComponentsWithStats(o, l, pst, pce, 4, cv.CV_32S);
      return { n, lab: l.data32S.slice() as Int32Array, st: pst.data32S.slice() as Int32Array };
    });
    // Seeds: every opened part; piece-sized ones become pieces.
    const isPiece = new Uint8Array(parts.n);
    let pieceParts = 0;
    for (let j = 1; j < parts.n; j++) {
      const a = parts.st[j * 5 + 4]!;
      // Opening shrinks a piece a little (knob tips): compare with a slightly lower range.
      if (a >= SEG.peelPartMin * expPx && a <= SEG.peelPartMax * expPx) {
        isPiece[j] = 1;
        pieceParts++;
      }
    }
    if (!pieceParts) continue;
    const owner = new Int32Array(bw * bh).fill(-1);
    const queue: number[] = [];
    for (let q = 0; q < bw * bh; q++) {
      const j = parts.lab[q]!;
      if (j > 0) {
        owner[q] = j;
        queue.push(q);
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const q = queue[qi]!;
      const x = q % bw;
      const y = (q - x) / bw;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
        const t = yy * bw + xx;
        if (!roi[t] || owner[t]! >= 0) continue;
        owner[t] = owner[q]!;
        queue.push(t);
      }
    }
    const newId = new Int32Array(parts.n);
    for (let j = 1; j < parts.n; j++) if (isPiece[j]) newId[j] = nl++;
    const boxes = new Map<number, number[]>();
    for (let q = 0; q < bw * bh; q++) {
      if (!roi[q]) continue;
      const o = owner[q]!;
      const id = o > 0 && isPiece[o] ? newId[o]! : i;
      const x = x0 + (q % bw);
      const y = y0 + Math.floor(q / bw);
      lab[y * w + x] = id;
      let b = boxes.get(id);
      if (!b) boxes.set(id, (b = [Infinity, Infinity, -Infinity, -Infinity, 0]));
      b[0] = Math.min(b[0]!, x);
      b[1] = Math.min(b[1]!, y);
      b[2] = Math.max(b[2]!, x);
      b[3] = Math.max(b[3]!, y);
      b[4] = b[4]! + 1;
    }
    for (const [id, b] of boxes) {
      st[id * 5] = b[0]!;
      st[id * 5 + 1] = b[1]!;
      st[id * 5 + 2] = b[2]! - b[0]! + 1;
      st[id * 5 + 3] = b[3]! - b[1]! + 1;
      st[id * 5 + 4] = b[4]!;
    }
    if (!boxes.has(i)) st[i * 5 + 4] = 0;
  }
  return { nl, st: Int32Array.from(st), lab };
}

/**
 * Two pieces joined by a thin bridge (a shadow-filled gap, a pale band) are cut apart: a blob
 * bigger than a piece is opened with a ~1 mm disc; when that leaves two or more piece-sized
 * parts, every pixel of the blob goes to the nearest part (breadth-first through the blob).
 * Truly touching pieces usually survive the opening as one part and stay a flagged clump.
 */
function splitNecks(cv: Cv, cc: { nl: number; st: Int32Array; lab: Int32Array }, w: number, h: number, expAt: (x: number, y: number) => number, sppm: number): { nl: number; st: Int32Array; lab: Int32Array } {
  const lab = cc.lab;
  const st: number[] = Array.from(cc.st);
  let nl = cc.nl;
  const r = Math.max(1, Math.round(SEG.neckMm * sppm));
  for (let i = 1; i < cc.nl; i++) {
    const expPx = expAt(st[i * 5]! + st[i * 5 + 2]! / 2, st[i * 5 + 1]! + st[i * 5 + 3]! / 2);
    if (st[i * 5 + 4]! < SEG.neckSplitArea * expPx || st[i * 5 + 4]! > SEG.regionArea * expPx) continue;
    const x0 = st[i * 5]!;
    const y0 = st[i * 5 + 1]!;
    const bw = st[i * 5 + 2]!;
    const bh = st[i * 5 + 3]!;
    const roi = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (lab[(y0 + y) * w + x0 + x] === i) roi[y * bw + x] = 255;
    const parts = withScope((sc) => {
      const m = toMat(cv, sc, roi, bw, bh);
      const k = sc.keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * r + 1, 2 * r + 1)));
      const o = sc.keep(new cv.Mat());
      cv.morphologyEx(m, o, cv.MORPH_OPEN, k);
      const l = sc.keep(new cv.Mat());
      const pst = sc.keep(new cv.Mat());
      const pce = sc.keep(new cv.Mat());
      const n: number = cv.connectedComponentsWithStats(o, l, pst, pce, 8, cv.CV_32S);
      return { n, lab: l.data32S.slice() as Int32Array, st: pst.data32S.slice() as Int32Array };
    });
    const big: number[] = [];
    for (let j = 1; j < parts.n; j++) if (parts.st[j * 5 + 4]! >= SEG.neckPartMin * expPx) big.push(j);
    if (big.length < 2) continue;
    // Multi-source BFS from the big parts through the blob.
    const owner = new Int32Array(bw * bh).fill(-1);
    const queue: number[] = [];
    for (let q = 0; q < bw * bh; q++) {
      const pj = big.indexOf(parts.lab[q]!);
      if (pj >= 0) {
        owner[q] = pj;
        queue.push(q);
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const q = queue[qi]!;
      const x = q % bw;
      const y = (q - x) / bw;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
        const t = yy * bw + xx;
        if (!roi[t] || owner[t]! >= 0) continue;
        owner[t] = owner[q]!;
        queue.push(t);
      }
    }
    const ids = big.map((_, k) => (k === 0 ? i : nl++));
    const boxes = ids.map(() => [Infinity, Infinity, -Infinity, -Infinity, 0]);
    for (let q = 0; q < bw * bh; q++) {
      if (!roi[q] || owner[q]! < 0) continue;
      const x = q % bw;
      const y = (q - x) / bw;
      const b = boxes[owner[q]!]!;
      lab[(y0 + y) * w + x0 + x] = ids[owner[q]!]!;
      b[0] = Math.min(b[0]!, x0 + x);
      b[1] = Math.min(b[1]!, y0 + y);
      b[2] = Math.max(b[2]!, x0 + x);
      b[3] = Math.max(b[3]!, y0 + y);
      b[4] = b[4]! + 1;
    }
    ids.forEach((id, k) => {
      const b = boxes[k]!;
      st[id * 5] = b[0]!;
      st[id * 5 + 1] = b[1]!;
      st[id * 5 + 2] = b[2]! - b[0]! + 1;
      st[id * 5 + 3] = b[3]! - b[1]! + 1;
      st[id * 5 + 4] = b[4]!;
    });
  }
  return { nl, st: Int32Array.from(st), lab };
}

function blobsToPieces(cv: Cv, sc: CvScope, c: BlobCtx): { pieces: FoundPiece[]; regions: FoundRegion[] } {
  const { img, pieceMask, sppm } = c;
  const { width: w, height: h } = img;
  void sc;
  const cc = withScope((s1) => {
    const m = toMat(cv, s1, pieceMask, w, h);
    const labels = s1.keep(new cv.Mat());
    const stats = s1.keep(new cv.Mat());
    const cents = s1.keep(new cv.Mat());
    const count: number = cv.connectedComponentsWithStats(m, labels, stats, cents, 8, cv.CV_32S);
    return { nl: count, st: stats.data32S.slice() as Int32Array, lab: labels.data32S.slice() as Int32Array };
  });

  // Expected piece area (small px): median of plausible blobs, else the prior.
  const priorPx = c.prior * sppm * sppm;
  const plausible: number[] = [];
  for (let i = 1; i < cc.nl; i++) {
    const a = cc.st[i * 5 + 4]!;
    if (a > 0.5 * priorPx && a < 1.6 * priorPx) plausible.push(a);
  }
  plausible.sort((a, b) => a - b);
  const expPx = plausible.length >= 5 ? plausible[plausible.length >> 1]! : priorPx;
  const expAt = expectedAreaField(cc, w, h, expPx);
  const { nl, st, lab } = peelRegions(cv, splitNecks(cv, cc, w, h, expAt, sppm), w, h, expAt);
  const expOf = (i: number) => expAt(st[i * 5]! + st[i * 5 + 2]! / 2, st[i * 5 + 1]! + st[i * 5 + 3]! / 2);

  // Blobs much bigger than a piece: an assembled area or an object. Loose pieces that merely
  // touch one (knob tips, a corner) are cut off first: an opening with a disc of ~¼ piece side
  // separates them (interlocked pieces stay joined along whole edges); piece-sized parts become
  // blobs of their own. The rest is reported as a region, never traced or counted as pieces.
  const regions: FoundRegion[] = [];
  const isRegion = new Uint8Array(nl);
  for (let i = 1; i < nl; i++) {
    if (st[i * 5 + 4]! <= SEG.regionArea * expOf(i)) continue;
    isRegion[i] = 1;
    const outlineImg = withScope((s3) => regionOutline(cv, s3, lab, i, st, w, h, c.factor));
    if (outlineImg.length < 6) continue;
    const outlineMm: number[] = [];
    for (let k = 0; k < outlineImg.length; k += 2) {
      const q = applyH(c.geo.imgToTable, [outlineImg[k]!, outlineImg[k + 1]!]);
      outlineMm.push(q[0], q[1]);
    }
    // An assembled area is printed (varied tones); an object (a phone, a coaster) is mostly plain.
    const hist = new Uint32Array(256);
    let cnt = 0;
    const x0 = st[i * 5]!;
    const y0 = st[i * 5 + 1]!;
    for (let y = y0; y < y0 + st[i * 5 + 3]!; y += 2)
      for (let x = x0; x < x0 + st[i * 5 + 2]!; x += 2) {
        const q = y * w + x;
        if (lab[q] !== i) continue;
        hist[Math.round((c.img.rgb[q * 3]! + 2 * c.img.rgb[q * 3 + 1]! + c.img.rgb[q * 3 + 2]!) / 4)]!++;
        cnt++;
      }
    const pct = (f: number) => {
      let acc = 0;
      for (let v = 0; v < 256; v++) {
        acc += hist[v]!;
        if (acc >= f * cnt) return v;
      }
      return 255;
    };
    // Interquartile range: robust to the object's rim and shadow.
    const printed = pct(0.75) - pct(0.25) > SEG.assembledMinIqr;
    regions.push({ kind: printed && st[i * 5 + 4]! >= SEG.assembledArea * expOf(i) ? 'assembled' : 'object', outlineImg, outlineMm, areaMm2: polyAreaCentroid(outlineMm).area });
  }

  // Fragments: a piece whose print has a near-white band can fall apart into pieces of a piece.
  // A small blob is joined to a neighbour within ~1.5 mm when the two together are still
  // piece-sized (two whole pieces never are).
  const parent = new Int32Array(nl);
  const gArea = new Float64Array(nl);
  for (let i = 0; i < nl; i++) {
    parent[i] = i;
    gArea[i] = st[i * 5 + 4]!;
  }
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const reach = Math.max(2, Math.round(SEG.fragmentGapMm * sppm));
  const order = Array.from({ length: nl - 1 }, (_, k) => k + 1).sort((a, b) => st[a * 5 + 4]! - st[b * 5 + 4]!);
  for (const i of order) {
    if (isRegion[i] || gArea[find(i)]! >= SEG.fragmentMax * expOf(i)) continue;
    const x0 = Math.max(0, st[i * 5]! - reach);
    const y0 = Math.max(0, st[i * 5 + 1]! - reach);
    const x1 = Math.min(w - 1, st[i * 5]! + st[i * 5 + 2]! - 1 + reach);
    const y1 = Math.min(h - 1, st[i * 5 + 1]! + st[i * 5 + 3]! - 1 + reach);
    // Nearest other blob (chessboard distance ≤ reach) to any pixel of blob i.
    const best = new Map<number, number>();
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const j = lab[y * w + x]!;
        if (j === 0 || j === i || isRegion[j]) continue;
        let d = Infinity;
        for (let dy = -reach; dy <= reach && d > 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -reach; dx <= reach; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w || lab[yy * w + xx] !== i) continue;
            d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)));
          }
        }
        if (d <= reach && d < (best.get(j) ?? Infinity)) best.set(j, d);
      }
    const cands = [...best.entries()].sort((a, b) => a[1] - b[1]);
    for (const [j] of cands) {
      const gi = find(i);
      const gj = find(j);
      if (gi === gj) continue;
      if (gArea[gi]! + gArea[gj]! <= SEG.fragmentUnion * expOf(i)) {
        parent[gj] = gi;
        gArea[gi]! += gArea[gj]!;
      }
      break; // only the nearest neighbour
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 1; i < nl; i++) {
    if (isRegion[i]) continue;
    const g = find(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(i);
  }
  const closeR = Math.max(1, Math.round(SEG.closeMm * sppm));
  const pieces: FoundPiece[] = [];
  for (const members of groups.values()) {
    let area = 0;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (const i of members) {
      area += st[i * 5 + 4]!;
      bx0 = Math.min(bx0, st[i * 5]!);
      by0 = Math.min(by0, st[i * 5 + 1]!);
      bx1 = Math.max(bx1, st[i * 5]! + st[i * 5 + 2]!);
      by1 = Math.max(by1, st[i * 5 + 1]! + st[i * 5 + 3]!);
    }
    const expHere = expAt((bx0 + bx1) / 2, (by0 + by1) / 2);
    if (area < SEG.minArea * expHere) continue;
    const piece = withScope((s2) => {
      const pad = 3 + closeR;
      const rx0 = Math.max(0, bx0 - pad);
      const ry0 = Math.max(0, by0 - pad);
      const rx1 = Math.min(w, bx1 + pad);
      const ry1 = Math.min(h, by1 + pad);
      const rw = rx1 - rx0;
      const rh = ry1 - ry0;
      const set = new Set(members);
      const roi = new Uint8Array(rw * rh);
      for (let y = ry0; y < ry1; y++)
        for (let x = rx0; x < rx1; x++) if (set.has(lab[y * w + x]!)) roi[(y - ry0) * rw + (x - rx0)] = 255;
      // Per-piece closing (fills narrow near-white inlets and joins fragments; can't bridge to
      // another piece because only this group's pixels are in the ROI), then hole filling.
      const rm = toMat(cv, s2, roi, rw, rh);
      const k = s2.keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * closeR + 1, 2 * closeR + 1)));
      cv.morphologyEx(rm, rm, cv.MORPH_CLOSE, k);
      const filled = fillHoles(cv, s2, rm);
      const fr: Uint8Array = filled.data.slice();
      // What closing + filling added: keep it unless it is mostly plain table. The hollow of a
      // blank has table in the middle (its mouth can be narrower than the closing); a near-white
      // inlet of the print is not table-coloured all the way through.
      const added = new Uint8Array(rw * rh);
      for (let q = 0; q < rw * rh; q++) added[q] = fr[q] && !roi[q] ? 255 : 0;
      const am = toMat(cv, s2, added, rw, rh);
      const al = s2.keep(new cv.Mat());
      const ast = s2.keep(new cv.Mat());
      const ace = s2.keep(new cv.Mat());
      const na: number = cv.connectedComponentsWithStats(am, al, ast, ace, 4, cv.CV_32S);
      const alab: Int32Array = al.data32S.slice();
      const tabN = new Float64Array(na);
      const totN = new Float64Array(na);
      for (let q = 0; q < rw * rh; q++) {
        const i = alab[q]!;
        if (!i) continue;
        totN[i]!++;
        if (c.cls[(ry0 + Math.floor(q / rw)) * w + rx0 + (q % rw)] === TABLE) tabN[i]!++;
      }
      for (let q = 0; q < rw * rh; q++) {
        const i = alab[q]!;
        if (i && tabN[i]! > SEG.addedTableMax * totN[i]!) fr[q] = 0;
      }
      let a2 = 0;
      for (let q = 0; q < rw * rh; q++) {
        // Never take pixels of another blob.
        const y = ry0 + Math.floor(q / rw);
        const x = rx0 + (q % rw);
        const l = lab[y * w + x]!;
        roi[q] = fr[q] && (l === 0 || set.has(l)) ? 255 : 0;
        if (roi[q]) a2++;
      }
      return onePiece(cv, s2, c, roi, [rx0, ry0, rw, rh], a2, expHere);
    });
    if (!piece) continue;
    if ('kind' in piece) regions.push(piece);
    else pieces.push(piece);
  }
  return { pieces, regions };
}

/**
 * Expected single-piece area (small px²) across the photo: a phone that isn't quite flat sees
 * nearer pieces bigger. A trimmed plane fit of log(area) over piece-sized blobs (0.5–2 × the
 * median), clamped to 0.6–1.6 × the median; the median everywhere when there are < 12 blobs.
 */
function expectedAreaField(cc: { nl: number; st: Int32Array }, w: number, h: number, med: number): (x: number, y: number) => number {
  let pts: Array<{ x: number; y: number; l: number }> = [];
  for (let i = 1; i < cc.nl; i++) {
    const a = cc.st[i * 5 + 4]!;
    if (a < 0.5 * med || a > 2 * med) continue;
    pts.push({ x: (cc.st[i * 5]! + cc.st[i * 5 + 2]! / 2) / w - 0.5, y: (cc.st[i * 5 + 1]! + cc.st[i * 5 + 3]! / 2) / h - 0.5, l: Math.log(a) });
  }
  if (pts.length < 12) return () => med;
  let f: number[] = [Math.log(med), 0, 0];
  for (let iter = 0; iter < 3; iter++) {
    const A = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const r = [0, 0, 0];
    for (const p of pts) {
      const v = [1, p.x, p.y];
      for (let i = 0; i < 3; i++) {
        r[i]! += v[i]! * p.l;
        for (let j = 0; j < 3; j++) A[i]![j]! += v[i]! * v[j]!;
      }
    }
    const sol = solve3x3(A, r);
    if (!sol) break;
    f = sol;
    const res = pts.map((p) => p.l - (f[0]! + f[1]! * p.x + f[2]! * p.y));
    const sorted = res.map(Math.abs).sort((a, b) => a - b);
    const mad = (sorted[sorted.length >> 1] ?? 0) * 1.48 || 1e-6;
    const kept = pts.filter((_, i) => Math.abs(res[i]!) < 2.5 * mad);
    if (kept.length === pts.length || kept.length < 12) break;
    pts = kept;
  }
  return (x: number, y: number) => {
    const v = Math.exp(f[0]! + f[1]! * (x / w - 0.5) + f[2]! * (y / h - 0.5));
    return Math.min(1.6 * med, Math.max(0.6 * med, v));
  };
}

function solve3x3(A: number[][], b: number[]): number[] | null {
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const k = M[r]![c]! / M[c]![c]!;
      for (let j = c; j < 4; j++) M[r]![j]! -= k * M[c]![j]!;
    }
  }
  return [M[0]![3]! / M[0]![0]!, M[1]![3]! / M[1]![1]!, M[2]![3]! / M[2]![2]!];
}

/** Outer outline (photo px) of component `id` of a label image. */
function regionOutline(cv: Cv, sc: CvScope, lab: Int32Array, id: number, st: Int32Array, w: number, h: number, factor: number): number[] {
  const x0 = Math.max(0, st[id * 5]! - 1);
  const y0 = Math.max(0, st[id * 5 + 1]! - 1);
  const x1 = Math.min(w, st[id * 5]! + st[id * 5 + 2]! + 1);
  const y1 = Math.min(h, st[id * 5 + 1]! + st[id * 5 + 3]! + 1);
  const rw = x1 - x0;
  const rh = y1 - y0;
  const roi = new Uint8Array(rw * rh);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (lab[y * w + x] === id) roi[(y - y0) * rw + (x - x0)] = 255;
  const m = toMat(cv, sc, roi, rw, rh);
  const contours = sc.keep(new cv.MatVector());
  const hier = sc.keep(new cv.Mat());
  cv.findContours(m, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  let best: Mat = null;
  let bestA = 0;
  const n: number = contours.size();
  for (let k = 0; k < n; k++) {
    const ct = sc.keep(contours.get(k));
    const a = cv.contourArea(ct);
    if (a > bestA) {
      bestA = a;
      best = ct;
    }
  }
  if (!best) return [];
  const ap = sc.keep(new cv.Mat());
  cv.approxPolyDP(best, ap, 1.0, true);
  const d: Int32Array = ap.data32S.slice();
  const out: number[] = [];
  for (let k = 0; k < d.length; k += 2) out.push((x0 + d[k]! + 0.5) * factor - 0.5, (y0 + d[k + 1]! + 0.5) * factor - 0.5);
  return out;
}

function onePiece(cv: Cv, sc: CvScope, c: BlobCtx, roi: Uint8Array, box: [number, number, number, number], area: number, expPx: number): FoundPiece | FoundRegion | null {
  const { img, cls, cardZone, glare, geo, factor, W, H } = c;
  const { width: w, height: h } = img;
  const [rx0, ry0, rw, rh] = box;
  const rx1 = rx0 + rw;
  const ry1 = ry0 + rh;

  // Flags and statistics on the small image.
  let nearCard = false;
  let strongN = 0;
  let glareIn = 0;
  let glareRing = 0;
  let ringN = 0;
  let touchesEdge = false;
  let sx = 0;
  let sy = 0;
  for (let y = ry0; y < ry1; y++)
    for (let x = rx0; x < rx1; x++) {
      if (!roi[(y - ry0) * rw + (x - rx0)]) continue;
      const p = y * w + x;
      if (cls[p] === STRONG) strongN++;
      if (glare[p]) glareIn++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
      sx += x;
      sy += y;
    }
  const tC = performance.now();
  // Ring of 2 px around the blob: card zone, glare.
  for (let y = ry0; y < ry1; y++)
    for (let x = rx0; x < rx1; x++) {
      const q = (y - ry0) * rw + (x - rx0);
      if (roi[q]) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const yy = y - ry0 + dy;
          const xx = x - rx0 + dx;
          if (yy >= 0 && xx >= 0 && yy < rh && xx < rw && roi[yy * rw + xx]) {
            near = true;
            break;
          }
        }
      if (!near) continue;
      ringN++;
      const p = y * w + x;
      if (cardZone[p]) nearCard = true;
      if (glare[p]) glareRing++;
    }

  c.prof.flags += performance.now() - tC;
  // Outline at full resolution (wall band removed), traced on a sub-pixel membership map.
  const cxs = sx / Math.max(1, area);
  const cys = sy / Math.max(1, area);
  const cImg: Vec2 = [(cxs + 0.5) * factor - 0.5, (cys + 0.5) * factor - 0.5];
  const tA = performance.now();
  const traced = traceOutline(cv, sc, c, roi, rx0, ry0, rw, rh, geo.wallShift(cImg));
  c.prof.outline += performance.now() - tA;
  if (!traced) return null;
  const { outlineImg, solidity, edgeSharp } = traced;
  // No sharp edge anywhere: a soft shadow or a reflection, not a piece.

  if (edgeSharp < SEG.minEdgeSharp) return null;
  if (outlineImg.length < 6) return null;

  // Table coordinates through the top plane.
  const outlineMm: number[] = [];
  for (let k = 0; k < outlineImg.length; k += 2) {
    const q = applyH(geo.imgToTop, [outlineImg[k]!, outlineImg[k + 1]!]);
    outlineMm.push(q[0], q[1]);
  }
  const { area: areaMm2, cx, cy } = polyAreaCentroid(outlineMm);
  const rect = minAreaRect(outlineMm);

  // Colour of the printed face (inside the blob, away from its edge), relative to the table.
  const tB = performance.now();
  const colour = faceColour(c, roi, [rx0, ry0, rw, rh]);
  c.prof.colour += performance.now() - tB;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < outlineImg.length; k += 2) {
    minX = Math.min(minX, outlineImg[k]!);
    maxX = Math.max(maxX, outlineImg[k]!);
    minY = Math.min(minY, outlineImg[k + 1]!);
    maxY = Math.max(maxY, outlineImg[k + 1]!);
  }

  const strongShare = strongN / Math.max(1, area);
  const flags: PieceFlags = {};
  if (touchesEdge || nearCard || minX < 1 || minY < 1 || maxX > W - 2 || maxY > H - 2) flags.cut = true;
  // Not a piece's shape (a remote, a coaster, a phone): too convex or too elongated. Pieces have
  // knobs and blanks (solidity ≈ 0.75–0.92) and are near-square (aspect ≤ ~1.5 with knobs).
  const aspect = Math.max(rect.size[0], rect.size[1]) / Math.max(1e-6, Math.min(rect.size[0], rect.size[1]));
  const relA = area / expPx;
  if (!flags.cut && ((relA <= SEG.clumpArea && (solidity > SEG.objectSolidity || aspect > SEG.objectAspect)) || (relA > SEG.clumpArea && (solidity > SEG.objectSolidity || aspect > 3)))) {
    return { kind: 'object', outlineImg, outlineMm, areaMm2 };
  }
  if (glareIn > 0.01 * area || glareRing > 0.08 * Math.max(1, ringN)) flags.glare = true;
  const rel = area / expPx;
  // Too big, big and not solid, or longer than any piece: probably more than one piece (or a
  // piece with something attached): "spread these apart".
  const expSideMm = Math.sqrt(expPx) / c.sppm;
  if (rel > SEG.clumpArea || (rel > SEG.clumpSolidArea && solidity < SEG.clumpSolidity) || Math.max(rect.size[0], rect.size[1]) > SEG.clumpLength * expSideMm) flags.clump = true;
  if (strongShare < 0.25) flags.weak = true;
  // Bigger than a piece with hardly any clear print: a grey/plain object (a display, a lid), or
  // pale pieces we can't separate anyway. Not reported as pieces.
  if (flags.weak && flags.clump && !flags.cut && strongShare < SEG.weakClumpStrong) return { kind: 'object', outlineImg, outlineMm, areaMm2 };
  const shapeOk = Math.exp(-Math.pow(Math.log(Math.max(0.05, rel)) / 0.35, 2)) * Math.min(1, solidity / 0.8);
  const score = Math.max(0, Math.min(1, (0.4 + 0.6 * Math.min(1, strongShare / 0.6)) * shapeOk * (flags.glare ? 0.7 : 1) * (flags.cut ? 0.5 : 1)));
  // A faint, badly shaped blob the colour of the table (a soft shadow's or reflection's edge).
  const white = rgbToLab(240, 240, 240);
  if (flags.weak && score < SEG.minWeakScore && Math.hypot(colour.meanLab[0] - white[0], colour.meanLab[1], colour.meanLab[2]) < SEG.tableLikeDeltaE) return null;

  return {
    outlineImg,
    outlineMm,
    centreMm: [cx, cy],
    angleDeg: rect.angleDeg,
    areaMm2,
    sizeMm: rect.size,
    meanLab: colour.meanLab,
    hueHist: colour.hueHist,
    bboxImg: [minX, minY, maxX - minX, maxY - minY],
    flags,
    score,
  };
}

/** Membership contrast below which the full-resolution refinement falls back to the small mask (8-bit levels). */
const MIN_EDGE_CONTRAST = 14;

/**
 * Traces the top-face outline of one blob at full resolution.
 *
 * Membership: around the edge each pixel is a blend of the piece's local colour P (median-like
 * local average of the blob's inner part) and the local background B (table or shadow, averaged
 * just outside); m = (I − B)·(P − B) / |P − B|² and the edge is at m = ½, which is unbiased
 * whatever the contrast (a fixed classifier threshold puts low-contrast edges inside the piece).
 * Where P and B are too alike (pale piece on white) the small-image mask decides. The wall band
 * is then removed by erosion along the parallax direction d (photo px), and the outer contour is
 * traced on a 2× upsampled membership map when the photo has fewer than 7 px/mm.
 */
function traceOutline(cv: Cv, sc: CvScope, c: BlobCtx, roi: Uint8Array, rx0: number, ry0: number, rw: number, rh: number, d: Vec2): { outlineImg: number[]; solidity: number; edgeSharp: number } | null {
  const { rgba, factor: f, W, H } = c;
  const ppm = c.sppm * f;
  const X0 = Math.max(0, Math.ceil(rx0 * f - 0.5));
  const Y0 = Math.max(0, Math.ceil(ry0 * f - 0.5));
  const X1 = Math.min(W - 1, Math.floor((rx0 + rw) * f - 0.5));
  const Y1 = Math.min(H - 1, Math.floor((ry0 + rh) * f - 0.5));
  const fw = X1 - X0 + 1;
  const fh = Y1 - Y0 + 1;
  if (fw < 4 || fh < 4) return null;
  const n = fw * fh;

  // Small mask → full-res ROI (smooth), inner and outer zones.
  const small = toMat(cv, sc, roi, rw, rh);
  const detM = sc.keep(new cv.Mat());
  const A = sc.keep(cv.matFromArray(2, 3, cv.CV_64F, [1 / f, 0, (X0 + 0.5) / f - 0.5 - rx0, 0, 1 / f, (Y0 + 0.5) / f - 0.5 - ry0]));
  cv.warpAffine(small, detM, A, new cv.Size(fw, fh), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(0));
  const bin = sc.keep(new cv.Mat());
  cv.threshold(detM, bin, 127, 255, cv.THRESH_BINARY);
  const r = Math.max(1, Math.round(SEG.refineBandMm * ppm));
  const ker = sc.keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * r + 1, 2 * r + 1)));
  const innerM = sc.keep(new cv.Mat());
  cv.erode(bin, innerM, ker);
  const outerM = sc.keep(new cv.Mat());
  cv.dilate(bin, outerM, ker);
  const inner: Uint8Array = innerM.data.slice();
  const outerD: Uint8Array = outerM.data.slice();
  const dm: Uint8Array = detM.data.slice();

  // Colours (lightly denoised) and the masked local averages. All Mats are allocated first:
  // typed-array views into WebAssembly memory go stale when an allocation grows the heap.
  const rgbM = sc.keep(new cv.Mat(fh, fw, cv.CV_32FC3));
  const pIn = sc.keep(new cv.Mat(fh, fw, cv.CV_32FC3));
  const wIn = sc.keep(new cv.Mat(fh, fw, cv.CV_32FC1));
  const pOut = sc.keep(new cv.Mat(fh, fw, cv.CV_32FC3));
  const wOut = sc.keep(new cv.Mat(fh, fw, cv.CV_32FC1));
  const mem = sc.keep(new cv.Mat(fh, fw, cv.CV_8UC1));
  const fr: Float32Array = rgbM.data32F;
  const src = rgba.data;
  for (let y = 0; y < fh; y++) {
    let q = (Y0 + y) * rgba.stride + X0 * 4;
    let o = y * fw * 3;
    for (let x = 0; x < fw; x++, q += 4, o += 3) {
      fr[o] = src[q]!;
      fr[o + 1] = src[q + 1]!;
      fr[o + 2] = src[q + 2]!;
    }
  }
  cv.GaussianBlur(rgbM, rgbM, new cv.Size(0, 0), 0.7, 0.7, cv.BORDER_REPLICATE);
  const I0: Float32Array = rgbM.data32F;
  const pi: Float32Array = pIn.data32F;
  const wi: Float32Array = wIn.data32F;
  const po: Float32Array = pOut.data32F;
  const wo: Float32Array = wOut.data32F;
  for (let p = 0; p < n; p++) {
    const a = inner[p] ? 1 : 0;
    const b = outerD[p] ? 0 : 1;
    wi[p] = a;
    wo[p] = b;
    for (let ch = 0; ch < 3; ch++) {
      pi[p * 3 + ch] = I0[p * 3 + ch]! * a;
      po[p * 3 + ch] = I0[p * 3 + ch]! * b;
    }
  }
  const sig = SEG.refineSigmaMm * ppm;
  for (const m of [pIn, wIn, pOut, wOut]) cv.GaussianBlur(m, m, new cv.Size(0, 0), sig, sig, cv.BORDER_CONSTANT);
  const I: Float32Array = rgbM.data32F;
  const P: Float32Array = pIn.data32F;
  const WI: Float32Array = wIn.data32F;
  const B: Float32Array = pOut.data32F;
  const WO: Float32Array = wOut.data32F;
  const md: Uint8Array = mem.data;
  const k2 = MIN_EDGE_CONTRAST * MIN_EDGE_CONTRAST;
  for (let p = 0; p < n; p++) {
    if (inner[p]) {
      md[p] = 255;
      continue;
    }
    if (!outerD[p]) {
      md[p] = 0;
      continue;
    }
    const a = WI[p]!;
    const b = WO[p]!;
    let m = dm[p]! / 255;
    if (a > 0.01 && b > 0.01) {
      const pr = P[p * 3]! / a;
      const pg = P[p * 3 + 1]! / a;
      const pb = P[p * 3 + 2]! / a;
      const br = B[p * 3]! / b;
      const bg = B[p * 3 + 1]! / b;
      const bb = B[p * 3 + 2]! / b;
      const dr = pr - br;
      const dg = pg - bg;
      const db = pb - bb;
      const dd = dr * dr + dg * dg + db * db;
      if (dd >= k2) m = ((I[p * 3]! - br) * dr + (I[p * 3 + 1]! - bg) * dg + (I[p * 3 + 2]! - bb) * db) / dd;
    }
    md[p] = Math.max(0, Math.min(255, Math.round(m * 255)));
  }
  // Edge sharpness: how fast membership changes across the edge, per mm (a die-cut edge is
  // sharp; the soft edge of a person's or the phone's shadow is not).
  const grads: number[] = [];
  for (let y = 1; y < fh - 1; y++)
    for (let x = 1; x < fw - 1; x++) {
      const p = y * fw + x;
      const v = md[p]!;
      if (v < 90 || v > 165) continue;
      const gx = (md[p + 1]! - md[p - 1]!) / 2;
      const gy = (md[p + fw]! - md[p - fw]!) / 2;
      grads.push(Math.hypot(gx, gy));
    }
  grads.sort((a, b) => a - b);
  // No half-way pixels at all = an abrupt edge (inner and outer zones touch): sharp.
  const edgeSharp = grads.length >= 5 ? (grads[grads.length >> 1]! / 255) * ppm : Infinity;

  // Sub-pixel: trace on a 2× upsampled map when pixels are coarse.
  const U = ppm < 7 ? 2 : 1;
  let memU = mem;
  if (U > 1) {
    memU = sc.keep(new cv.Mat());
    cv.resize(mem, memU, new cv.Size(fw * U, fh * U), 0, 0, cv.INTER_LINEAR);
  }
  cv.threshold(memU, memU, SEG.memberLevel * 255, 255, cv.THRESH_BINARY);
  const filled = fillHoles(cv, sc, memU);

  // Remove the wall band: erosion by the segment [0, d].
  const du: Vec2 = [d[0] * U, d[1] * U];
  const dl = Math.hypot(du[0], du[1]);
  let top = filled;
  if (dl > 0.5) {
    const steps = Math.ceil(dl / 1.5);
    // Not filled.clone(): in OpenCV.js that is embind's handle clone, which shares the pixels.
    top = sc.keep(new cv.Mat());
    filled.copyTo(top);
    const shifted = sc.keep(new cv.Mat());
    for (let s = 1; s <= steps; s++) {
      const lam = s / steps;
      const M = sc.keep(cv.matFromArray(2, 3, cv.CV_64F, [1, 0, lam * du[0], 0, 1, lam * du[1]]));
      cv.warpAffine(filled, shifted, M, new cv.Size(filled.cols, filled.rows), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0));
      cv.threshold(shifted, shifted, 127, 255, cv.THRESH_BINARY);
      cv.bitwise_and(top, shifted, top);
    }
  }
  const contours = sc.keep(new cv.MatVector());
  const hier = sc.keep(new cv.Mat());
  cv.findContours(top, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
  let best: Mat = null;
  let bestA = 0;
  const nc: number = contours.size();
  for (let k = 0; k < nc; k++) {
    const ct = sc.keep(contours.get(k));
    const a = cv.contourArea(ct);
    if (a > bestA) {
      bestA = a;
      best = ct;
    }
  }
  if (!best || bestA < 4) return null;
  const approx = sc.keep(new cv.Mat());
  cv.approxPolyDP(best, approx, 0.35 * U, true);
  const hull = sc.keep(new cv.Mat());
  cv.convexHull(best, hull, false, true);
  const solidity = bestA / Math.max(1, cv.contourArea(hull));
  const pts: Int32Array = approx.data32S.slice();
  const outlineImg: number[] = [];
  // Contour points are centres of the outermost inside pixels: push them out by half a pixel
  // along the outline normal so the polygon covers the pixels' area (unbiased area).
  const np = pts.length / 2;
  const signed = polySigned(pts);
  for (let k = 0; k < np; k++) {
    const a = (k + np - 1) % np;
    const b = (k + 1) % np;
    let tx = pts[2 * b]! - pts[2 * a]!;
    let ty = pts[2 * b + 1]! - pts[2 * a + 1]!;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    // Outward normal: for a clockwise-on-screen (positive signed area) polygon it is (ty, −tx).
    const nx = signed > 0 ? ty : -ty;
    const ny = signed > 0 ? -tx : tx;
    const ux = pts[2 * k]! + 0.5 * nx;
    const uy = pts[2 * k + 1]! + 0.5 * ny;
    outlineImg.push(X0 + (ux + 0.5) / U - 0.5, Y0 + (uy + 0.5) / U - 0.5);
  }
  return { outlineImg, solidity, edgeSharp };
}

function polySigned(pts: ArrayLike<number>): number {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[2 * i]! * pts[2 * j + 1]! - pts[2 * j]! * pts[2 * i + 1]!;
  }
  return a / 2;
}

function faceColour(c: BlobCtx, roi: Uint8Array, box: [number, number, number, number]): { meanLab: [number, number, number]; hueHist: number[] } {
  const { img, field } = c;
  const { width: w, rgb } = img;
  const [x0, y0, rw, rh] = box;
  const x1 = x0 + rw;
  const y1 = y0 + rh;
  const row = new Float32Array(w * 3);
  let L = 0;
  let A = 0;
  let B = 0;
  let n = 0;
  const hist = new Array<number>(8).fill(0);
  const inside = (x: number, y: number) => x >= x0 && y >= y0 && x < x1 && y < y1 && roi[(y - y0) * rw + (x - x0)] !== 0;
  for (let y = y0; y < y1; y++) {
    fieldRow(field, y, x1, row, x0);
    for (let x = x0; x < x1; x++) {
      if (!inside(x, y)) continue;
      // 1 px inside the edge (avoid the wall band and mixed edge pixels).
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) continue;
      const k = (y * w + x) * 3;
      // Rounded so rgbToLab uses its lookup table (1/255 is far below print-colour differences).
      const r = Math.min(255, Math.round((rgb[k]! / row[x * 3]!) * 240));
      const g = Math.min(255, Math.round((rgb[k + 1]! / row[x * 3 + 1]!) * 240));
      const b = Math.min(255, Math.round((rgb[k + 2]! / row[x * 3 + 2]!) * 240));
      const l = rgbToLab(r, g, b);
      L += l[0];
      A += l[1];
      B += l[2];
      n++;
      const ch = Math.hypot(l[1], l[2]);
      if (ch > 4) {
        const hue = (Math.atan2(l[2], l[1]) + 2 * Math.PI) % (2 * Math.PI);
        hist[Math.min(7, Math.floor((hue / (2 * Math.PI)) * 8))]! += ch;
      }
    }
  }
  const hs = hist.reduce((a, v) => a + v, 0);
  return {
    meanLab: n ? [L / n, A / n, B / n] : [0, 0, 0],
    hueHist: hs > 0 ? hist.map((v) => v / hs) : hist,
  };
}

// ---- Geometry helpers ------------------------------------------------------------------------------

function polyAreaCentroid(poly: number[]): { area: number; cx: number; cy: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = poly[2 * i]!;
    const y0 = poly[2 * i + 1]!;
    const x1 = poly[2 * j]!;
    const y1 = poly[2 * j + 1]!;
    const cr = x0 * y1 - x1 * y0;
    a += cr;
    cx += (x0 + x1) * cr;
    cy += (y0 + y1) * cr;
  }
  if (Math.abs(a) < 1e-12) return { area: 0, cx: poly[0] ?? 0, cy: poly[1] ?? 0 };
  return { area: Math.abs(a / 2), cx: cx / (3 * a), cy: cy / (3 * a) };
}

/** Minimum-area rectangle of a polygon (rotating calipers over its convex hull). */
export function minAreaRect(poly: number[]): { angleDeg: number; size: Vec2 } {
  const pts: Vec2[] = [];
  for (let i = 0; i < poly.length; i += 2) pts.push([poly[i]!, poly[i + 1]!]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let best = { area: Infinity, angle: 0, a: 0, b: 0 };
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i]!;
    const q = hull[(i + 1) % hull.length]!;
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const r of hull) {
      const u = r[0] * c + r[1] * s;
      const v = -r[0] * s + r[1] * c;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) best = { area, angle: ang, a: u1 - u0, b: v1 - v0 };
  }
  // Normalise to −45…45° (swap the sides when turning by 90°).
  let deg = (best.angle * 180) / Math.PI;
  let a = best.a;
  let b = best.b;
  while (deg >= 45) {
    deg -= 90;
    [a, b] = [b, a];
  }
  while (deg < -45) {
    deg += 90;
    [a, b] = [b, a];
  }
  return { angleDeg: deg, size: [a, b] };
}

// ---- Glare: fill in from a second photo ----------------------------------------------------------

/** One photo's finder result with its table → image mapping. */
export interface PhotoPieces {
  result: FindResult;
  tableToImg: Mat3;
}

export type MergedPiece = FoundPiece & { /** 0 = first photo, 1 = second photo. */ source: 0 | 1 };

/**
 * Merges two photos of the same pieces taken from slightly different angles (RESEARCH §6: glare
 * spots move with the camera, pieces don't). Matching is in TABLE coordinates (the markers align
 * the photos), by piece centre:
 *  - a piece flagged `glare` in photo A is replaced by its partner from photo B when B saw it
 *    without glare;
 *  - a piece B found inside A's glare mask that A didn't find at all is added.
 * Everything else comes from A. Outlines stay in the pixels of their own photo (`source`).
 */
export function mergeGlare(a: PhotoPieces, b: PhotoPieces, opts: { matchMm?: number } = {}): MergedPiece[] {
  const r = opts.matchMm ?? 4;
  const used = new Set<number>();
  const nearest = (p: FoundPiece): number => {
    let best = -1;
    let bd = r;
    b.result.pieces.forEach((q, j) => {
      if (used.has(j)) return;
      const d = Math.hypot(q.centreMm[0] - p.centreMm[0], q.centreMm[1] - p.centreMm[1]);
      if (d < bd) {
        bd = d;
        best = j;
      }
    });
    return best;
  };
  const out: MergedPiece[] = [];
  for (const p of a.result.pieces) {
    const j = nearest(p);
    if (j >= 0) used.add(j);
    const q = j >= 0 ? b.result.pieces[j]! : null;
    if (p.flags.glare && q && !q.flags.glare && !q.flags.cut) out.push({ ...q, source: 1 });
    else out.push({ ...p, source: 0 });
  }
  const mask = a.result.glareMaskImg;
  if (mask) {
    b.result.pieces.forEach((q, j) => {
      if (used.has(j) || q.flags.glare || q.flags.cut) return;
      const c = applyH(a.tableToImg, q.centreMm);
      const x = Math.round((c[0] + 0.5) / mask.factor - 0.5);
      const y = Math.round((c[1] + 0.5) / mask.factor - 0.5);
      // Inside A's glare, or within ~3 mm of it (A's piece there may have been lost entirely).
      const c1 = applyH(a.tableToImg, [q.centreMm[0] + 1, q.centreMm[1]]);
      const rad = Math.ceil((3 * Math.hypot(c1[0] - c[0], c1[1] - c[1])) / mask.factor);
      let hit = false;
      for (let dy = -rad; dy <= rad && !hit; dy++)
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < mask.width && yy < mask.height && mask.data[yy * mask.width + xx]) {
            hit = true;
            break;
          }
        }
      if (hit) out.push({ ...q, source: 1 });
    });
  }
  return out;
}

// ---- Scale without markers -------------------------------------------------------------------------

/** Ravensburger 1000 cell pitch: √(17.8 × 19.4) mm (a piece's area ≈ its cell's). */
export const DEFAULT_PITCH_MM = 18.6;
/** Measured blob area ÷ true top-face area at the pre-pass scale (walls, halo, mask rounding; tuned on val sets). */
export const SCALE_AREA_BIAS = 1.045;

/**
 * Photo px per mm WITHOUT markers, from the pieces themselves: a cheap pre-pass on a ~1400 px
 * copy finds the blobs and takes the median single-piece area; a piece's area ≈ one cell
 * (pitchMm²). Iterates twice (the blob gates depend on the scale). The phone is held flat, so one
 * number for the whole photo is enough (tilt ≤ 5–8° → ≤ 1–2 % across the view).
 * Returns null when fewer than 5 piece-like blobs are seen.
 */
export function estimatePxPerMm(cv: Cv, rgba: PixelBuffer, opts: { pitchMm?: number; zoom?: number; table?: TableModel | null } = {}): { pxPerMm: number; nPieces: number } | null {
  return cvGuard(cv, () => {
    const pitch = opts.pitchMm ?? DEFAULT_PITCH_MM;
    const W = rgba.width;
    const H = rgba.height;
    const factor = Math.max(1, Math.max(W, H) / SEG.scaleWidth);
    const img = shrinkRgb(rgba, factor);
    const { width: w, height: h } = img;
    const none = new Uint8Array(w * h);
    // First guess: a hand-held overview at 1× (~4 px/mm at 12 MP), close-ups at 2×.
    let ppm = ((opts.zoom ?? 1) >= 2 ? 9 : 4) * (Math.max(W, H) / 4032);
    let result: { pxPerMm: number; nPieces: number } | null = null;
    for (let iter = 0; iter < 3; iter++) {
      const sppm = ppm / factor;
      const field = estimateField(img, { pxPerMm: sppm, ignore: none, chromaPrior: opts.table ? tableChroma(opts.table) : null });
      const alpha = new Float32Array(w * h);
      const cls = classify(img, field, none, sppm, alpha);
      const shadow = SEG.shadowRuns ? explainShadows(cls, w, h, sppm, none) : null;
      const expPx = pitch * pitch * sppm * sppm;
      const onTable = tableRegion(cv, cls, alpha, w, h, sppm);
      const off = new Uint8Array(w * h);
      if (onTable) for (let p = 0; p < w * h; p++) off[p] = onTable[p] ? 0 : 1;
      const mask = buildMask(cv, cls, off, w, h, expPx, sppm, shadow?.explained ?? null);
      // Single-piece-like blobs only: not cut by the edge, piece-like solidity and squareness (not
      // clumps, assembled areas or objects), then the MODE of their log-area.
      const areas = withScope((sc) => {
        const m = toMat(cv, sc, mask, w, h);
        const contours = sc.keep(new cv.MatVector());
        const hier = sc.keep(new cv.Mat());
        cv.findContours(m, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        const out: number[] = [];
        const n: number = contours.size();
        for (let k = 0; k < n; k++) {
          const ct = sc.keep(contours.get(k));
          const a = cv.contourArea(ct);
          if (a < 0.15 * expPx || a > 6 * expPx) continue;
          const r = cv.boundingRect(ct);
          if (r.x <= 0 || r.y <= 0 || r.x + r.width >= w || r.y + r.height >= h) continue;
          const hull = sc.keep(new cv.Mat());
          cv.convexHull(ct, hull, false, true);
          const sol = a / Math.max(1, cv.contourArea(hull));
          const rr = cv.minAreaRect(ct);
          const asp = Math.max(rr.size.width, rr.size.height) / Math.max(1e-6, Math.min(rr.size.width, rr.size.height));
          if (sol < SEG.scaleSolidity[0] || sol > SEG.scaleSolidity[1] || asp > SEG.scaleAspect) continue;
          out.push(a);
        }
        return out;
      });
      if (areas.length < 5) return result;
      // Mode of log(area) (0.04 bins, smoothed), then the median of blobs within ±20 % of it.
      const logs = areas.map((a) => Math.log(a));
      const lo = Math.min(...logs);
      const nb = Math.ceil((Math.max(...logs) - lo) / 0.04) + 1;
      const hist = new Float64Array(nb);
      for (const v of logs) hist[Math.floor((v - lo) / 0.04)]!++;
      let peak = 0;
      let peakN = -1;
      for (let i = 0; i < nb; i++) {
        let v = 0;
        for (let d = -3; d <= 3; d++) if (i + d >= 0 && i + d < nb) v += hist[i + d]! * (4 - Math.abs(d));
        if (v > peakN) {
          peakN = v;
          peak = i;
        }
      }
      const mode = lo + (peak + 0.5) * 0.04;
      const cand = areas.filter((a) => Math.abs(Math.log(a) - mode) < 0.2).sort((x, y) => x - y);
      if (cand.length < 5) return result;
      const med = cand[cand.length >> 1]!;
      const next = (Math.sqrt(med / SCALE_AREA_BIAS) / pitch) * factor;
      result = { pxPerMm: next, nPieces: cand.length };
      const change = Math.abs(next / ppm - 1);
      ppm = next;
      if (change < 0.03) break;
    }
    return result;
  });
}
