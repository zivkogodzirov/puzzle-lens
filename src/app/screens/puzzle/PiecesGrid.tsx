/**
 * The grid of pieces (M9 part 4, design plan §4 item 7; tiles M9 part 6, §3.5 "Piece tile"): 4 across (tiles of
 * about 80–88 px on an iPhone), a one-line legend above for the badges on screen, and a tap opens the piece's card.
 *
 * Each tile is a grey square with the piece cut out of its thumbnail by its stored outline (pieceCutout.ts), at
 * about 72 % of the tile with a soft shadow; a piece whose outline can't be drawn into its thumbnail shows the
 * thumbnail as before. No coloured rings (§2 decision 10): a corner / edge glyph top-left; the spot bottom-right (a
 * filled check: very likely, a hollow one: maybe, a violet dot: its shape is read), with the frame side's arrow
 * beside it; an amber "?" (to check: a rescan's piece), "!" (check the outline: faint) or arrows apart (touching
 * another piece, as on the photo's outlines, M9 part 3) top-right; and
 * the colour group's letter bottom-left on the Sort into trays page. Each tile's VoiceOver name says all of it
 * ("Edge piece, very likely column 17 row 8, check outline").
 *
 * Used by the Pieces tab and its Sort into trays page (PiecesPages.tsx). At most 200 tiles at first, then
 * "Show more" adds 200 at a time (each tile reads its thumbnail from the database), so a 1000-piece puzzle opens
 * as fast as a small one.
 */
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { SIDE_ARROW, SIDE_WORDS, type FrameSide } from '../../../project/progress';
import type { SpotChoice } from '../../../cv/openSpots';
import type { Placement } from '../../../cv/placement';
import type { PieceRow } from '../../../project/types';
import type { Groups } from '../../../project/groups';
import { Icon } from '../../ui/icons';
import { SPLIT_GLYPH } from '../../overlay';
import { useBlobUrl, type ShapeGroup } from './shared';
import { cutoutOf, fitsThumb, usePhotoFrames, type Cutout } from './pieceCutout';

/** Tiles drawn at first, and added by each "Show more". */
export const GRID_STEP = 200;

/** A tile's colour-group badge: the group's letter on its colour, "+B" when it also has a lot of B. */
export interface TrayTag {
  letter: string;
  hex: string;
  ink: string;
  also: string | null;
}

/** A piece's colour-group badge from the groups (null: no groups yet, or not grouped). */
export function trayTag(groups: Groups | null, of: { group: number; also: number | null } | undefined): TrayTag | null {
  if (!groups || !of) return null;
  const g = groups.groups[of.group];
  if (!g) return null;
  return { letter: g.letter, hex: g.hex, ink: g.ink, also: of.also !== null ? (groups.groups[of.also]?.letter ?? null) : null };
}

/** The piece needs a look: its shape isn't sure, a rescan saw it where no known piece was, or its outline is faint. */
export function needsCheck(p: PieceRow, group: ShapeGroup | undefined): boolean {
  return group === 'unsure' || p.status === 'pending' || Boolean(p.flags.weak);
}

export interface PiecesGridProps {
  /** The pieces to show, in order. */
  rows: PieceRow[];
  groups: Map<string, ShapeGroup>;
  /** Each piece's spot as shown (the shell's `shownPlaces`). */
  places: Map<string, SpotChoice>;
  sideOf: (id: string) => FrameSide | null;
  /** The piece whose card is open. */
  selected: string | null;
  onOpen: (id: string) => void;
  /** Colour-group badges (Sort into trays). */
  trayOf?: (id: string) => TrayTag | null;
  /** Shown instead of the grid when there are no pieces. */
  empty?: ComponentChildren;
  /** What the rows were picked by (e.g. the filter): "Show more" starts again at 200 when it changes (tiles kept: no remount). */
  resetKey?: string | number;
  testId?: string;
}

/** The legend's entries, in this order; only those on screen are listed. */
type Badge = 'corner' | 'edge' | 'strong' | 'likely' | 'shape' | 'pending' | 'outline' | 'touching' | 'side' | 'tray';

/** What a tile shows: its badges, its name and the legend come from it. */
export interface TileFacts {
  group: ShapeGroup;
  place: Placement | null;
  /** The spot badge: very likely (filled check), maybe (hollow check), shape read (violet dot), or none. */
  spot: 'strong' | 'likely' | 'shape' | null;
  /** The amber badge: "?" a rescan's piece to check; "!" its outline is faint; arrows apart: touching another piece. */
  check: 'pending' | 'weak' | 'clump' | null;
  side: FrameSide | null;
  tray: TrayTag | null;
}

const KIND_WORDS: Record<ShapeGroup, string> = { corner: 'Corner piece', edge: 'Edge piece', interior: 'Inside piece', unsure: 'Shape not sure yet' };

/**
 * The tile's VoiceOver name, e.g. "Edge piece, very likely column 17 row 8, check outline, number 3": its number in
 * the grid (from 1) last, so no two tiles have the same name.
 */
