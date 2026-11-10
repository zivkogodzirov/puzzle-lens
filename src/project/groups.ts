/**
 * Colour groups of a puzzle's pieces (trays by colour, M4): each piece's colours read from its
 * straightened patch, evened out for the light where it lay (the table's colour around it, from the
 * scan, or for pieces scanned before that from their saved photo), and the groups (fixed while
 * pieces are in trays). The maths is in src/cv/colourGroups.ts.
 */
import {
  evenLight,
  GROUP_LETTERS,
  groupColours,
  labToHex,
  inkOn,
  pieceColours,
  pieceGroup,
  tableAround,
  type Lab,
  type PieceColours,
} from '../cv/colourGroups';
import { db } from '../db/db';
import { applyH, invertH } from '../geo/homography';
import { getBlob } from './store';
import { fixedColours, trayCountOf } from './trays';
import type { PieceRow, Project, SnapRow } from './types';
import { logWarn } from '../log/logger';

type Rgb = [number, number, number];

/** Patches read (raw RGBA) and table colours measured from saved photos, per patch (blob id + time). */
const patchCache = new Map<string, Uint8Array | null>();
const photoLightCache = new Map<string, Rgb | null>();
/** Colours per patch, light and reference light. */
const colourCache = new Map<string, PieceColours | null>();

const keyOf = (p: PieceRow) => `${p.patch!.blobId}|${p.patch!.ts}`;
const pause = () => new Promise((r) => setTimeout(r, 0));
/** Longest run (ms) between breaks for the screen while reading many pieces' colours. */
const YIELD_MS = 30;

/** Longest side a saved photo is decoded at to measure the table around pieces (plenty at 2–4 mm out). */
const PHOTO_SIDE = 2000;

/**
 * The table's colour around pieces scanned before it was measured during the scan, from the photo
 * their patch came from (the scan photo taken at the patch's time), when that photo is still kept.
 */
async function lightsFromPhotos(pieces: PieceRow[]): Promise<void> {
  const need = pieces.filter((p) => p.patch && !p.patch.light && !photoLightCache.has(keyOf(p)));
  if (!need.length) return;
  const snaps = new Map<number, SnapRow>();
  for (const s of await db().snaps.where('projectId').equals(need[0]!.projectId).toArray()) if (s.blobId && s.imgToTable) snaps.set(s.ts, s);
  const bySnap = new Map<SnapRow, PieceRow[]>();
  for (const p of need) {
    const s = snaps.get(p.patch!.ts);
    if (!s) {
      photoLightCache.set(keyOf(p), null);
      continue;
    }
    bySnap.set(s, [...(bySnap.get(s) ?? []), p]);
  }
  for (const [s, ps] of bySnap) {
    try {
      const blob = await getBlob(s.blobId!);
      const H = invertH(s.imgToTable!);
      if (!blob || !H) throw new Error('photo missing');
      const bmp = await createImageBitmap(blob);
      const k = Math.min(1, PHOTO_SIDE / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * k);
      const h = Math.round(bmp.height * k);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      const img = ctx.getImageData(0, 0, w, h);
      canvas.width = canvas.height = 1;
      // Table mm → this decoded picture's px (the snap's size may differ from the stored photo's).
      const kx = w / s.width;
      const ky = h / s.height;
      const toPx = (x: number, y: number): [number, number] => {
        const q = applyH(H, [x, y]);
        return [q[0] * kx, q[1] * ky];
      };
      for (const p of ps) {
        const c = toPx(p.table.x, p.table.y);
        const e = toPx(p.table.x + 10, p.table.y);
        const pxPerMm = Math.hypot(e[0] - c[0], e[1] - c[1]) / 10;
        const outline: number[] = [];
        for (let i = 0; i + 1 < p.outlineMm.length; i += 2) outline.push(...toPx(p.table.x + p.outlineMm[i]!, p.table.y + p.outlineMm[i + 1]!));
        photoLightCache.set(keyOf(p), tableAround({ data: img.data, width: w, height: h, stride: w * 4 }, outline, pxPerMm));
      }
    } catch (err) {
      logWarn('trays', 'A saved photo could not be read to even out the light', err);
      for (const p of ps) photoLightCache.set(keyOf(p), null);
    }
    await pause();
  }
}

/** The light around a piece (sRGB), or null when unknown. */
function lightOf(p: PieceRow): Rgb | null {
  if (!p.patch) return null;
  return p.patch.light ?? photoLightCache.get(keyOf(p)) ?? null;
}

/** Colours of the pieces, and how many couldn't be evened out for the light (no measurement). */
export interface PieceColourSet {
  colours: Map<string, PieceColours>;
  uneven: number;
}

