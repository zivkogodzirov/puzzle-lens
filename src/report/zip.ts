/**
 * Builds report / backup ZIP files. Pure function (no DOM), used by the report worker and tests.
 * Images are stored without re-compression (they are JPEGs already).
 */
import { strToU8, zipSync, type Zippable } from 'fflate';

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
  /** true for already-compressed data (JPEG, PNG): store as-is. */
  stored?: boolean;
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const files: Zippable = {};
  const used = new Set<string>();
  for (const e of entries) {
    let name = e.name.replace(/^\/+/, '');
    if (used.has(name)) {
      // Only a dot in the file name itself counts (not one in a folder name like "frames.v2/").
      const slash = name.lastIndexOf('/');
      const dot = name.lastIndexOf('.');
      const hasExt = dot > slash + 1;
      let i = 2;
      const stem = hasExt ? name.slice(0, dot) : name;
      const ext = hasExt ? name.slice(dot) : '';
      while (used.has(`${stem}-${i}${ext}`)) i++;
      name = `${stem}-${i}${ext}`;
    }
    used.add(name);
    const bytes = typeof e.data === 'string' ? strToU8(e.data) : e.data;
    files[name] = [bytes, { level: e.stored ? 0 : 6 }];
  }
  return zipSync(files, { mtime: new Date('2026-01-01T00:00:00Z') });
}