export function tileName(t: TileFacts, n?: number): string {
  const parts = [KIND_WORDS[t.group]];
  const top = t.place?.top[0];
  if (top && (t.spot === 'strong' || t.spot === 'likely'))
    parts.push(`${t.spot === 'strong' ? 'very likely' : 'maybe'} column ${top.col + 1} row ${top.row + 1}`);
  if (t.side) parts.push(SIDE_WORDS[t.side]);
  if (t.check === 'pending') parts.push('to check, may be a piece you moved');
  else if (t.check === 'clump') parts.push('touching another piece');
  else if (t.check) parts.push('check outline');
  if (t.tray) parts.push(`colour group ${t.tray.letter}${t.tray.also ? ` and ${t.tray.also}` : ''}`);
  if (n !== undefined) parts.push(`number ${n}`);
  return parts.join(', ');
}

/** A piece's tile facts. */
export function tileFacts(r: PieceRow, group: ShapeGroup, place: Placement | null, side: FrameSide | null, tray: TrayTag | null): TileFacts {
  const v = place?.verdict;
  return {
    group,
    place,
    spot: v === 'strong' || v === 'likely' ? v : group !== 'unsure' ? 'shape' : null,
    check: r.status === 'pending' ? 'pending' : r.flags.clump ? 'clump' : r.flags.weak ? 'weak' : null,
    side,
    tray,
  };
}

export function PiecesGrid({ rows, groups, places, sideOf, selected, onOpen, trayOf, empty, resetKey = '', testId = 'catalog' }: PiecesGridProps) {
  const [more, setMore] = useState<{ key: string | number; limit: number }>({ key: resetKey, limit: GRID_STEP });
  const frames = usePhotoFrames(rows[0]?.projectId ?? null, rows);
  const limit = more.key === resetKey ? more.limit : GRID_STEP;
  const setLimit = (n: number) => setMore({ key: resetKey, limit: n });
  const shown = rows.length > limit ? rows.slice(0, limit) : rows;
  const seen = new Set<Badge>();
  const tiles = shown.map((r, i) => {
    const f = tileFacts(r, groups.get(r.id) ?? 'unsure', places.get(r.id)?.placement ?? null, sideOf(r.id), trayOf ? trayOf(r.id) : null);
    if (f.group === 'corner' || f.group === 'edge') seen.add(f.group);
    if (f.spot) seen.add(f.spot);
    if (f.check) seen.add(f.check === 'pending' ? 'pending' : f.check === 'clump' ? 'touching' : 'outline');
    if (f.side) seen.add('side');
    if (f.tray) seen.add('tray');
    return <PieceTile key={r.id} piece={r} n={i + 1} facts={f} cut={cutoutOf(r, frames)} selected={selected === r.id} onSelect={() => onOpen(r.id)} />;
  });
  if (!rows.length) return <>{empty}</>;
  return (
    <>
      {seen.size > 0 && <GridLegend badges={seen} />}
      <div class="catalog-grid pieces-grid" data-testid={testId}>
        {tiles}
      </div>
      {rows.length > limit && (
        <button type="button" class="btn btn-block pieces-more" data-testid="catalog-more" onClick={() => setLimit(limit + GRID_STEP)}>
          Show {Math.min(GRID_STEP, rows.length - limit)} more of {rows.length - limit}
        </button>
      )}
    </>
  );
}

/** Corner: two sides of a square drawn bold; edge: one. */
function KindBadge({ kind, legend }: { kind: 'corner' | 'edge'; legend?: boolean }) {
  return (
    <span
      class={`tile-badge tile-kind tile-kind-${kind}${legend ? ' in-legend' : ''}`}
      aria-hidden="true"
      data-testid={legend ? undefined : 'kind-tag'}
      data-kind={kind}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" focusable="false">
        <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" class="tile-kind-frame" />
        <path d={kind === 'corner' ? 'M2.5 13.5V2.5h11' : 'M2.5 2.5h11'} class="tile-kind-side" />
      </svg>
    </span>
  );
}

function SpotBadge({ spot, legend }: { spot: 'strong' | 'likely' | 'shape'; legend?: boolean }) {
  const cls = `tile-spot tile-spot-${spot}${legend ? ' in-legend' : ''}`;
  const testId = legend ? undefined : 'spot-tag';
  if (spot === 'shape') return <span class={cls} aria-hidden="true" data-testid={testId} data-spot={spot} />;
  return (
    <span class={`tile-badge ${cls}`} aria-hidden="true" data-testid={testId} data-spot={spot}>
      <Icon name="check" size={12} />
    </span>
  );
}

/** Touching another piece: a line with arrows pointing apart (the photo's outline badge, M9 part 3). */
function SplitGlyph() {
  return (
    <svg class="tile-split" viewBox="0 0 16 16" width="14" height="14" focusable="false">
      <path d={SPLIT_GLYPH} />
    </svg>
  );
}

