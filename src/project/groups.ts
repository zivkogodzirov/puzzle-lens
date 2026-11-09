/**
 * Colour groups of a puzzle's pieces (trays by colour, M4): each piece's colours read from its
 * straightened patch (cached), and the groups (fixed while pieces are in trays). The maths is in
 * src/cv/colourGroups.ts.
 */
import { GROUP_LETTERS, groupColours, labToHex, inkOn, pieceColours, pieceGroup, type Lab, type PieceColours } from '../cv/colourGroups';
import { getBlob } from './store';
import { fixedColours, trayCountOf } from './trays';
import type { PieceRow, Project } from './types';

/** Read colours per patch (blob id + time), so reopening the page is instant. */
const readCache = new Map<string, PieceColours | null>();

/** Each piece's colours: from its patch, or (scanned before M4) from its mean colour. */
export async function loadPieceColours(pieces: PieceRow[]): Promise<Map<string, PieceColours>> {
  const out = new Map<string, PieceColours>();
  let done = 0;
  for (const p of pieces) {
    let pc: PieceColours | null = null;
    if (p.patch) {
      const key = `${p.patch.blobId}|${p.patch.ts}`;
      if (!readCache.has(key)) {
        const b = await getBlob(p.patch.blobId);
        readCache.set(key, b ? pieceColours(new Uint8Array(await b.arrayBuffer())) : null);
        // Keep the screen responsive on a big catalog.
        if (++done % 40 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      pc = readCache.get(key) ?? null;
    }
    pc ??= { main: p.colour.meanLab, mainShare: 1, second: null, secondShare: 0 };
    out.set(p.id, pc);
  }
  return out;
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
