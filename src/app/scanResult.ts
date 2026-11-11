/**
 * A scan photo's result in words (M9 part 5): what the result sheet (components/ScanResult.tsx) shows. Every
 * message of M8's note over the camera has a kind here (each `setNote(` of Scan.tsx maps to one); the finished
 * puzzle's is built in screens/Scan.tsx (finishedResult) from its finishedLines.
 */
import { plural } from './words';

/** How a line of the result reads: done/fine, have a look, a problem, or just so you know. */
export type ResultTone = 'good' | 'warn' | 'bad' | 'info';

export interface ResultItem {
  tone: ResultTone;
  text: string;
}

/**
 * Pieces found by an overview, a close-up read, a finished puzzle, hardly any pieces, a photo that couldn't be
 * matched, no marker in view (marker puzzles), nothing measured, a blurred or tilted photo, an error.
 */
export type ResultKind = 'found' | 'closeup' | 'finished' | 'few' | 'unmatched' | 'no-marker' | 'nothing' | 'blocked' | 'error';

export interface ScanResult {
  kind: ResultKind;
  /** Something was added or saved. */
  ok: boolean;
  title: string;
  /** One line under the title (e.g. "5 new, 17 seen before"). */
  sub?: string;
  items: ResultItem[];
  /** This photo can be shown with its outlines ("See photo"). */
  photo: boolean;
}

/** What a photo that was added found (Scan.tsx counts these from the photo and the merge). */
export interface PiecesCounts {
  kind: 'overview' | 'detail';
  /** Pieces in the photo (overview), or read by the close-up. */
  count: number;
  /** New in the catalog. */
  added: number;
  /** Without anything to check (not touching, not faint, not cut by the edge). */
  ready: number;
  /** Spots where pieces touch; faint outlines; pieces only partly outlined. */
  clumps: number;
  faint: number;
  part: number;
  /** From the merge: set aside earlier and back; moved; maybe moved (to check); gone from their spot. */
  back: number;
  moved: number;
  pending: number;
  missing: number;
  /** The photo's quality notes other than blurred or tilted. */
  reasons: string[];
  /** The coin's lines (overview with a coin chosen). */
  coinLines: string[];
  /** Quick scan mode: one overview photo. */
  quick: boolean;
  photo: boolean;
}

/** Pieces found (overview) or read (close-up): the count, then a short list of what to do. */
export function piecesResult(c: PiecesCounts): ScanResult {
  const items: ResultItem[] = c.coinLines.map((text) => ({ tone: /^Coin found/.test(text) ? 'good' : 'warn', text }));
  if (c.ready) items.push({ tone: 'good', text: `${c.ready} ready` });
  if (c.clumps)
    items.push({
      tone: 'warn',
      text: `${c.clumps === 1 ? '1 spot where pieces touch' : `${c.clumps} spots where pieces touch`} (dashed, arrows apart): spread them apart and take another.`,
    });
  if (c.faint)
    items.push({
      tone: 'warn',
      text: `${c.faint} faint outline${c.faint > 1 ? 's' : ''} (dashed, “?”): check ${c.faint > 1 ? 'they are' : 'it is'} outlined right.`,
    });
  if (c.part)
    items.push({
      tone: 'warn',
      text: `${c.part === 1 ? '1 piece' : `${c.part} pieces`} only partly outlined: ${c.part === 1 ? 'its' : 'their'} shape is not used. A close-up helps.`,
    });
  if (c.back)
    items.push({
      tone: 'info',
      text: `${c.back === 1 ? '1 piece' : `${c.back} pieces`} set aside in an earlier batch ${c.back === 1 ? 'is' : 'are'} back: recognised, not counted again.`,
    });
  const movedHere = c.moved - c.back;
  if (movedHere > 0)
    items.push({ tone: 'info', text: `${movedHere === 1 ? '1 piece was' : `${movedHere} pieces were`} moved: recognised, not counted again.` });
  if (c.pending)
    items.push({
      tone: 'warn',
      text: `${c.pending === 1 ? '1 piece' : `${c.pending} pieces`} may be ${c.pending === 1 ? 'one' : 'ones'} you moved: check ${c.pending === 1 ? 'it' : 'them'} on the Pieces tab ("Pieces to check"), or take a close-up.`,
    });
  if (c.missing)
    items.push({
      tone: 'info',
      text: `${c.missing === 1 ? '1 piece is' : `${c.missing} pieces are`} no longer where ${c.missing === 1 ? 'it was' : 'they were'} (taken away, or moved out of view).`,
    });
  for (const q of c.reasons) if (!/Blurred|Tilted/.test(q)) items.push({ tone: 'warn', text: q });
  if (c.kind === 'overview' && c.quick) items.push({ tone: 'info', text: 'Quick scan done. Close-ups (2×) read the shapes better, if you want them.' });
  const seen = Math.max(0, c.count - c.added);
  return {
    kind: c.kind === 'overview' ? 'found' : 'closeup',
    ok: true,
    title: c.kind === 'overview' ? `Found ${plural(c.count, 'piece')}` : `Close-up read: ${plural(c.count, 'piece')}`,
    sub: `${c.added} new${seen ? `, ${seen} seen before` : ''}`,
    items,
    photo: c.photo,
  };
}