/**
 * Each piece's colours: from its patch, evened out to the typical light of all the pieces' photos
 * (the median table colour), or, for pieces scanned before M4 (no patch), their mean colour.
 * `need` picks the pieces whose colours are worked out (default: all). The typical light, and the
 * count of pieces it couldn't be evened out for, are still from all `pieces`: from the table pieces
 * alone the light changed, and with it the trays of 25 of 300 pieces (measured 2026-11-10).
 */
export async function loadPieceColours(pieces: PieceRow[], need: (p: PieceRow) => boolean = () => true): Promise<PieceColourSet> {
  await lightsFromPhotos(pieces);
  const lights = pieces.map(lightOf).filter((l): l is Rgb => Boolean(l));
  // Rounded so a few more pieces don't change it (and the groups) every time.
  const median = (c: number) => lights.map((l) => l[c] as number).sort((a, b) => a - b)[lights.length >> 1]!;
  const ref = lights.length ? ([0, 1, 2].map((c) => Math.round(median(c) / 4) * 4) as Rgb) : null;
  const colours = new Map<string, PieceColours>();
  let uneven = 0;
  // Keep the screen responsive on a big catalog: a break whenever this has run for a while (the
  // patches may all be read already, and then only the sums take time).
  let since = performance.now();
  for (const p of pieces) {
    if (p.patch && !lightOf(p)) uneven++;
    if (!need(p)) continue;
    let pc: PieceColours | null = null;
    if (p.patch) {
      const key = keyOf(p);
      if (!patchCache.has(key)) {
        const b = await getBlob(p.patch.blobId);
        patchCache.set(key, b ? new Uint8Array(await b.arrayBuffer()) : null);
      }
      const rgba = patchCache.get(key);
      const light = lightOf(p);
      const ck = `${key}|${light?.join(',') ?? '-'}|${ref?.join(',') ?? '-'}`;
      if (!colourCache.has(ck)) colourCache.set(ck, rgba ? pieceColours(light && ref ? evenLight(rgba, light, ref) : rgba) : null);
      pc = colourCache.get(ck) ?? null;
    }
    pc ??= { main: p.colour.meanLab, mainShare: 1, second: null, secondShare: 0 };
    colours.set(p.id, pc);
    if (performance.now() - since > YIELD_MS) {
      await pause();
      since = performance.now();
    }
  }
  return { colours, uneven };
}

export interface Group {
  index: number;
  letter: string;
  lab: Lab;
  hex: string;
  ink: '#000' | '#fff';
}

export interface Groups {
  groups: Group[];
  /** True while pieces are in trays (the groups' colours don't follow the table). */
  fixed: boolean;
  /** Per piece: its group, and the group of a second colour it also has a lot of. Tray pieces: their tray. */
  of: Map<string, { group: number; also: number | null }>;
}

/** The colour groups for the pieces now (on the table and in trays). */
export function makeGroups(project: Pick<Project, 'trays'>, pieces: PieceRow[], colours: Map<string, PieceColours>): Groups {
  const fixed = fixedColours(project, pieces);
  const table = pieces.filter((p) => p.status === 'table' && colours.has(p.id));
  const labs =
    fixed ??
    groupColours(
      table.map((p) => colours.get(p.id)!.main),
      trayCountOf(project),
    );
  const groups = labs.map((lab, index) => ({ index, letter: GROUP_LETTERS[index]!, lab, hex: labToHex(lab), ink: inkOn(lab) }));
  const of = new Map<string, { group: number; also: number | null }>();
  for (const p of pieces) {
    if (p.status === 'tray') {
      const g = p.tray ? GROUP_LETTERS.indexOf(p.tray) : -1;
      if (g >= 0) of.set(p.id, { group: g, also: null });
    } else if (p.status === 'table' && colours.has(p.id) && labs.length) of.set(p.id, pieceGroup(labs, colours.get(p.id)!));
  }
  return { groups, fixed: Boolean(fixed), of };
}

/** The table's typical colour around the pieces (sRGB, median), or null before any is measured. */
export async function tableLight(pieces: PieceRow[]): Promise<Rgb | null> {
  await lightsFromPhotos(pieces);
  const lights = pieces.map(lightOf).filter((l): l is Rgb => Boolean(l));
  if (lights.length < 3) return null;
  const median = (c: number) => lights.map((l) => l[c] as number).sort((a, b) => a - b)[lights.length >> 1]!;
  return [median(0), median(1), median(2)];
}

/** The pieces' straightened patches (RGBA), read once and kept. */
export async function loadPatches(pieces: PieceRow[]): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const p of pieces) {
    if (!p.patch) continue;
    const key = keyOf(p);
    if (!patchCache.has(key)) {
      const b = await getBlob(p.patch.blobId);
      patchCache.set(key, b ? new Uint8Array(await b.arrayBuffer()) : null);
    }
    const rgba = patchCache.get(key);
    if (rgba) out.push(rgba);
  }
  return out;
}
