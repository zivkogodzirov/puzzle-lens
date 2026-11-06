/// <reference lib="webworker" />
/**
 * READER worker (PLAN §3.1): everything about photos (Snaps). In M1: decode a photo, check it
 * tile by tile (size, brightness, blown-out share, sharpness), the 2× lens test, the OpenCV
 * speed benchmark, and small JPEG previews. Later milestones add piece finding and reading here.
 */
import * as Comlink from 'comlink';
import { cvLoadMs, loadCv, wasmBytes, type Cv } from '../cv/loadCv';
import { cvCounters } from '../cv/scope';
import { tileStats, twoXRatio, twoXWindows } from '../cv/photoAnalysis';
import { runCvBench } from '../cv/bench';
import { readVideoFrame } from '../shared/frameRead';
import { JPEG_HEADER_BYTES, parseJpegHeader } from '../device/jpeg';
import { probeWorkerCapabilities } from '../shared/workerCaps';
import type { CvBenchResult, PhotoStats, TwoXResult, WorkerInitInfo, WorkerMemory } from '../shared/types';
import type { ReaderApi } from '../shared/apis';
import { PhotoChecker } from '../cv/photoCheck';
import { setupFromPhoto, toGray } from '../cv/tableSetup';
import { ensureRgba, scanPixels, tableFromPixels } from '../cv/scanPhoto';
import { scanMarkerless } from '../cv/scanMarkerless';
import type { FreeScanOptions, FreeScanReply, ScanOptions, ScanReply, TableSetupReply } from '../shared/apis';
import type { TableModel } from '../project/types';
import { decodeAtMost, findBoxQuad, RECTIFIED_MAX_SIDE, rectifyQuad, type Point, type RectifyBoxResult } from '../cv/rectify';

const TILE = 1024;
/**
 * Photos bigger than this are checked at a reduced size (long side 4032 px) so a 48 MP photo from
 * the iPhone camera screen is never decoded at full size (~195 MB; BRIEF §2).
 */
const MAX_FULL_DECODE_PIXELS = 16_000_000;
const REDUCED_LONG_SIDE = 4032;
let cv: Cv | null = null;
let checker: PhotoChecker | null = null;
/** Longest side of a piece thumbnail (px). */
const THUMB_PX = 160;
let openFrames = 0;

async function ready(): Promise<Cv> {
  cv ??= await loadCv();
  return cv;
}

type Rect = { x: number; y: number; width: number; height: number };
type Rgba = { data: Uint8Array | Uint8ClampedArray; width: number; height: number; stride: number; order: 'RGBA' | 'BGRA' };

/**
 * Reads rectangles of a decoded photo. Prefers VideoFrame.copyTo (exact pixels); falls back to
 * drawing into a small canvas (which Safari's fingerprinting protection may add noise to).
 */
class PhotoReader {
  readonly width: number;
  readonly height: number;
  method: PhotoStats['readMethod'] = 'videoframe';
  private frame: VideoFrame | null = null;
  private canvas: OffscreenCanvas | null = null;

  constructor(private readonly bitmap: ImageBitmap) {
    this.width = bitmap.width;
    this.height = bitmap.height;
    if (typeof VideoFrame !== 'undefined') {
      try {
        this.frame = new VideoFrame(bitmap, { timestamp: 0 });
        openFrames++;
        if (!this.frame.format) {
          this.frame.close();
          openFrames--;
          this.frame = null;
        }
      } catch {
        this.frame = null;
      }
    }
    if (!this.frame) this.method = 'canvas';
  }

  async read(rect: Rect): Promise<Rgba> {
    if (this.frame) {
      try {
        const r = await readVideoFrame(this.frame, rect);
        if (r && r.kind !== 'gray') return { ...r.buffer, order: r.kind === 'rgba' ? 'RGBA' : 'BGRA' };
      } catch {
        /* copyTo refused: use the canvas from now on */
      }
      this.frame.close();
      openFrames--;
      this.frame = null;
      this.method = 'canvas';
    }
    if (!this.canvas || this.canvas.width !== rect.width || this.canvas.height !== rect.height) {
      this.canvas = new OffscreenCanvas(rect.width, rect.height);
    }
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.drawImage(this.bitmap, -rect.x, -rect.y);
    const img = ctx.getImageData(0, 0, rect.width, rect.height);
    return { data: img.data, width: rect.width, height: rect.height, stride: rect.width * 4, order: 'RGBA' };
  }