/** A first photo with fewer than 5 pieces: not used. */
export function fewResult(photo: boolean): ScanResult {
  return {
    kind: 'few',
    ok: false,
    title: 'Hardly any pieces',
    items: [
      { tone: 'bad', text: 'Hardly any pieces in this photo, so it wasn’t used.' },
      { tone: 'info', text: 'Hold the phone over the spread-out pieces and tap the shutter button.' },
    ],
    photo,
  };
}

/** A later photo that couldn't be placed among the pieces found so far. */
export function unmatchedResult(photo: boolean): ScanResult {
  return {
    kind: 'unmatched',
    ok: false,
    title: 'Couldn’t match this photo',
    items: [
      { tone: 'bad', text: 'This photo could not be matched to the pieces found so far.' },
      { tone: 'info', text: 'Include more of the same pieces (keep about half the picture on pieces already scanned) and try again.' },
    ],
    photo,
  };
}

/** A marker puzzle's photo with no marker in it. */
export function noMarkerResult(photo: boolean): ScanResult {
  return {
    kind: 'no-marker',
    ok: false,
    title: 'No marker in view',
    items: [
      { tone: 'bad', text: 'No marker in this photo, so it can’t be placed on the table yet.' },
      { tone: 'info', text: 'Aim so at least one marker card is in the picture.' },
    ],
    photo,
  };
}

/** A photo whose pieces couldn't be measured (no scale). */
export function nothingResult(photo: boolean): ScanResult {
  return {
    kind: 'nothing',
    ok: false,
    title: 'No pieces measured',
    items: [{ tone: 'bad', text: 'No pieces could be measured in this photo. Point at the pieces and try again.' }],
    photo,
  };
}

/** A blurred or tilted photo ("Blurred: hold the phone still", "Tilted: hold the phone flat"): nothing added. */
export function blockedResult(blocking: string[], photo: boolean): ScanResult {
  const blurred = blocking.some((q) => /Blurred/.test(q));
  const tilted = blocking.some((q) => /Tilted/.test(q));
  return {
    kind: 'blocked',
    ok: false,
    title: blurred && tilted ? 'Blurred and tilted' : blurred ? 'Blurred photo' : 'Tilted photo',
    items: [...blocking.map((text) => ({ tone: 'warn' as const, text })), { tone: 'info', text: 'Nothing was added from this photo.' }],
    photo,
  };
}

/** The photo couldn't be read (the helper didn't start, it took too long, …): the error in plain words. */
export function errorResult(words: string, photo: boolean): ScanResult {
  return {
    kind: 'error',
    ok: false,
    title: 'Couldn’t read this photo',
    items: [
      { tone: 'bad', text: words },
      { tone: 'info', text: 'Nothing was added from this photo. Take another.' },
    ],
    photo,
  };
}
