/**
 * src/report/zip.ts: the ZIP builder for reports (and later backups).
 */
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildZip } from '../../src/report/zip';
import { noiseBytes } from '../helpers/images';

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** Offset of the entry's raw (possibly compressed) bytes in the file. */
  dataOffset: number;
}

/** Minimal ZIP central-directory reader (enough to check methods and stored bytes). */
function readCentralDirectory(zip: Uint8Array): CentralEntry[] {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: CentralEntry[] = [];
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central header');
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (dv.getUint32(local, true) !== 0x04034b50) throw new Error('bad local header');
    const dataOffset = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    out.push({ name, method, compressedSize, size, dataOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('buildZip', () => {
  it('round-trips text and binary entries through unzip', () => {
    const bin = noiseBytes(5000, 1);
    const zip = buildZip([
      { name: 'report.json', data: JSON.stringify({ ok: true, n: 3 }) },
      { name: 'frames/frame-1.jpg', data: bin, stored: true },
      { name: 'notes.txt', data: 'Hello — ünïcødé ✓' },
    ]);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(['frames/frame-1.jpg', 'notes.txt', 'report.json']);
    expect(JSON.parse(strFromU8(files['report.json']!))).toEqual({ ok: true, n: 3 });
    expect(files['frames/frame-1.jpg']).toEqual(bin);
    expect(strFromU8(files['notes.txt']!)).toBe('Hello — ünïcødé ✓');
  });

  it('de-duplicates repeated names (stem-2.ext, stem-3.ext …) and strips leading slashes', () => {
    const zip = buildZip([
      { name: 'a.txt', data: '1' },
      { name: 'a.txt', data: '2' },
      { name: '/a.txt', data: '3' },
      { name: 'b', data: '4' },
      { name: 'b', data: '5' },
      { name: 'x.txt', data: '6' },
      { name: 'x-2.txt', data: '7' },
      { name: 'x.txt', data: '8' },
      { name: '.hidden', data: '9' },
      { name: '.hidden', data: '10' },
      { name: 'dir/photo.v1.jpg', data: '11' },
      { name: 'dir/photo.v1.jpg', data: '12' },
    ]);
    const files = unzipSync(zip);
    const byName = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
    expect(byName).toEqual({
      'a.txt': '1',
      'a-2.txt': '2',
      'a-3.txt': '3',
      b: '4',
      'b-2': '5',
      'x.txt': '6',
      'x-2.txt': '7',
      'x-3.txt': '8',
      '.hidden': '9',
      '.hidden-2': '10',
      'dir/photo.v1.jpg': '11',
      'dir/photo.v1-2.jpg': '12',
    });
    // Every entry is kept (nothing silently overwritten).
    expect(readCentralDirectory(zip)).toHaveLength(12);
  });

  /** Fixed: a renamed duplicate must stay in its folder even when the folder name has a dot. */
  it('a duplicate inside a folder whose name has a dot stays in that folder', () => {
    const files = unzipSync(
      buildZip([
        { name: 'frames.v2/frame', data: '1' },
        { name: 'frames.v2/frame', data: '2' },
      ]),
    );
    expect(Object.keys(files).sort()).toEqual(['frames.v2/frame', 'frames.v2/frame-2']);
  });

  it('stored entries keep their bytes identical inside the file; others are compressed', () => {
    const jpegLike = noiseBytes(20_000, 7); // already-compressed data looks random
    const text = 'abc '.repeat(5000);
    const zip = buildZip([
      { name: 'photo.jpg', data: jpegLike, stored: true },
      { name: 'log.txt', data: text },
    ]);
    const entries = readCentralDirectory(zip);
    const photo = entries.find((e) => e.name === 'photo.jpg')!;
    const log = entries.find((e) => e.name === 'log.txt')!;
    expect(photo.method).toBe(0); // stored
    expect(photo.compressedSize).toBe(jpegLike.length);
    expect(zip.subarray(photo.dataOffset, photo.dataOffset + photo.compressedSize)).toEqual(jpegLike);
    expect(log.method).toBe(8); // deflate
    expect(log.size).toBe(text.length);
    expect(log.compressedSize).toBeLessThan(text.length / 10);
  });

  it('is deterministic (fixed timestamps): same input, same bytes', () => {
    const input = [
      { name: 'a.json', data: '{"x":1}' },
      { name: 'b.bin', data: noiseBytes(100, 3), stored: true },
    ];
    expect(buildZip(input)).toEqual(buildZip(input));
  });

  it('an empty list gives a valid empty ZIP', () => {
    const zip = buildZip([]);
    expect(Object.keys(unzipSync(zip))).toEqual([]);
    expect(readCentralDirectory(zip)).toEqual([]);
  });
});