/** One line: each badge on screen, drawn as on the tiles, with its word. */
function GridLegend({ badges }: { badges: Set<Badge> }) {
  const item = (b: Badge, glyph: ComponentChildren, words: string) =>
    badges.has(b) ? (
      <span class="pieces-legend-item" key={b}>
        {glyph}
        {words}
      </span>
    ) : null;
  return (
    <p class="pieces-legend" data-testid="pieces-legend">
      {item('corner', <KindBadge kind="corner" legend />, 'corner')}
      {item('edge', <KindBadge kind="edge" legend />, 'edge')}
      {item('strong', <SpotBadge spot="strong" legend />, 'very likely')}
      {item('likely', <SpotBadge spot="likely" legend />, 'maybe')}
      {item('shape', <SpotBadge spot="shape" legend />, 'shape read')}
      {item(
        'pending',
        <span class="tile-badge tile-check in-legend" aria-hidden="true">
          ?
        </span>,
        'to check',
      )}
      {item(
        'outline',
        <span class="tile-badge tile-check in-legend" aria-hidden="true">
          !
        </span>,
        'check outline',
      )}
      {item(
        'touching',
        <span class="tile-badge tile-check in-legend" aria-hidden="true">
          <SplitGlyph />
        </span>,
        'touching',
      )}
      {item(
        'side',
        <span class="tile-badge side-tag in-legend" aria-hidden="true">
          ↑
        </span>,
        'frame side',
      )}
      {item(
        'tray',
        <span class="tile-badge tray-tag in-legend" aria-hidden="true">
          A
        </span>,
        'colour group',
      )}
    </p>
  );
}

/** The thumbnail's (or its shadow's) place in the tile and the outline it is clipped to. */
function cutStyle(c: Cutout) {
  return { left: `${c.left}%`, top: `${c.top}%`, width: `${c.width}%`, height: `${c.height}%`, clipPath: c.clip, WebkitClipPath: c.clip };
}

/**
 * One tile: a grey square with the piece cut out of its thumbnail by its outline (pieceCutout.ts), or the thumbnail
 * itself when the outline can't be drawn into it; the badges in its corners.
 */
function PieceTile({
  piece,
  n,
  facts,
  cut,
  onSelect,
  selected,
}: {
  piece: PieceRow;
  /** Its number in the grid (from 1), in its name. */
  n: number;
  facts: TileFacts;
  cut: Cutout | null;
  onSelect: () => void;
  selected: boolean;
}) {
  const url = useBlobUrl(piece.thumbBlobId, piece.updatedAt);
  // The thumbnail's size once it loads (kept by its address, not by the cut-out: the rows are read again after
  // every change, so the cut-out is a new object while the picture, already loaded, doesn't load again).
  const [size, setSize] = useState<{ url: string; w: number; h: number } | null>(null);
  // Whether it has the shape the cut-out expects (null: not loaded yet; false: the tile shows it whole).
  const checked = cut && url && size?.url === url ? fitsThumb(cut, size.w, size.h) : null;
  const shape = cut && checked !== false ? cut : null;
  const { group, check, side, tray, spot } = facts;
  const onLoad = (e: Event) => {
    const img = e.currentTarget as HTMLImageElement;
    if (url) setSize({ url, w: img.naturalWidth, h: img.naturalHeight });
  };
  return (
    <button
      type="button"
      class={`thumb-btn piece-tile${selected ? ' thumb-selected' : ''}`}
      onClick={onSelect}
      data-id={piece.id}
      data-group={group}
      data-place={facts.place?.verdict ?? 'none'}
      data-cut={shape ? 'outline' : 'thumb'}
      aria-label={tileName(facts, n)}
    >
      {url && shape ? (
        <span class={`tile-piece${checked === null ? ' tile-wait' : ''}`}>
          {/* The soft shadow: the same outline, filled and a little lower (a CSS filter made scrolling 1000 pieces slow). */}
          <span class="tile-shade" style={cutStyle(shape)} />
          <img src={url} class="tile-cut" alt="" loading="lazy" decoding="async" onLoad={onLoad} style={cutStyle(shape)} />
        </span>
      ) : url ? (
        <img src={url} class="tile-thumb" alt="" loading="lazy" decoding="async" />
      ) : (
        <span class="catalog-empty tile-thumb" />
      )}
      {(group === 'corner' || group === 'edge') && <KindBadge kind={group} />}
      {check === 'pending' ? (
        <span class="tile-badge tile-check" aria-hidden="true" data-testid="pending-tag">
          ?
        </span>
      ) : check ? (
        <span class={`tile-badge tile-check flag-${check}`} aria-hidden="true" data-testid="check-tag" data-flag={check}>
          {check === 'clump' ? <SplitGlyph /> : '!'}
        </span>
      ) : null}
      {(side || spot) && (
        <span class="tile-br">
          {side && (
            <span class="tile-badge side-tag" aria-hidden="true" data-testid="side-tag">
              {SIDE_ARROW[side]}
            </span>
          )}
          {spot && <SpotBadge spot={spot} />}
        </span>
      )}
      {tray && (
        <span class="tile-badge tray-tag" style={{ background: tray.hex, color: tray.ink }} aria-hidden="true" data-testid="tray-tag">
          {tray.letter}
          {tray.also ? `+${tray.also}` : ''}
        </span>
      )}
    </button>
  );
}
