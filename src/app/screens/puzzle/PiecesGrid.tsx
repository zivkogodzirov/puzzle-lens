/**
 * The grid of pieces (M9 part 4, design plan §4 item 7): 4 across (tiles of about 80–88 px on an iPhone), each
 * piece's thumbnail with its badges as before (a green or yellow dot: its spot is very likely / maybe; an orange or
 * teal outline: corner / edge; "?": to check; an arrow: its side of the frame; a letter: its colour group, on the
 * Sort into trays page), a one-line legend above for the badges that are on screen, and a tap opens the piece's card.
 *
 * Used by the Pieces tab and its Sort into trays page (PiecesPages.tsx). The cut-out tiles are design stage 6.
 * At most 200 tiles at first, then "Show more" adds 200 at a time (each tile reads its thumbnail from the
 * database), so a 1000-piece puzzle opens as fast as a small one.
 */
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { SIDE_ARROW, SIDE_WORDS, type FrameSide } from '../../../project/progress';
import type { SpotChoice } from '../../../cv/openSpots';
import type { Placement } from '../../../cv/placement';
import type { PieceRow } from '../../../project/types';
import type { Groups } from '../../../project/groups';
import { useBlobUrl, type ShapeGroup } from './shared';

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
type Badge = 'strong' | 'likely' | 'corner' | 'edge' | 'pending' | 'side' | 'weak' | 'clump' | 'tray';

export function PiecesGrid({ rows, groups, places, sideOf, selected, onOpen, trayOf, empty, resetKey = '', testId = 'catalog' }: PiecesGridProps) {
  const [more, setMore] = useState<{ key: string | number; limit: number }>({ key: resetKey, limit: GRID_STEP });
  const limit = more.key === resetKey ? more.limit : GRID_STEP;
  const setLimit = (n: number) => setMore({ key: resetKey, limit: n });
  const shown = rows.length > limit ? rows.slice(0, limit) : rows;
  const seen = new Set<Badge>();
  const tiles = shown.map((r) => {
    const group = groups.get(r.id) ?? 'unsure';
    const place = places.get(r.id)?.placement ?? null;
    const side = sideOf(r.id);
    const tray = trayOf ? trayOf(r.id) : null;
    if (place?.verdict === 'strong' || place?.verdict === 'likely') seen.add(place.verdict);
    if (group === 'corner' || group === 'edge') seen.add(group);
    if (r.status === 'pending') seen.add('pending');
    if (side) seen.add('side');
    if (r.flags.clump) seen.add('clump');
    else if (r.flags.weak) seen.add('weak');
    if (tray) seen.add('tray');
    return <PieceThumb key={r.id} piece={r} group={group} place={place} selected={selected === r.id} onSelect={() => onOpen(r.id)} tray={tray} side={side} />;
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
      {item('strong', <span class="place-dot place-strong" aria-hidden="true" />, 'very likely')}
      {item('likely', <span class="place-dot place-likely" aria-hidden="true" />, 'maybe')}
      {item('corner', <span class="legend-tile kind-corner" aria-hidden="true" />, 'corner')}
      {item('edge', <span class="legend-tile kind-edge" aria-hidden="true" />, 'edge')}
      {item(
        'pending',
        <span class="pending-tag" aria-hidden="true">
          ?
        </span>,
        'to check',
      )}
      {item(
        'side',
        <span class="side-tag" aria-hidden="true">
          ↑
        </span>,
        'frame side',
      )}
      {item('weak', <span class="legend-tile flag-weak" aria-hidden="true" />, 'faint outline')}
      {item('clump', <span class="legend-tile flag-clump" aria-hidden="true" />, 'touching')}
      {item(
        'tray',
        <span class="tray-tag legend-tray" aria-hidden="true">
          A
        </span>,
        'colour group',
      )}
    </p>
  );
}

function PieceThumb({
  piece,
  group,
  place,
  onSelect,
  selected,
  tray,
  side,
}: {
  piece: PieceRow;
  group: ShapeGroup;
  place: Placement | null;
  onSelect: () => void;
  selected: boolean;
  tray?: TrayTag | null;
  side?: FrameSide | null;
}) {
  const url = useBlobUrl(piece.thumbBlobId, piece.updatedAt);
  const cls = [
    piece.flags.clump ? 'flag-clump' : piece.flags.weak ? 'flag-weak' : '',
    group === 'corner' ? 'kind-corner' : group === 'edge' ? 'kind-edge' : '',
    selected ? 'thumb-selected' : '',
  ]
    .join(' ')
    .trim();
  const title = group === 'corner' ? 'Corner piece' : group === 'edge' ? 'Edge piece' : group === 'interior' ? 'Inside piece' : 'Shape not sure yet';
  return (
    <button class="thumb-btn" onClick={onSelect} data-group={group} data-place={place?.verdict ?? 'none'} aria-label={`${title}: show where it goes`}>
      {url ? <img src={url} class={cls} alt={title} title={title} loading="lazy" /> : <div class={`catalog-empty ${cls}`} title={title} />}
      {place && place.verdict !== 'several' && <span class={`place-dot place-${place.verdict}`} />}
      {piece.status === 'pending' && (
        <span class="pending-tag" title="To check: may be a piece you moved" data-testid="pending-tag">
          ?
        </span>
      )}
      {side && (
        <span class="side-tag" title={SIDE_WORDS[side]} data-testid="side-tag">
          {SIDE_ARROW[side]}
        </span>
      )}
      {tray && (
        <span class="tray-tag" style={{ background: tray.hex, color: tray.ink }} data-testid="tray-tag">
          {tray.letter}
          {tray.also ? `+${tray.also}` : ''}
        </span>
      )}
    </button>
  );
}