  close(): void {
    if (this.frame) {
      this.frame.close();
      openFrames--;
    }
    this.frame = null;
    this.canvas = null;
    this.bitmap.close();
  }
}

/** Size of a photo as displayed (EXIF orientation applied), read from its header; null if unknown. */
async function headerSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const info = parseJpegHeader(new Uint8Array(await blob.slice(0, JPEG_HEADER_BYTES).arrayBuffer()));
    return info ? { width: info.displayWidth, height: info.displayHeight } : null;
  } catch {
    return null;
  }
}

async function decode(blob: Blob): Promise<{ reader: PhotoReader; ms: number; original: { width: number; height: number } | null }> {
  const t0 = performance.now();
  const original = await headerSize(blob);
  // imageOrientation defaults to 'from-image', so iPhone photos come out the right way up.
  let bitmap: ImageBitmap;
  if (original && original.width * original.height > MAX_FULL_DECODE_PIXELS) {
    const s = REDUCED_LONG_SIDE / Math.max(original.width, original.height);
    bitmap = await createImageBitmap(blob, {
      resizeWidth: Math.round(original.width * s),
      resizeHeight: Math.round(original.height * s),
      resizeQuality: 'high',
    });
  } else {
    bitmap = await createImageBitmap(blob);
  }
  return { reader: new PhotoReader(bitmap), ms: performance.now() - t0, original };
}

async function bitmapToJpeg(bitmap: ImageBitmap, w: number, h: number, quality: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas in the photo helper');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

/** Brightness, clipping and sharpness of a whole picture, one 1024 px tile at a time. */
async function checkTiles(
  c: Cv,
  reader: PhotoReader,
  meta: Pick<PhotoStats, 'width' | 'height' | 'checkedAt' | 'bytes' | 'type' | 'decodeMs'>,
): Promise<PhotoStats> {
  const t0 = performance.now();
  let pixels = 0;
  let sumLuma = 0;
  let high = 0;
  let low = 0;
  const sharp: number[] = [];
  let tiles = 0;
  for (let y = 0; y < reader.height; y += TILE) {
    for (let x = 0; x < reader.width; x += TILE) {
      const rect = { x, y, width: Math.min(TILE, reader.width - x), height: Math.min(TILE, reader.height - y) };
      const px = await reader.read(rect);
      const s = tileStats(c, px, px.order);
      pixels += s.pixels;
      sumLuma += s.sumLuma;
      high += s.clippedHigh;
      low += s.clippedLow;
      sharp.push(s.lapVar);
      tiles++;
    }
  }
  sharp.sort((a, b) => a - b);
  return {
    ...meta,
    analyseMs: performance.now() - t0,
    tiles,
    tileSize: TILE,
    meanLuma: pixels ? sumLuma / pixels : 0,
    clippedHigh: pixels ? high / pixels : 0,
    clippedLow: pixels ? low / pixels : 0,
    sharpness: sharp[Math.floor(sharp.length / 2)] ?? 0,
    readMethod: reader.method,
    wasmBytesAfter: wasmBytes(c),
  };
}


/** Small JPEG thumbnails of the given boxes and a ≤ 1024 px preview, from RGBA-ordered pixels. */
async function thumbsAndPreview(rgba: { data: Uint8Array | Uint8ClampedArray; width: number; height: number; stride: number }, boxes: Array<[number, number, number, number]>): Promise<{ thumbs: Array<Blob | null>; preview: Blob; previewScale: number }> {
  const rowBytes = rgba.width * 4;
  let packed: Uint8ClampedArray<ArrayBuffer>;
  if (rgba.stride === rowBytes) packed = new Uint8ClampedArray(rgba.data.buffer as ArrayBuffer, rgba.data.byteOffset, rowBytes * rgba.height);
  else {
    packed = new Uint8ClampedArray(rowBytes * rgba.height);
    for (let y = 0; y < rgba.height; y++) packed.set(rgba.data.subarray(y * rgba.stride, y * rgba.stride + rowBytes), y * rowBytes);
  }
  const bmp = await createImageBitmap(new ImageData(packed, rgba.width, rgba.height));
  try {
    const thumbs: Array<Blob | null> = [];
    for (const [x, y, w, h] of boxes) {
      const pad = Math.round(Math.max(w, h) * 0.12);
      const sx = Math.max(0, x - pad);
      const sy = Math.max(0, y - pad);
      const sw = Math.min(rgba.width - sx, w + 2 * pad);
      const sh = Math.min(rgba.height - sy, h + 2 * pad);
      const s = Math.min(1, THUMB_PX / Math.max(sw, sh));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * s)), Math.max(1, Math.round(sh * s)));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        thumbs.push(null);
        continue;
      }
      ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      thumbs.push(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
    }
    const previewScale = Math.min(1, 1024 / Math.max(rgba.width, rgba.height));
    const pc = new OffscreenCanvas(Math.round(rgba.width * previewScale), Math.round(rgba.height * previewScale));
    pc.getContext('2d')?.drawImage(bmp, 0, 0, pc.width, pc.height);
    const preview = await pc.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return { thumbs, preview, previewScale };
  } finally {
    bmp.close();
  }
}

