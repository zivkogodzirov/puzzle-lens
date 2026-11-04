/**
 * Reads a JPEG's pixel size and EXIF orientation from its header, without decoding the image.
 * Used by the Device check so a possibly huge photo (48 MP = 195 MB decoded) is never decoded
 * on the main thread just to learn its size. Pure; touches only the first few hundred KB.
 */

export interface JpegInfo {
  /** Stored pixel size (before EXIF rotation). */
  width: number;
  height: number;
  /** EXIF orientation 1–8 (1 when absent). */
  orientation: number;
  /** Size as displayed, after applying the orientation (5–8 swap width and height). */
  displayWidth: number;
  displayHeight: number;
  progressive: boolean;
}

/** Bytes to read from the start of a file: EXIF (≤ 64 KB) and the tables come before the frame header. */
export const JPEG_HEADER_BYTES = 512 * 1024;

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const PROGRESSIVE = new Set([0xc2, 0xc6, 0xca, 0xce]);

function exifOrientation(b: Uint8Array, start: number, end: number): number | null {
  // "Exif\0\0" then a TIFF header.
  if (end - start < 14) return null;
  if (b[start] !== 0x45 || b[start + 1] !== 0x78 || b[start + 2] !== 0x69 || b[start + 3] !== 0x66 || b[start + 4] !== 0 || b[start + 5] !== 0) return null;
  const tiff = start + 6;
  const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  const big = b[tiff] === 0x4d && b[tiff + 1] === 0x4d;
  if (!little && !big) return null;
  const u16 = (p: number) => (p + 1 < end ? (little ? b[p]! | (b[p + 1]! << 8) : (b[p]! << 8) | b[p + 1]!) : -1);
  const u32 = (p: number) =>
    p + 3 < end ? (little ? (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0 : ((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0) : -1;
  if (u16(tiff + 2) !== 42) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd < tiff || ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) break;
    if (u16(e) === 0x0112) {
      const type = u16(e + 2);
      const v = type === 3 ? u16(e + 8) : type === 4 ? u32(e + 8) : -1;
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** Returns null if this isn't a JPEG or the frame header isn't within `bytes`. */
export function parseJpegHeader(bytes: Uint8Array): JpegInfo | null {
  const b = bytes;
  const n = b.length;
  if (n < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let orientation = 1;
  let i = 2;
  while (i + 3 < n) {
    if (b[i] !== 0xff) {
      i++; // tolerate garbage between segments
      continue;
    }
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before a frame header
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2) return null;
    const start = i + 4;
    const end = Math.min(n, i + 2 + len);
    if (marker === 0xe1) {
      const o = exifOrientation(b, start, end);
      if (o !== null) orientation = o;
    } else if (SOF_MARKERS.has(marker)) {
      if (start + 5 > n) return null;
      const height = (b[start + 1]! << 8) | b[start + 2]!;
      const width = (b[start + 3]! << 8) | b[start + 4]!;
      if (!width || !height) return null;
      const swap = orientation >= 5;
      return { width, height, orientation, displayWidth: swap ? height : width, displayHeight: swap ? width : height, progressive: PROGRESSIVE.has(marker) };
    }
    i += 2 + len;
  }
  return null;
}
