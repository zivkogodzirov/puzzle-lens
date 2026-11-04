#!/usr/bin/env node
/**
 * Reads the memory limits declared inside a .wasm file (defined or imported memory) and prints
 * "initial X MiB, maximum Y MiB". With --expect-initial-mib N it exits with an error if the initial
 * size differs (used by scripts/build-opencv.sh and test/unit/core-opencv.test.ts).
 *
 * Usage: node scripts/opencv/check-wasm.mjs vendor/opencv/opencv.wasm [--expect-initial-mib 32]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PAGE = 65536;

function leb(bytes, pos) {
  let result = 0;
  let shift = 0;
  let b;
  do {
    b = bytes[pos++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return [result, pos];
}

function readLimits(bytes, pos) {
  const flags = bytes[pos++];
  let initial;
  let maximum = null;
  [initial, pos] = leb(bytes, pos);
  if (flags & 1) [maximum, pos] = leb(bytes, pos);
  return [{ initial, maximum }, pos];
}

/** Returns { initialPages, maximumPages, imported } for the first memory in the module. */
export function wasmMemoryLimits(bytes) {
  if (bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) throw new Error('Not a WebAssembly file');
  let pos = 8;
  while (pos < bytes.length) {
    const id = bytes[pos++];
    let size;
    [size, pos] = leb(bytes, pos);
    const end = pos + size;
    if (id === 2) {
      // import section
      let count;
      let p = pos;
      [count, p] = leb(bytes, p);
      for (let i = 0; i < count; i++) {
        let len;
        [len, p] = leb(bytes, p);
        p += len; // module name
        [len, p] = leb(bytes, p);
        p += len; // field name
        const kind = bytes[p++];
        if (kind === 0) {
          [, p] = leb(bytes, p); // func type index
        } else if (kind === 1) {
          p += 1; // reftype
          [, p] = readLimits(bytes, p);
        } else if (kind === 2) {
          const [lim] = readLimits(bytes, p);
          return { initialPages: lim.initial, maximumPages: lim.maximum, imported: true };
        } else if (kind === 3) {
          p += 2; // valtype + mut
        } else if (kind === 4) {
          p += 1; // tag attribute
          [, p] = leb(bytes, p);
        } else {
          throw new Error(`Unknown import kind ${kind}`);
        }
      }
    } else if (id === 5) {
      let count;
      let p = pos;
      [count, p] = leb(bytes, p);
      if (count > 0) {
        const [lim] = readLimits(bytes, p);
        return { initialPages: lim.initial, maximumPages: lim.maximum, imported: false };
      }
    }
    pos = end;
  }
  throw new Error('No memory found in the WebAssembly file');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: check-wasm.mjs <file.wasm> [--expect-initial-mib N]');
    process.exit(2);
  }
  const lim = wasmMemoryLimits(readFileSync(file));
  const initialMiB = (lim.initialPages * PAGE) / 1048576;
  const maxMiB = lim.maximumPages == null ? null : (lim.maximumPages * PAGE) / 1048576;
  console.log(`initial ${initialMiB} MiB, maximum ${maxMiB == null ? 'none' : `${maxMiB} MiB`}${lim.imported ? ' (imported)' : ''}`);
  const i = process.argv.indexOf('--expect-initial-mib');
  if (i > 0) {
    const want = Number(process.argv[i + 1]);
    if (initialMiB !== want) {
      console.error(`Expected the WebAssembly memory to start at ${want} MiB but it starts at ${initialMiB} MiB.`);
      process.exit(1);
    }
  }
}