const api: ReaderApi = {
  async init(): Promise<WorkerInitInfo> {
    const capabilities = await probeWorkerCapabilities();
    try {
      await ready();
      return { ok: true, cvLoadMs: cvLoadMs(), capabilities };
    } catch (err) {
      return { ok: false, cvLoadMs: 0, error: String(err), capabilities };
    }
  },

  /** Checks a Snap tile by tile (never the whole 12 MP image at once). */
  /**
   * Wizard step 5: the photo of the empty table with all 8 markers → marker map (and, with piece
   * finding, the table model). The whole photo is read once (12 MP ≈ 48 MB, freed afterwards).
   */
  async setupTable(photo: Blob, opts: { printScale: number; snapId: string }): Promise<TableSetupReply> {
    const c = await ready();
    const t0 = performance.now();
    const { reader } = await decode(photo);
    try {
      const rgba = await reader.read({ x: 0, y: 0, width: reader.width, height: reader.height });
      const gray = toGray(c, rgba, rgba.order);
      checker ??= new PhotoChecker(c);
      const r = setupFromPhoto(c, checker, gray, opts);
      let table: TableModel | null = null;
      if (r.ok && r.map && r.imgToTable) {
        try {
          table = tableFromPixels(c, ensureRgba(rgba), { imgToTable: r.imgToTable, map: r.map, snapId: opts.snapId });
        } catch (err) {
          // The marker map is still good; pieces can be found without a table model (estimated per photo).
          console.warn('Table model failed', err);
        }
      }
      return { ...r, table, width: reader.width, height: reader.height, ms: performance.now() - t0 };
    } finally {
      reader.close();
    }
  },

  /**
   * One scan photo: quality gate, table position, pieces (with a small thumbnail each) and a
   * preview. Pieces come back in table mm, ready for the catalog.
   */
  async scanPhoto(photo: Blob, opts: ScanOptions): Promise<ScanReply> {
    const c = await ready();
    const t0 = performance.now();
    const { reader, ms: decodeMs } = await decode(photo);
    try {
      const rgba = ensureRgba(await reader.read({ x: 0, y: 0, width: reader.width, height: reader.height }));
      checker ??= new PhotoChecker(c);
      const r = scanPixels(c, checker, rgba, opts);
      const { thumbs, preview } = await thumbsAndPreview(rgba, r.pieces.map((p) => p.bboxImg));
      {
        return { ...r, thumbs, preview, width: rgba.width, height: rgba.height, ms: performance.now() - t0, decodeMs };
      }
    } finally {
      reader.close();
    }
  },

  /**
   * Marker-free scan photo: pieces found, then the photo placed by matching them to the catalog
   * (src/cv/scanMarkerless.ts). Also returns each piece's outline in preview pixels, for showing
   * the result over the photo.
   */
  async scanFree(photo: Blob, opts: FreeScanOptions): Promise<FreeScanReply> {
    const c = await ready();
    const t0 = performance.now();
    const { reader, ms: decodeMs } = await decode(photo);
    try {
      const rgba = ensureRgba(await reader.read({ x: 0, y: 0, width: reader.width, height: reader.height }));
      checker ??= new PhotoChecker(c);
      const gray = toGray(c, rgba, 'RGBA');
      const check = checker.check(gray, { map: null, zoom: opts.zoom, kind: opts.kind });
      const r = scanMarkerless(c, rgba, { catalog: opts.catalog, pitchMm: opts.pitchMm, zoom: opts.zoom, kind: opts.kind, table: opts.table });
      const { thumbs, preview, previewScale } = await thumbsAndPreview(rgba, r.pieces.map((p) => p.bboxImg));
      const outlinesPreview = r.pieces.map((p) => p.outlineImg.filter((_, i) => i % 4 < 2).map((v) => v * previewScale));
      return {
        ...r,
        // Without markers, blur is judged from the photo's own sharpness only where markers would be: report tilt/glare reasons from the checker except "no markers".
        reasons: check.quality.reasons.filter((q) => !/marker/i.test(q)),
        sharpness: check.quality.sharpness,
        clippedShare: check.quality.clippedShare,
        thumbs,
        preview,
        previewSize: { width: Math.round(rgba.width * previewScale), height: Math.round(rgba.height * previewScale) },
        outlinesPreview,
        width: rgba.width,
        height: rgba.height,
        ms: performance.now() - t0,
        decodeMs,
      };
    } finally {
      reader.close();
    }
  },

  async analysePhoto(blob: Blob): Promise<PhotoStats> {
    const c = await ready();
    const { reader, ms: decodeMs, original } = await decode(blob);
    try {
      const reduced = original !== null && (original.width !== reader.width || original.height !== reader.height);
      return await checkTiles(c, reader, {
        width: reduced ? original!.width : reader.width,
        height: reduced ? original!.height : reader.height,
        checkedAt: reduced ? [reader.width, reader.height] : null,
        bytes: blob.size,
        type: blob.type || 'unknown',
        decodeMs,
      });
    } finally {
      reader.close();
    }
  },

  /**
   * A Snap taken as the full-size live picture (grabFrame): checks it like a photo (pixels read
   * with VideoFrame.copyTo, so no canvas noise), and makes a preview and a full JPEG for reports.
   * Takes ownership of the bitmap.
   */
  async analyseFrame(bitmap: ImageBitmap): Promise<{ stats: PhotoStats; preview: Blob; jpeg: Blob }> {
    const c = await ready();
    const w = bitmap.width;
    const h = bitmap.height;
    let reader: PhotoReader | null = null;
    try {
      const t0 = performance.now();
      const jpeg = await bitmapToJpeg(bitmap, w, h, 0.92);
      const scale = Math.min(1, 1024 / Math.max(w, h));
      const preview = await bitmapToJpeg(bitmap, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), 0.8);
      const encodeMs = performance.now() - t0;
      reader = new PhotoReader(bitmap);
      const stats = await checkTiles(c, reader, { width: w, height: h, checkedAt: null, bytes: jpeg.size, type: 'image/jpeg', decodeMs: encodeMs });
      return { stats, preview, jpeg };
    } finally {
      if (reader) reader.close();
      else bitmap.close();
    }
  },

  /** The 2× lens test on two full-size live pictures (when takePhoto() isn't available). Takes ownership of both. */
  async twoXFrames(one: ImageBitmap, two: ImageBitmap): Promise<TwoXResult> {
    const c = await ready();
    const r1 = new PhotoReader(one);
    const r2 = new PhotoReader(two);
    try {
      const w = twoXWindows(r1.width, r1.height, r2.width, r2.height);
      const a = await r1.read(w.one);
      const aCopy = { ...a, data: new Uint8Array(a.data) };
      const b = await r2.read(w.two);
      return twoXRatio(c, aCopy, b, { one: [r1.width, r1.height], two: [r2.width, r2.height] }, b.order);
    } finally {
      r1.close();
      r2.close();
    }
  },

  /** The 2× lens test: is 2× a true sensor crop? (RESEARCH §4) */
  async twoX(oneXBlob: Blob, twoXBlob: Blob): Promise<TwoXResult> {
    const c = await ready();
    // One photo decoded at a time: copy the needed window out of the first, close it, then the second.
    const twoSize = await headerSize(twoXBlob);
    const one = await decode(oneXBlob);
    let oneSize: [number, number];
    let aCopy: Rgba;
    try {
      oneSize = [one.reader.width, one.reader.height];
      // The 1× window depends only on the 1× size.
      const w = twoXWindows(one.reader.width, one.reader.height, twoSize?.width ?? one.reader.width, twoSize?.height ?? one.reader.height);
      const a = await one.reader.read(w.one);
      aCopy = { ...a, data: new Uint8Array(a.data) }; // the next read reuses the scratch buffer
    } finally {
      one.reader.close();
    }
    const two = await decode(twoXBlob);
    try {
      const w = twoXWindows(oneSize[0], oneSize[1], two.reader.width, two.reader.height);
      const b = await two.reader.read(w.two);
      return twoXRatio(c, aCopy, b, { one: oneSize, two: [two.reader.width, two.reader.height] }, b.order);
    } finally {
      two.reader.close();
    }
  },

  async bench(): Promise<CvBenchResult> {
    const c = await ready();
    return runCvBench(c, cvLoadMs());
  },

  /** A small JPEG preview of a photo, for the screen and for reports. */
  async preview(blob: Blob, maxSide: number, size?: { width: number; height: number }): Promise<Blob> {
    // Know the size without a full decode: given by the caller, else from the JPEG header, else decode.
    let known = size ?? (await headerSize(blob));
    if (!known) {
      const probe = await createImageBitmap(blob);
      known = { width: probe.width, height: probe.height };
      probe.close();
    }
    const scale = Math.min(1, maxSide / Math.max(known.width, known.height));
    const w = Math.max(1, Math.round(known.width * scale));
    const h = Math.max(1, Math.round(known.height * scale));
    const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' });
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  },

  /**
   * Box picture (wizard step 2): straightens the picture inside 4 corners given as fractions of the
   * photo. The photo is decoded at most 3072 px long (enough for a 2048 px result) and only the
   * part around the picture is copied into OpenCV.
   */
  async rectifyBox(photo: Blob, corners: Array<[number, number]>, maxSide: number = RECTIFIED_MAX_SIDE): Promise<RectifyBoxResult> {
    const t0 = performance.now();
    const c = await ready();
    if (corners.length !== 4) throw new Error('Four corners are needed');
    const original = await headerSize(photo);
    const reader = new PhotoReader(await decodeAtMost(photo, original, 3072));
    try {
      const W = reader.width;
      const H = reader.height;
      const px = corners.map(([x, y]) => [x * W, y * H] as Point);
      const x0 = Math.max(0, Math.floor(Math.min(...px.map((p) => p[0]))) - 2);
      const y0 = Math.max(0, Math.floor(Math.min(...px.map((p) => p[1]))) - 2);
      const x1 = Math.min(W, Math.ceil(Math.max(...px.map((p) => p[0]))) + 2);
      const y1 = Math.min(H, Math.ceil(Math.max(...px.map((p) => p[1]))) + 2);
      if (x1 - x0 < 8 || y1 - y0 < 8) throw new Error('The outline is too small. Drag the dots out to the corners of the picture.');
      const pixels = await reader.read({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
      const out = rectifyQuad(c, pixels, pixels.order, px, { maxSide, offset: [x0, y0], imageSize: { width: W, height: H } });
      const canvas = new OffscreenCanvas(out.width, out.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No 2D canvas in the photo helper');
      ctx.putImageData(new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height), 0, 0);
      const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      const fw = original?.width ?? W;
      const fh = original?.height ?? H;
      return {
        jpeg,
        width: out.width,
        height: out.height,
        aspect: out.aspect,
        photoWidth: fw,
        photoHeight: fh,
        cornersPx: corners.map(([x, y]) => [x * fw, y * fh] as Point),
        ms: performance.now() - t0,
      };
    } finally {
      reader.close();
    }
  },

  /** Box picture: a first guess of its 4 corners (fractions of the photo), from a copy at most 800 px long. */
  async suggestBoxCorners(photo: Blob): Promise<Array<[number, number]> | null> {
    const c = await ready();
    const reader = new PhotoReader(await decodeAtMost(photo, await headerSize(photo), 800));
    try {
      const pixels = await reader.read({ x: 0, y: 0, width: reader.width, height: reader.height });
      return findBoxQuad(c, pixels, pixels.order);
    } finally {
      reader.close();
    }
  },

  memory(): WorkerMemory {
    return {
      wasmBytes: cv ? wasmBytes(cv) : 0,
      liveScoped: cvCounters.liveScoped,
      livePersistent: cvCounters.livePersistent,
      openFrames,
    };
  },
};

Comlink.expose(api);
